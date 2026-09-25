import { runRuleTest } from '../rule-test-runner';
import { Rule, Fact, RuleTest } from '../../knowledge-graph/types';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const now = new Date('2025-06-01T12:00:00Z');

const FACTS: Record<string, Fact> = {
  weight: {
    display_name: 'Weight', area: 'vitals', type: 'number', unit: 'kg',
    valid_for: '7d', valid_for_hours: 168, required: true,
    applicable_classifications: [], applicable_phases: [], extraction_hint: null,
  },
  breathlessness: {
    display_name: 'Breathlessness', area: 'symptom', type: 'boolean',
    valid_for: '7d', valid_for_hours: 168, required: false,
    applicable_classifications: [], applicable_phases: [], extraction_hint: null,
  },
};

// weight >= 80
const WEIGHT_RULE: Rule = {
  rule_id: 'R_WEIGHT',
  red_flag_id: 'RF_WEIGHT',
  order: 1,
  expression: 'weight >= 80',
  ast: {
    kind: 'compare', op: '>=',
    left: { kind: 'fact', name: 'weight' },
    right: { kind: 'number', value: 80 },
  },
  action: 'ESCALATE',
  patient_action: 'NURSE_CALLBACK',
  applicable_classifications: ['ALL'],
  applicable_phases: ['ALL'],
};

// delta(weight, 48h) >= 2
const DELTA_RULE: Rule = {
  rule_id: 'R_DELTA',
  red_flag_id: 'RF_DELTA',
  order: 1,
  expression: 'delta(weight, 48h) >= 2',
  ast: {
    kind: 'compare', op: '>=',
    left: { kind: 'call', func: 'delta', fact: 'weight', window: '48h' },
    right: { kind: 'number', value: 2 },
  },
  action: 'ESCALATE',
  patient_action: 'NURSE_CALLBACK',
  applicable_classifications: ['ALL'],
  applicable_phases: ['ALL'],
};

// no_reading(weight, 7d)
const NO_READING_RULE: Rule = {
  rule_id: 'R_NO_READING',
  red_flag_id: 'RF_NO_READING',
  order: 1,
  expression: 'no_reading(weight, 7d)',
  ast: { kind: 'call', func: 'no_reading', fact: 'weight', window: '7d' },
  action: 'ADVISE',
  patient_action: 'SELF_MONITOR',
  applicable_classifications: ['ALL'],
  applicable_phases: ['ALL'],
};

const TOLERANCE = 0.25;

function makeTest(overrides: Partial<RuleTest> & { test_id: string; rule_id: string }): RuleTest {
  return {
    scenario: 'a scenario',
    observations: [],
    expect: 'FIRES',
    notes: null,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('runRuleTest', () => {
  it('reports pass when a FIRES case matches', () => {
    const test = makeTest({
      test_id: 'T1', rule_id: 'R_WEIGHT', scenario: 'Weight above threshold',
      observations: [{ fact: 'weight', value: 90, offset_hours: 0 }],
      expect: 'FIRES',
    });
    const result = runRuleTest(test, WEIGHT_RULE, FACTS, TOLERANCE, now);
    expect(result).toEqual({
      testId: 'T1', ruleId: 'R_WEIGHT', scenario: 'Weight above threshold',
      expected: 'FIRES', actual: 'FIRES', passed: true,
    });
  });

  it('reports FAIL when a FIRES case does not match', () => {
    const test = makeTest({
      test_id: 'T2', rule_id: 'R_WEIGHT', scenario: 'Weight below threshold, wrongly expected to fire',
      observations: [{ fact: 'weight', value: 50, offset_hours: 0 }],
      expect: 'FIRES',
    });
    const result = runRuleTest(test, WEIGHT_RULE, FACTS, TOLERANCE, now);
    expect(result.actual).toBe('NOT_FIRES');
    expect(result.passed).toBe(false);
  });

  it('reports pass when a NOT_FIRES case does not match', () => {
    const test = makeTest({
      test_id: 'T3', rule_id: 'R_WEIGHT', scenario: 'Weight below threshold',
      observations: [{ fact: 'weight', value: 50, offset_hours: 0 }],
      expect: 'NOT_FIRES',
    });
    const result = runRuleTest(test, WEIGHT_RULE, FACTS, TOLERANCE, now);
    expect(result.actual).toBe('NOT_FIRES');
    expect(result.passed).toBe(true);
  });

  it('reports FAIL when a NOT_FIRES case matches — catches an over-broad rule', () => {
    const test = makeTest({
      test_id: 'T4', rule_id: 'R_WEIGHT', scenario: 'Weight above threshold, wrongly expected not to fire',
      observations: [{ fact: 'weight', value: 90, offset_hours: 0 }],
      expect: 'NOT_FIRES',
    });
    const result = runRuleTest(test, WEIGHT_RULE, FACTS, TOLERANCE, now);
    expect(result.actual).toBe('FIRES');
    expect(result.passed).toBe(false);
  });

  it('builds fact history from offsets: -2d becomes now minus 48h', () => {
    // delta(weight, 48h) needs two readings inside the 48h window. -2d (=-48h)
    // must land exactly at the window boundary, and 0 at "now" — if offsets
    // were mis-converted (e.g. treated as days instead of hours), delta would
    // be unresolvable or wrong, and this FIRES case would fail.
    const test = makeTest({
      test_id: 'T5', rule_id: 'R_DELTA', scenario: 'Gained 2kg in two days',
      observations: [
        { fact: 'weight', value: 70, offset_hours: -48 },
        { fact: 'weight', value: 72, offset_hours: 0 },
      ],
      expect: 'FIRES',
    });
    const result = runRuleTest(test, DELTA_RULE, FACTS, TOLERANCE, now);
    expect(result.actual).toBe('FIRES');
    expect(result.passed).toBe(true);
  });

  it('a fact absent from observations has no readings — no_reading() sees zero', () => {
    const test = makeTest({
      test_id: 'T6', rule_id: 'R_NO_READING', scenario: 'Patient never reported weight',
      observations: [], // weight never observed
      expect: 'FIRES',
    });
    const result = runRuleTest(test, NO_READING_RULE, FACTS, TOLERANCE, now);
    expect(result.actual).toBe('FIRES');
    expect(result.passed).toBe(true);
  });

  it('is deterministic: same case + same now yields the same result twice', () => {
    const test = makeTest({
      test_id: 'T7', rule_id: 'R_WEIGHT', scenario: 'Weight above threshold',
      observations: [{ fact: 'weight', value: 90, offset_hours: 0 }],
      expect: 'FIRES',
    });
    const first = runRuleTest(test, WEIGHT_RULE, FACTS, TOLERANCE, now);
    const second = runRuleTest(test, WEIGHT_RULE, FACTS, TOLERANCE, now);
    expect(second).toEqual(first);
  });

  it('reports the scenario text on failure, so the message is human-readable', () => {
    const test = makeTest({
      test_id: 'T8', rule_id: 'R_WEIGHT',
      scenario: 'This exact sentence should appear in the failing result',
      observations: [{ fact: 'weight', value: 50, offset_hours: 0 }],
      expect: 'FIRES',
    });
    const result = runRuleTest(test, WEIGHT_RULE, FACTS, TOLERANCE, now);
    expect(result.passed).toBe(false);
    expect(result.scenario).toBe('This exact sentence should appear in the failing result');
  });
});
