/**
 * Test Conversation Service
 * Orchestrates test conversations from the dashboard using the same
 * multi-skill pipeline (TurnPlanner → SkillRegistry → ResponseSynthesizer)
 * as the real MessagingOrchestrator, so RAG documents and symptom-check
 * context are applied identically to production calls.
 */

import { prisma } from '../core/database';
import { sarvamClient } from '../integrations/sarvam/client';
import { logger } from '../core/logger';
import { getTenantContext, runWithTenantContext } from '../core/tenant-context-storage';
import { contextLoader, ClinicalContext } from '../knowledge-graph/context-loader';
import { decrypt } from '../core/encryption';
import { OpenAIAdapter } from '../ai-agent/adapters/openai.adapter';
import { LLMProvider } from '../ai-agent/interfaces';
import { MessageState } from '../messaging/session';
import { ConversationSkillRegistry } from './conversation-skill';
import { buildSessionContext } from './session-context-builder';
import { TurnPlanner } from './turn-planner';
import { ResponseSynthesizer } from './response-synthesizer';
import { SymptomCheckSkill } from './skills/symptom-check.skill';
import { QASkill } from './skills/qa.skill';
import { ClinicalTurnService } from './clinical-turn.service';
import { RAGService } from '../rag/rag-service';
import { clinicalAssessmentService } from './clinical-assessment.service';
import { getTenantFeatures, TenantFeatures } from './tenant-features';

interface StartConversationRequest {
  patientId: string;
  callPurpose: 'POST_SURGERY' | 'MEDICATION_REMINDER' | 'GENERAL_CHECKUP' | 'APPOINTMENT_REMINDER';
  locale: string;
}

interface ConversationTurn {
  speaker: 'agent' | 'patient';
  text: string;
  audioBase64?: string;
  timestamp: Date;
}

interface ProcessAudioRequest {
  sessionId: string;
  audioBuffer: Buffer;
}

export class TestConversationService {
  private readonly llm: LLMProvider;
  private readonly skillRegistry: ConversationSkillRegistry;
  private readonly turnPlanner: TurnPlanner;
  private readonly clinicalTurn: ClinicalTurnService;
  private readonly responseSynthesizer: ResponseSynthesizer;
  private readonly conversationContext: Map<string, ConversationTurn[]> = new Map();
  private readonly clinicalContext: Map<string, ClinicalContext> = new Map();
  private readonly tenantFeaturesMap: Map<string, TenantFeatures> = new Map();
  // sessionId → Map<symptomId, symptomName> for symptoms reported but not yet assessed
  private readonly pendingSymptoms: Map<string, Map<string, string>> = new Map();

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY || '';
    this.llm = new OpenAIAdapter({ apiKey });

