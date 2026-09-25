import fixture from './fixtures/kb-sample.json';
import { ParseResult, Rule } from '../../knowledge-graph/types';
import { runRuleTest } from '../rule-test-runner';

/**
 * The Python <-> TypeScript contract test.
 *
 * src/decision/__tests__/fixtures/kb-sample.json is genuine output of the
 * production Python parser (scripts/generate-knowledge-graph.py) run against
 * tests/fixtures/kb-sample.xlsx — NOT hand-written. See
 * scripts/kg-tools/regen-kb-fixture.sh to regenerate it, and
 * tests/unit/knowledge-graph/test_kb_fixture.py, which fails if the emitter's
 * output shape ever drifts from what's committed here.
 *
 * Nothing before this test ever ran both halves of the system against each
 * other: Python asserted what its AST looks like, Jest asserted how
 * rulePass/evaluateAst behave given that shape, and neither asserted the two
 * agree. Renaming a field in the emitter would previously leave both suites
 * green while production broke.
 */
describe('kb-contract', () => {
  it('runs a real parser-emitted KG end to end', () => {
    const result = fixture as unknown as ParseResult;
    expect(result.valid).toBe(true);

    const kg = result.knowledge_graph;
    expect(kg).not.toBeNull();
    if (!kg) return;

    expect(kg.rule_tests).toBeDefined();
    expect(kg.rule_tests!.length).toBeGreaterThan(0);
    expect(kg.rules).toBeDefined();
    expect(kg.facts).toBeDefined();
    expect(kg.settings).toBeDefined();
    if (!kg.rules || !kg.facts || !kg.settings) return;

    const rulesById = new Map<string, Rule>(kg.rules.map((r) => [r.rule_id, r]));
    const tolerance = kg.settings.time_uncertainty_tolerance;
    const facts = kg.facts;
    const now = new Date('2025-06-01T12:00:00Z');

    for (const test of kg.rule_tests ?? []) {
      const rule = rulesById.get(test.rule_id);
      if (!rule) {
        throw new Error(
          `rule_test '${test.test_id}' references unknown rule_id '${test.rule_id}'`,
        );
      }
      const outcome = runRuleTest(test, rule, facts, tolerance, now);
      expect(outcome.passed).toBe(true);
    }
  });
});
