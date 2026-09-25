import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { stringify } from 'csv-stringify/sync';
import { loadRows, toPhoenixExamples } from '../dataset-loader';

function writeTempCsv(content: string): string {
  const tmpPath = path.join(os.tmpdir(), `test-dataset-${Date.now()}.csv`);
  fs.writeFileSync(tmpPath, content, 'utf-8');
  return tmpPath;
}

const HEADER = 'scenario_id,row_type,turn_number,patient_name,condition,classification,days_since_start,phase,locale,patient_says,nurse_says,expected,needs_review,approved,reviewer_notes,history,transcript,symptoms_reported';

const COLUMNS = HEADER.split(',');

function toRow(obj: Record<string, string>): string {
  return stringify([obj], { header: false, columns: COLUMNS }).trimEnd();
}

const GREETING_ROW = toRow({
  scenario_id: 'cardiac_surgery__CABG__phase_1__green',
  row_type: 'greeting',
  turn_number: '',
  patient_name: 'Priya Sharma',
  condition: 'cardiac_surgery',
  classification: 'CABG',
  days_since_start: '14',
  phase: 'phase_1',
  locale: 'en-IN',
  patient_says: '',
  nurse_says: '',
  expected: '{"phase_acknowledged":true,"condition_mentioned":true,"warm_tone":true,"opens_with_open_question":true}',
  needs_review: 'false',
  approved: 'false',
  reviewer_notes: '',
  history: '[]',
  transcript: '',
  symptoms_reported: '',
});

const TURN_ROW = toRow({
  scenario_id: 'cardiac_surgery__CABG__phase_1__yellow',
  row_type: 'turn',
  turn_number: '1',
  patient_name: 'Priya Sharma',
  condition: 'cardiac_surgery',
  classification: 'CABG',
  days_since_start: '14',
  phase: 'phase_1',
  locale: 'en-IN',
  patient_says: 'I have some chest pain',
  nurse_says: '',
  expected: '{"topics_covered":["chest_pain"],"one_question_at_a_time":true,"did_not_dismiss":true,"acknowledged_symptoms":true}',
  needs_review: 'false',
  approved: 'false',
  reviewer_notes: '',
  history: '[{"role":"user","content":"I have some chest pain"}]',
  transcript: '',
  symptoms_reported: '',
});

const NEEDS_REVIEW_ROW = toRow({
  scenario_id: 'cardiac_surgery__CABG__phase_1__red',
  row_type: 'turn',
  turn_number: '1',
  patient_name: 'Priya Sharma',
  condition: 'cardiac_surgery',
  classification: 'CABG',
  days_since_start: '14',
  phase: 'phase_1',
  locale: 'en-IN',
  patient_says: 'I am in severe pain',
  nurse_says: '',
  expected: '{"topics_covered":[],"one_question_at_a_time":true,"did_not_dismiss":true,"acknowledged_symptoms":true}',
  needs_review: 'true',
  approved: 'false',
  reviewer_notes: '',
  history: '[{"role":"user","content":"I am in severe pain"}]',
  transcript: '',
  symptoms_reported: '',
});

describe('loadRows', () => {
  it('parses greeting rows correctly', () => {
    const csvPath = writeTempCsv(`${HEADER}\n${GREETING_ROW}`);
    const rows = loadRows(csvPath);
    expect(rows).toHaveLength(1);
    expect(rows[0].row_type).toBe('greeting');
    expect(rows[0].condition).toBe('cardiac_surgery');
    expect(rows[0].days_since_start).toBe(14);
    expect(rows[0].needs_review).toBe(false);
    const expected = rows[0].expected as unknown as Record<string, unknown>;
    expect(expected.phase_acknowledged).toBe(true);
  });

  it('parses turn rows with history', () => {
    const csvPath = writeTempCsv(`${HEADER}\n${TURN_ROW}`);
    const rows = loadRows(csvPath);
    expect(rows[0].row_type).toBe('turn');
    expect(rows[0].turn_number).toBe('1');
    const history = rows[0].history as unknown as Array<{ role: string; content: string }>;
    expect(Array.isArray(history)).toBe(true);
    expect(history[0].role).toBe('user');
  });

  it('filters out needs_review rows', () => {
    const csvPath = writeTempCsv(`${HEADER}\n${GREETING_ROW}\n${TURN_ROW}\n${NEEDS_REVIEW_ROW}`);
    const rows = loadRows(csvPath);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.needs_review === false)).toBe(true);
  });

  it('throws if the file does not exist', () => {
    expect(() => loadRows('/nonexistent/path.csv')).toThrow();
  });
});

describe('toPhoenixExamples', () => {
  it('maps rows to Phoenix Example shape', () => {
    const csvPath = writeTempCsv(`${HEADER}\n${GREETING_ROW}`);
    const rows = loadRows(csvPath);
    const examples = toPhoenixExamples(rows);
    expect(examples).toHaveLength(1);
    expect(examples[0].input).toBeDefined();
    expect(examples[0].output).toBeDefined();
    expect((examples[0].metadata as Record<string, unknown>)?.row_type).toBe('greeting');
    expect((examples[0].input as Record<string, unknown>).patient_says).toBeDefined();
  });
});
