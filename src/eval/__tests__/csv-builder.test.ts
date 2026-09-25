// src/eval/__tests__/csv-builder.test.ts
import { buildScenarioRows, toReadableCsvString, toDatasetCsvString } from '../csv-builder';
import { KnowledgeGraph } from '../../knowledge-graph/types';

const mockKg = {
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
} as unknown as KnowledgeGraph;

import { ScenarioSpec } from '../dataset-types';

const yellowSpec: ScenarioSpec = {
  scenario_id: 'cardiac_surgery__CABG__phase_1__yellow',
  condition: 'cardiac_surgery',
  condition_display: 'Cardiac Surgery',
  classification: 'CABG',
  phase_key: 'phase_1',
  phase_display: 'Phase I — Early Recovery',
  days_since_start: 7,
  flag_path: 'yellow',
  symptoms_reported: ['wound_swelling'],
  locale: 'en-IN',
  patient_name: 'Priya Sharma',
};

describe('buildScenarioRows', () => {
  it('produces exactly 4 rows: greeting, turn 1, turn 2, assessment', () => {
    const rows = buildScenarioRows(yellowSpec, mockKg);
    expect(rows).toHaveLength(4);
    expect(rows[0].row_type).toBe('greeting');
    expect(rows[1].row_type).toBe('turn');
    expect(rows[1].turn_number).toBe('1');
    expect(rows[2].row_type).toBe('turn');
    expect(rows[2].turn_number).toBe('2');
    expect(rows[3].row_type).toBe('assessment');
  });

  it('all rows share scenario_id, condition, classification', () => {
    const rows = buildScenarioRows(yellowSpec, mockKg);
    for (const row of rows) {
      expect(row.scenario_id).toBe('cardiac_surgery__CABG__phase_1__yellow');
      expect(row.condition).toBe('Cardiac Surgery');
      expect(row.classification).toBe('CABG');
    }
  });

  it('greeting row has empty patient_says and empty nurse_says', () => {
    const rows = buildScenarioRows(yellowSpec, mockKg);
    expect(rows[0].patient_says).toBe('');
    expect(rows[0].nurse_says).toBe('');
  });

  it('assessment row has non-empty expected JSON with outcome', () => {
    const rows = buildScenarioRows(yellowSpec, mockKg);
    const assessment = rows[3];
    const expected = JSON.parse(assessment.expected);
    expect(expected.outcome).toBe('ADVISE');
  });

  it('turn rows are always needs_review true', () => {
    const rows = buildScenarioRows(yellowSpec, mockKg);
    expect(rows[1].needs_review).toBe(true);
    expect(rows[2].needs_review).toBe(true);
  });

  it('assessment row for yellow path is needs_review false', () => {
    const rows = buildScenarioRows(yellowSpec, mockKg);
    expect(rows[3].needs_review).toBe(false);
  });

  it('dataset.csv rows include history JSON for turn rows', () => {
    const rows = buildScenarioRows(yellowSpec, mockKg);
    // dataset format: turn rows have history field
    expect(rows[1].history).toBeDefined();
    expect(() => JSON.parse(rows[1].history!)).not.toThrow();
  });
});

describe('toReadableCsvString', () => {
  it('produces a string with CSV header', () => {
    const rows = buildScenarioRows(yellowSpec, mockKg);
    const csv = toReadableCsvString(rows);
    expect(csv).toContain('scenario_id');
    expect(csv).toContain('cardiac_surgery__CABG__phase_1__yellow');
  });

  it('does not include history or transcript columns', () => {
    const rows = buildScenarioRows(yellowSpec, mockKg);
    const csv = toReadableCsvString(rows);
    const lines = csv.split('\n');
    const header = lines[0];
    expect(header).not.toContain('history');
    expect(header).not.toContain('transcript');
  });
});

describe('toDatasetCsvString', () => {
  it('includes history and transcript columns', () => {
    const rows = buildScenarioRows(yellowSpec, mockKg);
    const csv = toDatasetCsvString(rows);
    expect(csv).toContain('history');
    expect(csv).toContain('transcript');
  });
});
