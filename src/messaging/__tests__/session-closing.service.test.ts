// session-closing.service.ts now loads the active KG (Task 7) --
// knowledge-graph.service.ts and context-loader.ts both import the real
// core/database Prisma singleton at module scope, which constructs a real
// PrismaClient on import and crashes on this machine's ARM64 Windows Node
// (the query engine binary is x64-only). Mock both so this suite never
// touches that import chain -- same pattern as eval/__tests__/callables.test.ts.
jest.mock('../../knowledge-graph/knowledge-graph.service', () => ({
  knowledgeGraphService: { getActiveKnowledgeGraph: jest.fn() },
}));
jest.mock('../../knowledge-graph/context-loader', () => ({
  contextLoader: { loadContext: jest.fn() },
}));

import { SessionClosingService } from '../session-closing.service';
import { knowledgeGraphService } from '../../knowledge-graph/knowledge-graph.service';
import { contextLoader } from '../../knowledge-graph/context-loader';

const mockGetActiveKg = knowledgeGraphService.getActiveKnowledgeGraph as jest.Mock;
const mockLoadContext = contextLoader.loadContext as jest.Mock;

// ── Prisma mock builder ───────────────────────────────────────────────────────

function makePrisma({
  updateManyCount = 1, // 1 = claimed successfully, 0 = already taken
  patient = { preferredLocale: 'hi-IN' } as any,
} = {}) {
  const created = { callSessions: [] as any[], transcripts: [] as any[], clinicalEvents: [] as any[] };
  const updated = { callSessions: [] as any[] };

  return {
    _created: created,
    _updated: updated,
    messageSession: {
      updateMany: jest.fn().mockResolvedValue({ count: updateManyCount }),
    },
    patient: {
      findUnique: jest.fn().mockResolvedValue(patient),
    },
    callSession: {
      create: jest.fn().mockImplementation((args: any) => {
        const cs = { id: 'cs-1', ...args.data };
        created.callSessions.push(cs);
        return Promise.resolve(cs);
      }),
      update: jest.fn().mockImplementation((args: any) => {
        updated.callSessions.push(args);
        return Promise.resolve({});
      }),
    },
    transcript: {
      createMany: jest.fn().mockImplementation((args: any) => {
        created.transcripts.push(...args.data);
        return Promise.resolve({ count: args.data.length });
      }),
    },
    clinicalEvent: {
      createMany: jest.fn().mockImplementation((args: any) => {
        created.clinicalEvents.push(...args.data);
        return Promise.resolve({ count: args.data.length });
      }),
    },
  };
}

function makeSession(overrides: any = {}) {
  return {
    id: 'sess-1',
    tenantId: 'tenant-1',
    patientId: 'patient-1',
    channel: 'whatsapp',
    senderId: '+911234567890',
    locale: 'hi-IN',
    createdAt: new Date(Date.now() - 40 * 60_000),
    lastMessageAt: new Date(Date.now() - 35 * 60_000),
    transcript: [],
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SessionClosingService.close()', () => {
  let svc: SessionClosingService;

  beforeEach(() => { svc = new SessionClosingService(); });

  it('returns null when session is already claimed (updateMany count = 0)', async () => {
    const prisma = makePrisma({ updateManyCount: 0 });
    const result = await svc.close(makeSession(), prisma, null);
    expect(result).toBeNull();
    expect(prisma.callSession.create).not.toHaveBeenCalled();
  });

  it('returns null when session has no patientId', async () => {
    const prisma = makePrisma();
    const result = await svc.close(makeSession({ patientId: '' }), prisma, null);
    expect(result).toBeNull();
    expect(prisma.callSession.create).not.toHaveBeenCalled();
  });

  it('creates CallSession with REASSURE outcome when llm is null', async () => {
    const prisma = makePrisma();
    const result = await svc.close(makeSession(), prisma, null);

    expect(result).not.toBeNull();
    expect(prisma.callSession.create).toHaveBeenCalledTimes(1);
    const csData = prisma.callSession.create.mock.calls[0][0].data;
    expect(csData.callPurpose).toBe('WHATSAPP_CHAT');
    expect(csData.state).toBe('COMPLETED');
    expect(csData.outcome).toBe('REASSURE');
    expect(csData.locale).toBe('hi-IN');
    expect(result!.callSessionId).toBe('cs-1');
  });

  it('resolves locale from patient record when session.locale is null', async () => {
    const prisma = makePrisma({ patient: { preferredLocale: 'en-US' } });
    const result = await svc.close(makeSession({ locale: null }), prisma, null);
    expect(result).not.toBeNull();
    const csData = prisma.callSession.create.mock.calls[0][0].data;
    expect(csData.locale).toBe('en-US');
    expect(prisma.patient.findUnique).toHaveBeenCalled();
  });

  it('creates Transcript rows from session.transcript', async () => {
    const transcript = [
      { speaker: 'patient', originalText: 'Hello', timestamp: new Date().toISOString() },
      { speaker: 'agent',   originalText: 'Hi',    timestamp: new Date().toISOString() },
    ];
    const prisma = makePrisma();
    await svc.close(makeSession({ transcript }), prisma, null);

    expect(prisma.transcript.createMany).toHaveBeenCalledTimes(1);
    const txData = prisma.transcript.createMany.mock.calls[0][0].data;
    expect(txData).toHaveLength(2);
    expect(txData[0]).toMatchObject({ turnNumber: 1, speaker: 'patient', originalText: 'Hello' });
    expect(txData[1]).toMatchObject({ turnNumber: 2, speaker: 'agent',   originalText: 'Hi' });
  });

  it('returns fallback summaryText when no assessment ran (null llm)', async () => {
    const prisma = makePrisma();
    const result = await svc.close(makeSession(), prisma, null);
    expect(result!.summaryText).toContain('Session closed');
    expect(result!.summaryText).toContain('No assessment was run');
  });
});

