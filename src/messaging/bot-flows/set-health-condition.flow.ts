import { BotFlow, BotFlowResult } from './bot-flow.interface';
import { MessagingProvider } from '../interfaces';
import { LLMProvider } from '../../ai-agent/interfaces';
import { decrypt } from '../../core/encryption';
import { generateGreeting } from './greeting-copy';
import { ConversationTracer } from '../../instrumentation';
import { PatientFactRepository } from '../../decision/patient-fact.repository';

const FLOW_NAME = 'set_health_condition';

/** Build the list of phases from KG data, filtered by track for hybrid conditions. */
function buildPhaseList(
  kg: any,
  selectedClassification: string | null,
  conditionType: string,
  track: 'episodic' | 'chronic',
): Array<{ id: string; label: string; daysStart: number; daysEnd: number | null }> {
  const classificationPhases: Record<string, any> =
    (kg.jsonData as any)?.condition?.classifications?.[selectedClassification ?? '']?.phases ?? {};

  const entries = Object.entries(classificationPhases) as Array<[string, any]>;

  const filtered = entries.filter(([_key, phase]) => {
    if (conditionType !== 'hybrid') return true; // non-hybrid: include all
    const phaseTrack = phase.track as string | undefined;
    if (!phaseTrack) return true;               // legacy v3.1 KB: no track field → include
    if (phaseTrack === 'hybrid') return true;    // hybrid phases apply to both tracks
    return phaseTrack === track;
  });

  // Sort by day_range start ascending
  filtered.sort(([, a], [, b]) => (a.day_range?.[0] ?? 0) - (b.day_range?.[0] ?? 0));

  return filtered.map(([phaseKey, phase], i) => {
    // Strip track suffix from key for display (e.g. "Phase I:episodic" → "Phase I")
    const rawLabel = phaseKey.split(':')[0].trim();
    const label: string = typeof phase.name === 'string' ? phase.name : rawLabel;
    return {
      id: `phase_${i + 1}`,
      label,
      daysStart: (phase.day_range?.[0] ?? 0) as number,
      daysEnd: (phase.day_range?.[1] ?? null) as number | null,
    };
  });
}

/** Derive track and synthetic trigger type from a non-hybrid condition_type. */
function deriveTrackAndTrigger(conditionType: string): { track: 'episodic' | 'chronic'; triggerType: string } {
  if (conditionType === 'chronic') {
    return { track: 'chronic', triggerType: 'enrollment_date' };
  }
  return { track: 'episodic', triggerType: 'discharge_date' };
}

export class SetHealthConditionFlow implements BotFlow {
  readonly name = FLOW_NAME;
  readonly triggerPhrases = ['set health condition'];
  private conversationTracer = new ConversationTracer();

  isActive(session: any): boolean {
    return session?.flowState?.flow === FLOW_NAME;
  }

  async handle(
    session: any,
    message: string,
    patient: any,
    tenantId: string,
    prisma: any,
    adapter: MessagingProvider,
    llm: LLMProvider,
  ): Promise<BotFlowResult> {
    const text = message.trim();
    const step = session?.flowState?.step ?? null;

    if (text.toLowerCase() === 'cancel') {
      await this.clearFlowState(prisma, session.id);
      await adapter.sendMessage({
        channel: session.channel,
        recipientId: session.senderId,
        content: [{ type: 'text', text: 'Cancelled. Send any message to continue.' }],
      });
      return { handled: true, done: true };
    }

    if (step === null)                      return this.handleTrigger(session, patient, tenantId, prisma, adapter);
    if (step === 'awaiting_condition')      return this.handleConditionSelected(session, text, patient, tenantId, prisma, adapter);
    if (step === 'awaiting_track')          return this.handleTrackSelected(session, text, patient, tenantId, prisma, adapter);
    if (step === 'awaiting_classification') return this.handleClassificationSelected(session, text, patient, tenantId, prisma, adapter);
    if (step === 'awaiting_phase')          return this.handlePhaseSelected(session, text, patient, prisma, adapter, llm);

    return { handled: true, done: false };
  }

  // ── Step 1: Show active KGs ──────────────────────────────────────────────

