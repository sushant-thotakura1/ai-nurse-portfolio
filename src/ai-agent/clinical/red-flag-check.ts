import { ProseVerdict } from '../../decision/types';
import { RedFlagValidationResult } from './red-flag-check.types';
import { LLMProvider, LLMProviderError } from '../interfaces';
import { RedFlag } from '../../knowledge-graph/types';
import { Turn } from '../../orchestrator/session';

/**
 * Validates the raw response from "call 3" (the per-red-flag LLM check) against
 * the list of red_flag_ids we actually asked about.
 *
 * Pure and synchronous -- no I/O, never throws. Prompt construction, the network
 * call, and retry policy live elsewhere (Task 6); this function only decides,
 * given whatever came back, which entries are trustworthy enough to reach
 * finalize().
 *
 * Spec §4.2 rules:
 *  1. A non-array `raw` degrades to "everything unevaluated" rather than throwing.
 *  2. Hallucination guard: any red_flag_id not in `askedFor` is discarded entirely --
 *     it must never appear in verdicts, evidence, or unevaluated.
 *  3. For a known red_flag_id, `fired` must be a genuine boolean and `evidence` a
 *     non-empty (post-trim) string. No coercion. A schema violation marks that one
 *     flag unevaluated.
 *  4. Any askedFor id never successfully validated ends up in `unevaluated`.
 *  5. Duplicates: only the first occurrence of a given red_flag_id is processed.
 */
export function validateRedFlagResponse(raw: unknown, askedFor: string[]): RedFlagValidationResult {
  const evidence = new Map<string, string>();

  if (!Array.isArray(raw)) {
    return { verdicts: [], evidence, unevaluated: [...askedFor] };
  }

  const askedForSet = new Set(askedFor);
  const verdicts: ProseVerdict[] = [];
  const resolved = new Set<string>();
  const seen = new Set<string>();

  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object') {
      continue;
    }

    const redFlagId = (entry as Record<string, unknown>).red_flag_id;
    if (typeof redFlagId !== 'string' || !askedForSet.has(redFlagId)) {
      // Not something we asked about (or malformed id) -- discard entirely (rule 2).
      continue;
    }

    if (seen.has(redFlagId)) {
      // Duplicate -- only the first occurrence is processed (rule 5).
      continue;
    }
    seen.add(redFlagId);

    const fired = (entry as Record<string, unknown>).fired;
    const evidenceText = (entry as Record<string, unknown>).evidence;

    const firedValid = typeof fired === 'boolean';
    const evidenceValid = typeof evidenceText === 'string' && evidenceText.trim().length > 0;

    if (firedValid && evidenceValid) {
      verdicts.push({ red_flag_id: redFlagId, fired });
      evidence.set(redFlagId, evidenceText);
      resolved.add(redFlagId);
    }
    // Schema violation -> this id simply never joins `resolved`, so it falls
    // through to the unevaluated pass below (rule 3/4; no double-add).
  }

  const unevaluated = askedFor.filter((id) => !resolved.has(id));

  return { verdicts, evidence, unevaluated };
}

// ── Call 3: prompt + LLM call + retry (spec §2-4.3) ───────────────────────────

export interface RedFlagCheckInput {
  turns: Turn[];
  /** Captured facts, name -> value. */
  facts: Record<string, number | boolean | string>;
  /** Names only, of facts never captured or stale -- absence must read as "never asked", not "no". */
  unresolvedFactNames: string[];
  daysSinceTrigger: number;
  currentPhase: string;
  /** The flags to judge -- only .id and .trigger (Sheet 4 prose) are used. Sheet 8 is never touched. */
  flags: RedFlag[];
}

// Matches calls 1 and 2's model config (fact-extractor.ts, and the OpenAIAdapter
// default) -- this repo is OpenAI-only; introducing a second provider is a
// separate decision and out of scope here (plan Background 10).
const MODEL = 'gpt-4o-mini';
const TEMPERATURE = 0.1; // a classification task, not creative dialogue -- matches fact-extractor.ts

const MAX_ATTEMPTS = 3;
const PER_ATTEMPT_TIMEOUT_MS = 12_000;
const BACKOFF_SCHEDULE_MS = [500, 1500];
const JITTER_FRACTION = 0.2;
const TOTAL_BUDGET_MS = 45_000;

function buildPrompt(input: RedFlagCheckInput): string {
  const transcript = input.turns
    .map((t) => `${t.speaker.toUpperCase()}: ${t.originalText}`)
    .join('\n');

  const factLines = Object.entries(input.facts)
    .map(([name, value]) => `- ${name}: ${value}`)
    .join('\n') || '(none captured)';

  const unresolvedLines = input.unresolvedFactNames.length > 0
    ? input.unresolvedFactNames.map((n) => `- ${n}`).join('\n')
    : '(none)';

  const flagLines = input.flags
    .map((f) => `- ${f.id}: ${f.trigger}`)
    .join('\n');

  return `You are a clinical reviewer. Read the transcript below and decide, for each red flag listed, whether it fired.

Days since trigger: ${input.daysSinceTrigger}
Current phase: ${input.currentPhase}

Facts captured:
${factLines}

Facts never captured or stale (this means the topic was never asked about -- it does NOT mean the answer was "no"):
${unresolvedLines}

Transcript:
${transcript}

Red flags to judge:
${flagLines}

For each red flag above, decide from the transcript and captured facts whether it fired. Respond with ONLY a JSON array, no other text, no markdown code fences:
[
  { "red_flag_id": "...", "evidence": "...", "fired": true }
]

Some red flags require a specific measurement, count, or reading (for example, a change in body weight, or a number of repeated episodes) as one of the things that must be true. If that specific measurement was never reported anywhere in the transcript, do not mark that red flag as fired just because other, related symptoms it also mentions are present -- the presence of a related symptom does not establish that the missing measurement occurred. In that situation, set fired to false and say in your evidence that the specific measurement was not reported.

Every entry must include a non-empty "evidence" string -- a short, specific observation from the transcript explaining your judgment. This is reviewed by clinicians and must never be empty or generic.`;
}

