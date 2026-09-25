import { MessagingOrchestrator } from '../messaging-orchestrator';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockTranscribe = jest.fn();
const mockComplete = jest.fn();
const mockSendMessage = jest.fn();
const mockResolveLocale = jest.fn();

jest.mock('../../speech', () => ({
  getSttProvider: jest.fn().mockImplementation(() =>
    Promise.resolve({ transcribe: (...args: any[]) => mockTranscribe(...args) }),
  ),
}));

jest.mock('../../speech/resolve-locale', () => ({
  resolveLocaleForTts: (...args: any[]) => mockResolveLocale(...args),
}));

jest.mock('../../speech/tts-provider.factory', () => ({
  getTtsProvider: jest.fn().mockResolvedValue({
    synthesize: jest.fn().mockResolvedValue(Buffer.from('audio')),
  }),
}));

jest.mock('../../knowledge-graph/context-loader', () => ({
  contextLoader: { loadContext: jest.fn().mockResolvedValue(null) },
}));

jest.mock('../session', () => ({
  findOrResetSession: jest.fn().mockResolvedValue({
    id: 'sess-1', state: 'CONVERSATION', locale: null,
    transcript: [], patientId: 'pat-1', channel: 'whatsapp', senderId: '+911234567890',
    flowState: null,
  }),
  MessageStateMachine: jest.fn().mockImplementation(() => ({
    transition: jest.fn().mockReturnValue({ success: true }),
  })),
  MessageState: { CONVERSATION: 'CONVERSATION', INITIATED: 'INITIATED',
    LANGUAGE_DETECTION: 'LANGUAGE_DETECTION', CONSENT_CHECK: 'CONSENT_CHECK', ENDING: 'ENDING' },
}));

jest.mock('../bot-flows/bot-flow-registry', () => ({
  BotFlowRegistry: jest.fn().mockImplementation(() => ({
    register: jest.fn(),
    shouldHandle: jest.fn().mockReturnValue(false),
    handle: jest.fn(),
  })),
}));

jest.mock('../bot-flows/set-language.flow', () => ({ SetLanguageFlow: jest.fn() }));
jest.mock('../bot-flows/set-health-condition.flow', () => ({ SetHealthConditionFlow: jest.fn() }));
jest.mock('../bot-flows/end-call.flow', () => ({ EndCallFlow: jest.fn() }));
jest.mock('../session-closing.service', () => {
  const close = jest.fn().mockResolvedValue({ callSessionId: 'cs-1', summaryText: 'sum', outcome: 'ESCALATE' });
  const storeSummaryWamid = jest.fn();
  return { SessionClosingService: jest.fn().mockImplementation(() => ({ close, storeSummaryWamid })), __mocks: { close, storeSummaryWamid } };
});
const closingMocks = jest.requireMock('../session-closing.service').__mocks;
jest.mock('../../core/normalize-phone', () => ({ normalizeToE164: (p: string) => p }));
jest.mock('../../rag/rag-service', () => ({ RAGService: jest.fn().mockImplementation(() => ({})) }));
jest.mock('../../conversation/tenant-features', () => ({ getTenantFeatures: jest.fn() }));
import { getTenantFeatures } from '../../conversation/tenant-features';
const mockGetTenantFeatures = getTenantFeatures as jest.Mock;

jest.mock('../../conversation/clinical-turn.service', () => {
  const assessTurn = jest.fn().mockResolvedValue({ newSymptoms: [], redFlags: [], branchAnswer: { kind: 'none' } });
  return { ClinicalTurnService: jest.fn().mockImplementation(() => ({ assessTurn })), __mocks: { assessTurn } };
});
const assessMock = jest.requireMock('../../conversation/clinical-turn.service').__mocks.assessTurn;

jest.mock('../../conversation/clinical-turn-renderer', () => {
  const renderTurn = jest.fn().mockResolvedValue({ acknowledgment: 'I understand.', qaAnswer: null, question: 'Translated question?' });
  const translateNote = jest.fn().mockImplementation((text: string) => Promise.resolve(text));
  return {
    ClinicalTurnRenderer: jest.fn().mockImplementation(() => ({ renderTurn, translateNote })),
    assemble: (qa: string | null, ack: string | null, q: string) => [qa, ack, q].filter(Boolean).join('\n\n'),
    looksLikeAQuestion: (t: string) => t.includes('?'),
    __mocks: { renderTurn, translateNote },
  };
});
const renderMock = jest.requireMock('../../conversation/clinical-turn-renderer').__mocks.renderTurn;
const translateNoteMock = jest.requireMock('../../conversation/clinical-turn-renderer').__mocks.translateNote;

