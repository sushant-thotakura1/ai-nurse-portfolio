// src/screening/engine.ts
import { ScreeningSchema, ScreeningStep, Answers, ScreeningQuestion, RecommendationResult, StopResult } from './types';

export function visibleQuestions(step: Pick<ScreeningStep, 'questions'>, answers: Answers): ScreeningQuestion[] {
  return step.questions.filter((q) => !q.showIf || q.showIf(answers));
}

export function checkStopRules(schema: ScreeningSchema, answers: Answers): StopResult | null {
  const rule = schema.stopRules.find((r) => r.when(answers));
  return rule ? { outcome: rule.outcome, message: rule.message } : null;
}

export function computeRecommendation(schema: ScreeningSchema, answers: Answers): RecommendationResult {
  const tags = schema.deriveTags(answers);
  const vaccines = new Set<string>();
  for (const rule of schema.recommendationRules) {
    if (rule.ifTagsInclude.every((tag) => tags.includes(tag))) {
      rule.vaccines.forEach((v) => vaccines.add(v));
    }
  }
  return { vaccines: Array.from(vaccines) };
}
