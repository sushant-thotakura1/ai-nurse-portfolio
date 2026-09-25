// src/eval/__tests__/scenario-enumerator.test.ts
import { enumerateScenarios } from '../scenario-enumerator';
import { KnowledgeGraph } from '../../knowledge-graph/types';
import { ScenarioSpec } from '../dataset-types';

const mockKg: KnowledgeGraph = {
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

describe('enumerateScenarios', () => {
  it('produces 3 scenarios per phase (green/yellow/red)', () => {
    const specs = enumerateScenarios(mockKg, 'cardiac_surgery');
    // 1 classification × 1 phase × 3 flag paths = 3
    expect(specs).toHaveLength(3);
  });

  it('scenario_id follows the deterministic scheme', () => {
    const specs = enumerateScenarios(mockKg, 'cardiac_surgery');
    const ids = specs.map((s: ScenarioSpec) => s.scenario_id);
    expect(ids).toContain('cardiac_surgery__CABG__phase_1__green');
    expect(ids).toContain('cardiac_surgery__CABG__phase_1__yellow');
    expect(ids).toContain('cardiac_surgery__CABG__phase_1__red');
  });

  it('days_since_start is midpoint of phase range (day_range [1, 14] → 7)', () => {
    const specs = enumerateScenarios(mockKg, 'cardiac_surgery');
    expect(specs[0].days_since_start).toBe(7);
  });

  it('green path has empty symptoms_reported', () => {
    const specs = enumerateScenarios(mockKg, 'cardiac_surgery');
    const green = specs.find((s: ScenarioSpec) => s.flag_path === 'green')!;
    expect(green.symptoms_reported).toEqual([]);
  });

  it('yellow path has one moderate-severity symptom', () => {
    const specs = enumerateScenarios(mockKg, 'cardiac_surgery');
    const yellow = specs.find((s: ScenarioSpec) => s.flag_path === 'yellow')!;
    expect(yellow.symptoms_reported).toEqual(['wound_swelling']);
  });

  it('red path has one high-severity symptom', () => {
    const specs = enumerateScenarios(mockKg, 'cardiac_surgery');
    const red = specs.find((s: ScenarioSpec) => s.flag_path === 'red')!;
    expect(red.symptoms_reported).toEqual(['chest_pain']);
  });

  it('filters to single classification when classificationFilter provided', () => {
    const specs = enumerateScenarios(mockKg, 'cardiac_surgery', 'CABG');
    expect(specs.every((s: ScenarioSpec) => s.classification === 'CABG')).toBe(true);
  });

  it('returns empty array when no symptom exists for a flag path (yellow with no moderate symptoms)', () => {
    const kgOnlyHigh = {
      ...mockKg,
      symptoms: { chest_pain: mockKg.symptoms.chest_pain },
    } as KnowledgeGraph;
    const specs = enumerateScenarios(kgOnlyHigh, 'cardiac_surgery');
    // yellow path finds no symptom → scenario still generated with empty symptoms_reported
    const yellow = specs.find((s: ScenarioSpec) => s.flag_path === 'yellow')!;
    expect(yellow.symptoms_reported).toEqual([]);
  });

  it('always sets patient_name to Priya Sharma', () => {
    const specs = enumerateScenarios(mockKg, 'cardiac_surgery');
    expect(specs.every((s: ScenarioSpec) => s.patient_name === 'Priya Sharma')).toBe(true);
  });

  it('always sets locale to en-IN', () => {
    const specs = enumerateScenarios(mockKg, 'cardiac_surgery');
    expect(specs.every((s: ScenarioSpec) => s.locale === 'en-IN')).toBe(true);
  });

  it('handles open-ended phase ranges (day_range[1] === null)', () => {
    const kgOpenEnded = {
      ...mockKg,
      condition: {
        ...mockKg.condition,
        classifications: {
          CABG: {
            label: 'CABG',
            phases: {
              phase_ongoing: {
                name: 'Phase Ongoing',
                day_range: [60, null],
                day_range_type: 'open',
                focus: 'long-term monitoring',
                review: 'periodic',
                instruction_sheet: '',
              },
            },
          },
        },
      },
    } as KnowledgeGraph;
    const specs = enumerateScenarios(kgOpenEnded, 'cardiac_surgery');
    // days_since_start should be 60 + 15 = 75
    expect(specs[0].days_since_start).toBe(75);
  });
});
