import { FactRow } from './patient-fact.repository';
import { Fact, RuleAction, PatientAction } from '../knowledge-graph/types';

/** A value that was either successfully resolved or could not be resolved due to missing data. */
export type Resolution<T> =
  | { resolved: true; value: T }
  | { resolved: false; unresolvedFact?: string };

/**
 * Provides fact data to the AST evaluator.
 * Implementations query the PatientFactRepository (or an in-memory test double).
 */
export interface FactResolver {
  /** Current value (within validForHours). Unresolved if stale or absent. */
  currentValue(name: string): Resolution<number | boolean | string>;
  /** All live rows in the window, oldest first. Empty array is valid (absence-tolerant callers). */
  history(name: string, windowHours: number): FactRow[];
  /** Sheet 7 fact definition, or undefined if unknown. */
  factDef(name: string): Fact | undefined;
}

/** How confident the speech/NLP layer is about a fact value. */
export type ExtractionClass = 'CONFIDENT' | 'UNCERTAIN' | 'NOT_ASKED' | 'NO_ANSWER';

export interface RuleVerdict {
  red_flag_id: string;
  rule_id: string;
  action: RuleAction;
  patient_action: PatientAction | null;
}

export interface RulePassResult {
  verdicts: RuleVerdict[];
  /** Red flag IDs where applicable rules existed but none evaluated to true. */
  fellThrough: string[];
  /** Red flag IDs that had rules in the KB, but NONE were applicable to this classification+phase. */
  noRules: string[];
  /** Per-rule skip reasons for red flags that fell through (audit trail; see spec §5.3). */
  skipped: Array<{
    red_flag_id: string;
    rule_id: string;
    reason: 'evaluated_false' | 'unresolvable_fact' | 'not_applicable';
    fact?: string;
  }>;
}

export interface ProseVerdict {
  red_flag_id: string;
  fired: boolean;
}

export interface Decision {
  outcome: 'REASSURE' | 'ADVISE' | 'ESCALATE' | 'INCOMPLETE';
  patient_action: PatientAction | null;
  escalation_type: 'CLINICAL_RED_FLAG' | null;
  deterministic: boolean;
  verdicts: RuleVerdict[];
  proseVerdicts: ProseVerdict[];
}
