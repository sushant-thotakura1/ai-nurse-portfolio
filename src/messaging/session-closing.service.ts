import { logger } from '../core/logger';
import { LLMProvider } from '../ai-agent/interfaces';
import { enterSessionContext, maskPhone, ConversationTracer } from '../instrumentation';
import { TranscriptAssessmentService, ScoredEvent, AssessmentOutput } from '../ai-agent/clinical/transcript-assessment.service';
import { Turn } from '../orchestrator/session';
import { knowledgeGraphService } from '../knowledge-graph/knowledge-graph.service';
import { contextLoader } from '../knowledge-graph/context-loader';

export interface CloseResult {
  callSessionId: string;
  callSession: any;
  events: ScoredEvent[];
  outcome: 'REASSURE' | 'ADVISE' | 'ESCALATE' | 'INCOMPLETE';
  summaryText: string;
}

const RISK_EMOJI: Record<string, string> = {
  LOW: '✅', MEDIUM: '⚠️', HIGH: '🔴', CRITICAL: '🚨',
};

const RISK_RANK: Record<string, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };

/**
 * Collapses multiple fired flags that share a Sheet 4 Symptom ID down to the
 * single highest-severity one. Without this, a sharp/sudden chest-pain
 * ER_NOW flag and a milder "chest pain present" NURSE_CALLBACK flag can both
 * fire off the same patient statement and read as contradictory in the
 * summary, even though the engine correctly took the more severe one as the
 * overall outcome -- live-tested 2026-07-29, Post-Breast Cancer Surgery.
 *
 * Flags with no symptomId (standalone red flags per schema.md's `Symptom ID:
 * —`, or AssessmentOutputs predating this field) are never grouped -- each
 * stays its own finding, so genuinely different symptoms that happen to
 * co-occur (e.g. a chest-pain ESCALATE alongside a shoulder-pain ADVISE)
 * are never conflated into one.
 */
function collapseBySymptom(
  symptoms: AssessmentOutput['symptoms'],
): AssessmentOutput['symptoms'] {
  const bestBySymptom = new Map<string, AssessmentOutput['symptoms'][number]>();
  for (const s of symptoms) {
    if (!s.symptomId) continue;
    const existing = bestBySymptom.get(s.symptomId);
    if (!existing || (RISK_RANK[s.risk] ?? 0) > (RISK_RANK[existing.risk] ?? 0)) {
      bestBySymptom.set(s.symptomId, s);
    }
  }

  const emitted = new Set<string>();
  const result: AssessmentOutput['symptoms'] = [];
  for (const s of symptoms) {
    if (!s.symptomId) {
      result.push(s);
      continue;
    }
    if (emitted.has(s.symptomId)) continue;
    emitted.add(s.symptomId);
    result.push(bestBySymptom.get(s.symptomId)!);
  }
  return result;
}

const OUTCOME_CONFIG: Record<string, { emoji: string; description: string }> = {
  REASSURE:   { emoji: '✅', description: 'No immediate concerns. Recovery appears on track.' },
  ADVISE:     { emoji: '⚠️', description: 'Monitoring recommended. Please follow up with your care provider.' },
  ESCALATE:   { emoji: '🚨', description: 'Immediate medical attention needed. Please contact your doctor or go to the nearest hospital.' },
  INCOMPLETE: { emoji: '⁉️', description: 'Assessment incomplete — not all required information was collected.' },
};

export class SessionClosingService {
  private conversationTracer = new ConversationTracer();

