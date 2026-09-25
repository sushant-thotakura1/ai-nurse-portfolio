/**
 * Tests for context-loader.ts (v3 schema — Condition + Classification)
 */

import type { KnowledgeGraph, TriggerDates } from '../../../src/knowledge-graph/types';
import { resolveDaysSinceStart } from '../../../src/knowledge-graph/context-loader';

function makeKg(overrides: Partial<KnowledgeGraph> = {}): KnowledgeGraph {
  return {
    meta: {
      source_file: 'test.xlsx',
      generated_at: new Date().toISOString(),
      schema_version: 'v3.1',
      condition: {
        name: 'Test Condition',
        condition_type: 'episodic',
        classifications: ['Test'],
      },
      required_inputs: ['classification', 'discharge_date'],
    },
    condition: {
      name: 'Test Condition',
      condition_type: 'episodic',
      trigger: ['discharge_date'],
      phase_model: 'linear',
      classifications: {
        Test: {
          label: 'Test',
          phases: {
            PHASE_I: {
              name: 'Phase I',
              day_range: [0, 14],
              day_range_type: 'fixed',
              focus: 'Early',
              review: 'Review',
              instruction_sheet: 'v1',
            },
            PHASE_II: {
              name: 'Phase II',
              day_range: [15, 30],
              day_range_type: 'fixed',
              focus: 'Mid',
              review: 'Review',
              instruction_sheet: 'v1',
            },
            PHASE_III: {
              name: 'Phase III',
              day_range: [31, null],
              day_range_type: 'open',
              focus: 'Late',
              review: 'Review',
              instruction_sheet: 'v1',
            },
          },
        },
      },
    },
    symptoms: {},
    red_flags: [],
    instructions: [],
    scoring: {
      thresholds: {},
      rules: { escalate_override: '', phase_override: '' },
    },
    traversal: [],
    ...overrides,
  } as unknown as KnowledgeGraph;
}

describe('TypeScript types: PhaseDefinition', () => {
  it('accepts null end day in day_range', () => {
    const kg = makeKg();
    const phase = kg.condition.classifications['Test'].phases['PHASE_III'];
    expect(phase.day_range[1]).toBeNull();
    expect(phase.day_range_type).toBe('open');
  });

  it('accepts fixed day_range_type', () => {
    const kg = makeKg();
    expect(kg.condition.classifications['Test'].phases['PHASE_I'].day_range_type).toBe('fixed');
  });
});

jest.mock('../../../src/knowledge-graph/knowledge-graph.service', () => ({
  knowledgeGraphService: {
    getActiveKnowledgeGraph: jest.fn(),
    getKnowledgeGraphById: jest.fn(),
  },
}));

describe('loadContext (v3 classification-aware)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { knowledgeGraphService } = require('../../../src/knowledge-graph/knowledge-graph.service');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { contextLoader } = require('../../../src/knowledge-graph/context-loader');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('resolves correct phase for a linear KG with fixed ranges', async () => {
    knowledgeGraphService.getActiveKnowledgeGraph.mockResolvedValue(makeKg());
    const result = await contextLoader.loadContext('TEST', 'Test', 10, 'en-IN');
    expect(result).not.toBeNull();
    expect(result!.patientContext.currentPhase).toBe('PHASE_I');
    expect(result!.patientContext.isReentry).toBe(false);
  });

  it('isReentry defaults to false when not passed', async () => {
    knowledgeGraphService.getActiveKnowledgeGraph.mockResolvedValue(makeKg());
    const result = await contextLoader.loadContext('TEST', 'Test', 5, 'hi-IN');
    expect(result!.patientContext.isReentry).toBe(false);
  });

  it('isReentry is true when explicitly passed as true', async () => {
    knowledgeGraphService.getActiveKnowledgeGraph.mockResolvedValue(makeKg());
    const result = await contextLoader.loadContext('TEST', 'Test', 5, 'hi-IN', undefined, true);
    expect(result!.patientContext.isReentry).toBe(true);
  });

  it('throws when classification does not exist', async () => {
    knowledgeGraphService.getActiveKnowledgeGraph.mockResolvedValue(makeKg());
    await expect(
      contextLoader.loadContext('TEST', 'CLS_MISSING', 5, 'hi-IN')
    ).rejects.toThrow(/Classification 'CLS_MISSING'/);
  });

  it('escalationMessage is null when the KG has no Settings sheet/escalation_message', async () => {
    knowledgeGraphService.getActiveKnowledgeGraph.mockResolvedValue(makeKg());
    const result = await contextLoader.loadContext('TEST', 'Test', 10, 'en-IN');
    expect(result!.escalationMessage).toBeNull();
  });

  it('escalationMessage is populated from kg.settings.escalation_message when present', async () => {
    knowledgeGraphService.getActiveKnowledgeGraph.mockResolvedValue(makeKg({
      settings: {
        max_questions_per_checkin: 6,
        min_days_between_checkins: '3d',
        checkin_trigger_stale_count: 1,
        time_uncertainty_tolerance: 0.25,
        escalation_message: 'Call 080-66202020 to book an appointment.',
      },
    }));
    const result = await contextLoader.loadContext('TEST', 'Test', 10, 'en-IN');
    expect(result!.escalationMessage).toBe('Call 080-66202020 to book an appointment.');
  });
});

