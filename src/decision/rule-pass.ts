import { Rule } from '../knowledge-graph/types';
import { FactResolver, RulePassResult, RuleVerdict } from './types';
import { evaluateAst } from './ast-evaluator';

/** Shared by rule-pass (which rules apply) and call 3's candidate selection
 * (which red flags apply) -- both are scoped by the same classification/phase
 * fields, just on different KB objects (Rule vs RedFlag). */
export function isApplicable(
  scope: { applicable_classifications: string[]; applicable_phases: string[] },
  classification: string,
  phase: string,
): boolean {
  const cls = scope.applicable_classifications;
  const ph  = scope.applicable_phases;
  const clsMatch = cls.includes('ALL') || cls.includes(classification);
  const phMatch  = ph.includes('ALL')  || ph.includes(phase);
  return clsMatch && phMatch;
}

export function rulePass(
  facts: FactResolver,
  rules: Rule[],
  classification: string,
  phase: string,
  now: Date,
  tolerance: number,
): RulePassResult {
  // Group ALL rules by red_flag_id (before filtering) to identify noRules
  const allByFlag = new Map<string, Rule[]>();
  for (const rule of rules) {
    const group = allByFlag.get(rule.red_flag_id) ?? [];
    group.push(rule);
    allByFlag.set(rule.red_flag_id, group);
  }

  const verdicts: RuleVerdict[] = [];
  const fellThrough: string[] = [];
  const noRules: string[] = [];
  const skipped: RulePassResult['skipped'] = [];

  for (const [flagId, group] of allByFlag) {
    // Filter to applicable rules for this patient
    const applicable = group
      .filter(r => isApplicable(r, classification, phase))
      .sort((a, b) => a.order - b.order);

    if (applicable.length === 0) {
      noRules.push(flagId);
      continue;
    }

    // First match wins within the group
    let matched = false;
    const groupSkips: RulePassResult['skipped'] = [];
    for (const rule of applicable) {
      const result = evaluateAst(rule.ast, facts, now, tolerance);
      if (!result.resolved) {
        groupSkips.push({
          red_flag_id: flagId,
          rule_id: rule.rule_id,
          reason: 'unresolvable_fact',
          ...(result.unresolvedFact !== undefined ? { fact: result.unresolvedFact } : {}),
        });
        continue; // unresolvable — skip, try next rule
      }
      if (!result.value) {
        groupSkips.push({ red_flag_id: flagId, rule_id: rule.rule_id, reason: 'evaluated_false' });
        continue; // false — skip, try next rule
      }
      // Matched
      verdicts.push({
        red_flag_id: flagId,
        rule_id: rule.rule_id,
        action: rule.action,
        patient_action: rule.patient_action,
      });
      matched = true;
      break;
    }

    if (!matched) {
      fellThrough.push(flagId);
      skipped.push(...groupSkips);
    }
  }

  return { verdicts, fellThrough, noRules, skipped };
}
