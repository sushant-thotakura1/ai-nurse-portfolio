import { rulePass } from '../rule-pass';
import { Rule, RuleAst, Fact } from '../../knowledge-graph/types';
import { FactResolver, RuleVerdict } from '../types';
import { FactRow } from '../patient-fact.repository';
import { inMemoryFactResolver } from '../in-memory-fact-resolver';

const ALWAYS_TRUE_AST: RuleAst = { kind: 'fact', name: 'always_true' };
const ALWAYS_FALSE_AST: RuleAst = { kind: 'fact', name: 'always_false' };
const UNRESOLVABLE_AST: RuleAst = { kind: 'fact', name: 'unresolvable' };

// FactResolver that maps 'always_true' → true, 'always_false' → false, anything else → unresolved.
// Built on the shared inMemoryFactResolver (see in-memory-fact-resolver.ts) so this
// double can't drift from the resolver the real rule-test-runner uses. 'always_true'
// and 'always_false' are given a single "now" row and a permissive Fact def each;
// 'unresolvable' (and anything else) intentionally has no row/def, so currentValue
// returns { resolved: false }.
function makeResolver(): FactResolver {
  const now = new Date('2025-01-01T12:00:00Z');
  const permissiveDef = (): Fact => ({
    display_name: null,
    area: 'symptom',
    type: 'boolean',
    valid_for: '999999h',
    valid_for_hours: 999_999,
    required: false,
    applicable_classifications: [],
    applicable_phases: [],
    extraction_hint: null,
  });
  const rows: FactRow[] = [
    { id: 'always_true-current', factId: 'always_true', value: true, observedAt: now,
      timeUncertaintyHours: 0, extractionClass: 'CONFIDENT' },
    { id: 'always_false-current', factId: 'always_false', value: false, observedAt: now,
      timeUncertaintyHours: 0, extractionClass: 'CONFIDENT' },
  ];
  const facts: Record<string, Fact> = {
    always_true: permissiveDef(),
    always_false: permissiveDef(),
  };
  return inMemoryFactResolver(rows, facts, now);
}

function makeRule(overrides: Partial<Rule> & { rule_id: string; red_flag_id: string }): Rule {
  return {
    order: 1,
    expression: 'test',
    ast: ALWAYS_TRUE_AST,
    action: 'ESCALATE',
    patient_action: 'NURSE_CALLBACK',
    applicable_classifications: ['ALL'],
    applicable_phases: ['ALL'],
    ...overrides,
  };
}

const now = new Date('2025-01-01T12:00:00Z');
const resolver = makeResolver();