describe('resolveDaysSinceStart', () => {
  const today = new Date();
  const daysAgo = (n: number) => new Date(today.getTime() - n * 86_400_000);

  it('uses preferred (first listed) trigger when available', () => {
    const kg = makeKg({
      condition: {
        ...makeKg().condition,
        trigger: ['discharge_date', 'enrollment_date'],
        phase_model: 'linear',
      },
    });
    const dates: TriggerDates = {
      discharge_date: daysAgo(10),
      enrollment_date: daysAgo(30),
    };
    const result = resolveDaysSinceStart(kg, dates);
    expect(result.triggerTypeUsed).toBe('discharge_date');
    expect(result.daysSinceStart).toBe(10);
    expect(result.isReentry).toBe(false);
  });

  it('falls back to second trigger when first is absent', () => {
    const kg = makeKg({
      condition: {
        ...makeKg().condition,
        trigger: ['discharge_date', 'enrollment_date'],
        phase_model: 'linear',
      },
    });
    const dates: TriggerDates = { enrollment_date: daysAgo(20) };
    const result = resolveDaysSinceStart(kg, dates);
    expect(result.triggerTypeUsed).toBe('enrollment_date');
    expect(result.daysSinceStart).toBe(20);
  });

  it('throws when no trigger date is available', () => {
    const kg = makeKg({
      condition: {
        ...makeKg().condition,
        trigger: ['discharge_date', 'enrollment_date'],
        phase_model: 'linear',
      },
    });
    expect(() => resolveDaysSinceStart(kg, {})).toThrow(/discharge_date.*enrollment_date/);
  });

  it('linear: isReentry is always false regardless of dates', () => {
    const kg = makeKg({
      condition: {
        ...makeKg().condition,
        trigger: ['discharge_date'],
        phase_model: 'linear',
      },
    });
    const dates: TriggerDates = { discharge_date: daysAgo(45) };
    const result = resolveDaysSinceStart(kg, dates);
    expect(result.isReentry).toBe(false);
    expect(result.daysSinceStart).toBe(45);
  });

  it('cyclical: older second trigger does not cause re-entry', () => {
    const kg = makeKg({
      condition: {
        ...makeKg().condition,
        trigger: ['discharge_date', 'enrollment_date'],
        phase_model: 'cyclical',
      },
    });
    const dates: TriggerDates = {
      discharge_date: daysAgo(100),
      enrollment_date: daysAgo(120),
    };
    const result = resolveDaysSinceStart(kg, dates);
    expect(result.isReentry).toBe(false);
    expect(result.triggerTypeUsed).toBe('discharge_date');
    expect(result.daysSinceStart).toBe(100);
  });

  it('cyclical: enrollment_date preferred, but newer discharge_date causes re-entry', () => {
    const kg = makeKg({
      condition: {
        ...makeKg().condition,
        trigger: ['enrollment_date', 'discharge_date'],
        phase_model: 'cyclical',
      },
    });
    const dates: TriggerDates = {
      enrollment_date: daysAgo(180),
      discharge_date: daysAgo(5),
    };
    const result = resolveDaysSinceStart(kg, dates);
    expect(result.isReentry).toBe(true);
    expect(result.daysSinceStart).toBe(5);
    expect(result.triggerTypeUsed).toBe('discharge_date');
  });

  it('returns daysSinceStart of 0 when trigger date is in the future', () => {
    const kg = makeKg({
      condition: {
        ...makeKg().condition,
        trigger: ['discharge_date'],
        phase_model: 'linear',
      },
    });
    const tomorrow = new Date(Date.now() + 86_400_000);
    const result = resolveDaysSinceStart(kg, { discharge_date: tomorrow });
    expect(result.daysSinceStart).toBe(0);
    expect(result.isReentry).toBe(false);
  });
});
