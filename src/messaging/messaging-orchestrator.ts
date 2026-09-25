import { LLMProvider, ChatMessage } from '../ai-agent/interfaces';
import { logger } from '../core/logger';
import { normalizeToE164 } from '../core/normalize-phone';
import { MessagingProvider, InboundMessage, OutboundMessage, MessageContent } from './interfaces';
import { MessageState, MessageStateMachine, findOrResetSession } from './session';
import { formatForChannel } from './message-formatter';
import { mergeQuestionWamid, resolveQuotedQuestion } from './question-wamids';
import { contextLoader, ClinicalContext } from '../knowledge-graph/context-loader';
import { BotFlowRegistry } from './bot-flows/bot-flow-registry';
import { SetHealthConditionFlow } from './bot-flows/set-health-condition.flow';
import { EndCallFlow } from './bot-flows/end-call.flow';
import { SetLanguageFlow } from './bot-flows/set-language.flow';
import { SessionClosingService } from './session-closing.service';
import { resolveConversationLocale } from '../speech/resolve-conversation-locale';
import { languageDirective } from '../core/locale-language';
import { getTtsProvider } from '../speech/tts-provider.factory';
import { getSttProvider } from '../speech';
import { resolveLocaleForTts } from '../speech/resolve-locale';
import { getTtsFallbackNotice } from '../speech/tts-fallback-notice';
import { enterSessionContext, ConversationTracer, maskPhone } from '../instrumentation';
import { decrypt } from '../core/encryption';
import { buildDemographicsContext } from '../patient/demographics-context';
import { ConversationSkillRegistry } from '../conversation/conversation-skill';
import { buildSessionContext } from '../conversation/session-context-builder';
import { TurnPlanner } from '../conversation/turn-planner';
import { ResponseSynthesizer } from '../conversation/response-synthesizer';
import { SymptomCheckSkill } from '../conversation/skills/symptom-check.skill';
import { QASkill } from '../conversation/skills/qa.skill';
import { RAGService } from '../rag/rag-service';
import { getTenantFeatures } from '../conversation/tenant-features';
import { AgendaSequencer, emptyAgendaState, activeQuestionOf, inPlaySymptomIds, AgendaState } from '../conversation/agenda-sequencer';
import { ClinicalTurnService } from '../conversation/clinical-turn.service';
import { ClinicalTurnRenderer, assemble, looksLikeAQuestion } from '../conversation/clinical-turn-renderer';
import { calculateAge } from '../patient/demographics-context';

// KNOWN GAP: only en/hi/te are SME-reviewed. A patient pinned to Hausa/Igbo/
// Swahili receives the English escalation text (defaultEscalationMessage()
// falls back to `en`). Machine-translating a safety-critical message without
// a native clinical review is worse than a clear English fallback — needs
// SME sign-off before African-language tenants go to production. This
// applies only to this static fallback — a KB author who sets their own
// escalation_message takes on the same LLM-translation trust model already
// used for question prompts, and owns their own wording.
const ESCALATION_MESSAGES: Record<string, string> = {
  en: "I'm concerned about what you've told me. Please contact your doctor right away, or go to the nearest hospital if you can't reach them. This is important and should not wait.",
  hi: 'मुझे आपकी बात से चिंता हो रही है। कृपया तुरंत अपने डॉक्टर से संपर्क करें, या यदि संपर्क न हो सके तो नज़दीकी अस्पताल जाएँ। यह ज़रूरी है, इसे टालें नहीं।',
  te: 'మీరు చెప్పిన దాని గురించి నాకు ఆందోళనగా ఉంది. దయచేసి వెంటనే మీ డాక్టర్‌ను సంప్రదించండి, లేదా సంప్రదించలేకపోతే దగ్గర్లోని ఆసుపత్రికి వెళ్లండి. ఇది ముఖ్యం, ఆలస్యం చేయవద్దు.',
};
function defaultEscalationMessage(locale: string): string {
  return ESCALATION_MESSAGES[(locale || 'en').slice(0, 2).toLowerCase()] ?? ESCALATION_MESSAGES.en;
}

