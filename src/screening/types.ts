// src/screening/types.ts
// Domain-agnostic decision-tree screening types. No knowledge of vaccination
// here — that lives entirely in src/screening/schemas/vaccination.schema.ts.

export type AnswerValue = boolean | string | string[] | number;
export type Answers = Record<string, AnswerValue>;

export type QuestionType = 'yes_no' | 'single_select' | 'multi_select' | 'text' | 'number';

export interface ScreeningOption {
  value: string;
  label: string;
}

export interface ScreeningQuestion {
  id: string;
  prompt: string;
  type: QuestionType;
  options?: ScreeningOption[]; // required for single_select / multi_select
  /** Only shown/required if this returns true given answers collected so far. Omit to always show. */
  showIf?: (answers: Answers) => boolean;
  /** If true, the wizard lets the step advance without an answer to this question. Default false. */
  optional?: boolean;
}

export interface ScreeningStep {
  id: string;
  title: string;
  questions: ScreeningQuestion[];
}

export interface StopRule {
  id: string;
  outcome: 'stop' | 'defer';
  message: string;
  when: (answers: Answers) => boolean;
}

export interface RecommendationRule {
  /** Fires only if every one of these tags is present (see ScreeningSchema.deriveTags). */
  ifTagsInclude: string[];
  vaccines: string[];
}

export interface ScreeningSchema {
  id: string;
  version: string;
  steps: ScreeningStep[];
  stopRules: StopRule[];
  recommendationRules: RecommendationRule[];
  /** Maps raw answers to an abstract tag set the recommendation rules match against. */
  deriveTags: (answers: Answers) => string[];
}

export interface RecommendationResult {
  vaccines: string[];
}

export interface StopResult {
  outcome: 'stop' | 'defer';
  message: string;
}