describe('SessionClosingService — formatSummary', () => {
  let svc: SessionClosingService;
  beforeEach(() => { svc = new SessionClosingService(); });

  function makeAssessment(overrides: Partial<{
    outcome: 'REASSURE' | 'ADVISE' | 'ESCALATE' | 'INCOMPLETE';
    patient_action: string | null;
    overall_risk_level: string;
    symptoms: Array<{ name: string; severity: string; risk: string; flag: string; decidedBy?: 'rule' | 'prose'; symptomId?: string | null }>;
    escalation_reason?: string;
    escalation_required: boolean;
    deterministic: boolean;
  }> = {}) {
    return {
      outcome: 'REASSURE',
      patient_action: 'SELF_MONITOR',
      overall_risk_level: 'LOW',
      symptoms: [],
      escalation_required: false,
      deterministic: true,
      ...overrides,
    };
  }

  // Access the private method via casting for unit testing
  function fmt(assessment: any, sessionId = 'sess-1') {
    return (svc as any).formatSummary(assessment, sessionId);
  }

  it('returns fallback when assessment is null', () => {
    const text = fmt(null);
    expect(text).toContain('Session closed');
    expect(text).toContain('No assessment was run');
  });

  it('renders each fired symptom as a bullet with severity and risk', () => {
    const assessment = makeAssessment({
      outcome: 'ADVISE',
      symptoms: [
        { name: 'Breathlessness at rest or progressive worsening breathlessness over days', severity: 'moderate', risk: 'MEDIUM', flag: 'yellow', decidedBy: 'rule' },
      ],
    });
    const text = fmt(assessment);
    expect(text).toContain('Findings');
    expect(text).toContain('Breathlessness at rest');
    expect(text).toContain('moderate');
    expect(text).toContain('MEDIUM');
  });

  it('shows a reassuring line when no symptoms fired', () => {
    const text = fmt(makeAssessment({ symptoms: [] }));
    expect(text).toContain('No specific concerns were identified');
  });

  // Live-tested 2026-07-29 (Post-Breast Cancer Surgery): a sharp/sudden
  // chest-pain flag and a milder "chest pain present" flag, both linked to
  // the same Sheet 2 symptom, fired together and read as contradictory in
  // the summary even though the engine correctly took ESCALATE overall.
  // collapseBySymptom groups by symptomId and keeps only the highest-risk
  // entry per group -- these tests pin exactly that, and the converse (never
  // collapse genuinely different symptoms just because both fired).
  it('collapses two findings that share a symptomId down to the higher-risk one', () => {
    const text = fmt(makeAssessment({
      outcome: 'ESCALATE',
      symptoms: [
        { name: 'Chest pain or ache with breathing that is not sharp/stabbing and not sudden in onset, but present', severity: 'moderate', risk: 'MEDIUM', flag: 'yellow', decidedBy: 'rule', symptomId: 'SYM_BRSURG_014' },
        { name: 'Sudden-onset breathlessness, or sharp chest pain on breathing in', severity: 'severe', risk: 'CRITICAL', flag: 'red', decidedBy: 'rule', symptomId: 'SYM_BRSURG_014' },
      ],
    }));
    expect(text).toContain('Sudden-onset breathlessness, or sharp chest pain on breathing in');
    expect(text).not.toContain('Chest pain or ache with breathing that is not sharp/stabbing');
    // Only one bullet should exist for this symptom, not two.
    expect((text.match(/^• /gm) ?? []).length).toBe(1);
  });

  it('does not collapse findings with different symptomIds even if one is severe and one is mild', () => {
    const text = fmt(makeAssessment({
      outcome: 'ESCALATE',
      symptoms: [
        { name: 'Sudden-onset breathlessness, or sharp chest pain on breathing in', severity: 'severe', risk: 'CRITICAL', flag: 'red', decidedBy: 'rule', symptomId: 'SYM_BRSURG_014' },
        { name: 'Shoulder movement worsening compared with an earlier point', severity: 'moderate', risk: 'MEDIUM', flag: 'yellow', decidedBy: 'rule', symptomId: 'SYM_BRSURG_008' },
      ],
    }));
    expect(text).toContain('Sudden-onset breathlessness, or sharp chest pain on breathing in');
    expect(text).toContain('Shoulder movement worsening compared with an earlier point');
    expect((text.match(/^• /gm) ?? []).length).toBe(2);
  });

  it('never collapses findings with no symptomId, even if identical to each other', () => {
    const text = fmt(makeAssessment({
      outcome: 'ADVISE',
      symptoms: [
        { name: 'Standalone red flag A', severity: 'moderate', risk: 'MEDIUM', flag: 'yellow', decidedBy: 'rule' },
        { name: 'Standalone red flag B', severity: 'moderate', risk: 'MEDIUM', flag: 'yellow', decidedBy: 'rule' },
      ],
    }));
    expect(text).toContain('Standalone red flag A');
    expect(text).toContain('Standalone red flag B');
    expect((text.match(/^• /gm) ?? []).length).toBe(2);
  });

  it('renders escalation_reason under Escalation Flags when present', () => {
    const assessment = makeAssessment({
      outcome: 'ESCALATE',
      escalation_reason: 'Weight gain plus breathlessness at rest',
      symptoms: [{ name: 'RF_HF_001', severity: 'severe', risk: 'HIGH', flag: 'red' }],
    });
    const text = fmt(assessment);
    expect(text).toContain('Escalation Flags');
    expect(text).toContain('Weight gain plus breathlessness at rest');
  });

  it('names the specific findings that were AI judgment calls, not a generic disclaimer', () => {
    const assessment = makeAssessment({
      deterministic: false,
      symptoms: [
        { name: 'New onset bilateral edema after a period of stability', severity: 'severe', risk: 'HIGH', flag: 'red', decidedBy: 'prose' },
        { name: 'Breathlessness at rest', severity: 'severe', risk: 'HIGH', flag: 'red', decidedBy: 'rule' },
      ],
    });
    const text = fmt(assessment);
    expect(text).toContain('AI clinical judgment');
    expect(text).toContain('consider authoring a deterministic rule');
    expect(text).toContain('New onset bilateral edema after a period of stability'); // the prose-decided one, named
  });

  it('does not show the AI-judgment note when every finding was rule-decided', () => {
    const assessment = makeAssessment({
      deterministic: true,
      symptoms: [
        { name: 'Breathlessness at rest', severity: 'severe', risk: 'HIGH', flag: 'red', decidedBy: 'rule' },
      ],
    });
    const text = fmt(assessment);
    expect(text).not.toContain('AI clinical judgment');
  });

  it('shows REASSURE outcome line', () => {
    const text = fmt(makeAssessment({ outcome: 'REASSURE' }));
    expect(text).toContain('REASSURE');
    expect(text).toContain('No immediate concerns');
  });

  it('shows ADVISE outcome line', () => {
    const text = fmt(makeAssessment({ outcome: 'ADVISE' }));
    expect(text).toContain('ADVISE');
    expect(text).toContain('Monitoring recommended');
  });

  it('shows ESCALATE outcome line', () => {
    const text = fmt(makeAssessment({ outcome: 'ESCALATE' }));
    expect(text).toContain('ESCALATE');
    expect(text).toContain('Immediate medical attention');
  });

  it('shows INCOMPLETE outcome line', () => {
    const text = fmt(makeAssessment({ outcome: 'INCOMPLETE' }));
    expect(text).toContain('INCOMPLETE');
    expect(text).toContain('Assessment incomplete');
  });
});

