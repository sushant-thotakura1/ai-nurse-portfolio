import { Rule, RedFlag, Fact } from '../knowledge-graph/types';
import { FactResolver, ProseVerdict, Decision, ExtractionClass } from './types';
import { rulePass } from './rule-pass';
import { finalize } from './finalize';

/** Convenience wrapper for eval fixtures: rulePass then finalize. */
export function evaluate(
  facts: FactResolver,
  rules: Rule[],
  classification: string,
  phase: string,
  proseVerdicts: ProseVerdict[],
  redFlags: RedFlag[],
  applicableFacts: Record<string, Fact>,
  factStatus: Map<string, ExtractionClass>,
  now: Date,
  tolerance: number,
): Decision {
  const rp = rulePass(facts, rules, classification, phase, now, tolerance);
  // call 3 (LLM red-flag check) isn't wired in yet — no source for unevaluated flags
  // until that lands; this is the one place a literal [] is acceptable (see finalize.ts).
  return finalize(rp, proseVerdicts, redFlags, applicableFacts, factStatus, [], now);
}