jest.mock('../../conversation/agenda-sequencer', () => {
  const advance = jest.fn().mockReturnValue({
    state: { hpiQueue: [], rosQueue: [], noted: [], active: null, completed: [] },
    escalated: null, nextQuestion: null,
  });
  return {
    AgendaSequencer: jest.fn().mockImplementation(() => ({ advance })),
    emptyAgendaState: () => ({ hpiQueue: [], rosQueue: [], noted: [], active: null, completed: [] }),
    activeQuestionOf: jest.fn().mockReturnValue(null),
    inPlaySymptomIds: jest.fn().mockReturnValue([]),
    __mocks: { advance },
  };
});
const advanceMock = jest.requireMock('../../conversation/agenda-sequencer').__mocks.advance;

function makePrisma(patientOverrides: any = {}) {
  return {
    patient: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'pat-1', phoneNumber: '+911234567890', preferredLocale: 'en-IN',
        condition: null, conditionStartDate: null, knowledgeGraphId: null,
        consentStatus: 'GRANTED', ...patientOverrides,
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    messageSession: {
      update: jest.fn().mockResolvedValue({}),
    },
  };
}

function makeOrchestrator(prisma: any) {
  const adapter = { sendMessage: mockSendMessage, parseWebhook: jest.fn(), verifyWebhook: jest.fn() } as any;
  const llm = { complete: mockComplete } as any;
  return new MessagingOrchestrator(adapter, llm, prisma);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('MessagingOrchestrator — audio message', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockComplete.mockResolvedValue({ content: 'I understand you have eye pain.' });
    mockResolveLocale.mockResolvedValue('en-IN');
    mockGetTenantFeatures.mockResolvedValue({ enabledSkills: ['symptom_check', 'qa'], enabledCapabilities: [], welcomeMessage: null, languageOptions: [] });
  });

  it('calls STT with no locale when audioBuffer is present', async () => {
    mockTranscribe.mockResolvedValue({ text: 'I have eye pain', locale: 'en-IN', confidence: 0.9, timestamp: new Date() });

    const orch = makeOrchestrator(makePrisma());
    await orch.handleInbound({
      channel: 'whatsapp', senderId: '+911234567890', text: '',
      timestamp: new Date(), rawPayload: {}, inputType: 'audio',
      audioBuffer: Buffer.from('fake-audio'),
    }, 'tenant-1');

    expect(mockTranscribe).toHaveBeenCalledWith(expect.any(Buffer));
    expect(mockTranscribe.mock.calls[0].length).toBe(1);  // no locale arg
  });

  it('uses transcript.locale in the LLM system prompt', async () => {
    mockTranscribe.mockResolvedValue({ text: 'வலி உள்ளது', locale: 'ta-IN', confidence: 0.9, timestamp: new Date() });

    const orch = makeOrchestrator(makePrisma({ preferredLocale: 'hi-IN' }));
    await orch.handleInbound({
      channel: 'whatsapp', senderId: '+911234567890', text: '',
      timestamp: new Date(), rawPayload: {}, inputType: 'audio',
      audioBuffer: Buffer.from('audio'),
    }, 'tenant-1');

    const systemPrompt = mockComplete.mock.calls[0][0][0].content as string;
    expect(systemPrompt).toContain('ta-IN');
  });

  it('passes transcript.locale and patient.preferredLocale to resolveLocaleForTts when TTS fails', async () => {
    mockTranscribe.mockResolvedValue({ text: 'hello', locale: 'en-IN', confidence: 0.9, timestamp: new Date() });
    // resolveLocaleForTts is only called inside the TTS catch block
    const { getTtsProvider } = require('../../speech/tts-provider.factory');
    (getTtsProvider as jest.Mock).mockResolvedValueOnce({
      synthesize: jest.fn().mockRejectedValue(new Error('TTS unavailable')),
    });

    const orch = makeOrchestrator(makePrisma({ preferredLocale: 'hi-IN' }));
    await orch.handleInbound({
      channel: 'whatsapp', senderId: '+911234567890', text: '',
      timestamp: new Date(), rawPayload: {}, inputType: 'audio',
      audioBuffer: Buffer.from('audio'),
    }, 'tenant-1');

    expect(mockResolveLocale).toHaveBeenCalledWith(
      expect.anything(),  // prisma
      'en-IN',            // detected locale
      'hi-IN',            // patient fallback
    );
  });

  it('sends fallback text message when audioBuffer is empty (zero length)', async () => {
    const orch = makeOrchestrator(makePrisma());
    await orch.handleInbound({
      channel: 'whatsapp', senderId: '+911234567890', text: '',
      timestamp: new Date(), rawPayload: {}, inputType: 'audio',
      audioBuffer: Buffer.alloc(0),   // zero-length buffer
    }, 'tenant-1');

    expect(mockSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.arrayContaining([
          expect.objectContaining({ type: 'text', text: expect.stringContaining('voice note') }),
        ]),
      }),
    );
    expect(mockTranscribe).not.toHaveBeenCalled();
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it('sends fallback text message and does NOT crash if STT throws', async () => {
    mockTranscribe.mockRejectedValue(new Error('Sarvam API down'));

    const orch = makeOrchestrator(makePrisma());
    await orch.handleInbound({
      channel: 'whatsapp', senderId: '+911234567890', text: '',
      timestamp: new Date(), rawPayload: {}, inputType: 'audio',
      audioBuffer: Buffer.from('audio'),
    }, 'tenant-1');

    expect(mockSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.arrayContaining([
          expect.objectContaining({ type: 'text', text: expect.stringContaining('voice note') }),
        ]),
      }),
    );
    expect(mockComplete).not.toHaveBeenCalled();
  });
});