export class MessagingOrchestrator {
  private stateMachine: MessageStateMachine;
  private botFlowRegistry: BotFlowRegistry;
  private conversationTracer = new ConversationTracer();
  private skillRegistry: ConversationSkillRegistry;
  private turnPlanner: TurnPlanner;
  private responseSynthesizer: ResponseSynthesizer;
  private clinicalTurn: ClinicalTurnService;
  private agendaSequencer: AgendaSequencer;
  private renderer: ClinicalTurnRenderer;
  private ragService: RAGService;
  private sessionClosingService: SessionClosingService;

  constructor(
    private readonly adapter: MessagingProvider,
    private readonly llm: LLMProvider,
    private readonly prisma: any,
  ) {
    this.stateMachine = new MessageStateMachine();
    this.botFlowRegistry = new BotFlowRegistry();
    this.botFlowRegistry.register(new SetHealthConditionFlow());
    this.botFlowRegistry.register(new EndCallFlow(new SessionClosingService()));
    this.botFlowRegistry.register(new SetLanguageFlow());

    this.ragService = new RAGService(this.prisma);
    this.skillRegistry = new ConversationSkillRegistry();
    this.skillRegistry.register(new SymptomCheckSkill());
    this.skillRegistry.register(new QASkill(this.ragService, this.llm));
    this.turnPlanner = new TurnPlanner(this.llm, this.skillRegistry);
    this.responseSynthesizer = new ResponseSynthesizer();
    this.clinicalTurn = new ClinicalTurnService(this.llm);
    this.agendaSequencer = new AgendaSequencer();
    this.renderer = new ClinicalTurnRenderer(this.llm);
    this.sessionClosingService = new SessionClosingService();
  }

