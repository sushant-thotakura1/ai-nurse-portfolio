import { ProseVerdict } from '../../decision/types';

/**
 * Result of validating a raw LLM "call 3" response against the red flags we
 * actually asked about (spec §4.2).
 */
export interface RedFlagValidationResult {
  /** One verdict per red_flag_id that passed schema validation. */
  verdicts: ProseVerdict[];
  /** red_flag_id -> the model's evidence text, for every *valid* verdict (both fired:true and fired:false). */
  evidence: Map<string, string>;
  /** red_flag_id's that could not be resolved -- feeds finalize()'s `unevaluated` argument. */
  unevaluated: string[];
}