describe('MessagingOrchestrator — language_selection capability', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockComplete.mockResolvedValue({ content: 'Nazrun ciwo.' });
    mockResolveLocale.mockResolvedValue('ha-NG');
  });

  it('pins STT + system prompt to patient.preferredLocale when capability is on', async () => {
    mockGetTenantFeatures.mockResolvedValue({
      enabledSkills: ['symptom_check', 'qa'], enabledCapabilities: ['language_selection'],
      welcomeMessage: null, languageOptions: ['ha-NG'],
    });
    // STT would "detect" sw-KE, but the pin must win
    mockTranscribe.mockResolvedValue({ text: 'ina jin ciwo', locale: 'ha-NG', confidence: 1, timestamp: new Date() });

    const orch = makeOrchestrator(makePrisma({ preferredLocale: 'ha-NG' }));
    await orch.handleInbound({
      channel: 'whatsapp', senderId: '+911234567890', text: '',
      timestamp: new Date(), rawPayload: {}, inputType: 'audio', audioBuffer: Buffer.from('audio'),
    }, 'tenant-1');

    expect(mockTranscribe).toHaveBeenCalledWith(expect.any(Buffer), 'ha-NG');
    const systemPrompt = mockComplete.mock.calls[0][0][0].content as string;
    expect(systemPrompt).toContain('ha-NG');
  });

  it('does NOT pass a locale to STT when capability is off (regression)', async () => {
    mockGetTenantFeatures.mockResolvedValue({
      enabledSkills: ['symptom_check', 'qa'], enabledCapabilities: [],
      welcomeMessage: null, languageOptions: [],
    });
    mockTranscribe.mockResolvedValue({ text: 'hi', locale: 'en-NG', confidence: 1, timestamp: new Date() });

    const orch = makeOrchestrator(makePrisma({ preferredLocale: 'ha-NG' }));
    await orch.handleInbound({
      channel: 'whatsapp', senderId: '+911234567890', text: '',
      timestamp: new Date(), rawPayload: {}, inputType: 'audio', audioBuffer: Buffer.from('audio'),
    }, 'tenant-1');

    expect(mockTranscribe).toHaveBeenCalledWith(expect.any(Buffer));
    expect(mockTranscribe.mock.calls[0].length).toBe(1);
  });
});