  private async handleTrigger(
    session: any,
    patient: any,
    tenantId: string,
    prisma: any,
    adapter: MessagingProvider,
  ): Promise<BotFlowResult> {
    const kgs = await prisma.knowledgeGraph.findMany({
      where: { status: 'ACTIVE', tenantId },
      select: { id: true, condition: true },
      take: 10,
    });

    if (kgs.length === 0) {
      await adapter.sendMessage({
        channel: session.channel,
        recipientId: session.senderId,
        content: [{ type: 'text', text: 'No health conditions are configured yet. Please contact your care coordinator.' }],
      });
      return { handled: true, done: false };
    }

    await prisma.messageSession.update({
      where: { id: session.id },
      data: { flowState: { flow: FLOW_NAME, step: 'awaiting_condition' } },
    });

    await adapter.sendMessage({
      channel: session.channel,
      recipientId: session.senderId,
      content: [{
        type: 'interactive',
        interactive: {
          type: 'list',
          body: 'Which health condition would you like to set?',
          listButtonLabel: 'Select',
          sections: [{
            title: 'Available Conditions',
            rows: kgs.map((kg: any) => ({
              id: kg.id,
              title: kg.condition.length > 24 ? kg.condition.slice(0, 23) + '…' : kg.condition,
              ...(kg.condition.length > 24 ? { description: kg.condition } : {}),
            })),
          }],
        },
      }],
    });

    return { handled: true, done: false };
  }

  // ── Step 2: KG selected — hybrid or non-hybrid branch ───────────────────

  private async handleConditionSelected(
    session: any,
    selectedId: string,
    patient: any,
    tenantId: string,
    prisma: any,
    adapter: MessagingProvider,
  ): Promise<BotFlowResult> {
    const kg = await prisma.knowledgeGraph.findFirst({
      where: { id: selectedId, tenantId, status: 'ACTIVE' },
      select: { id: true, condition: true, jsonData: true },
    });

    if (!kg) return this.handleTrigger(session, patient, tenantId, prisma, adapter);

    const conditionType: string = (kg.jsonData as any)?.condition?.condition_type ?? 'episodic';
    const classificationMap = (kg.jsonData as any)?.condition?.classifications ?? {};
    const classifications: string[] = Object.keys(classificationMap);

    // ── Hybrid → always ask track first ─────────────────────────────────
    if (conditionType === 'hybrid') {
      await prisma.messageSession.update({
        where: { id: session.id },
        data: {
          flowState: {
            flow: FLOW_NAME,
            step: 'awaiting_track',
            kgId: kg.id,
            conditionName: kg.condition,
            conditionType: 'hybrid',
            classifications,
            retryCount: 0,
          },
        },
      });
      return this.sendTrackButtons(session, adapter);
    }

    // ── Non-hybrid → derive track/triggerType immediately ────────────────
    const { track, triggerType } = deriveTrackAndTrigger(conditionType);

    if (classifications.length === 1) {
      const selectedClassification = classifications[0];
      const phases = buildPhaseList(kg, selectedClassification, conditionType, track);
      if (phases.length === 0) return this.sendNoPhasesError(session, adapter, prisma);
      await prisma.messageSession.update({
        where: { id: session.id },
        data: {
          flowState: {
            flow: FLOW_NAME,
            step: 'awaiting_phase',
            kgId: kg.id,
            conditionName: kg.condition,
            conditionType,
            track,
            triggerType,
            selectedClassification,
            phases,
          },
        },
      });
      return this.sendPhaseList(session, kg.condition, phases, adapter);
    }

    await prisma.messageSession.update({
      where: { id: session.id },
      data: {
        flowState: {
          flow: FLOW_NAME,
          step: 'awaiting_classification',
          kgId: kg.id,
          conditionName: kg.condition,
          conditionType,
          track,
          triggerType,
          classifications,
          retryCount: 0,
        },
      },
    });

    return this.sendClassificationPrompt(session, classifications, adapter);
  }

  // ── Step 2b: Track selected (hybrid only) ────────────────────────────────

