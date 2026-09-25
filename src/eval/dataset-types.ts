// src/eval/dataset-types.ts

// ── Expected value shapes (what reviewers validate against) ──────────────────

export interface GreetingExpected {
  phase_acknowledged: boolean;
  condition_mentioned: boolean;
  warm_tone: boolean;
  opens_with_open_question: boolean;
}

export interface TurnExpected {
  topics_covered: string[];         // e.g. ["wound_swelling", "pain_duration"]
  one_question_at_a_time: boolean;
  did_not_dismiss: boolean;
  acknowledged_symptoms: boolean;
}

export interface AssessmentExpected {
  outcome: 'REASSURE' | 'ADVISE' | 'ESCALATE';
  patient_action: 'SELF_MONITOR' | 'NURSE_CALLBACK' | 'FACILITY_TODAY' | 'ER_NOW';
  overall_risk_level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  escalation_required: boolean;
}

export type FlagPath = 'green' | 'yellow' | 'red';

// ── Internal scenario descriptor (used by enumerator + builder) ──────────────

export interface ScenarioSpec {
  scenario_id: string;            // "{condition}__{classification}__{phase_key}__{flag_path}"
  condition: string;              // e.g. "cardiac_surgery"
  condition_display: string;      // e.g. "Cardiac Surgery" (from KG meta)
  classification: string;         // e.g. "CABG"
  phase_key: string;              // e.g. "phase_1"
  phase_display: string;          // e.g. "Phase I — Early Recovery"
  days_since_start: number;       // midpoint of phase date range
  flag_path: FlagPath;
  symptoms_reported: string[];    // symptom names for this flag path (empty for green)
  locale: string;                 // always "en-IN" for initial dataset
  patient_name: string;           // synthetic, always "Priya Sharma" for initial dataset
}

// ── Flat CSV row (both readable and dataset formats share this base) ─────────

export interface DatasetRow {
  scenario_id: string;
  row_type: 'greeting' | 'turn' | 'assessment';
  turn_number: string;            // empty string for greeting/assessment
  patient_name: string;
  condition: string;
  classification: string;
  days_since_start: number;
  phase: string;
  locale: string;
  patient_says: string;
  nurse_says: string;             // blank — experiment runner fills at runtime
  expected: string;               // JSON string (dataset.csv) or human-readable (readable.csv)
  needs_review: boolean;
  approved: boolean;
  reviewer_notes: string;
  // dataset.csv only — omitted from readable.csv
  history?: string;               // JSON: ChatMessage[] up to and including this turn
  transcript?: string;            // JSON: full ChatMessage[] (assessment row only)
  symptoms_reported?: string;     // JSON: string[] (assessment row only)
}