describe('MessagingOrchestrator — text message', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockComplete.mockResolvedValue({ content: 'Hello!' });
    mockResolveLocale.mockResolvedValue('en-IN');
    mockGetTenantFeatures.mockResolvedValue({ enabledSkills: ['symptom_check', 'qa'], enabledCapabilities: [], welcomeMessage: null, languageOptions: [] });
  });

  it('does NOT call STT when audioBuffer is absent', async () => {
    const orch = makeOrchestrator(makePrisma());
    await orch.handleInbound({
      channel: 'whatsapp', senderId: '+911234567890', text: 'I have eye pain',
      timestamp: new Date(), rawPayload: {}, inputType: 'text',
    }, 'tenant-1');

    expect(mockTranscribe).not.toHaveBeenCalled();
  });

  it('still persists the turn to transcript when the outbound send fails (e.g. WhatsApp API rejects the token)', async () => {
    // Regression: a failed adapter.sendMessage() must not silently discard the
    // turn. Losing it here means session.transcript stays empty across every
    // turn, so at session close `transcript.length > 0` is false, the whole
    // assessment step is skipped, and the outcome defaults to REASSURE with
    // no assessment/summary ever created -- discovered via live Docker testing
    // where every outbound send 401'd and no session ever got an assessment.
    mockSendMessage.mockRejectedValueOnce(new Error('Request failed with status code 401'));
    const prisma = makePrisma();
    const orch = makeOrchestrator(prisma);

    await orch.handleInbound({
      channel: 'whatsapp', senderId: '+911234567890', text: 'I have eye pain',
      timestamp: new Date(), rawPayload: {}, inputType: 'text',
    }, 'tenant-1');

    expect(prisma.messageSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          transcript: expect.arrayContaining([
            expect.objectContaining({ speaker: 'patient', originalText: 'I have eye pain' }),
            expect.objectContaining({ speaker: 'agent', originalText: 'Hello!' }),
          ]),
        }),
      }),
    );
  });
});

describe('MessagingOrchestrator — tenant feature gates', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockComplete.mockResolvedValue({ content: 'Hello from the nurse.' });
    mockResolveLocale.mockResolvedValue('en-IN');
    mockGetTenantFeatures.mockResolvedValue({ enabledSkills: ['symptom_check', 'qa'], enabledCapabilities: [], welcomeMessage: null, languageOptions: [] });
  });

  it('sends welcomeMessage directly on first turn for QA-only tenant', async () => {
    mockGetTenantFeatures.mockResolvedValue({
      enabledSkills: ['qa'], enabledCapabilities: [],
      welcomeMessage: 'Welcome! How can I help you today?', languageOptions: [],
    });
    // formatForChannel returns non-JSON so it falls back to plain text of clinicalText
    mockComplete.mockResolvedValue({ content: 'not-json' });

    const orch = makeOrchestrator(makePrisma());
    await orch.handleInbound(
      { channel: 'whatsapp', senderId: '+911234567890', text: 'Hi', timestamp: new Date(), rawPayload: {}, inputType: 'text' },
      'tenant-qa',
    );

    expect(mockSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.arrayContaining([
          expect.objectContaining({ type: 'text', text: 'Welcome! How can I help you today?' }),
        ]),
      }),
    );
  });

  it('uses skill pipeline on second turn for QA-only tenant', async () => {
    mockGetTenantFeatures.mockResolvedValue({
      enabledSkills: ['qa'], enabledCapabilities: [],
      welcomeMessage: 'Welcome!', languageOptions: [],
    });
    const { findOrResetSession } = require('../session');
    (findOrResetSession as jest.Mock).mockResolvedValueOnce({
      id: 'sess-2', state: 'CONVERSATION', locale: null,
      transcript: [
        { speaker: 'agent', originalText: 'Welcome!', timestamp: new Date() },
        { speaker: 'patient', originalText: 'What can you do?', timestamp: new Date() },
      ],
      patientId: 'pat-1', channel: 'whatsapp', senderId: '+911234567890', flowState: null,
    });

    const orch = makeOrchestrator(makePrisma());
    await orch.handleInbound(
      { channel: 'whatsapp', senderId: '+911234567890', text: 'Tell me more', timestamp: new Date(), rawPayload: {}, inputType: 'text' },
      'tenant-qa',
    );

    // LLM should be called (by TurnPlanner + ResponseSynthesizer + formatForChannel)
    expect(mockComplete).toHaveBeenCalled();
  });
});