describe('rulePass', () => {
  describe('grouping and ordering', () => {
    it('groups rules by red_flag_id and evaluates each group independently', () => {
      // flag A has a matching rule; flag B has a matching rule
      // Both should get verdicts; they are independent
      const rules = [
        makeRule({ rule_id: 'R_A_1', red_flag_id: 'RF_A', order: 1, ast: ALWAYS_TRUE_AST, action: 'ESCALATE' }),
        makeRule({ rule_id: 'R_B_1', red_flag_id: 'RF_B', order: 1, ast: ALWAYS_TRUE_AST, action: 'ADVISE' }),
      ];
      const result = rulePass(resolver, rules, 'CABG', 'phase_1', now, 0.25);
      expect(result.verdicts).toHaveLength(2);
      expect(result.verdicts.find((v: RuleVerdict) => v.red_flag_id === 'RF_A')?.action).toBe('ESCALATE');
      expect(result.verdicts.find((v: RuleVerdict) => v.red_flag_id === 'RF_B')?.action).toBe('ADVISE');
      expect(result.fellThrough).toHaveLength(0);
    });

    it('within a group, Order is respected — lower order wins when multiple rules match', () => {
      // Order 10 (REASSURE) should beat Order 20 (ESCALATE) if both match
      const rules = [
        makeRule({ rule_id: 'R_1', red_flag_id: 'RF_A', order: 20, ast: ALWAYS_TRUE_AST, action: 'ESCALATE' }),
        makeRule({ rule_id: 'R_2', red_flag_id: 'RF_A', order: 10, ast: ALWAYS_TRUE_AST, action: 'REASSURE' }),
      ];
      const result = rulePass(resolver, rules, 'CABG', 'phase_1', now, 0.25);
      expect(result.verdicts).toHaveLength(1);
      expect(result.verdicts[0].rule_id).toBe('R_2'); // order 10 wins
      expect(result.verdicts[0].action).toBe('REASSURE');
    });

    it('Order is GROUP-SCOPED — same Order values in different groups are legal', () => {
      // Both flags have a rule with order 1 — no conflict
      const rules = [
        makeRule({ rule_id: 'R_A', red_flag_id: 'RF_A', order: 1 }),
        makeRule({ rule_id: 'R_B', red_flag_id: 'RF_B', order: 1 }),
      ];
      const result = rulePass(resolver, rules, 'CABG', 'phase_1', now, 0.25);
      expect(result.verdicts).toHaveLength(2);
    });
  });

  describe('first match wins', () => {
    it('stops evaluating after first match in a group', () => {
      // R_1 (order 1, true, REASSURE) fires. R_2 (order 2, true, ESCALATE) should NOT fire.
      const rules = [
        makeRule({ rule_id: 'R_1', red_flag_id: 'RF_A', order: 1, ast: ALWAYS_TRUE_AST, action: 'REASSURE' }),
        makeRule({ rule_id: 'R_2', red_flag_id: 'RF_A', order: 2, ast: ALWAYS_TRUE_AST, action: 'ESCALATE' }),
      ];
      const result = rulePass(resolver, rules, 'CABG', 'phase_1', now, 0.25);
      expect(result.verdicts).toHaveLength(1);
      expect(result.verdicts[0].rule_id).toBe('R_1');
      expect(result.verdicts[0].action).toBe('REASSURE');
    });

    it('a REASSURE rule at order 10 beats an ESCALATE at order 20 (downgrade works)', () => {
      // This validates the clinically important case: a specific benign condition
      // can suppress escalation when it fires first.
      const rules = [
        makeRule({ rule_id: 'R_REASSURE', red_flag_id: 'RF_A', order: 10, ast: ALWAYS_TRUE_AST, action: 'REASSURE' }),
        makeRule({ rule_id: 'R_ESCALATE', red_flag_id: 'RF_A', order: 20, ast: ALWAYS_TRUE_AST, action: 'ESCALATE' }),
      ];
      const result = rulePass(resolver, rules, 'CABG', 'phase_1', now, 0.25);
      expect(result.verdicts[0].action).toBe('REASSURE');
    });
  });

  describe('unresolvable and fall-through', () => {
    it('skips a rule with an unresolvable expression and continues to the next rule', () => {
      // R_1 is unresolvable (skipped); R_2 should fire
      const rules = [
        makeRule({ rule_id: 'R_1', red_flag_id: 'RF_A', order: 1, ast: UNRESOLVABLE_AST }),
        makeRule({ rule_id: 'R_2', red_flag_id: 'RF_A', order: 2, ast: ALWAYS_TRUE_AST }),
      ];
      const result = rulePass(resolver, rules, 'CABG', 'phase_1', now, 0.25);
      expect(result.verdicts).toHaveLength(1);
      expect(result.verdicts[0].rule_id).toBe('R_2');
    });

    it('a group where all rules are false → fellThrough', () => {
      const rules = [
        makeRule({ rule_id: 'R_1', red_flag_id: 'RF_A', order: 1, ast: ALWAYS_FALSE_AST }),
      ];
      const result = rulePass(resolver, rules, 'CABG', 'phase_1', now, 0.25);
      expect(result.verdicts).toHaveLength(0);
      expect(result.fellThrough).toContain('RF_A');
    });

    it('a group where all rules are unresolvable → fellThrough (not a crash)', () => {
      const rules = [
        makeRule({ rule_id: 'R_1', red_flag_id: 'RF_A', order: 1, ast: UNRESOLVABLE_AST }),
      ];
      const result = rulePass(resolver, rules, 'CABG', 'phase_1', now, 0.25);
      expect(result.verdicts).toHaveLength(0);
      expect(result.fellThrough).toContain('RF_A');
    });
  });

  describe('classification and phase filtering', () => {
    it('only evaluates rules applicable to the patient\'s classification', () => {
      const rules = [
        makeRule({ rule_id: 'R_VALVE', red_flag_id: 'RF_A', order: 1, applicable_classifications: ['VALVE'] }),
        makeRule({ rule_id: 'R_CABG',  red_flag_id: 'RF_A', order: 2, applicable_classifications: ['CABG'] }),
      ];
      const result = rulePass(resolver, rules, 'CABG', 'phase_1', now, 0.25);
      expect(result.verdicts).toHaveLength(1);
      expect(result.verdicts[0].rule_id).toBe('R_CABG');
    });

    it('rules with applicable_classifications=["ALL"] match any classification', () => {
      const rules = [
        makeRule({ rule_id: 'R_ALL', red_flag_id: 'RF_A', order: 1, applicable_classifications: ['ALL'] }),
      ];
      const result = rulePass(resolver, rules, 'CABG', 'phase_1', now, 0.25);
      expect(result.verdicts).toHaveLength(1);
    });

    it('only evaluates rules applicable to the patient\'s phase', () => {
      const rules = [
        makeRule({ rule_id: 'R_P2', red_flag_id: 'RF_A', order: 1, applicable_phases: ['phase_2'] }),
        makeRule({ rule_id: 'R_P1', red_flag_id: 'RF_A', order: 2, applicable_phases: ['phase_1'] }),
      ];
      const result = rulePass(resolver, rules, 'CABG', 'phase_1', now, 0.25);
      expect(result.verdicts).toHaveLength(1);
      expect(result.verdicts[0].rule_id).toBe('R_P1');
    });

    it('a flag with rules but none applicable to this classification+phase → noRules', () => {
      const rules = [
        makeRule({ rule_id: 'R_VALVE', red_flag_id: 'RF_A', order: 1, applicable_classifications: ['VALVE'] }),
      ];
      const result = rulePass(resolver, rules, 'CABG', 'phase_1', now, 0.25);
      expect(result.verdicts).toHaveLength(0);
      expect(result.noRules).toContain('RF_A');
      expect(result.fellThrough).not.toContain('RF_A');
    });
  });

  describe('behaviour isolation', () => {
    it('adding rules to flag X never changes flag Y\'s verdict', () => {
      // First evaluation: RF_B has one rule
      const baseRules = [
        makeRule({ rule_id: 'R_B', red_flag_id: 'RF_B', order: 1, ast: ALWAYS_TRUE_AST, action: 'ADVISE' }),
      ];
      const base = rulePass(resolver, baseRules, 'CABG', 'phase_1', now, 0.25);
      expect(base.verdicts.find((v: RuleVerdict) => v.red_flag_id === 'RF_B')?.action).toBe('ADVISE');

      // Add rules for RF_A — RF_B's result must not change
      const extendedRules = [
        makeRule({ rule_id: 'R_A', red_flag_id: 'RF_A', order: 1, ast: ALWAYS_FALSE_AST }),
        ...baseRules,
      ];
      const extended = rulePass(resolver, extendedRules, 'CABG', 'phase_1', now, 0.25);
      expect(extended.verdicts.find((v: RuleVerdict) => v.red_flag_id === 'RF_B')?.action).toBe('ADVISE');
    });
  });

  describe('empty inputs', () => {
    it('empty rules array → all arrays empty', () => {
      const result = rulePass(resolver, [], 'CABG', 'phase_1', now, 0.25);
      expect(result.verdicts).toHaveLength(0);
      expect(result.fellThrough).toHaveLength(0);
      expect(result.noRules).toHaveLength(0);
      expect(result.skipped).toHaveLength(0);
    });
  });

  describe('skip reasons', () => {
    it('a fell-through flag records one skip entry per rule tried, with the right reasons', () => {
      const rules = [
        makeRule({ rule_id: 'R_FALSE', red_flag_id: 'RF_A', order: 1, ast: ALWAYS_FALSE_AST }),
        makeRule({ rule_id: 'R_UNRESOLVABLE', red_flag_id: 'RF_A', order: 2, ast: UNRESOLVABLE_AST }),
      ];
      const result = rulePass(resolver, rules, 'CABG', 'phase_1', now, 0.25);
      expect(result.fellThrough).toContain('RF_A');
      expect(result.skipped).toHaveLength(2);
      expect(result.skipped).toContainEqual({
        red_flag_id: 'RF_A',
        rule_id: 'R_FALSE',
        reason: 'evaluated_false',
      });
      expect(result.skipped).toContainEqual({
        red_flag_id: 'RF_A',
        rule_id: 'R_UNRESOLVABLE',
        reason: 'unresolvable_fact',
        fact: 'unresolvable',
      });
    });

    it('a flag that matches has NO skipped entries, even if earlier rules were tried and skipped', () => {
      const rules = [
        makeRule({ rule_id: 'R_FALSE', red_flag_id: 'RF_A', order: 1, ast: ALWAYS_FALSE_AST }),
        makeRule({ rule_id: 'R_UNRESOLVABLE', red_flag_id: 'RF_A', order: 2, ast: UNRESOLVABLE_AST }),
        makeRule({ rule_id: 'R_MATCH', red_flag_id: 'RF_A', order: 3, ast: ALWAYS_TRUE_AST }),
      ];
      const result = rulePass(resolver, rules, 'CABG', 'phase_1', now, 0.25);
      expect(result.verdicts).toHaveLength(1);
      expect(result.verdicts[0].rule_id).toBe('R_MATCH');
      expect(result.fellThrough).not.toContain('RF_A');
      expect(result.skipped.filter((s) => s.red_flag_id === 'RF_A')).toHaveLength(0);
    });
  });
});