  private async handleTrackSelected(
    session: any,
    selectedTrackId: string,
    patient: any,
    tenantId: string,
    prisma: any,
    adapter: MessagingProvider,
  ): Promise<BotFlowResult> {
    const flowState = session.flowState;

    if (selectedTrackId !== 'track_episodic' && selectedTrackId !== 'track_chronic') {
      const retryCount = (flowState.retryCount ?? 0) + 1;
      if (retryCount >= 3) {
        await this.clearFlowState(prisma, session.id);
        await adapter.sendMessage({
          channel: session.channel,
          recipientId: session.senderId,
          content: [{ type: 'text', text: 'Too many invalid responses. Setup cancelled. Send any message to try again.' }],
        });
        return { handled: true, done: true };
      }
      await prisma.messageSession.update({
        where: { id: session.id },
        data: { flowState: { ...flowState, retryCount } },
      });
      return this.sendTrackButtons(session, adapter);
    }

    const track: 'episodic' | 'chronic' = selectedTrackId === 'track_chronic' ? 'chronic' : 'episodic';
    const triggerType = track === 'chronic' ? 'enrollment_date' : 'discharge_date';
    const classifications: string[] = flowState.classifications ?? [];

    // Load the KG to build phase list
    const kg = await prisma.knowledgeGraph.findFirst({
      where: { id: flowState.kgId, tenantId, status: 'ACTIVE' },
      select: { id: true, condition: true, jsonData: true },
    });

    if (!kg) {
      await this.clearFlowState(prisma, session.id);
      await adapter.sendMessage({
        channel: session.channel,
        recipientId: session.senderId,
        content: [{ type: 'text', text: 'Could not load the condition. Please try again.' }],
      });
      return { handled: true, done: true };
    }

    if (classifications.length === 1) {
      const selectedClassification = classifications[0];
      const phases = buildPhaseList(kg, selectedClassification, 'hybrid', track);
      if (phases.length === 0) return this.sendNoPhasesError(session, adapter, prisma);
      await prisma.messageSession.update({
        where: { id: session.id },
        data: {
          flowState: {
            flow: FLOW_NAME,
            step: 'awaiting_phase',
            kgId: kg.id,
            conditionName: kg.condition,
            conditionType: 'hybrid',
            track,
            triggerType,
            selectedClassification,
            phases,
          },
        },
      });
      return this.sendPhaseList(session, kg.condition, phases, adapter);
    }

    await prisma.messageSession.update({
      where: { id: session.id },
      data: {
        flowState: {
          flow: FLOW_NAME,
          step: 'awaiting_classification',
          kgId: kg.id,
          conditionName: kg.condition,
          conditionType: 'hybrid',
          track,
          triggerType,
          classifications,
          retryCount: 0,
        },
      },
    });

    return this.sendClassificationPrompt(session, classifications, adapter);
  }

  // ── Step 3: Classification selected ─────────────────────────────────────

  private async handleClassificationSelected(
    session: any,
    selectedIdx: string,
    patient: any,
    tenantId: string,
    prisma: any,
    adapter: MessagingProvider,
  ): Promise<BotFlowResult> {
    const flowState = session.flowState;
    const classifications: string[] = flowState.classifications ?? [];
    const index = parseInt(selectedIdx, 10);
    const isValid = !isNaN(index) && index >= 0 && index < classifications.length;

    if (!isValid) {
      const retryCount = (flowState.retryCount ?? 0) + 1;
      if (retryCount >= 3) {
        await this.clearFlowState(prisma, session.id);
        await adapter.sendMessage({
          channel: session.channel,
          recipientId: session.senderId,
          content: [{ type: 'text', text: 'Too many invalid responses. Setup cancelled. Send any message to try again.' }],
        });
        return { handled: true, done: true };
      }
      await prisma.messageSession.update({
        where: { id: session.id },
        data: { flowState: { ...flowState, retryCount } },
      });
      return this.sendClassificationPrompt(session, classifications, adapter);
    }

    const selectedClassification = classifications[index];

    // Load KG to build phase list (needed for awaiting_phase state)
    const kg = await prisma.knowledgeGraph.findFirst({
      where: { id: flowState.kgId, tenantId, status: 'ACTIVE' },
      select: { id: true, condition: true, jsonData: true },
    });

    if (!kg) {
      await this.clearFlowState(prisma, session.id);
      await adapter.sendMessage({
        channel: session.channel,
        recipientId: session.senderId,
        content: [{ type: 'text', text: 'Could not load the condition. Please try again.' }],
      });
      return { handled: true, done: true };
    }

    const phases = buildPhaseList(kg, selectedClassification, flowState.conditionType, flowState.track);
    if (phases.length === 0) return this.sendNoPhasesError(session, adapter, prisma);

    await adapter.sendMessage({
      channel: session.channel,
      recipientId: session.senderId,
      content: [{ type: 'text', text: `Got it — ${selectedClassification} selected.` }],
    });

    await prisma.messageSession.update({
      where: { id: session.id },
      data: {
        flowState: {
          flow: FLOW_NAME,
          step: 'awaiting_phase',
          kgId: flowState.kgId,
          conditionName: flowState.conditionName,
          conditionType: flowState.conditionType,
          track: flowState.track,
          triggerType: flowState.triggerType,
          selectedClassification,
          phases,
        },
      },
    });

    return this.sendPhaseList(session, flowState.conditionName, phases, adapter);
  }