/** Parses the model's response into a JSON array, or null if it isn't one -- the "malformed" case (spec §4.2). */
function parseVerdictArray(content: string): unknown[] | null {
  const cleaned = content
    .replace(/^```(?:json)?\s*/im, '')
    .replace(/```\s*$/m, '')
    .trim();
  try {
    const parsed: unknown = JSON.parse(cleaned);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Timeout/connection errors (no status) and 429/5xx are retryable; other 4xx are not (spec §4.3). */
function isRetryableStatus(status: number | undefined): boolean {
  if (status === undefined) return true;
  if (status === 429) return true;
  return status >= 500;
}

function jitteredDelayMs(baseMs: number): number {
  const jitter = baseMs * JITTER_FRACTION;
  return baseMs + (Math.random() * 2 - 1) * jitter;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function allUnevaluated(askedFor: string[]): RedFlagValidationResult {
  return { verdicts: [], evidence: new Map(), unevaluated: [...askedFor] };
}

/**
 * Call 3 -- the LLM red-flag check. Runs once, batched, over every flag the
 * deterministic engine could not decide (rulePass's fellThrough ∪ noRules).
 *
 * Never sees Sheet 8 (rule expressions, thresholds, or any hint a rule was
 * tried) -- only Sheet 4's Trigger Condition prose. That's load-bearing, not
 * stylistic: showing call 3 the rules destroys the disagreement signal the
 * whole feedback loop depends on (spec §2.1).
 *
 * Retry policy (spec §4.3): 3 attempts, 12s per-attempt timeout, 500ms then
 * 1500ms backoff +/-20% jitter, honouring Retry-After on 429 capped by the
 * 45s wall-clock budget -- checked before every attempt (including the first
 * retry), so a Retry-After larger than the remaining budget abandons rather
 * than delays past the cap. A response that parses into an array is accepted
 * immediately and never retried, even if partial or containing per-verdict
 * schema violations -- only a response that could not be parsed into a
 * verdict list at all (or a request-level failure) is retryable.
 */
export async function redFlagCheck(
  input: RedFlagCheckInput,
  llm: LLMProvider,
): Promise<RedFlagValidationResult> {
  const askedFor = input.flags.map((f) => f.id);
  if (askedFor.length === 0) {
    return { verdicts: [], evidence: new Map(), unevaluated: [] };
  }

  const prompt = buildPrompt(input);
  const startedAt = Date.now();

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (Date.now() - startedAt >= TOTAL_BUDGET_MS) {
      return allUnevaluated(askedFor);
    }

    let parsedArray: unknown[] | null = null;
    let retryable = false;
    let retryAfterSeconds: number | undefined;

    try {
      const response = await llm.complete(
        [{ role: 'user', content: prompt }],
        { model: MODEL, temperature: TEMPERATURE, maxTokens: 2000, timeoutMs: PER_ATTEMPT_TIMEOUT_MS },
      );
      parsedArray = parseVerdictArray(response.content);
      retryable = parsedArray === null; // malformed body -- never a partial/schema issue at this level
    } catch (error) {
      const status = error instanceof LLMProviderError ? error.status : undefined;
      retryAfterSeconds = error instanceof LLMProviderError ? error.retryAfterSeconds : undefined;
      retryable = isRetryableStatus(status);
    }

    if (parsedArray !== null) {
      // Parsed into a verdict list -- accept immediately, partial or not.
      // Never retried past this point (spec §4.2).
      return validateRedFlagResponse(parsedArray, askedFor);
    }

    if (!retryable || attempt >= MAX_ATTEMPTS) {
      return allUnevaluated(askedFor);
    }

    const scheduledBackoff = jitteredDelayMs(
      BACKOFF_SCHEDULE_MS[Math.min(attempt - 1, BACKOFF_SCHEDULE_MS.length - 1)],
    );
    const backoffMs = retryAfterSeconds !== undefined
      ? Math.max(scheduledBackoff, retryAfterSeconds * 1000)
      : scheduledBackoff;

    const remainingBudgetMs = TOTAL_BUDGET_MS - (Date.now() - startedAt);
    if (backoffMs >= remainingBudgetMs) {
      // Delaying this long would blow past the 45s cap -- abandon rather than wait.
      return allUnevaluated(askedFor);
    }

    await sleep(backoffMs);
  }

  return allUnevaluated(askedFor);
}
