import { greetingEvaluator, turnEvaluator, assessmentEvaluator } from '../evaluators';
import { GreetingExpected, TurnExpected, AssessmentExpected } from '../dataset-types';

describe('greetingEvaluator', () => {
  const expected: GreetingExpected = {
    phase_acknowledged: true,
    condition_mentioned: true,
    warm_tone: true,
    opens_with_open_question: true,
  };

  it('returns score 1 and label pass when all fields match', async () => {
    const result = await greetingEvaluator.evaluate({ input: {}, output: { ...expected }, expected });
    expect(result.score).toBe(1);
    expect(result.label).toBe('pass');
  });

  it('returns score 0.75 when one boolean field mismatches', async () => {
    const result = await greetingEvaluator.evaluate({
      input: {}, output: { ...expected, warm_tone: false }, expected,
    });
    expect(result.score).toBe(0.75);
    expect(result.label).toBe('fail');
  });

  it('returns score 0 and label fail when output is missing', async () => {
    const result = await greetingEvaluator.evaluate({ input: {}, output: null, expected });
    expect(result.score).toBe(0);
    expect(result.label).toBe('fail');
  });
});

describe('turnEvaluator', () => {
  const expected: TurnExpected = {
    topics_covered: ['chest_pain', 'pain_duration'],
    one_question_at_a_time: true,
    did_not_dismiss: true,
    acknowledged_symptoms: true,
  };

  it('returns score 1 when all expected topics covered and booleans match', async () => {
    const result = await turnEvaluator.evaluate({
      input: {},
      output: { ...expected, topics_covered: ['chest_pain', 'pain_duration', 'extra_topic'] },
      expected,
    });
    expect(result.score).toBe(1);
    expect(result.label).toBe('pass');
  });

  it('returns partial score when a topic is missing', async () => {
    const result = await turnEvaluator.evaluate({
      input: {},
      output: { topics_covered: ['chest_pain'], one_question_at_a_time: true, did_not_dismiss: true, acknowledged_symptoms: true },
      expected,
    });
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThan(1);
    expect(result.label).toBe('fail');
  });

  it('returns score 0 and label fail when output is null', async () => {
    const result = await turnEvaluator.evaluate({ input: {}, output: null, expected });
    expect(result.score).toBe(0);
    expect(result.label).toBe('fail');
  });
});

describe('assessmentEvaluator', () => {
  const expected: AssessmentExpected = {
    outcome: 'ESCALATE',
    patient_action: 'ER_NOW',
    overall_risk_level: 'CRITICAL',
    escalation_required: true,
  };

  it('returns score 1 when all 4 fields match', async () => {
    const result = await assessmentEvaluator.evaluate({ input: {}, output: { ...expected }, expected });
    expect(result.score).toBe(1);
    expect(result.label).toBe('pass');
  });

  it('returns 0.5 when two fields differ (outcome and escalation_required)', async () => {
    const result = await assessmentEvaluator.evaluate({
      input: {},
      output: { ...expected, outcome: 'ADVISE', escalation_required: false },
      expected,
    });
    expect(result.score).toBe(0.5); // 2 of 4 fields wrong
    expect(result.label).toBe('fail');
  });

  it('returns score 0 and label fail when output is null', async () => {
    const result = await assessmentEvaluator.evaluate({ input: {}, output: null, expected });
    expect(result.score).toBe(0);
    expect(result.label).toBe('fail');
  });
});