  // ── Step 4: Phase selected — persist and greet ───────────────────────────

  private async handlePhaseSelected(
    session: any,
    selectedPhaseId: string,
    patient: any,
    prisma: any,
    adapter: MessagingProvider,
    llm: LLMProvider,
  ): Promise<BotFlowResult> {
    const flowState = session.flowState;
    const phases: Array<{ id: string; label: string; daysStart: number; daysEnd: number | null }> =
      flowState.phases ?? [];

    const phase = phases.find((p: any) => p.id === selectedPhaseId);
    if (!phase) return this.sendPhaseList(session, flowState.conditionName, phases, adapter);

    // Use midpoint of phase window as synthetic "days since start"
    const syntheticDaysAgo =
      phase.daysEnd !== null
        ? Math.round((phase.daysStart + phase.daysEnd) / 2)
        : phase.daysStart + 7;

    const now = new Date();
    const startDate = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() - syntheticDaysAgo,
    ));

    // Test identities can reuse the same phone number across unrelated
    // scenarios (testers have no portal access, so this flow is the only
    // way to reassign a test patient's condition). PatientFact has no
    // episode tag, so old facts would otherwise resolve as "live" for the
    // new scenario if fact names overlap across conditions -- see
    // docs/superpowers/CONCEPTS.md §10 for the full contamination story.
    // Only a genuine condition/classification switch flushes; a phase-only
    // change (same condition, same classification) is the deliberate
    // temporal-continuity test case and must keep its facts.
    const scenarioChanged =
      patient.condition !== flowState.conditionName ||
      (patient.classification ?? null) !== (flowState.selectedClassification ?? null);

    // Deliberately NOT persisting knowledgeGraphId -- patients always resolve
    // to whatever KG is currently ACTIVE for their condition, not a snapshot
    // pinned at enrollment. flowState.kgId is still used above to keep this
    // enrollment conversation's own multi-step flow internally consistent
    // (see :269, :363), which is a narrower, unrelated use.
    //
    // Flush + reassignment run in one transaction so a crash between the two
    // can never leave a test patient with facts deleted but the old
    // condition still recorded (see CONCEPTS.md §10 / STATUS.md Round 5).
    await prisma.$transaction(async (tx: any) => {
      if (patient.isTestIdentity && scenarioChanged) {
        await new PatientFactRepository(tx).flushForPatient(patient.tenantId, patient.id, tx);
      }

      await tx.patient.update({
        where: { id: patient.id },
        data: {
          condition: flowState.conditionName,
          classification: flowState.selectedClassification ?? null,
          conditionStartDate: startDate,
          triggerType: flowState.triggerType,
        },
      });
    });

    await this.clearFlowState(prisma, session.id);

    const locale = session.locale ?? patient.preferredLocale ?? 'hi-IN';
    const greeting = await this.conversationTracer.traceOperation(
      'ai_nurse.whatsapp_greeting',
      session.id,
      {
        'patient.id':             patient.id,
        'patient.condition':      flowState.conditionName         ?? '',
        'patient.classification': flowState.selectedClassification ?? '',
        'trigger.type':           flowState.triggerType            ?? '',
        'patient.days_since_start': syntheticDaysAgo,
        'channel':                session.channel                  ?? 'whatsapp',
        'locale':                 locale,
        'masked.pid':             session.senderId
                                    ? `***${String(session.senderId).slice(-4)}`
                                    : '***',
      },
      () => this.generateWelcomeGreeting(
        patient,
        flowState.conditionName,
        syntheticDaysAgo,
        locale,
        llm,
        flowState.triggerType,
      ),
    );

    await adapter.sendMessage({
      channel: session.channel,
      recipientId: session.senderId,
      content: [{ type: 'text', text: greeting }],
    });

    const updatedTranscript = [
      ...((session.transcript as any[]) ?? []),
      { speaker: 'agent', originalText: greeting, timestamp: new Date() },
    ];
    await prisma.messageSession.update({
      where: { id: session.id },
      data: { transcript: updatedTranscript },
    });

    return { handled: true, done: true };
  }

  // ── Welcome greeting ─────────────────────────────────────────────────────

  private async generateWelcomeGreeting(
    patient: any,
    conditionName: string,
    daysSinceStart: number,
    locale: string,
    llm: LLMProvider,
    triggerType: string,
  ): Promise<string> {
    let patientName = 'patient';
    try {
      if (patient.encryptedName) patientName = decrypt(patient.encryptedName);
    } catch { /* keep default */ }

    return generateGreeting(patientName, conditionName, daysSinceStart, locale, triggerType, llm);
  }

  // ── UI helpers ───────────────────────────────────────────────────────────

  private async sendTrackButtons(session: any, adapter: MessagingProvider): Promise<BotFlowResult> {
    await adapter.sendMessage({
      channel: session.channel,
      recipientId: session.senderId,
      content: [{
        type: 'interactive',
        interactive: {
          type: 'button',
          body: 'Is this patient episodic (post-discharge / post-crisis) or chronic (ongoing enrolment)?',
          buttons: [
            { id: 'track_episodic', title: 'Episodic' },
            { id: 'track_chronic', title: 'Chronic' },
          ],
        },
      }],
    });
    return { handled: true, done: false };
  }

  private async sendPhaseList(
    session: any,
    conditionName: string,
    phases: Array<{ id: string; label: string; daysStart: number; daysEnd: number | null }>,
    adapter: MessagingProvider,
  ): Promise<BotFlowResult> {
    await adapter.sendMessage({
      channel: session.channel,
      recipientId: session.senderId,
      content: [{
        type: 'interactive',
        interactive: {
          type: 'list',
          body: `Which phase for ${conditionName}?`,
          listButtonLabel: 'Select',
          sections: [{
            title: 'Phases',
            rows: phases.map((p) => ({
              id: p.id,
              title: p.label.length > 24 ? p.label.slice(0, 23) + '…' : p.label,
              ...(p.label.length > 24 ? { description: p.label } : {}),
            })),
          }],
        },
      }],
    });
    return { handled: true, done: false };
  }

  private async sendClassificationPrompt(
    session: any,
    classifications: string[],
    adapter: MessagingProvider,
  ): Promise<BotFlowResult> {
    await adapter.sendMessage({
      channel: session.channel,
      recipientId: session.senderId,
      content: [{
        type: 'interactive',
        interactive: {
          type: 'list',
          body: 'Which classification applies to this patient?',
          listButtonLabel: 'Select',
          sections: [{
            title: 'Classifications',
            rows: classifications.map((cls, i) => ({
              id: String(i),
              title: cls.length > 24 ? cls.slice(0, 23) + '…' : cls,
              ...(cls.length > 24 ? { description: cls } : {}),
            })),
          }],
        },
      }],
    });
    return { handled: true, done: false };
  }

  private async sendNoPhasesError(
    session: any,
    adapter: MessagingProvider,
    prisma: any,
  ): Promise<BotFlowResult> {
    await this.clearFlowState(prisma, session.id);
    await adapter.sendMessage({
      channel: session.channel,
      recipientId: session.senderId,
      content: [{ type: 'text', text: 'No phases are configured for this condition. Please contact your care coordinator.' }],
    });
    return { handled: true, done: true };
  }

  private async clearFlowState(prisma: any, sessionId: string): Promise<void> {
    await prisma.messageSession.update({
      where: { id: sessionId },
      data: { flowState: null },
    });
  }
}