describe('MessagingOrchestrator — quote-reply attribution (#141)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockComplete.mockResolvedValue({ content: 'Thanks for letting me know.' });
    mockResolveLocale.mockResolvedValue('en-IN');
    mockGetTenantFeatures.mockResolvedValue({ enabledSkills: ['symptom_check', 'qa'], enabledCapabilities: [], welcomeMessage: null, languageOptions: [] });
  });

  function mockSession(overrides: any) {
    const { findOrResetSession } = require('../session');
    (findOrResetSession as jest.Mock).mockResolvedValueOnce({
      id: 'sess-q', state: 'CONVERSATION', locale: null, transcript: [],
      patientId: 'pat-1', channel: 'whatsapp', senderId: '+911234567890', flowState: null,
      questionWamids: {},
      ...overrides,
    });
  }

  it('feeds the quoted question into the turn when the patient quote-replies to a known wamid', async () => {
    mockSession({ questionWamids: { 'wamid.Q1': 'Has your vision decreased?' } });

    const orch = makeOrchestrator(makePrisma());
    await orch.handleInbound({
      channel: 'whatsapp', senderId: '+911234567890', text: 'yes a little',
      timestamp: new Date(), rawPayload: {}, inputType: 'text',
      contextMessageId: 'wamid.Q1',
    }, 'tenant-1');

    const allPayloads = JSON.stringify(mockComplete.mock.calls);
    expect(allPayloads).toContain('Replying to your question');
    expect(allPayloads).toContain('Has your vision decreased?');
  });

  it('does not alter the turn when the quoted wamid is unknown/expired', async () => {
    mockSession({ questionWamids: { 'wamid.Q1': 'Has your vision decreased?' } });

    const orch = makeOrchestrator(makePrisma());
    await orch.handleInbound({
      channel: 'whatsapp', senderId: '+911234567890', text: 'yes a little',
      timestamp: new Date(), rawPayload: {}, inputType: 'text',
      contextMessageId: 'wamid.GONE',
    }, 'tenant-1');

    expect(JSON.stringify(mockComplete.mock.calls)).not.toContain('Replying to your question');
  });

  it('records the outbound wamid against the agent response text', async () => {
    mockSendMessage.mockResolvedValue('wamid.OUT1');
    mockSession({});

    const prisma = makePrisma();
    const orch = makeOrchestrator(prisma);
    await orch.handleInbound({
      channel: 'whatsapp', senderId: '+911234567890', text: 'I have a headache',
      timestamp: new Date(), rawPayload: {}, inputType: 'text',
    }, 'tenant-1');

    const recordCall = prisma.messageSession.update.mock.calls
      .find(([arg]: any[]) => arg?.data?.questionWamids);
    expect(recordCall).toBeTruthy();
    expect(recordCall[0].data.questionWamids).toEqual({ 'wamid.OUT1': 'Thanks for letting me know.' });
  });
});

