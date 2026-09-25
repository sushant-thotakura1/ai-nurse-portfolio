// src/screening/engine.test.ts
import { visibleQuestions, checkStopRules, computeRecommendation } from './engine';
import { ScreeningSchema, ScreeningStep } from './types';

const testSchema: ScreeningSchema = {
  id: 'test',
  version: '1',
  steps: [],
  stopRules: [
    { id: 'allergy', outcome: 'stop', message: 'Stop.', when: (a) => a.allergy === true },
    { id: 'ill', outcome: 'defer', message: 'Defer.', when: (a) => a.ill === true },
  ],
  recommendationRules: [
    { ifTagsInclude: ['diabetes'], vaccines: ['flu', 'pneumococcal'] },
    { ifTagsInclude: ['elderly'], vaccines: ['flu', 'zoster'] },
  ],
  deriveTags: (a) => {
    const tags = Array.isArray(a.conditions) ? [...(a.conditions as string[])] : [];
    if (typeof a.age === 'number' && a.age >= 60) tags.push('elderly');
    return tags;
  },
};

describe('visibleQuestions', () => {
  const step: ScreeningStep = {
    id: 's1',
    title: 'Step 1',
    questions: [
      { id: 'has_conditions', prompt: 'Any conditions?', type: 'yes_no' },
      {
        id: 'conditions',
        prompt: 'Which ones?',
        type: 'multi_select',
        options: [],
        showIf: (a) => a.has_conditions === true,
      },
    ],
  };

  it('hides a conditional question when its predicate is false', () => {
    const result = visibleQuestions(step, { has_conditions: false });
    expect(result.map((q) => q.id)).toEqual(['has_conditions']);
  });

  it('shows a conditional question when its predicate is true', () => {
    const result = visibleQuestions(step, { has_conditions: true });
    expect(result.map((q) => q.id)).toEqual(['has_conditions', 'conditions']);
  });
});

describe('checkStopRules', () => {
  it('returns null when no rule matches', () => {
    expect(checkStopRules(testSchema, {})).toBeNull();
  });

  it('returns the first matching rule', () => {
    expect(checkStopRules(testSchema, { allergy: true })).toEqual({
      outcome: 'stop',
      message: 'Stop.',
    });
  });

  it('matches a defer rule independently of stop rules', () => {
    expect(checkStopRules(testSchema, { ill: true })).toEqual({
      outcome: 'defer',
      message: 'Defer.',
    });
  });
});

describe('computeRecommendation', () => {
  it('returns an empty list when no rule matches', () => {
    expect(computeRecommendation(testSchema, {})).toEqual({ vaccines: [] });
  });

  it('unions vaccines across every matching rule, deduplicated', () => {
    const result = computeRecommendation(testSchema, { conditions: ['diabetes'], age: 65 });
    expect(new Set(result.vaccines)).toEqual(new Set(['flu', 'pneumococcal', 'zoster']));
    expect(result.vaccines.length).toBe(3); // no duplicate 'flu'
  });
});
