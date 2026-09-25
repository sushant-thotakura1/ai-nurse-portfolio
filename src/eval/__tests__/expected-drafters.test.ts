// src/eval/__tests__/expected-drafters.test.ts
import {
  draftGreetingExpected,
  draftTurnExpected,
  draftAssessmentExpected,
  selectSymptomForFlagPath,
} from '../expected-drafters';
import { KnowledgeGraph } from '../../knowledge-graph/types';

const mockKg: Partial<KnowledgeGraph> = {
  meta: {
    source_file: 'test.xlsx',
    generated_at: '2026-06-10',
    schema_version: 'v3.2',
    condition: { name: 'Cardiac Surgery', condition_type: 'episodic', classifications: ['CABG'] },
    required_inputs: ['surgery_date'],
  },
  condition: {
    name: 'Cardiac Surgery',
    condition_type: 'episodic',
    trigger: ['surgery_date'],
    phase_model: 'linear',
    classifications: {
      CABG: {
        label: 'CABG',
        phases: {
          phase_1: {
            name: 'Phase I — Early Recovery',
            day_range: [1, 14],
            day_range_type: 'fixed',
            focus: 'wound care',
            review: 'daily check',
            instruction_sheet: '',
          },
        },
      },
    },
  },
  symptoms: {
    wound_swelling: {
      name: 'wound_swelling',
      applicable_classifications: ['ALL'],
      applicable_phases: ['ALL'],
      base_severity: 'moderate',
      severity_score: 1,
      phase_override: null,
      assessment_questions: [],
      notes: '',
    },
    chest_pain: {
      name: 'chest_pain',
      applicable_classifications: ['ALL'],
      applicable_phases: ['ALL'],
      base_severity: 'high',
      severity_score: 4,
      phase_override: null,
      assessment_questions: [],
      notes: '',
    },
  },
  red_flags: [],
  instructions: [],
  scoring: {
    thresholds: {
      advise: { min_score: 1, max_score: 2, action: 'ADVISE', patient_action: 'NURSE_CALLBACK' },
      escalate: { min_score: 3, action: 'ESCALATE', patient_action: 'ER_NOW' },
    },
    rules: { escalate_override: '', phase_override: '' },
  },
  traversal: [],
};

describe('draftGreetingExpected', () => {
  it('returns all true booleans — always draftable from KG', () => {
    const { expected, needs_review } = draftGreetingExpected(mockKg as KnowledgeGraph);
    expect(expected.phase_acknowledged).toBe(true);
    expect(expected.condition_mentioned).toBe(true);
    expect(expected.warm_tone).toBe(true);
    expect(expected.opens_with_open_question).toBe(true);
    expect(needs_review).toBe(false);
  });
});

describe('draftTurnExpected', () => {
  it('green path returns empty topics_covered, needs_review true', () => {
    const { expected, needs_review } = draftTurnExpected('green', []);
    expect(expected.topics_covered).toEqual([]);
    expect(needs_review).toBe(true);
  });

  it('yellow path includes symptom name in topics_covered', () => {
    const { expected, needs_review } = draftTurnExpected('yellow', ['wound_swelling']);
    expect(expected.topics_covered).toContain('wound_swelling');
    expect(needs_review).toBe(true);
  });

  it('always sets one_question_at_a_time, did_not_dismiss, acknowledged_symptoms true', () => {
    const { expected } = draftTurnExpected('yellow', ['wound_swelling']);
    expect(expected.one_question_at_a_time).toBe(true);
    expect(expected.did_not_dismiss).toBe(true);
    expect(expected.acknowledged_symptoms).toBe(true);
  });
});

describe('draftAssessmentExpected', () => {
  it('green path: REASSURE, SELF_MONITOR, LOW, escalation_required false', () => {
    const { expected, needs_review } = draftAssessmentExpected(mockKg as KnowledgeGraph, 'CABG', 'phase_1', 'green', []);
    expect(expected.outcome).toBe('REASSURE');
    expect(expected.patient_action).toBe('SELF_MONITOR');
    expect(expected.overall_risk_level).toBe('LOW');
    expect(expected.escalation_required).toBe(false);
    expect(needs_review).toBe(false);
  });

  it('yellow path: ADVISE, NURSE_CALLBACK, MEDIUM', () => {
    const { expected } = draftAssessmentExpected(mockKg as KnowledgeGraph, 'CABG', 'phase_1', 'yellow', ['wound_swelling']);
    expect(expected.outcome).toBe('ADVISE');
    expect(expected.patient_action).toBe('NURSE_CALLBACK');
    expect(expected.overall_risk_level).toBe('MEDIUM');
  });

  it('red path: ESCALATE, ER_NOW, CRITICAL, escalation_required true', () => {
    const { expected } = draftAssessmentExpected(mockKg as KnowledgeGraph, 'CABG', 'phase_1', 'red', ['chest_pain']);
    expect(expected.outcome).toBe('ESCALATE');
    expect(expected.patient_action).toBe('ER_NOW');
    expect(expected.overall_risk_level).toBe('CRITICAL');
    expect(expected.escalation_required).toBe(true);
  });
});

describe('selectSymptomForFlagPath', () => {
  it('green returns null', () => {
    expect(selectSymptomForFlagPath(mockKg as KnowledgeGraph, 'CABG', 'phase_1', 'green')).toBeNull();
  });

  it('yellow returns symptom with severity_score 1-2', () => {
    const name = selectSymptomForFlagPath(mockKg as KnowledgeGraph, 'CABG', 'phase_1', 'yellow');
    expect(name).toBe('wound_swelling');
  });

  it('red returns symptom with severity_score >= 3', () => {
    const name = selectSymptomForFlagPath(mockKg as KnowledgeGraph, 'CABG', 'phase_1', 'red');
    expect(name).toBe('chest_pain');
  });

  it('returns null when no applicable symptom exists for flag path', () => {
    const kgNoHigh = {
      ...mockKg,
      symptoms: { wound_swelling: mockKg.symptoms!.wound_swelling },
    };
    expect(selectSymptomForFlagPath(kgNoHigh as KnowledgeGraph, 'CABG', 'phase_1', 'red')).toBeNull();
  });
});
