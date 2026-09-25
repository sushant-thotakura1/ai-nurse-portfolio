import { ChatMessage } from '../ai-agent/interfaces';

export { ChatMessage };

// ── Greeting ──────────────────────────────────────────────────────────────────

export interface GreetingInput {
  condition: string;
  classification: string;
  phase: string;  // informational/display only; loadContext derives phase from days_since_start
  days_since_start: number;
  locale: string;
  patient_name?: string;  // not currently injected into the prompt; reserved for future use
  trigger_type_used?: string;  // defaults to kg.condition.trigger[0]
  is_reentry?: boolean;        // defaults to false
}

export interface GreetingOutput {
  nurse_greeting: string;
  system_prompt_used: string;
}

// ── Turn ──────────────────────────────────────────────────────────────────────

export interface TurnInput {
  condition: string;
  classification: string;
  phase: string;  // informational/display only; loadContext derives phase from days_since_start
  days_since_start: number;
  locale: string;
  history: ChatMessage[];      // cumulative from turn 1 through this turn, includes patient_says
  trigger_type_used?: string;
  is_reentry?: boolean;
}

export interface TurnOutput {
  nurse_response: string;
  topics_covered: string[];    // extracted via structured LLM call after nurse response
}

// ── Assessment ────────────────────────────────────────────────────────────────

export interface AssessmentInput {
  condition: string;
  classification: string;
  phase: string;  // informational/display only; loadContext derives phase from days_since_start
  days_since_start: number;
  locale: string;
  transcript: ChatMessage[];
  trigger_type_used?: string;
  is_reentry?: boolean;
}

export interface AssessmentOutput {
  outcome: 'REASSURE' | 'ADVISE' | 'ESCALATE' | 'INCOMPLETE';
  patient_action: 'SELF_MONITOR' | 'NURSE_CALLBACK' | 'FACILITY_TODAY' | 'ER_NOW' | null;  // null when INCOMPLETE
  overall_risk_level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  symptoms: Array<{
    name: string;
    severity: 'mild' | 'moderate' | 'severe';
    risk: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    flag: 'green' | 'yellow' | 'red';
    // Optional: whether this finding was decided by a deterministic rule or
    // by call 3's LLM judgment. Absent from older/fixture-constructed
    // AssessmentOutputs; only the real producer (transcript-assessment.service.ts)
    // populates it.
    decidedBy?: 'rule' | 'prose';
    // Sheet 4's Symptom ID (or null for a standalone red flag with no linked
    // symptom -- schema.md allows `Symptom ID: —`). Lets a summary formatter
    // group multiple fired flags that are about the same underlying complaint
    // (e.g. a sharp/sudden chest-pain flag and a milder chest-pain-with-
    // breathing flag both firing off the same patient statement) without
    // conflating genuinely different symptoms that happen to co-occur.
    // Optional/nullable for the same reason as decidedBy above: absent from
    // older/fixture-constructed AssessmentOutputs -- treated as "do not
    // group" by any consumer, never as "these are the same symptom".
    symptomId?: string | null;
  }>;
  escalation_reason?: string;
  escalation_required: boolean;
  deterministic: boolean;   // true only when every flag was covered by a rule
}
