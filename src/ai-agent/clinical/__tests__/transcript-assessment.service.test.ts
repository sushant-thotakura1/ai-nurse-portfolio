import { TranscriptAssessmentService } from '../transcript-assessment.service';
import { LLMProvider } from '../../interfaces';
import { Turn } from '../../../orchestrator/session';
import { KnowledgeGraph, Fact, Rule, RedFlag } from '../../../knowledge-graph/types';
import { RedFlagValidationResult } from '../red-flag-check.types';
import { PrismaClient } from '@prisma/client';

const mockLlm: LLMProvider = { complete: jest.fn(), stream: jest.fn() as any };

// FactExtractor calls this for any KG with a non-empty applicable fact set --
// resolve `always_true` (the fixture fact every test rule keys off) so tests
// exercise real fact resolution rather than every rule going unresolvable.
beforeEach(() => {
  (mockLlm.complete as jest.Mock).mockReset().mockResolvedValue({
    content: JSON.stringify({ always_true: { value: true, extractionClass: 'CONFIDENT' } }),
    finishReason: 'stop',
    usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
  });
});

const now = new Date('2025-01-01T12:00:00Z');

const minimalTurns: Turn[] = [
  { turnNumber: 1, speaker: 'agent', originalText: 'How are you feeling?', timestamp: now },
  { turnNumber: 2, speaker: 'patient', originalText: 'I feel okay.', timestamp: now },
];

function makeFact(overrides: Partial<Fact> = {}): Fact {
  return {
    display_name: null,
    area: 'vitals',
    type: 'boolean',
    valid_for: '999999h',
    valid_for_hours: 999_999,
    required: false,
    applicable_classifications: ['ALL'],
    applicable_phases: ['ALL'],
    extraction_hint: null,
    ...overrides,
  };
}

function makeRule(overrides: Partial<Rule> & { rule_id: string; red_flag_id: string }): Rule {
  return {
    order: 1,
    expression: 'always_true',
    ast: { kind: 'fact', name: 'always_true' },
    action: 'ESCALATE',
    patient_action: 'NURSE_CALLBACK',
    applicable_classifications: ['ALL'],
    applicable_phases: ['ALL'],
    ...overrides,
  };
}

function makeRedFlag(id: string, overrides: Partial<RedFlag> = {}): RedFlag {
  return {
    id,
    symptom_id: null,
    trigger: `Trigger prose for ${id}`,
    applicable_classifications: ['ALL'],
    applicable_phases: ['ALL'],
    action: 'ADVISE',
    urgency: 'urgent',
    patient_action: 'NURSE_CALLBACK',
    context_note: '',
    rationale: '',
    ...overrides,
  };
}

function makeKg(overrides: Partial<KnowledgeGraph> = {}): KnowledgeGraph {
  return {
    meta: {} as any,
    condition: {} as any,
    symptoms: {},
    red_flags: [],
    instructions: [],
    scoring: {} as any,
    traversal: [],
    facts: {},
    rules: [],
    ...overrides,
  };
}

/** No facts to extract -- FactExtractor's fast path returns [] without an LLM call. */
const NO_FACTS_KG = makeKg();

function makeMockPrisma(): jest.Mocked<PrismaClient> {
  return {
    patientFact: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn() },
    assessment: { create: jest.fn() },
    assessmentFlag: { createMany: jest.fn() },
    $transaction: jest.fn((cb: any) => cb({
      assessment: { create: jest.fn().mockResolvedValue({ id: 'assessment-1' }) },
      assessmentFlag: { createMany: jest.fn() },
    })),
  } as unknown as jest.Mocked<PrismaClient>;
}

