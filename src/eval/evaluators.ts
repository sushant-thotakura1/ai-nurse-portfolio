// src/eval/evaluators.ts
//
// Evaluators for Arize Phoenix experiments.
// Each evaluator returns { name, kind, evaluate } matching the Arize Evaluator interface.
// We inline the factory (asEvaluator is a trivial { name, kind, evaluate } wrapper) to
// avoid the package deep-import restriction in @arizeai/phoenix-client.

import type { GreetingExpected, TurnExpected, AssessmentExpected } from './dataset-types';

// ── Minimal local types matching @arizeai/phoenix-client Evaluator shape ─────

type EvalResult = { score: number; label: string };

type EvaluatorFn = (params: {
  input: Record<string, unknown>;
  output: unknown;
  expected?: unknown;
}) => EvalResult | Promise<EvalResult>;

export interface Evaluator {
  name: string;
  kind: 'CODE' | 'LLM';
  evaluate: EvaluatorFn;
}

function makeEvaluator(name: string, evaluate: EvaluatorFn): Evaluator {
  return { name, kind: 'CODE', evaluate };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function labelFrom(score: number): string {
  return score === 1 ? 'pass' : 'fail';
}

// ── greetingEvaluator ────────────────────────────────────────────────────────

export const greetingEvaluator: Evaluator = makeEvaluator(
  'greeting-evaluator',
  ({ output, expected }) => {
    if (output == null || expected == null) {
      return { score: 0, label: 'fail' };
    }

    const exp = expected as unknown as GreetingExpected;
    const act = output as Partial<GreetingExpected>;

    const fields: (keyof GreetingExpected)[] = [
      'phase_acknowledged',
      'condition_mentioned',
      'warm_tone',
      'opens_with_open_question',
    ];

    let matches = 0;
    for (const field of fields) {
      if (act[field] === exp[field]) matches++;
    }

    const score = matches / fields.length;
    return { score, label: labelFrom(score) };
  },
);

// ── turnEvaluator ────────────────────────────────────────────────────────────

export const turnEvaluator: Evaluator = makeEvaluator(
  'turn-evaluator',
  ({ output, expected }) => {
    if (output == null || expected == null) {
      return { score: 0, label: 'fail' };
    }

    const exp = expected as unknown as TurnExpected;
    const act = output as Partial<TurnExpected>;

    // Topic score: fraction of expected topics present in actual (extra actual topics are fine)
    const expectedTopics = exp.topics_covered ?? [];
    const actualTopics: string[] = Array.isArray(act.topics_covered) ? act.topics_covered : [];
    const topicScore =
      expectedTopics.length === 0
        ? 1
        : expectedTopics.filter(t => actualTopics.includes(t)).length / expectedTopics.length;

    // Boolean matches (each counts as 1 dimension)
    const boolFields: (keyof TurnExpected)[] = [
      'one_question_at_a_time',
      'did_not_dismiss',
      'acknowledged_symptoms',
    ];
    let boolMatches = 0;
    for (const field of boolFields) {
      if (act[field] === exp[field]) boolMatches++;
    }

    // topics counts as 1 dimension, each boolean counts as 1 → total 4 dimensions
    const raw = (topicScore + boolMatches) / (1 + boolFields.length);
    const score = Math.round(raw * 1000) / 1000;
    return { score, label: labelFrom(score) };
  },
);

// ── assessmentEvaluator ──────────────────────────────────────────────────────

export const assessmentEvaluator: Evaluator = makeEvaluator(
  'assessment-evaluator',
  ({ output, expected }) => {
    if (output == null || expected == null) {
      return { score: 0, label: 'fail' };
    }

    const exp = expected as unknown as AssessmentExpected;
    const act = output as Partial<AssessmentExpected>;

    const fields: (keyof AssessmentExpected)[] = [
      'outcome',
      'patient_action',
      'overall_risk_level',
      'escalation_required',
    ];

    let matches = 0;
    for (const field of fields) {
      if (act[field] === exp[field]) matches++;
    }

    const score = matches / fields.length;
    return { score, label: labelFrom(score) };
  },
);