    const ragService = new RAGService(prisma);
    this.skillRegistry = new ConversationSkillRegistry();
    this.skillRegistry.register(new SymptomCheckSkill());
    this.skillRegistry.register(new QASkill(ragService, this.llm));
    this.turnPlanner = new TurnPlanner(this.llm, this.skillRegistry);
    this.clinicalTurn = new ClinicalTurnService(this.llm);
    this.responseSynthesizer = new ResponseSynthesizer();
  }

  async startConversation(request: StartConversationRequest) {
    try {
      logger.info('Starting test conversation', {
        patientId: request.patientId,
        callPurpose: request.callPurpose,
      });

      const patient = await prisma.patient.findUnique({
        where: { id: request.patientId },
      });

      if (!patient) {
        throw new Error('Patient not found');
      }

      const languagePack = await prisma.languagePack.findFirst({
        where: { localeCode: request.locale },
      });

      if (!languagePack) {
        throw new Error(`Language pack not found for locale: ${request.locale}`);
      }

      let clinicalCtx: ClinicalContext | null = null;
      let currentPhase: string | null = null;
      let daysSinceStart: number | null = null;
      // The active KG's row id, recorded on the CallSession as a historical
      // fact -- "this call used this KG" -- not a live resolution mechanism.
      let resolvedKnowledgeGraphId: string | null = null;

      if (patient.condition && patient.conditionStartDate) {
        daysSinceStart = Math.floor(
          (Date.now() - new Date(patient.conditionStartDate).getTime()) / (1000 * 60 * 60 * 24)
        );

        // Always resolves to this tenant's currently ACTIVE KG for the condition --
        // patients are no longer pinned to a KG snapshot from enrollment time.
        clinicalCtx = await contextLoader.loadContext(
          patient.condition,
          patient.classification ?? '',
          daysSinceStart,
          request.locale,
        );

        if (clinicalCtx) {
          currentPhase = clinicalCtx.patientContext.currentPhase;
          logger.info('Clinical context loaded for patient', {
            patientId: patient.id,
            condition: patient.condition,
            currentPhase,
            daysSinceStart,
          });

          const activeKgRow = await prisma.knowledgeGraph.findFirst({
            where: { condition: patient.condition, status: 'ACTIVE' },
            select: { id: true },
          });
          resolvedKnowledgeGraphId = activeKgRow?.id ?? null;
        }
      }

      let tenantId: string;
      const tenantContext = getTenantContext();
      if (tenantContext) {
        tenantId = tenantContext.tenantId;
      } else {
        const defaultTenant = await prisma.tenant.findUnique({ where: { slug: 'default-tenant' } });
        if (!defaultTenant) {
          throw new Error('Default tenant not found. Run create-default-tenant.js script.');
        }
        tenantId = defaultTenant.id;
      }

      const features = await getTenantFeatures(tenantId);

      const session = await prisma.callSession.create({
        data: {
          tenantId,
          patientId: request.patientId,
          callPurpose: request.callPurpose,
          state: 'CONVERSATION',
          locale: request.locale,
          startedAt: new Date(),
          metadata: { testMode: true },
          knowledgeGraphId: resolvedKnowledgeGraphId,
          currentPhase,
          daysSinceStart,
        },
      });

      this.conversationContext.set(session.id, []);
      this.tenantFeaturesMap.set(session.id, features);
      if (clinicalCtx) {
        this.clinicalContext.set(session.id, clinicalCtx);
      }

      const isQAOnly = !features.enabledSkills.includes('symptom_check');
      const greeting = (isQAOnly && features.welcomeMessage)
        ? features.welcomeMessage
        : await this.getInitialGreeting(
            languagePack.scripts,
            request.callPurpose,
            request.locale,
            patient,
            clinicalCtx,
          );

      const audioBuffer = await sarvamClient.textToSpeech(greeting, request.locale, 'simran');

      await prisma.transcript.create({
        data: {
          sessionId: session.id,
          turnNumber: 1,
          speaker: 'agent',
          originalText: greeting,
          timestamp: new Date(),
          confidenceScore: 1.0,
        },
      });

      this.conversationContext.get(session.id)!.push({
        speaker: 'agent',
        text: greeting,
        audioBase64: audioBuffer.toString('base64'),
        timestamp: new Date(),
      });

      logger.info('Test conversation started', { sessionId: session.id });

      return {
        sessionId: session.id,
        greeting: {
          text: greeting,
          audioBase64: audioBuffer.toString('base64'),
        },
        patient: {
          phoneNumber: patient.phoneNumber,
          locale: request.locale,
        },
      };
    } catch (error: any) {
      logger.error('Failed to start test conversation', { error: error.message });
      throw error;
    }
  }

  async processAudio(request: ProcessAudioRequest) {
    try {
      logger.info('Processing patient audio', { sessionId: request.sessionId });

      const session = await prisma.callSession.findUnique({
        where: { id: request.sessionId },
      });

      if (!session) {
        throw new Error('Session not found');
      }

      const patient = await prisma.patient.findUnique({
        where: { id: session.patientId },
      });

      if (!patient) {
        throw new Error('Patient not found for session');
      }

      const sttResult = await sarvamClient.speechToText(request.audioBuffer, session.locale);
      const patientText = sttResult.transcript;
      const detectedLocale = sttResult.language_code ?? null;

      logger.info('Patient speech transcribed', {
        sessionId: request.sessionId,
        text: patientText,
        detectedLocale,
      });

      const turnNumber = (this.conversationContext.get(request.sessionId) ?? []).length + 1;

      await prisma.transcript.create({
        data: {
          sessionId: request.sessionId,
          turnNumber,
          speaker: 'patient',
          originalText: patientText,
          timestamp: new Date(),
          confidenceScore: 0.9,
        },
      });

      this.conversationContext.get(request.sessionId)!.push({
        speaker: 'patient',
        text: patientText,
        timestamp: new Date(),
      });

      // Detect symptoms synchronously so the pending agenda is populated before
      // we generate the response — this allows the agent to ask a follow-up in
      // the same turn where the patient first reports the symptom.
      const clinicalCtx = this.clinicalContext.get(request.sessionId) ?? null;
      const sessionFeatures = this.tenantFeaturesMap.get(request.sessionId);
      const isQAOnly = sessionFeatures && !sessionFeatures.enabledSkills.includes('symptom_check');
      const assessment = (!isQAOnly && clinicalCtx)
        ? await this.clinicalTurn.assessTurn({
            patientText, recentTranscript: [], clinicalCtx,
            patient: { gender: patient.gender ?? null },
            activeQuestion: null,
            inPlaySymptomIds: Object.keys(clinicalCtx.symptoms),
          })
        : { newSymptoms: [], redFlags: [], branchAnswer: { kind: 'none' as const } };
      const detectedSymptoms = assessment.newSymptoms;
      const turnRedFlags = assessment.redFlags;

      if (detectedSymptoms.length > 0) {
        const pending = this.pendingSymptoms.get(request.sessionId) ?? new Map<string, string>();
        for (const s of detectedSymptoms) pending.set(s.id, s.name);
        this.pendingSymptoms.set(request.sessionId, pending);
      }

      // Resolve tenant so we can set up the AsyncLocalStorage context that
      // QASkill (RAGService) requires for tenant-scoped document queries.
      const tenant = await prisma.tenant.findUnique({ where: { id: session.tenantId } });
      if (!tenant) throw new Error('Tenant not found for session');

      const agentResponse = await runWithTenantContext(
        { tenantId: session.tenantId, tenantSlug: tenant.slug, tenant, isSuperAdmin: false },
        () => this.generateAgentResponse(
          request.sessionId,
          patientText,
          patient,
          session.locale,
          detectedLocale,
        ),
      );

      const audioBuffer = await sarvamClient.textToSpeech(agentResponse, session.locale, 'simran');

      await prisma.transcript.create({
        data: {
          sessionId: request.sessionId,
          turnNumber: turnNumber + 1,
          speaker: 'agent',
          originalText: agentResponse,
          timestamp: new Date(),
          confidenceScore: 1.0,
          metadata: {
            model: 'gpt-4o-mini',
            locale: session.locale,
            generatedAt: new Date().toISOString(),
          },
        },
      });

      this.conversationContext.get(request.sessionId)!.push({
        speaker: 'agent',
        text: agentResponse,
        audioBase64: audioBuffer.toString('base64'),
        timestamp: new Date(),
      });

      // Fire-and-forget: write clinical events to DB using the already-detected symptoms
      if (clinicalCtx && detectedSymptoms.length > 0) {
        this.recordClinicalEvents(
          request.sessionId,
          patientText,
          patient.id,
          session.tenantId,
          clinicalCtx,
          detectedSymptoms,
          turnRedFlags,
        ).catch((err) => logger.error('Clinical event recording failed', { error: err.message, sessionId: request.sessionId }));
      }

      return {
        patientTranscript: patientText,
        agentResponse: {
          text: agentResponse,
          audioBase64: audioBuffer.toString('base64'),
        },
      };
    } catch (error: any) {
      logger.error('Failed to process audio', {
        error: error.message,
        sessionId: request.sessionId,
      });
      throw error;
    }
  }

  async endConversation(sessionId: string) {
    try {
      logger.info('Ending test conversation', { sessionId });

      const session = await prisma.callSession.findUnique({ where: { id: sessionId } });
      if (session) {
        await prisma.callSession.update({
          where: { id: sessionId },
          data: {
            state: 'COMPLETED',
            endedAt: new Date(),
            outcome: 'COMPLETED',
            durationSeconds: Math.floor((new Date().getTime() - session.startedAt.getTime()) / 1000),
          },
        });
      }

      this.conversationContext.delete(sessionId);
      this.clinicalContext.delete(sessionId);
      this.tenantFeaturesMap.delete(sessionId);
      this.pendingSymptoms.delete(sessionId);

      logger.info('Test conversation ended', { sessionId });

      return { success: true };
    } catch (error: any) {
      logger.error('Failed to end conversation', { error: error.message });
      throw error;
    }
  }

  private async generateAgentResponse(
    sessionId: string,
    patientMessage: string,
    patient: any,
    locale: string,
    detectedLocale: string | null,
  ): Promise<string> {
    const context = this.conversationContext.get(sessionId) ?? [];
    const clinicalCtx = this.clinicalContext.get(sessionId) ?? null;

    // Shape the in-memory transcript to match what buildSessionContext expects
    const sessionLike = {
      state: MessageState.CONVERSATION,
      transcript: context.map(t => ({
        speaker: t.speaker,
        originalText: t.text,
        timestamp: t.timestamp,
      })),
    };

    const sessionContext = buildSessionContext(
      patient,
      sessionLike,
      clinicalCtx,
      patientMessage,
      detectedLocale,
      locale,
      null, // greeting already sent by getInitialGreeting at session start
    );

    // Inject pending symptom agenda so SymptomCheckSkill can append follow-up instructions
    const pending = this.pendingSymptoms.get(sessionId);
    if (pending && pending.size > 0) {
      sessionContext.pendingSymptoms = Array.from(pending.entries()).map(([id, name]) => ({ id, name }));
    }

    const sessionFeatures = this.tenantFeaturesMap.get(sessionId);
    const plan = await this.turnPlanner.plan(sessionContext, sessionFeatures?.enabledSkills);

    // Ensure symptom_check runs whenever there are unassessed symptoms, regardless
    // of what the TurnPlanner decided (patient may have asked an unrelated question)
    if (sessionContext.pendingSymptoms?.length && !plan.skills.includes('symptom_check')) {
      plan.skills.push('symptom_check');
      logger.info('Injecting symptom_check for pending assessment', {
        sessionId,
        pending: sessionContext.pendingSymptoms.map(s => s.name),
      });
    }

    logger.info('Test conversation skill plan', {
      sessionId,
      skills: plan.skills,
      reasoning: plan.reasoning,
    });

    const fragments = await this.skillRegistry.execute(plan, sessionContext, prisma);

    return this.responseSynthesizer.synthesize(
      fragments,
      sessionContext,
      sessionContext.transcriptHistory,
      patientMessage,
      this.llm,
    );
  }

  private async getInitialGreeting(
    scripts: any,
    callPurpose: string,
    locale: string,
    patient: any,
    clinicalCtx: ClinicalContext | null,
  ): Promise<string> {
    if (clinicalCtx) {
      let patientName = 'patient';
      try {
        if (patient.encryptedName) {
          patientName = decrypt(patient.encryptedName);
        }
      } catch (error: any) {
        logger.error('Failed to decrypt patient name for greeting', {
          error: error.message,
          patientId: patient.id,
        });
      }

      const greetingPrompt = `Generate the opening greeting for a post-surgery follow-up call. Follow this exact structure:

1. Greet the patient by name: "${patientName}"
2. Introduce yourself as a member of the patient's care team calling from REAN Foundation (do NOT use placeholder names, just say "This is Maya from REAN Foundation" or similar)
3. State you are calling to check on their health/recovery. Do NOT mention how long it has been since the surgery

Keep it warm, natural, and conversational (2-3 sentences maximum). Do NOT mention technical terms like "phase", "PHASE_II", or clinical terminology. Do NOT use placeholders like "[your name]" - use a real first name like "Maya" or "Priya", with no title or honorific.`;

      try {
        const response = await this.llm.complete(
          [
            { role: 'system', content: clinicalCtx.systemPrompt },
            { role: 'user', content: greetingPrompt },
          ],
          { temperature: 0.7, maxTokens: 150 },
        );
        return response.content || scripts.greeting || 'Hello';
      } catch (error: any) {
        logger.error('LLM call failed for greeting', { error: error.message });
        throw error;
      }
    }

    const greeting = scripts.greeting || 'नमस्ते';
    const purposeIntros: Record<string, string> = {
      POST_SURGERY: scripts.post_surgery_intro || '',
      MEDICATION_REMINDER: scripts.medication_reminder || '',
      GENERAL_CHECKUP: scripts.general_checkup || '',
      APPOINTMENT_REMINDER: scripts.appointment_reminder || '',
    };
    return `${greeting} ${purposeIntros[callPurpose] || ''}`.trim();
  }

  private async recordClinicalEvents(
    sessionId: string,
    patientText: string,
    patientId: string,
    tenantId: string,
    clinicalCtx: ClinicalContext,
    detectedSymptoms: any[],
    turnRedFlags: Array<{ trigger: string; symptomId: string | null; action: string; urgency: string; rationale: string }>,
  ): Promise<void> {
    for (const symptom of detectedSymptoms) {
      await clinicalAssessmentService.recordSymptomReported(
        sessionId, patientId, symptom.name, symptom.id, symptom.baseSeverity, tenantId,
      );

      const patientResponses = await this.simulateAssessmentResponses(patientText, symptom);
      const assessmentResult = await clinicalAssessmentService.assessSymptom(
        sessionId, patientId, symptom.name, patientResponses, clinicalCtx,
      );
      await clinicalAssessmentService.recordAssessmentOutcome(sessionId, patientId, assessmentResult, tenantId);

      // Remove from pending once the assessment has been recorded
      this.pendingSymptoms.get(sessionId)?.delete(symptom.id);

      await this.recordRedFlags(sessionId, patientId, symptom.id, turnRedFlags, tenantId);
    }
  }

  private async simulateAssessmentResponses(patientText: string, symptom: any): Promise<any[]> {
    const prompt = `Analyze the severity of the symptom "${symptom.name}" based on the patient's description.

Patient's statement: "${patientText}"

Return a JSON object:
{"riskShift": <0=mild|1=moderate|2=severe>, "escalate": <boolean>, "reasoning": "<brief explanation>"}

Only return the JSON object, nothing else.`;

    try {
      const response = await this.llm.complete(
        [
          { role: 'system', content: 'You are a clinical severity assessment assistant. Return only valid JSON.' },
          { role: 'user', content: prompt },
        ],
        { temperature: 0.3, maxTokens: 150 },
      );

      const jsonMatch = response.content.trim().match(/\{.*?\}/s);
      if (jsonMatch) return [JSON.parse(jsonMatch[0])];
    } catch (err: any) {
      logger.warn('Severity assessment failed', { error: err.message });
    }
    return [{ riskShift: 0, escalate: false, reasoning: 'Unable to assess severity' }];
  }

  private async recordRedFlags(
    sessionId: string,
    patientId: string,
    symptomId: string,
    turnRedFlags: Array<{ trigger: string; symptomId: string | null; action: string; urgency: string; rationale: string }>,
    tenantId: string,
  ): Promise<void> {
    for (const hit of turnRedFlags.filter(h => !h.symptomId || h.symptomId === symptomId)) {
      await clinicalAssessmentService.recordRedFlag(
        sessionId, patientId, hit.trigger, hit.symptomId, hit.action, hit.urgency, hit.rationale, tenantId,
      );
    }
  }
}

export const testConversationService = new TestConversationService();