describe('MessagingOrchestrator — deterministic clinical turn (#161)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockComplete.mockResolvedValue({ content: 'ok' });
    mockResolveLocale.mockResolvedValue('en-IN');
    mockGetTenantFeatures.mockResolvedValue({ enabledSkills: ['symptom_check', 'qa'], enabledCapabilities: [], welcomeMessage: null, languageOptions: [] });
    assessMock.mockResolvedValue({ newSymptoms: [], redFlags: [], branchAnswer: { kind: 'none' } });
    advanceMock.mockReturnValue({
      state: { hpiQueue: [], rosQueue: [], noted: [], active: null, completed: [] },
      escalated: null, nextQuestion: null,
    });
  });

  function withKG(overrides: { escalationMessage?: string | null } = {}) {
    const { contextLoader } = require('../../knowledge-graph/context-loader');
    (contextLoader.loadContext as jest.Mock).mockResolvedValueOnce({
      patientContext: { currentPhase: 'PHASE_II', condition: 'Keratoplasty', daysSinceStart: 20, conditionType: 'acute' },
      symptoms: {}, redFlags: [], systemPrompt: 'CLINICAL_PERSONA',
      escalationMessage: overrides.escalationMessage ?? null,
    });
  }
  function clinicalPatient() {
    return makePrisma({ condition: 'Keratoplasty', conditionStartDate: new Date('2026-08-01'), classification: 'PK' });
  }
  function mockSession(overrides: any = {}) {
    const { findOrResetSession } = require('../session');
    (findOrResetSession as jest.Mock).mockResolvedValueOnce({
      id: 'sess-d', state: 'CONVERSATION', locale: null, transcript: [],
      patientId: 'pat-1', channel: 'whatsapp', senderId: '+911234567890', flowState: null,
      questionWamids: {}, clinicalEvents: [], agendaState: null, ...overrides,
    });
  }

  it('agenda turn: assess -> advance -> render -> assembled reply is sent, agendaState persisted', async () => {
    withKG();
    advanceMock.mockReturnValueOnce({
      state: { hpiQueue: [], rosQueue: [], noted: [], active: { symptomId: 'S1' }, completed: [] },
      escalated: null, nextQuestion: { id: 'Q1', promptEn: 'Is the redness increasing?' },
    });
    renderMock.mockResolvedValueOnce({ acknowledgment: 'I hear you.', qaAnswer: null, question: 'Kya laali badh rahi hai?' });
    mockSession();
    const prisma = clinicalPatient();
    const orch = makeOrchestrator(prisma);
    await orch.handleInbound({ channel: 'whatsapp', senderId: '+911234567890', text: 'my eye is red', timestamp: new Date(), rawPayload: {}, inputType: 'text' }, 'tenant-1');

    expect(assessMock).toHaveBeenCalled();
    expect(advanceMock).toHaveBeenCalled();
    expect(renderMock).toHaveBeenCalledWith(expect.objectContaining({ questionEn: 'Is the redness increasing?' }));
    const sent = JSON.stringify(mockSendMessage.mock.calls);
    expect(sent).toContain('Kya laali badh rahi hai?');
    const persist = prisma.messageSession.update.mock.calls.find(([a]: any[]) => a?.data?.agendaState !== undefined);
    expect(persist[0].data.agendaState.active.symptomId).toBe('S1');
  });

  it('escalation turn: fixed message, no render, session closed, state ESCALATING', async () => {
    withKG();
    advanceMock.mockReturnValueOnce({
      state: { hpiQueue: [], rosQueue: [], noted: [], active: null, completed: [] },
      escalated: { trigger: 'branch', detail: 'Q2:B' }, nextQuestion: null,
    });
    mockSendMessage.mockResolvedValue('wamid.ESC1');
    mockSession();
    const prisma = clinicalPatient();
    const orch = makeOrchestrator(prisma);
    await orch.handleInbound({ channel: 'whatsapp', senderId: '+911234567890', text: 'it is much worse', timestamp: new Date(), rawPayload: {}, inputType: 'text' }, 'tenant-1');

    expect(renderMock).not.toHaveBeenCalled();
    expect(closingMocks.close).toHaveBeenCalled();
    expect(JSON.stringify(mockSendMessage.mock.calls).toLowerCase()).toContain('doctor');
    const persist = prisma.messageSession.update.mock.calls.find(([a]: any[]) => a?.data?.state === 'ESCALATING');
    expect(persist).toBeTruthy();

    // close() resolves asynchronously (fire-and-forget) — flush microtasks
    await new Promise((r) => setImmediate(r));
    const sentAfterClose = JSON.stringify(mockSendMessage.mock.calls);
    expect(sentAfterClose).toContain('sum'); // result.summaryText from the mocked close()
    expect(closingMocks.storeSummaryWamid).toHaveBeenCalledWith('cs-1', 'wamid.ESC1', expect.anything());
  });

  it('escalation turn: uses the KB-authored escalation_message (translated) instead of the default when configured', async () => {
    withKG({ escalationMessage: 'Go to your nearest PartnerHospital facility. Call 080-00000000 for follow-up.' });
    advanceMock.mockReturnValueOnce({
      state: { hpiQueue: [], rosQueue: [], noted: [], active: null, completed: [] },
      escalated: { trigger: 'branch', detail: 'Q2:B' }, nextQuestion: null,
    });
    translateNoteMock.mockResolvedValueOnce('अपने नज़दीकी PartnerHospital केंद्र जाएँ। फॉलो-अप के लिए 080-00000000 पर कॉल करें।');
    mockSession();
    const orch = makeOrchestrator(clinicalPatient());
    await orch.handleInbound({ channel: 'whatsapp', senderId: '+911234567890', text: 'it is much worse', timestamp: new Date(), rawPayload: {}, inputType: 'text' }, 'tenant-1');

    expect(translateNoteMock).toHaveBeenCalledWith('Go to your nearest PartnerHospital facility. Call 080-00000000 for follow-up.', 'en-IN');
    const sent = JSON.stringify(mockSendMessage.mock.calls);
    expect(sent).toContain('PartnerHospital');
    expect(sent).not.toContain('nearest hospital'); // the default's wording must NOT also be present -- this is a replacement, not an append
  });

  it('escalation turn: falls back to the default ESCALATION_MESSAGES when the KG has no escalation_message (regression)', async () => {
    withKG({ escalationMessage: null });
    advanceMock.mockReturnValueOnce({
      state: { hpiQueue: [], rosQueue: [], noted: [], active: null, completed: [] },
      escalated: { trigger: 'branch', detail: 'Q2:B' }, nextQuestion: null,
    });
    mockSession();
    const orch = makeOrchestrator(clinicalPatient());
    await orch.handleInbound({ channel: 'whatsapp', senderId: '+911234567890', text: 'it is much worse', timestamp: new Date(), rawPayload: {}, inputType: 'text' }, 'tenant-1');

    expect(translateNoteMock).not.toHaveBeenCalled();
    expect(closingMocks.close).toHaveBeenCalled();
    expect(JSON.stringify(mockSendMessage.mock.calls).toLowerCase()).toContain('doctor');
  });

  it('open turn (agenda drained): falls through to the skill pipeline', async () => {
    withKG();
    // advance returns no nextQuestion, not escalated -> open turn
    mockSession();
    const orch = makeOrchestrator(clinicalPatient());
    await orch.handleInbound({ channel: 'whatsapp', senderId: '+911234567890', text: 'I feel fine', timestamp: new Date(), rawPayload: {}, inputType: 'text' }, 'tenant-1');
    expect(renderMock).not.toHaveBeenCalled();
    // the synthesizer LLM call ran (skill pipeline) — its system prompt carries the clinical persona
    const usedPersona = mockComplete.mock.calls.some((c: any[]) => (c[0]?.[0]?.content ?? '').includes('CLINICAL_PERSONA'));
    expect(usedPersona).toBe(true);
  });

  it('first turn greeting: no agenda question yet -> open turn -> symptom_check forced so the greeting fires', async () => {
    withKG();
    mockComplete.mockImplementation((msgs: any[]) => {
      const sys = msgs[0]?.content ?? '';
      if (sys.includes('turn planner')) return Promise.resolve({ content: '{"skills":["qa"],"reasoning":"q"}' });
      return Promise.resolve({ content: 'Hello Sushant, this is Nurse Maya.' });
    });
    mockSession();
    const orch = makeOrchestrator(clinicalPatient());
    await orch.handleInbound({ channel: 'whatsapp', senderId: '+911234567890', text: 'Hello', timestamp: new Date(), rawPayload: {}, inputType: 'text' }, 'tenant-1');
    const usedPersona = mockComplete.mock.calls.some((c: any[]) => (c[0]?.[0]?.content ?? '').includes('CLINICAL_PERSONA'));
    expect(usedPersona).toBe(true);
  });

  it('QA-only tenant: no assessTurn, no advance', async () => {
    mockGetTenantFeatures.mockResolvedValue({ enabledSkills: ['qa'], enabledCapabilities: [], welcomeMessage: null, languageOptions: [] });
    mockSession();
    const orch = makeOrchestrator(clinicalPatient());
    await orch.handleInbound({ channel: 'whatsapp', senderId: '+911234567890', text: 'hi', timestamp: new Date(), rawPayload: {}, inputType: 'text' }, 'tenant-1');
    expect(assessMock).not.toHaveBeenCalled();
    expect(advanceMock).not.toHaveBeenCalled();
  });

  it('no-KG patient: no assessTurn', async () => {
    mockSession();
    const orch = makeOrchestrator(makePrisma()); // condition: null default
    await orch.handleInbound({ channel: 'whatsapp', senderId: '+911234567890', text: 'hi', timestamp: new Date(), rawPayload: {}, inputType: 'text' }, 'tenant-1');
    expect(assessMock).not.toHaveBeenCalled();
  });
});