  async close(
    session: any,
    prisma: any,
    llm: LLMProvider | null,
  ): Promise<CloseResult | null> {
    // 1. Atomically claim — only one execution proceeds when count === 1
    const claim = await prisma.messageSession.updateMany({
      where: { id: session.id, closedAt: null },
      data: { closedAt: new Date() },
    });
    if (claim.count === 0) {
      logger.info('SessionClosingService: session already claimed', { sessionId: session.id });
      return null;
    }

    // 2. Skip unidentified patients (no CallSession needed)
    if (!session.patientId) return null;

    // 3. Resolve locale + fetch patient attributes for Arize tracing.
    //    Always look up the patient so condition/classification/phone are
    //    available regardless of whether locale was already on the session.
    const patient = await prisma.patient.findUnique({
      where: { id: session.patientId },
      select: { preferredLocale: true, condition: true, classification: true, phoneNumber: true, conditionStartDate: true },
    });
    const locale: string = session.locale ?? patient?.preferredLocale ?? 'hi-IN';

    // session.id is now a fresh UUID per conversation (findOrResetSession
    // deletes and recreates on reset), so it naturally matches the Arize
    // session used during the conversation turns.
    enterSessionContext(session.id, {
      'patient.id':             session.patientId,
      'patient.condition':      patient?.condition      ?? '',
      'patient.classification': patient?.classification ?? '',
      'channel':                'whatsapp',
      'masked.pid':             maskPhone(patient?.phoneNumber ?? ''),
    });

    const startedAt      = new Date(session.createdAt);
    const endedAt        = new Date(session.lastMessageAt);
    const durationSeconds = Math.round((endedAt.getTime() - startedAt.getTime()) / 1000);

    // 4. Create CallSession (outcome updated after event extraction if LLM runs)
    const callSession = await prisma.callSession.create({
      data: {
        tenantId:        session.tenantId,
        patientId:       session.patientId,
        callPurpose:     'WHATSAPP_CHAT',
        state:           'COMPLETED',
        outcome:         'REASSURE',
        locale,
        startedAt,
        endedAt,
        durationSeconds,
        messageSessionId: session.id,
      },
    });

    // 5. Create Transcript rows
    const transcript: any[] = Array.isArray(session.transcript) ? session.transcript : [];
    // session.transcript is a JSON column -- every entry's `timestamp` comes back
    // as a plain string, never a real Date. Revive it once here rather than
    // trusting the `as Turn[]` cast below, which would silently hand
    // FactExtractor a string where it expects to call .getTime() on a volunteered
    // time offset (only reached when a fact carries one, which is why this only
    // surfaces for some sessions and not others).
    const turns: Turn[] = transcript.map((entry: any, idx: number) => ({
      turnNumber:      entry.turnNumber ?? idx + 1,
      speaker:         entry.speaker,
      originalText:    entry.originalText,
      translatedText:  entry.translatedText,
      timestamp:       entry.timestamp ? new Date(entry.timestamp) : new Date(),
      confidenceScore: entry.confidenceScore,
    }));
    if (transcript.length > 0) {
      await prisma.transcript.createMany({
        data: transcript.map((entry: any, idx: number) => ({
          sessionId:    callSession.id,
          turnNumber:   idx + 1,
          speaker:      entry.speaker,
          originalText: entry.originalText,
          timestamp:    entry.timestamp ? new Date(entry.timestamp) : new Date(),
        })),
      });
    }

    // 6. Extract clinical events via LLM (if available)
    let eventSummaries: ScoredEvent[] = [];
    let outcome: 'REASSURE' | 'ADVISE' | 'ESCALATE' | 'INCOMPLETE' = 'REASSURE';
    let computedAssessment: AssessmentOutput | null = null;

    if (llm && transcript.length > 0 && patient?.condition && patient?.classification && patient?.conditionStartDate) {
      try {
        const kg = await knowledgeGraphService.getActiveKnowledgeGraph(patient.condition);
        const daysSinceStart = Math.floor(
          (Date.now() - new Date(patient.conditionStartDate).getTime()) / (1000 * 60 * 60 * 24),
        );
        // contextLoader re-derives the same active KG internally just to compute
        // currentPhase -- a second fetch, but this runs once per session close
        // and keeps this file from having to reach into ContextLoader's private
        // phase-calculation logic.
        const ctx = await contextLoader.loadContext(patient.condition, patient.classification, daysSinceStart, locale);

        if (!kg || !ctx) {
          logger.warn('SessionClosingService: no active knowledge graph or phase for patient', {
            sessionId: session.id, condition: patient.condition, classification: patient.classification,
          });
        } else {
          const assessor = new TranscriptAssessmentService(llm, prisma);
          const { assessment, scoredEvents } = await this.conversationTracer.traceOperation(
            'ai_nurse.session_assessment',
            session.id,
            {
              'patient.id':             session.patientId,
              'patient.condition':      patient.condition,
              'patient.classification': patient.classification,
              'channel':                'whatsapp',
              'transcript.turns':       transcript.length,
              'masked.pid':             maskPhone(patient?.phoneNumber ?? ''),
            },
            () => assessor.assess(
              turns,
              kg,
              patient.classification!,
              ctx.patientContext.currentPhase,
              daysSinceStart,
              new Date(),
              { tenantId: session.tenantId, patientId: session.patientId, sessionId: callSession.id },
            ),
          );

          // Persisting the outcome must NOT depend on scoredEvents -- the new
          // engine never produces ClinicalEvent-shaped events at all
          // (scoredEvents is always [] now), so gating this on
          // `scoredEvents.length > 0` would silently discard every computed
          // outcome, including ESCALATE and INCOMPLETE, forever.
          outcome = assessment.outcome;
          computedAssessment = assessment;

          await prisma.callSession.update({
            where: { id: callSession.id },
            data:  { outcome, currentPhase: ctx.patientContext.currentPhase, daysSinceStart },
          });

          eventSummaries = scoredEvents;

          logger.info('SessionClosingService: assessment computed', {
            sessionId: session.id,
            outcome,
            deterministic: assessment.deterministic,
          });

          // clinicalEvent rows were a concept of the old extractor/scorer
          // classes (deleted, Task 9) that the new engine doesn't produce --
          // scoredEvents is always [] now, so this block is dead but left in
          // place rather than removed as a drive-by outside Task 9's scope.
          if (scoredEvents.length > 0) {
            await prisma.clinicalEvent.createMany({
              data: scoredEvents.map(ev => ({
                tenantId:           session.tenantId,
                patientId:          session.patientId,
                sessionId:          callSession.id,
                eventType:          ev.eventType,
                eventData:          ev.eventData,
                riskScore:          ev.riskScore,
                requiresEscalation: ev.requiresEscalation,
              })),
            });
          }
        }
      } catch (err: any) {
        logger.warn('SessionClosingService: clinical event extraction failed', {
          sessionId: session.id,
          error: err?.message,
        });
      }
    }

    const summaryText = this.formatSummary(computedAssessment, session.id);
    return { callSessionId: callSession.id, callSession, events: eventSummaries, outcome, summaryText };
  }

