import { Fact, Rule, RuleTest } from '../knowledge-graph/types';
import { FactRow } from './patient-fact.repository';
import { inMemoryFactResolver } from './in-memory-fact-resolver';
import { rulePass } from './rule-pass';

export interface RuleTestResult {
  testId: string;
  ruleId: string;
  scenario: string;
  expected: 'FIRES' | 'NOT_FIRES';
  actual: 'FIRES' | 'NOT_FIRES';
  passed: boolean;
}

/**
 * Runs one Sheet 10 case against the real decision engine (rulePass ->
 * evaluateAst). Pure — `now` is supplied so results are reproducible.
 *
 * Does NOT re-implement any evaluation logic: it only builds synthetic
 * FactRows from the case's observations and hands them to the real engine.
 */
export function runRuleTest(
  test: RuleTest,
  rule: Rule,
  facts: Record<string, Fact>,
  tolerance: number,
  now: Date,
): RuleTestResult {
  const rows: FactRow[] = test.observations.map((o, i) => ({
    id: `${test.test_id}-${i}`,
    factId: o.fact,
    value: o.value,
    observedAt: new Date(now.getTime() + o.offset_hours * 3600_000),
    timeUncertaintyHours: 0,
    extractionClass: 'CONFIDENT',
  }));

  const resolver = inMemoryFactResolver(rows, facts, now);

  // classification/phase are required by rulePass but Sheet 10 has no columns
  // for them. Derive from the rule under test: when the rule is scoped to
  // ALL, isApplicable's includes('ALL') check short-circuits before ever
  // comparing to the literal classification/phase string, so any sentinel
  // value passes. When the rule is scoped to a specific classification/phase,
  // using that same value as the sentinel guarantees a match.
  const classification = rule.applicable_classifications.includes('ALL')
    ? '__ANY__'
    : rule.applicable_classifications[0];
  const phase = rule.applicable_phases.includes('ALL')
    ? '__ANY__'
    : rule.applicable_phases[0];

  // Only the single rule under test is passed in — the case is scoped to one
  // rule, not a whole KB's rules.
  const result = rulePass(resolver, [rule], classification, phase, now, tolerance);

  const actual: 'FIRES' | 'NOT_FIRES' =
    result.verdicts.some((v) => v.rule_id === rule.rule_id) ? 'FIRES' : 'NOT_FIRES';

  return {
    testId: test.test_id,
    ruleId: test.rule_id,
    scenario: test.scenario,
    expected: test.expect,
    actual,
    passed: actual === test.expect,
  };
}