describe('TranscriptAssessmentService.assess()', () => {
  it('runs rulePass -> call 3 -> finalize in order', async () => {
    // A rule that always matches decides RF_RULE deterministically (no call 3
    // needed for it); RF_PROSE has no rule, so it must go to call 3.
    const kg = makeKg({
      red_flags: [makeRedFlag('RF_RULE', { action: 'ESCALATE', patient_action: 'ER_NOW' }), makeRedFlag('RF_PROSE')],
      rules: [makeRule({ rule_id: 'R_1', red_flag_id: 'RF_RULE', action: 'ESCALATE', patient_action: 'ER_NOW', ast: { kind: 'fact', name: 'always_true' } })],
      facts: { always_true: makeFact({ type: 'boolean' }) },
    });

    const redFlagCheckFn = jest.fn(async (input): Promise<RedFlagValidationResult> => {
      // The rule-decided flag must never be asked about in call 3.
      expect(input.flags.map((f: RedFlag) => f.id)).toEqual(['RF_PROSE']);
      return {
        verdicts: [{ red_flag_id: 'RF_PROSE', fired: false }],
        evidence: new Map([['RF_PROSE', 'no evidence of concern']]),
        unevaluated: [],
      };
    });

    const prisma = makeMockPrisma();
    const svc = new TranscriptAssessmentService(mockLlm, prisma, redFlagCheckFn);
    const { assessment } = await svc.assess(minimalTurns, kg, 'CABG', 'phase_1', 3, now);

    expect(redFlagCheckFn).toHaveBeenCalledTimes(1);
    // RF_RULE (ESCALATE/ER_NOW) outranks RF_PROSE's fired:false -- outcome is ESCALATE.
    expect(assessment.outcome).toBe('ESCALATE');
    expect(assessment.patient_action).toBe('ER_NOW');
  });

  it('accepts an injected red-flag checker so eval can pin verdicts', async () => {
    const kg = makeKg({
      red_flags: [makeRedFlag('RF_A', { action: 'ADVISE', patient_action: 'NURSE_CALLBACK' })],
    });
    const pinnedCheck = jest.fn(async (): Promise<RedFlagValidationResult> => ({
      verdicts: [{ red_flag_id: 'RF_A', fired: true }],
      evidence: new Map([['RF_A', 'pinned evidence']]),
      unevaluated: [],
    }));

    // No prisma/identity supplied -- this is exactly the eval-replay shape:
    // an injected checker standing in for a live LLM call, and no real
    // patient to persist against.
    const svc = new TranscriptAssessmentService(mockLlm, makeMockPrisma(), pinnedCheck);
    const { assessment } = await svc.assess(minimalTurns, kg, 'CABG', 'phase_1', 3, now);

    expect(pinnedCheck).toHaveBeenCalledTimes(1);
    expect(assessment.outcome).toBe('ADVISE');
    expect(assessment.patient_action).toBe('NURSE_CALLBACK');
  });

  it('persists one audit row per evaluated flag', async () => {
    const kg = makeKg({
      red_flags: [makeRedFlag('RF_RULE', { action: 'ESCALATE' }), makeRedFlag('RF_PROSE')],
      rules: [makeRule({ rule_id: 'R_1', red_flag_id: 'RF_RULE', action: 'ESCALATE', ast: { kind: 'fact', name: 'always_true' } })],
      facts: { always_true: makeFact({ type: 'boolean' }) },
    });
    const redFlagCheckFn = jest.fn(async (): Promise<RedFlagValidationResult> => ({
      verdicts: [],
      evidence: new Map(),
      unevaluated: ['RF_PROSE'],
    }));

    let createManyArg: any;
    let assessmentCreateArg: any;
    const prisma = {
      patientFact: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...data, id: 'fact-row-1' })) },
      $transaction: jest.fn(async (cb: any) => cb({
        assessment: {
          create: jest.fn().mockImplementation((arg: any) => {
            assessmentCreateArg = arg;
            return Promise.resolve({ id: 'assessment-1' });
          }),
        },
        assessmentFlag: {
          createMany: jest.fn().mockImplementation((arg: any) => {
            createManyArg = arg;
            return Promise.resolve({ count: arg.data.length });
          }),
        },
      })),
    } as unknown as jest.Mocked<PrismaClient>;

    const svc = new TranscriptAssessmentService(mockLlm, prisma, redFlagCheckFn);
    await svc.assess(minimalTurns, kg, 'CABG', 'phase_1', 3, now, {
      tenantId: 'tenant-1', patientId: 'patient-1', sessionId: 'session-1',
    });

    expect(assessmentCreateArg.data.tenantId).toBe('tenant-1');
    // One row for RF_RULE (decided by rule) and one for RF_PROSE (unevaluated).
    expect(createManyArg.data).toHaveLength(2);
    const byFlag = Object.fromEntries(createManyArg.data.map((r: any) => [r.redFlagId, r]));
    expect(byFlag['RF_RULE']).toMatchObject({ decidedBy: 'rule', fired: true, tenantId: 'tenant-1' });
    expect(byFlag['RF_PROSE']).toMatchObject({ decidedBy: 'unevaluated', fired: null, tenantId: 'tenant-1' });
  });

  it('does not let cross-session PatientFact history decide a new_onset() rule (session-scoped fact resolution)', async () => {
    const kg = makeKg({
      red_flags: [makeRedFlag('RF_X', { action: 'ESCALATE', patient_action: 'ER_NOW' })],
      rules: [makeRule({
        rule_id: 'R_1',
        red_flag_id: 'RF_X',
        action: 'ESCALATE',
        patient_action: 'ER_NOW',
        ast: { kind: 'call', func: 'new_onset', fact: 'symptom_x', window: '90d' },
      })],
      facts: { symptom_x: makeFact({ type: 'boolean' }) },
    });

    // FactExtractor (call 2) extracts symptom_x = true for THIS session.
    (mockLlm.complete as jest.Mock).mockResolvedValue({
      content: JSON.stringify({ symptom_x: { value: true, extractionClass: 'CONFIDENT' } }),
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
    });

    // A PRIOR session recorded symptom_x = false 10 days ago. Under the old
    // cross-session resolver, [false (10d ago), true (now)] is exactly the
    // false->true transition new_onset() is designed to catch -- it would
    // resolve true and ESCALATE would fire deterministically, off a reading
    // from a different conversation.
    const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
    const prisma = {
      patientFact: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'hist-1', factId: 'symptom_x',
            valueNumber: null, valueBoolean: false, valueString: null,
            observedAt: tenDaysAgo, timeUncertaintyHours: 0, extractionClass: 'CONFIDENT',
          },
        ]),
        create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...data, id: 'session-row-1' })),
      },
      $transaction: jest.fn(async (cb: any) => cb({
        assessment: { create: jest.fn().mockResolvedValue({ id: 'assessment-1' }) },
        assessmentFlag: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      })),
    } as unknown as jest.Mocked<PrismaClient>;

    const redFlagCheckFn = jest.fn(async (): Promise<RedFlagValidationResult> => ({
      verdicts: [{ red_flag_id: 'RF_X', fired: false }],
      evidence: new Map([['RF_X', 'nothing concerning in this session alone']]),
      unevaluated: [],
    }));

    const svc = new TranscriptAssessmentService(mockLlm, prisma, redFlagCheckFn);
    const { assessment } = await svc.assess(minimalTurns, kg, 'CABG', 'phase_1', 3, now, {
      tenantId: 'tenant-1', patientId: 'patient-1', sessionId: 'session-1',
    });

    // Session-scoped: new_onset() can only see this session's single `true`
    // reading, with no prior-false baseline in scope -- it cannot resolve
    // true, so RF_X falls through to call 3 (prose) instead of firing by rule.
    expect(redFlagCheckFn).toHaveBeenCalledTimes(1);
    expect(assessment.outcome).toBe('REASSURE');
    // RF_X never resolved true by rule or by prose, so it produces no
    // symptom entry at all -- a stronger check than "none say decidedBy:
    // rule", which would trivially pass on an empty array too.
    expect(assessment.symptoms).toHaveLength(0);
  });

  it('skips call 3 entirely when nothing fell through', async () => {
    const kg = makeKg({
      red_flags: [makeRedFlag('RF_RULE', { action: 'REASSURE' })],
      rules: [makeRule({ rule_id: 'R_1', red_flag_id: 'RF_RULE', action: 'REASSURE', ast: { kind: 'fact', name: 'always_true' } })],
      facts: { always_true: makeFact({ type: 'boolean' }) },
    });
    const redFlagCheckFn = jest.fn();

    const svc = new TranscriptAssessmentService(mockLlm, makeMockPrisma(), redFlagCheckFn);
    const { assessment } = await svc.assess(minimalTurns, kg, 'CABG', 'phase_1', 3, now);

    // redFlagCheck itself also no-ops on an empty flag list (Task 6), but the
    // orchestrator must not even construct/pass a request for it to matter.
    expect(redFlagCheckFn).not.toHaveBeenCalled();
    expect(assessment.outcome).toBe('REASSURE');
    expect(assessment.deterministic).toBe(true);
  });

  it('never sends a red flag to call 3 when it is out of scope for the patient\'s current phase', async () => {
    // RF_LATE is scoped to PHASE_III only (e.g. "recurrence after a period of
    // stability" -- only meaningful for a patient who has already been
    // through the earlier phases). It has no rule at all, so absent phase
    // filtering it would land in call 3's candidate set regardless of the
    // patient's actual phase and could fire on prose judgment alone -- for a
    // red flag that was never applicable to this patient in the first place.
    const kg = makeKg({
      red_flags: [makeRedFlag('RF_LATE', { applicable_phases: ['PHASE_III'], action: 'ESCALATE', patient_action: 'FACILITY_TODAY' })],
    });
    const redFlagCheckFn = jest.fn(async (): Promise<RedFlagValidationResult> => ({
      verdicts: [{ red_flag_id: 'RF_LATE', fired: true }],
      evidence: new Map([['RF_LATE', 'would have fired if asked']]),
      unevaluated: [],
    }));

    const svc = new TranscriptAssessmentService(mockLlm, makeMockPrisma(), redFlagCheckFn);
    const { assessment } = await svc.assess(minimalTurns, kg, 'CABG', 'PHASE_I', 3, now);

    expect(redFlagCheckFn).not.toHaveBeenCalled();
    expect(assessment.symptoms).toEqual([]);
    expect(assessment.outcome).toBe('REASSURE');
    expect(assessment.deterministic).toBe(true);
  });

  it('maps every Decision.outcome to an overall_risk_level', async () => {
    const cases: Array<{
      redFlags: RedFlag[];
      rules: Rule[];
      expectedOutcome: string;
      expectedRisk: string;
    }> = [
      {
        redFlags: [],
        rules: [],
        expectedOutcome: 'REASSURE',
        expectedRisk: 'LOW',
      },
      {
        redFlags: [makeRedFlag('RF_A', { action: 'ADVISE', patient_action: 'NURSE_CALLBACK' })],
        rules: [makeRule({ rule_id: 'R_1', red_flag_id: 'RF_A', action: 'ADVISE', patient_action: 'NURSE_CALLBACK', ast: { kind: 'fact', name: 'always_true' } })],
        expectedOutcome: 'ADVISE',
        expectedRisk: 'MEDIUM',
      },
      {
        redFlags: [makeRedFlag('RF_A', { action: 'ESCALATE', patient_action: 'FACILITY_TODAY' })],
        rules: [makeRule({ rule_id: 'R_1', red_flag_id: 'RF_A', action: 'ESCALATE', patient_action: 'FACILITY_TODAY', ast: { kind: 'fact', name: 'always_true' } })],
        expectedOutcome: 'ESCALATE',
        expectedRisk: 'HIGH',
      },
      {
        redFlags: [makeRedFlag('RF_A', { action: 'ESCALATE', patient_action: 'ER_NOW' })],
        rules: [makeRule({ rule_id: 'R_1', red_flag_id: 'RF_A', action: 'ESCALATE', patient_action: 'ER_NOW', ast: { kind: 'fact', name: 'always_true' } })],
        expectedOutcome: 'ESCALATE',
        expectedRisk: 'CRITICAL',
      },
    ];

    for (const c of cases) {
      const kg = makeKg({
        red_flags: c.redFlags,
        rules: c.rules,
        facts: { always_true: makeFact({ type: 'boolean' }) },
      });
      const svc = new TranscriptAssessmentService(mockLlm, makeMockPrisma(), jest.fn());
      const { assessment } = await svc.assess(minimalTurns, kg, 'CABG', 'phase_1', 3, now);
      expect(assessment.outcome).toBe(c.expectedOutcome);
      expect(assessment.overall_risk_level).toBe(c.expectedRisk);
    }

    // INCOMPLETE has no rule-derived path (it comes from a missing required
    // fact or an unevaluated flag) -- exercised directly via a fell-through
    // flag with no rules and a call-3 that leaves it unevaluated.
    const incompleteKg = makeKg({ red_flags: [makeRedFlag('RF_A')] });
    const svc = new TranscriptAssessmentService(mockLlm, makeMockPrisma(), async () => ({
      verdicts: [],
      evidence: new Map(),
      unevaluated: ['RF_A'],
    }));
    const { assessment } = await svc.assess(minimalTurns, incompleteKg, 'CABG', 'phase_1', 3, now);
    expect(assessment.outcome).toBe('INCOMPLETE');
    expect(assessment.overall_risk_level).toBe('MEDIUM');
  });

  it('with no rules in the KB, prose (call 3) decides and outcome reflects its verdict', async () => {
    const kg = makeKg({ red_flags: [makeRedFlag('RF_A', { action: 'ESCALATE', patient_action: 'ER_NOW' })] });
    const svc = new TranscriptAssessmentService(mockLlm, makeMockPrisma(), async () => ({
      verdicts: [{ red_flag_id: 'RF_A', fired: true }],
      evidence: new Map([['RF_A', 'fired via prose']]),
      unevaluated: [],
    }));
    const { assessment } = await svc.assess(minimalTurns, kg, 'CABG', 'phase_1', 3, now);
    expect(assessment.outcome).toBe('ESCALATE');
    expect(assessment.deterministic).toBe(false); // prose was used -- not every flag was covered by a rule
  });

  // Sheet 4's Symptom ID needs to survive into AssessmentOutput.symptoms so a
  // summary formatter can tell "two flags about the same complaint" apart
  // from "two flags about genuinely different symptoms" (session-closing.
  // service.ts's collapseBySymptom). Covered for both the rule path and the
  // prose (call 3) path, since each builds its symptoms[] entry separately.
  it('threads a fired flag\'s symptom_id through to symptoms[].symptomId (rule-decided)', async () => {
    const kg = makeKg({
      red_flags: [makeRedFlag('RF_A', { symptom_id: 'SYM_X', action: 'ESCALATE', patient_action: 'ER_NOW' })],
      rules: [makeRule({ rule_id: 'R_1', red_flag_id: 'RF_A', action: 'ESCALATE', patient_action: 'ER_NOW', ast: { kind: 'fact', name: 'always_true' } })],
      facts: { always_true: makeFact({ type: 'boolean' }) },
    });
    const svc = new TranscriptAssessmentService(mockLlm, makeMockPrisma(), jest.fn());
    const { assessment } = await svc.assess(minimalTurns, kg, 'CABG', 'phase_1', 3, now);
    expect(assessment.symptoms).toHaveLength(1);
    expect(assessment.symptoms[0].symptomId).toBe('SYM_X');
  });

  it('threads a fired flag\'s symptom_id through to symptoms[].symptomId (prose-decided)', async () => {
    const kg = makeKg({ red_flags: [makeRedFlag('RF_A', { symptom_id: 'SYM_Y', action: 'ESCALATE', patient_action: 'ER_NOW' })] });
    const svc = new TranscriptAssessmentService(mockLlm, makeMockPrisma(), async () => ({
      verdicts: [{ red_flag_id: 'RF_A', fired: true }],
      evidence: new Map([['RF_A', 'fired via prose']]),
      unevaluated: [],
    }));
    const { assessment } = await svc.assess(minimalTurns, kg, 'CABG', 'phase_1', 3, now);
    expect(assessment.symptoms[0].symptomId).toBe('SYM_Y');
  });

  it('symptomId is null for a standalone red flag with no linked symptom', async () => {
    const kg = makeKg({
      red_flags: [makeRedFlag('RF_A', { symptom_id: null, action: 'ESCALATE', patient_action: 'ER_NOW' })],
      rules: [makeRule({ rule_id: 'R_1', red_flag_id: 'RF_A', action: 'ESCALATE', patient_action: 'ER_NOW', ast: { kind: 'fact', name: 'always_true' } })],
      facts: { always_true: makeFact({ type: 'boolean' }) },
    });
    const svc = new TranscriptAssessmentService(mockLlm, makeMockPrisma(), jest.fn());
    const { assessment } = await svc.assess(minimalTurns, kg, 'CABG', 'phase_1', 3, now);
    expect(assessment.symptoms[0].symptomId).toBeNull();
  });
});