  /**
   * Template-based summary -- no LLM call, deterministic output for testing.
   *
   * Built from the real Decision-derived AssessmentOutput (rulePass/call 3/
   * finalize), not the old ClinicalEventExtractor/RiskScorer event shape --
   * scoredEvents is permanently [] under the new engine (Task 9 deleted
   * those classes), so branching on "any events?" here always took the
   * empty-state path and showed "No clinical events" regardless of what the
   * assessment actually found. This is what a real Heart Failure test
   * conversation (weight gain + breathlessness mentioned, engine correctly
   * computed ESCALATE) surfaced: the outcome was already being persisted
   * correctly (Task 7b), but the summary text shown to the tester never
   * reflected it.
   */
  private formatSummary(assessment: AssessmentOutput | null, sessionId: string): string {
    if (!assessment) {
      return `📋 *Session closed.*\nNo assessment was run for this session.\n\n🔖 *Session ID:* ${sessionId}`;
    }

    const lines: string[] = ['📋 *Assessment Summary*'];

    // Collapse same-symptom flags (see collapseBySymptom's doc comment)
    // before building the findings list -- both this list and the
    // AI-judgment disclaimer below read from the collapsed set, so a
    // subsumed finding disappears from both consistently.
    const findings = collapseBySymptom(assessment.symptoms);

    if (findings.length > 0) {
      lines.push('', '🔬 *Findings:*');
      for (const s of findings) {
        const emoji = RISK_EMOJI[s.risk] ?? '';
        // s.name is the red flag's Sheet 4 trigger prose (transcript-assessment.service.ts),
        // not the bare red_flag_id -- readable without decoding "RF_HF_001".
        lines.push(`• ${s.name} — Severity: ${s.severity} | Risk: ${s.risk} ${emoji}`);
      }
    } else {
      lines.push('', 'No specific concerns were identified during this conversation.');
    }

    if (assessment.escalation_reason) {
      lines.push('', '⚠️ *Escalation Flags:*', `• ${assessment.escalation_reason}`);
    }

    // Name which specific findings were AI judgment calls (decidedBy: 'prose')
    // rather than a single opaque disclaimer -- this is exactly the KB
    // fall-through signal STATUS.md calls the "prose-fallthrough rate": each
    // one named here is a candidate for someone to author a Sheet 8 rule for.
    const proseFindings = findings.filter((s) => s.decidedBy === 'prose');
    if (proseFindings.length > 0) {
      lines.push(
        '',
        '_The following were assessed by AI clinical judgment rather than a fixed rule -- consider authoring a deterministic rule for these where possible:_',
      );
      for (const s of proseFindings) {
        lines.push(`_• ${s.name}_`);
      }
    }

    // Overall outcome
    const cfg = OUTCOME_CONFIG[assessment.outcome] ?? OUTCOME_CONFIG['REASSURE'];
    lines.push('', `🏥 *Overall Outcome: ${assessment.outcome}* ${cfg.emoji}`, cfg.description);

    lines.push('', `🔖 *Session ID:* ${sessionId}`);

    return lines.join('\n');
  }

  async storeSummaryWamid(callSessionId: string, wamid: string, prisma: any): Promise<void> {
    await prisma.callSession.update({
      where: { id: callSessionId },
      data:  { summaryWamid: wamid },
    });
  }
}