  async handleInbound(inbound: InboundMessage, tenantId: string): Promise<void> {
    logger.info('Handling inbound messaging event', {
      channel: inbound.channel,
      tenantId,
    });

    // 1. Find or upsert session (24h sliding window)
    const session = await findOrResetSession(
      this.prisma,
      inbound.channel,
      inbound.senderId,
      tenantId,
    );

    // session.id is now a fresh UUID per conversation — findOrResetSession
    // deletes and recreates the record on each reset, so this ID naturally
    // changes with every new conversation.
    enterSessionContext(session.id);

    // 2. Identify patient by normalised phone number, scoped to this tenant
    const normalizedPhone = normalizeToE164(inbound.senderId);
    const patient = await this.prisma.patient.findFirst({
      where: { phoneNumber: normalizedPhone, tenantId },
    });

    if (!patient) {
      logger.warn('Patient not found for sender', { senderId: inbound.senderId, tenantId });
      await this.adapter.sendMessage({
        channel: inbound.channel,
        recipientId: inbound.senderId,
        content: [{ type: 'text', text: 'You are not registered in our system. Please contact your care provider.' }],
      });
      return;
    }

    const features = await getTenantFeatures(tenantId);
    const languageSelectionEnabled = features.enabledCapabilities?.includes('language_selection') ?? false;

    // 2b. Transcribe audio if voice note (before BotFlow — flows need transcript.text too)
    let detectedLocale: string | null = null;
    if (inbound.audioBuffer && inbound.audioBuffer.length > 0) {
      try {
        const sttProvider = await getSttProvider(tenantId, this.prisma);
        const pin = resolveConversationLocale({
          capabilityEnabled: languageSelectionEnabled,
          patientPreferredLocale: patient.preferredLocale ?? null,
          sessionLocale: session.locale ?? null,
          detectedLocale: null,
        });
        const transcript = pin.pinned
          ? await sttProvider.transcribe(inbound.audioBuffer, pin.locale)
          : await sttProvider.transcribe(inbound.audioBuffer);
        inbound.text = transcript.text;
        detectedLocale = transcript.locale;
        logger.info('STT auto-detect complete', {
          detectedLocale,
          patientPreferredLocale: patient.preferredLocale,
          audioSize: inbound.audioBuffer.length,
        });
      } catch (err: any) {
        logger.error('STT failed for voice note', {
          error: err.message,
          tenantId,
          audioSize: inbound.audioBuffer?.length,
        });
        await this.adapter.sendMessage({
          channel: inbound.channel,
          recipientId: inbound.senderId,
          content: [{ type: 'text', text: 'Sorry, I could not process your voice note. Please try sending a text message.' }],
        });
        return;
      }
    } else if (inbound.audioBuffer && inbound.audioBuffer.length === 0) {
      logger.warn('Received empty audioBuffer — treating as STT failure', { tenantId });
      await this.adapter.sendMessage({
        channel: inbound.channel,
        recipientId: inbound.senderId,
        content: [{ type: 'text', text: 'Sorry, I could not process your voice note. Please try sending a text message.' }],
      });
      return;
    }

    // Enrich session context with patient identifiers as soon as the patient
    // is known — bot flows return early before clinicalCtx loads, so this
    // must be here to cover their LLM calls (e.g. greeting generation).
    // patient.phase is not yet known; the later enterSessionContext adds it.
    enterSessionContext(session.id, {
      'patient.id':             patient.id,
      'patient.condition':      patient.condition      ?? '',
      'patient.classification': patient.classification ?? '',
      'channel':                inbound.channel,
      'masked.pid':             maskPhone(inbound.senderId),
    });

    // BotFlow interception — after patient lookup and STT, before state machine
    if (this.botFlowRegistry.shouldHandle(session, inbound.text)) {
      await this.botFlowRegistry.handle(session, inbound, patient, tenantId, this.prisma, this.adapter, this.llm);
      return;
    }

    // 3. Write patientId back to session if not already set
    if (!session.patientId) {
      await this.prisma.messageSession.update({
        where: { id: session.id },
        data: { patientId: patient.id },
      });
      session.patientId = patient.id;
    }

    // 4. Determine next state
    const currentState = session.state as MessageState;
    let nextState = this.getNextState(currentState, inbound.text, patient);
    const transition = this.stateMachine.transition(currentState, nextState);

    if (transition && !transition.success) {
      logger.error('State transition failed', { from: currentState, to: nextState });
      return;
    }

    // 5. Persist new state; write consent back to patient when they pass CONSENT_CHECK
    await this.prisma.messageSession.update({
      where: { id: session.id },
      data: { state: nextState },
    });

    // Language detection — skipped; STT auto-detects locale so the interactive
    // language-selection list is not needed. Advance directly to CONSENT_CHECK.
    if (nextState === MessageState.LANGUAGE_DETECTION) {
      nextState = MessageState.CONSENT_CHECK;
      await this.prisma.messageSession.update({
        where: { id: session.id },
        data: { state: MessageState.CONSENT_CHECK, flowState: null },
      });
      session.state = MessageState.CONSENT_CHECK;
      // Fall through — nextState is now CONSENT_CHECK for the LLM prompt and formatter.
    }

    if (currentState === MessageState.CONSENT_CHECK && nextState === MessageState.CONVERSATION
        && patient.consentStatus !== 'GRANTED') {
      await this.prisma.patient.update({
        where: { id: patient.id },
        data: { consentStatus: 'GRANTED' },
      });
      logger.info('Patient consent recorded', { patientId: patient.id });
    }

    // 6. Generate clinical AI response
    // Conversation locale: a pinned patient choice (language_selection on) wins;
    // otherwise the legacy STT-detected → session → patient → 'en-IN' chain.
    const conversationLocale = resolveConversationLocale({
      capabilityEnabled: languageSelectionEnabled,
      patientPreferredLocale: patient.preferredLocale ?? null,
      sessionLocale: session.locale ?? null,
      detectedLocale,
    });
    const { locale } = conversationLocale;
    logger.info('Conversation locale resolved', {
      locale,
      pinned: conversationLocale.pinned,
      languageSelectionEnabled,
      patientPreferredLocale: patient.preferredLocale ?? null,
      sessionLocale: session.locale ?? null,
      detectedLocale,
    });

    // Load knowledge-graph clinical context (mirrors voice path)
    let clinicalCtx: ClinicalContext | null = null;
    if (patient.condition && patient.conditionStartDate) {
      const daysSinceStart = Math.floor(
        (Date.now() - new Date(patient.conditionStartDate).getTime()) / (1000 * 60 * 60 * 24)
      );
      const classification = patient.classification || '';
      // Always resolves to this tenant's currently ACTIVE KG for the condition --
      // patients are no longer pinned to a KG snapshot from enrollment time.
      clinicalCtx = await contextLoader.loadContext(
        patient.condition,
        classification,
        daysSinceStart,
        locale,
      );
      if (clinicalCtx) {
        logger.info('Clinical context loaded for messaging session', {
          patientId: patient.id,
          condition: patient.condition,
          currentPhase: clinicalCtx.patientContext.currentPhase,
        });
      }
    }

    let patientDob: string | undefined;
    try {
      if (patient.encryptedDob) patientDob = decrypt(patient.encryptedDob);
    } catch { /* ignore decryption failure */ }
    const demographicsCtx = buildDemographicsContext(patient.gender, patientDob);

    // Enrich the request-level session context now that patient + clinical
    // data are both loaded. This covers spans that fire outside of
    // traceOperation (formatForChannel, bot flows) — they read from
    // enterSessionContext and previously only received session.id.
    enterSessionContext(session.id, {
      'patient.id':             patient.id,
      'patient.condition':      patient.condition      ?? '',
      'patient.classification': patient.classification ?? '',
      'patient.phase':          clinicalCtx?.patientContext.currentPhase ?? '',
      'channel':                inbound.channel,
      'masked.pid':             maskPhone(inbound.senderId),
    });

    // For CONVERSATION state: route through multi-skill orchestrator.
    // For other states (CONSENT_CHECK, ENDING): use the existing buildSystemPrompt path.
    let clinicalText: string | undefined;
    let agendaStateUpdate: AgendaState | null = null;
    let clinicalEventsUpdate: unknown[] | null = null;
    let escalation: { trigger: 'red_flag' | 'branch'; detail: string } | null = null;

    if (nextState === MessageState.CONVERSATION) {
      const priorTranscript = ((session.transcript as any[]) ?? []);
      const isFirstTurn = priorTranscript.filter((t: any) => t.speaker === 'agent').length === 0;
      const isQAOnly = !features.enabledSkills.includes('symptom_check');
      const turnNo = priorTranscript.length + 1;

      // ── Deterministic clinical turn: assess → sequence → render ──────────
      if (clinicalCtx && !isQAOnly) {
        const prevAgenda = (session.agendaState as AgendaState | null) ?? emptyAgendaState();
        const recentTranscript = priorTranscript.slice(-4).map((t: { speaker?: string; originalText?: string }) => ({
          speaker: (t.speaker === 'agent' ? 'agent' : 'patient') as 'agent' | 'patient',
          text: (t.originalText ?? '') as string,
        }));
        let patientAge: number | null = null;
        try { if (patient.encryptedDob) patientAge = calculateAge(decrypt(patient.encryptedDob)); } catch { /* ignore */ }

        const assessment = await this.clinicalTurn.assessTurn({
          patientText: inbound.text,
          recentTranscript,
          clinicalCtx,
          patient: { ageYears: patientAge, gender: patient.gender ?? null },
          activeQuestion: activeQuestionOf(prevAgenda, clinicalCtx),
          inPlaySymptomIds: inPlaySymptomIds(prevAgenda),
        });

        const turnResult = this.agendaSequencer.advance({
          prev: prevAgenda,
          newSymptoms: assessment.newSymptoms,
          redFlags: assessment.redFlags,
          branchAnswer: assessment.branchAnswer,
          clinicalCtx,
        });
        agendaStateUpdate = turnResult.state;
        session.agendaState = turnResult.state;

        const now = new Date().toISOString();
        const events: Array<Record<string, unknown>> = [
          ...assessment.newSymptoms.map(s => ({ type: 'symptom_detected', symptomId: s.id, name: s.name, turn: turnNo, timestamp: now })),
          ...assessment.redFlags.map(f => ({ type: 'red_flag', trigger: f.trigger, symptomId: f.symptomId, urgency: f.urgency, turn: turnNo, timestamp: now })),
          ...turnResult.state.noted
            .filter(n => !((prevAgenda.noted ?? []).some(p => p.symptomId === n.symptomId)))
            .map(n => ({ type: 'symptom_noted_not_drilled', symptomId: n.symptomId, turn: turnNo, timestamp: now })),
        ];
        if (turnResult.escalated) {
          events.push({ type: 'escalation', trigger: turnResult.escalated.trigger, detail: turnResult.escalated.detail, turn: turnNo, timestamp: now });
        }
        if (events.length > 0) {
          clinicalEventsUpdate = [...(Array.isArray(session.clinicalEvents) ? session.clinicalEvents : []), ...events];
        }

        if (turnResult.escalated) {
          escalation = turnResult.escalated;
          clinicalText = clinicalCtx.escalationMessage
            ? await this.renderer.translateNote(clinicalCtx.escalationMessage, locale)
            : defaultEscalationMessage(locale);
          logger.warn('Clinical turn: escalation triggered', { sessionId: session.id, ...turnResult.escalated });
        } else if (turnResult.nextQuestion) {
          const ragSnippets = looksLikeAQuestion(inbound.text)
            ? await this.ragService.queryDocuments(
                clinicalCtx ? `${clinicalCtx.patientContext.condition} patient: ${inbound.text}` : inbound.text, 3,
              ).then(rs => rs.filter(r => r.similarity >= 0.3).map(r => `[${r.documentTitle}] ${r.chunkText}`).join('\n\n') || null)
              .catch(() => null)
            : null;
          const rendered = await this.renderer.renderTurn({
            patientText: inbound.text, locale, ragSnippets, questionEn: turnResult.nextQuestion.promptEn,
          });
          clinicalText = assemble(rendered.qaAnswer, rendered.acknowledgment, rendered.question || turnResult.nextQuestion.promptEn);
        }
        // else: agenda drained → clinicalText stays undefined → open turn below
      }

      // ── Open turn: greeting / drained agenda / QA-only ──────────────────
      if (clinicalText === undefined) {
      if (isQAOnly && isFirstTurn && features.welcomeMessage) {
        clinicalText = features.welcomeMessage;
      } else {
      let patientName: string | null = null;
      try {
        if (patient.encryptedName) patientName = decrypt(patient.encryptedName);
      } catch { /* ignore decryption failure */ }
      // If the patient swipe-replied (quote-reply) to a specific question
      // bubble, attribute this answer to that question rather than the most
      // recent one. Unknown/expired wamid → undefined → unchanged behaviour.
      const replyingToQuestion = resolveQuotedQuestion(
        session.questionWamids, inbound.contextMessageId,
      );
      const sessionContext = buildSessionContext(
        patient, session, clinicalCtx, inbound.text, detectedLocale, locale, patientName,
        replyingToQuestion,
      );
      const plan = await this.turnPlanner.plan(sessionContext, features.enabledSkills);
      if (clinicalCtx && features.enabledSkills.includes('symptom_check') && !plan.skills.includes('symptom_check')) {
        plan.skills.push('symptom_check');
      }
      const fragments = await this.skillRegistry.execute(plan, sessionContext, this.prisma);
      clinicalText = await this.conversationTracer.traceOperation(
        'ai_nurse.turn',
        session.id,
        {
          'patient.id':             patient.id,
          'patient.condition':      patient.condition      ?? '',
          'patient.classification': patient.classification ?? '',
          'patient.phase':          clinicalCtx?.patientContext.currentPhase ?? '',
          'channel':                inbound.channel,
          'session.state':          nextState,
          'turn.number':            ((session.transcript as any[])?.length ?? 0) + 1,
          'masked.pid':             maskPhone(inbound.senderId),
          'turn.skills':            plan.skills.join(','),
        },
        () => this.responseSynthesizer.synthesize(
          fragments,
          sessionContext,
          sessionContext.transcriptHistory,
          inbound.text,
          this.llm,
        ),
      );
      } // end else (skill pipeline)
      } // end if (clinicalText === undefined)
    } else {
      const history: ChatMessage[] = [
        { role: 'system', content: this.buildSystemPrompt(nextState, locale, clinicalCtx, demographicsCtx) },
        ...((session.transcript as any[]) ?? []).map((t: any): ChatMessage => ({
          role: (t.speaker === 'agent' ? 'assistant' : 'user') as 'assistant' | 'user',
          content: t.originalText,
        })),
        { role: 'user', content: inbound.text },
      ];
      const llmResponse = await this.conversationTracer.traceOperation(
        'ai_nurse.turn',
        session.id,
        {
          'patient.id':             patient.id,
          'patient.condition':      patient.condition      ?? '',
          'patient.classification': patient.classification ?? '',
          'patient.phase':          clinicalCtx?.patientContext.currentPhase ?? '',
          'channel':                inbound.channel,
          'session.state':          nextState,
          'turn.number':            ((session.transcript as any[])?.length ?? 0) + 1,
          'masked.pid':             maskPhone(inbound.senderId),
        },
        () => this.llm.complete(history, { temperature: 0.7, maxTokens: 600 }),
      );
      clinicalText = llmResponse.content;
    }

    if (clinicalText === undefined) clinicalText = '';

    // 7. Format for channel (hybrid LLM formatter)
    const content = await formatForChannel(this.llm, clinicalText, nextState, inbound.channel, locale);

    // 8. If the patient sent a voice note, reply with a voice note (TTS)
    let outboundContent: MessageContent[] = content;
    if (inbound.inputType === 'audio') {
      try {
        // Use the same locale as the LLM — the TTS provider factory handles
        // per-provider locale compatibility (Intron → Whisper-en fallback,
        // Kokoro → Sarvam fallback, etc.) so no separate language-pack lookup needed.
        const ttsLocale = locale;
        logger.info('TTS locale resolved', {
          detectedLocale,
          patientPreferredLocale: patient.preferredLocale,
          resolvedTtsLocale: ttsLocale,
        });
        const ttsProvider = await getTtsProvider(tenantId, this.prisma, ttsLocale);
        const audioBuffer = await ttsProvider.synthesize(clinicalText, ttsLocale);
        outboundContent = [{ type: 'audio', audioBuffer }];
      } catch (err: any) {
        const ttsLocaleForNotice = await resolveLocaleForTts(this.prisma, detectedLocale, patient.preferredLocale).catch(() => null);
        const notice = getTtsFallbackNotice(ttsLocaleForNotice);
        logger.warn('TTS failed for voice note reply, falling back to text', { error: err.message, locale: ttsLocaleForNotice });
        outboundContent = [{ type: 'text', text: `${notice}\n\n${clinicalText}` }];
      }
    }

    const outbound: OutboundMessage = {
      channel: inbound.channel,
      recipientId: inbound.senderId,
      content: outboundContent,
    };
    // A failed send (channel API down/rejected token/rate-limited) must not
    // discard this turn: session.transcript is what session close reads to
    // decide whether to run the assessment at all (`transcript.length > 0`),
    // so losing a turn here can silently skip the assessment for the whole
    // session and leave outcome defaulted to REASSURE with no summary ever
    // computed -- discovered via live testing where every outbound send
    // 401'd and no session got an assessment as a result.
    let sentWamid: string | null = null;
    try {
      sentWamid = await this.adapter.sendMessage(outbound);
    } catch (err: unknown) {
      logger.error('Failed to send outbound message; persisting turn to transcript anyway', {
        sessionId: session.id, channel: inbound.channel,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // 9. Append turn to transcript; remember this outbound message's wamid so a
    // later quote-reply to it can be attributed to this question (#141).
    const updatedTranscript = [
      ...((session.transcript as any[]) ?? []),
      { speaker: 'patient', originalText: inbound.text, timestamp: inbound.timestamp },
      { speaker: 'agent', originalText: clinicalText, timestamp: new Date() },
    ];
    const sessionUpdate: Record<string, unknown> = { transcript: updatedTranscript };
    if (sentWamid && nextState === MessageState.CONVERSATION) {
      sessionUpdate.questionWamids = mergeQuestionWamid(session.questionWamids, sentWamid, clinicalText);
    }
    if (agendaStateUpdate !== null) sessionUpdate.agendaState = agendaStateUpdate;
    if (clinicalEventsUpdate !== null) sessionUpdate.clinicalEvents = clinicalEventsUpdate;
    if (escalation) sessionUpdate.state = 'ESCALATING';
    await this.prisma.messageSession.update({
      where: { id: session.id },
      data: sessionUpdate,
    });

    if (escalation) {
      session.transcript = updatedTranscript;
      this.sessionClosingService.close(session, this.prisma, this.llm)
        .then(async (result) => {
          if (!result) return;
          const wamid = await this.adapter.sendMessage({
            channel: inbound.channel,
            recipientId: inbound.senderId,
            content: [{ type: 'text', text: result.summaryText }],
          });
          if (wamid) {
            try {
              await this.sessionClosingService.storeSummaryWamid(result.callSessionId, wamid, this.prisma);
            } catch (err: unknown) {
              logger.warn('Clinical escalation: failed to store summary wamid', {
                sessionId: session.id, error: err instanceof Error ? err.message : String(err),
              });
            }
          }
        })
        .catch((err: unknown) => {
          logger.error('Clinical escalation: session close failed', {
            sessionId: session.id, error: err instanceof Error ? err.message : String(err),
          });
        });
    }

    logger.info('Inbound message handled', { sessionId: session.id, nextState });
  }

  private getNextState(current: MessageState, _patientText: string, patient: any): MessageState {
    const alreadyConsented = patient.consentStatus === 'GRANTED';

    // Returning patient — skip language & consent, go straight to conversation
    if (current === MessageState.INITIATED && alreadyConsented) {
      return MessageState.CONVERSATION;
    }
    if (current === MessageState.LANGUAGE_DETECTION && alreadyConsented) {
      return MessageState.CONVERSATION;
    }

    // Happy-path advance for new patients
    const advance: Partial<Record<MessageState, MessageState>> = {
      [MessageState.INITIATED]:          MessageState.LANGUAGE_DETECTION,
      [MessageState.LANGUAGE_DETECTION]: MessageState.CONSENT_CHECK,
      [MessageState.CONSENT_CHECK]:      MessageState.CONVERSATION,
      [MessageState.CONVERSATION]:       MessageState.CONVERSATION,
    };
    return advance[current] ?? current;
  }

  private buildSystemPrompt(state: MessageState, locale: string, clinicalCtx: ClinicalContext | null, demographicsCtx: string): string {
    if (state === MessageState.CONVERSATION && clinicalCtx) {
      const base = clinicalCtx.systemPrompt;
      return demographicsCtx
        ? `${base}\n\n---\n\nPATIENT DEMOGRAPHICS:\n${demographicsCtx}`
        : base;
    }

    const langInstruction = languageDirective(locale).instruction;
    const prompts: Partial<Record<MessageState, string>> = {
      [MessageState.LANGUAGE_DETECTION]: `You are a clinical AI nurse. Ask the patient to select their preferred language. ${langInstruction}`,
      [MessageState.CONSENT_CHECK]:      `You are a clinical AI nurse. Ask the patient for consent to proceed with the health check. Be clear and concise. ${langInstruction}`,
      [MessageState.CONVERSATION]:       `You are a clinical AI nurse. Conduct a health check conversation. Ask one question at a time. ${langInstruction}`,
      [MessageState.ENDING]:             `You are a clinical AI nurse. Conclude the conversation warmly. ${langInstruction}`,
    };
    const base = prompts[state] ?? `You are a clinical AI nurse. ${langInstruction}`;

    if (demographicsCtx && (state === MessageState.CONVERSATION || state === MessageState.ENDING)) {
      return `${base}\n\nPATIENT DEMOGRAPHICS:\n${demographicsCtx}`;
    }
    return base;
  }
}
