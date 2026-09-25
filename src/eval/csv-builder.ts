// src/eval/csv-builder.ts
import { stringify } from 'csv-stringify/sync';
import { KnowledgeGraph } from '../knowledge-graph/types';
import { DatasetRow, ScenarioSpec, FlagPath } from './dataset-types';
import { draftGreetingExpected, draftTurnExpected, draftAssessmentExpected } from './expected-drafters';

const READABLE_COLUMNS = [
  'scenario_id', 'row_type', 'turn_number', 'patient_name', 'condition', 'classification',
  'days_since_start', 'phase', 'locale', 'patient_says', 'nurse_says', 'expected',
  'needs_review', 'approved', 'reviewer_notes',
];

const DATASET_COLUMNS = [...READABLE_COLUMNS, 'history', 'transcript', 'symptoms_reported'];

export function buildScenarioRows(spec: ScenarioSpec, kg: KnowledgeGraph): DatasetRow[] {
  const base = {
    scenario_id: spec.scenario_id,
    condition: spec.condition_display,
    classification: spec.classification,
    days_since_start: spec.days_since_start,
    phase: spec.phase_display,
    locale: spec.locale,
    patient_name: spec.patient_name,
    nurse_says: '',
    approved: false,
    reviewer_notes: '',
  };

  const syntheticGreeting = buildSyntheticGreeting(spec);
  const { expected: greetingExp, needs_review: grNR } = draftGreetingExpected(kg);

  const greetingRow: DatasetRow = {
    ...base,
    row_type: 'greeting',
    turn_number: '',
    patient_says: '',
    expected: JSON.stringify(greetingExp),
    needs_review: grNR,
    history: JSON.stringify([]),
    transcript: undefined,
    symptoms_reported: undefined,
  };

  const patientTurn1 = buildPatientSays(spec.flag_path, spec.symptoms_reported, 1);
  const patientTurn2 = buildPatientSays(spec.flag_path, spec.symptoms_reported, 2);
  const syntheticNurseTurn1 = 'Thank you for sharing that. I understand you have been experiencing some discomfort. Can you tell me a bit more about how this started?';

  const { expected: turn1Exp } = draftTurnExpected(spec.flag_path, spec.symptoms_reported);
  const { expected: turn2Exp } = draftTurnExpected(spec.flag_path, spec.symptoms_reported);

  const historyForTurn1 = JSON.stringify([
    { role: 'assistant', content: syntheticGreeting },
    { role: 'user', content: patientTurn1 },
  ]);

  const historyForTurn2 = JSON.stringify([
    { role: 'assistant', content: syntheticGreeting },
    { role: 'user', content: patientTurn1 },
    { role: 'assistant', content: syntheticNurseTurn1 },
    { role: 'user', content: patientTurn2 },
  ]);

  const turn1Row: DatasetRow = {
    ...base,
    row_type: 'turn',
    turn_number: '1',
    patient_says: patientTurn1,
    expected: JSON.stringify(turn1Exp),
    needs_review: true,
    history: historyForTurn1,
  };

  const turn2Row: DatasetRow = {
    ...base,
    row_type: 'turn',
    turn_number: '2',
    patient_says: patientTurn2,
    expected: JSON.stringify(turn2Exp),
    needs_review: true,
    history: historyForTurn2,
  };

  const fullTranscript = JSON.stringify([
    { role: 'assistant', content: syntheticGreeting },
    { role: 'user', content: patientTurn1 },
    { role: 'assistant', content: syntheticNurseTurn1 },
    { role: 'user', content: patientTurn2 },
  ]);

  const { expected: assessExp, needs_review: assNR } = draftAssessmentExpected(
    kg, spec.classification, spec.phase_key, spec.flag_path, spec.symptoms_reported,
  );

  const assessmentRow: DatasetRow = {
    ...base,
    row_type: 'assessment',
    turn_number: '',
    patient_says: '',
    expected: JSON.stringify(assessExp),
    needs_review: assNR,
    transcript: fullTranscript,
    symptoms_reported: JSON.stringify(spec.symptoms_reported),
  };

  return [greetingRow, turn1Row, turn2Row, assessmentRow];
}

export function toReadableCsvString(rows: DatasetRow[]): string {
  return stringify(
    rows.map((r) => READABLE_COLUMNS.reduce((acc, col) => {
      acc[col] = (r as unknown as Record<string, unknown>)[col] ?? '';
      return acc;
    }, {} as Record<string, unknown>)),
    { header: true, columns: READABLE_COLUMNS },
  );
}

export function toDatasetCsvString(rows: DatasetRow[]): string {
  return stringify(
    rows.map((r) => DATASET_COLUMNS.reduce((acc, col) => {
      acc[col] = (r as unknown as Record<string, unknown>)[col] ?? '';
      return acc;
    }, {} as Record<string, unknown>)),
    { header: true, columns: DATASET_COLUMNS },
  );
}

function buildSyntheticGreeting(spec: ScenarioSpec): string {
  return `Hello ${spec.patient_name}! This is Asha calling to check on you — it has been ${spec.days_since_start} days since your ${spec.condition_display}. How are you feeling today?`;
}

const YELLOW_TURN2_PHRASES = [
  'It started about 2 days ago and it is still bothering me — it has not gone away.',
  'It has been there for a couple of days now and I am not sure if it is getting better.',
  'It started 2 days ago. It is not severe but it is still present and it concerns me.',
];

export function buildPatientSays(flagPath: FlagPath, symptoms: string[], turn: 1 | 2): string {
  if (flagPath === 'green') {
    return turn === 1
      ? 'I am feeling generally well, no major complaints.'
      : 'No, everything seems fine.';
  }
  const symptomLabel = symptoms[0] ?? 'some discomfort';
  if (flagPath === 'yellow') {
    return turn === 1
      ? `I have been noticing ${symptomLabel} and it is bothering me.`
      : YELLOW_TURN2_PHRASES[Math.floor(Math.random() * YELLOW_TURN2_PHRASES.length)];
  }
  // red
  return turn === 1
    ? `I have severe ${symptomLabel} that started suddenly and is quite bad.`
    : 'It has been getting worse over the past few hours.';
}