describe('SessionClosingService — llm path', () => {
  let svc: SessionClosingService;

  // The engine-wiring gate (Task 7) requires condition/classification/
  // conditionStartDate on the patient before it will even attempt an
  // assessment -- without these, close() falls back to the null-llm path.
  const llmPatient = {
    preferredLocale: 'hi-IN',
    condition: 'cardiac_surgery',
    classification: 'CABG',
    conditionStartDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
  };

  beforeEach(() => {
    svc = new SessionClosingService();
    jest.clearAllMocks();
    mockGetActiveKg.mockResolvedValue({ facts: {}, rules: [], red_flags: [] });
    mockLoadContext.mockResolvedValue({ patientContext: { currentPhase: 'phase_1' } });
  });

  async function spyOnAssess(resolved: { assessment: any; scoredEvents: any[] }) {
    const { TranscriptAssessmentService } = await import('../../ai-agent/clinical/transcript-assessment.service');
    return jest.spyOn(TranscriptAssessmentService.prototype, 'assess').mockResolvedValue(resolved);
  }

  it('calls TranscriptAssessmentService.assess() and persists the outcome', async () => {
    const mockAssessment = {
      outcome: 'ESCALATE' as const,
      patient_action: 'FACILITY_TODAY' as const,
      overall_risk_level: 'HIGH' as const,
      symptoms: [{ name: 'RF_FEVER', severity: 'moderate' as const, risk: 'HIGH' as const, flag: 'red' as const }],
      escalation_required: true,
      deterministic: true,
    };
    const assessSpy = await spyOnAssess({ assessment: mockAssessment, scoredEvents: [] });

    const prisma = makePrisma({ patient: llmPatient });
    const transcript = [
      { speaker: 'patient', originalText: 'I have fever', timestamp: new Date().toISOString() },
      { speaker: 'agent',   originalText: 'Noted.',       timestamp: new Date().toISOString() },
    ];
    const mockLlm = {} as any;

    const result = await svc.close(makeSession({ transcript }), prisma, mockLlm);

    expect(assessSpy).toHaveBeenCalledTimes(1);
    // session.transcript is a JSON column -- its timestamps come back as strings,
    // never real Date instances. TranscriptAssessmentService.assess() (and, inside
    // it, FactExtractor) requires real Dates -- FactExtractor calls .getTime() on
    // one when a fact carries a volunteered time offset. Assert the revival
    // actually happened rather than trusting an `as Turn[]` cast to paper over it.
    const turnsPassedToAssess = assessSpy.mock.calls[0][0];
    expect(turnsPassedToAssess[0].timestamp).toBeInstanceOf(Date);
    expect(turnsPassedToAssess[1].timestamp).toBeInstanceOf(Date);
    expect(result!.outcome).toBe('ESCALATE');
    expect(prisma.callSession.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ outcome: 'ESCALATE' }) }),
    );

    assessSpy.mockRestore();
  });

  // Task 7b: scoredEvents is always [] under the new engine (it doesn't
  // produce ClinicalEvent-shaped output), so persisting the outcome must
  // not depend on it -- gating on scoredEvents.length > 0 would silently
  // discard every computed outcome forever.
  it('persists the outcome even when no clinical events were produced', async () => {
    const mockAssessment = {
      outcome: 'ESCALATE' as const,
      patient_action: 'ER_NOW' as const,
      overall_risk_level: 'CRITICAL' as const,
      symptoms: [],
      escalation_required: true,
      deterministic: false,
    };
    const assessSpy = await spyOnAssess({ assessment: mockAssessment, scoredEvents: [] });

    const prisma = makePrisma({ patient: llmPatient });
    const transcript = [{ speaker: 'patient', originalText: 'severe chest pain', timestamp: new Date().toISOString() }];
    const mockLlm = {} as any;

    const result = await svc.close(makeSession({ transcript }), prisma, mockLlm);

    expect(prisma.clinicalEvent.createMany).not.toHaveBeenCalled(); // no scoredEvents -- nothing to write here
    expect(prisma.callSession.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ outcome: 'ESCALATE' }) }),
    );
    expect(result!.outcome).toBe('ESCALATE');

    assessSpy.mockRestore();
  });

  it('persists an INCOMPLETE outcome', async () => {
    const mockAssessment = {
      outcome: 'INCOMPLETE' as const,
      patient_action: null,
      overall_risk_level: 'MEDIUM' as const,
      symptoms: [],
      escalation_required: false,
      deterministic: false,
    };
    const assessSpy = await spyOnAssess({ assessment: mockAssessment, scoredEvents: [] });

    const prisma = makePrisma({ patient: llmPatient });
    const transcript = [{ speaker: 'patient', originalText: 'unclear response', timestamp: new Date().toISOString() }];
    const mockLlm = {} as any;

    const result = await svc.close(makeSession({ transcript }), prisma, mockLlm);

    expect(prisma.callSession.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ outcome: 'INCOMPLETE' }) }),
    );
    expect(result!.outcome).toBe('INCOMPLETE');

    assessSpy.mockRestore();
  });

  it('keeps REASSURE outcome and skips clinicalEvent writes when the assessment is REASSURE', async () => {
    const mockAssessment = {
      outcome: 'REASSURE' as const,
      patient_action: 'SELF_MONITOR' as const,
      overall_risk_level: 'LOW' as const,
      symptoms: [],
      escalation_required: false,
      deterministic: true,
    };
    const assessSpy = await spyOnAssess({ assessment: mockAssessment, scoredEvents: [] });

    const prisma = makePrisma({ patient: llmPatient });
    const transcript = [{ speaker: 'patient', originalText: 'I feel fine', timestamp: new Date().toISOString() }];
    const mockLlm = {} as any;

    const result = await svc.close(makeSession({ transcript }), prisma, mockLlm);

    expect(prisma.clinicalEvent.createMany).not.toHaveBeenCalled();
    // The outcome is still explicitly persisted (REASSURE at creation time
    // happens to match), unlike the old bug where this path silently never ran.
    expect(prisma.callSession.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ outcome: 'REASSURE' }) }),
    );
    expect(result!.outcome).toBe('REASSURE');

    assessSpy.mockRestore();
  });

  it('falls back to the null-llm path when patient condition/classification/conditionStartDate are missing', async () => {
    const assessSpy = await spyOnAssess({
      assessment: { outcome: 'ESCALATE', patient_action: 'ER_NOW', overall_risk_level: 'CRITICAL', symptoms: [], escalation_required: true, deterministic: true },
      scoredEvents: [],
    });

    const prisma = makePrisma(); // default patient has no condition/classification/conditionStartDate
    const transcript = [{ speaker: 'patient', originalText: 'hello', timestamp: new Date().toISOString() }];
    const mockLlm = {} as any;

    const result = await svc.close(makeSession({ transcript }), prisma, mockLlm);

    expect(assessSpy).not.toHaveBeenCalled();
    expect(result!.outcome).toBe('REASSURE'); // untouched default

    assessSpy.mockRestore();
  });
});

describe('SessionClosingService.storeSummaryWamid', () => {
  let service: SessionClosingService;
  let mockPrisma: any;

  beforeEach(() => {
    service = new SessionClosingService();
    mockPrisma = {
      callSession: { update: jest.fn().mockResolvedValue({}) },
    };
  });

  it('updates CallSession.summaryWamid with the provided wamid', async () => {
    await service.storeSummaryWamid('session-abc', 'wamid.HBgMOTE5ODc2NTQzMjEwFQIAEhgM', mockPrisma);
    expect(mockPrisma.callSession.update).toHaveBeenCalledWith({
      where: { id: 'session-abc' },
      data:  { summaryWamid: 'wamid.HBgMOTE5ODc2NTQzMjEwFQIAEhgM' },
    });
  });
});
