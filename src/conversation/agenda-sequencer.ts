import { ClinicalContext } from '../knowledge-graph/context-loader';
import { AssessmentQuestion, Symptom } from '../knowledge-graph/types';

// Deterministic single-slot question sequencer (issue #161). Walks the KG's
// assessment_questions graph one question per turn. Pure — no DB, no LLM. The
// caller passes the current AgendaState + this turn's assessment and persists
// the returned state.

export interface DetectedSymptom {
  id: string;
  name: string;
  baseSeverity: 'low' | 'moderate' | 'high';
  severityScore: number;
}

export interface RedFlagHit {
  trigger: string;
  symptomId: string | null;
  action: string;
  urgency: 'immediate' | 'urgent' | 'moderate';
  rationale: string;
}

export type BranchAnswer =
  | { kind: 'branch'; key: string }
  | { kind: 'unclear' }
  | { kind: 'off_topic' }
  | { kind: 'none' };

export interface AgendaItem {
  symptomId: string;
  source: 'HPI' | 'ROS';
  mandatoryScreening: boolean;
  currentQuestionId: string | null;
  askedQuestionIds: string[];
  riskShift: number;
  unclearCount: number;
  status: 'active' | 'done' | 'noted';
}

export interface AgendaState {
  hpiQueue: AgendaItem[];
  rosQueue: AgendaItem[];
  noted: AgendaItem[];
  active: AgendaItem | null;
  completed: AgendaItem[];
}

export interface AdvanceResult {
  state: AgendaState;
  escalated: { trigger: 'red_flag' | 'branch'; detail: string } | null;
  nextQuestion: { id: string; promptEn: string } | null;
}

export interface ActiveQuestion {
  id: string;
  promptEn: string;
  branches: Record<string, string>;
}

const MAX_UNCLEAR = 2;

export function emptyAgendaState(): AgendaState {
  return { hpiQueue: [], rosQueue: [], noted: [], active: null, completed: [] };
}

export function firstQuestion(symptom: Symptom): AssessmentQuestion | null {
  const qs = symptom.assessment_questions ?? [];
  if (qs.length === 0) return null;
  return [...qs].sort((a, b) => a.order - b.order)[0];
}

export function questionById(symptom: Symptom, id: string): AssessmentQuestion | null {
  return (symptom.assessment_questions ?? []).find(q => q.id === id) ?? null;
}

function isMandatoryScreening(symptom: Symptom | undefined): boolean {
  return !!(symptom as (Symptom & { mandatory_screening?: boolean }) | undefined)?.mandatory_screening;
}

export function mandatoryScreeningSymptomIds(clinicalCtx: ClinicalContext): string[] {
  return Object.entries(clinicalCtx.symptoms)
    .filter(([, s]) => isMandatoryScreening(s))
    .map(([id]) => id);
}

/** The active item's current question, with branch keys -> labels, for assessTurn. Null when nothing is pending. */
export function activeQuestionOf(state: AgendaState, clinicalCtx: ClinicalContext): ActiveQuestion | null {
  const active = state.active;
  if (!active || !active.currentQuestionId) return null;
  const symptom = clinicalCtx.symptoms[active.symptomId];
  const q = symptom ? questionById(symptom, active.currentQuestionId) : null;
  if (!q) return null;
  const branches: Record<string, string> = {};
  for (const [key, b] of Object.entries(q.branches ?? {})) branches[key] = b.label;
  return { id: q.id, promptEn: q.prompt, branches };
}

/** Every symptom id currently in play — used to scope per-turn red-flag evaluation. */
export function inPlaySymptomIds(state: AgendaState): string[] {
  const ids = new Set<string>();
  for (const i of state.hpiQueue) ids.add(i.symptomId);
  for (const i of state.rosQueue) ids.add(i.symptomId);
  for (const i of state.noted) ids.add(i.symptomId);
  for (const i of state.completed) ids.add(i.symptomId);
  if (state.active) ids.add(state.active.symptomId);
  return [...ids];
}

function newItem(symptomId: string, source: 'HPI' | 'ROS', clinicalCtx: ClinicalContext): AgendaItem {
  return {
    symptomId, source,
    mandatoryScreening: isMandatoryScreening(clinicalCtx.symptoms[symptomId]),
    currentQuestionId: null, askedQuestionIds: [], riskShift: 0, unclearCount: 0, status: 'active',
  };
}

export class AgendaSequencer {
  advance(input: {
    prev: AgendaState;
    newSymptoms: DetectedSymptom[];
    redFlags: RedFlagHit[];
    branchAnswer: BranchAnswer;
    clinicalCtx: ClinicalContext;
  }): AdvanceResult {
    const { newSymptoms, redFlags, branchAnswer, clinicalCtx } = input;
    const state: AgendaState = JSON.parse(JSON.stringify(input.prev ?? emptyAgendaState()));

    // 1. Apply the patient's answer to the currently-active question.
    let escalated: AdvanceResult['escalated'] = null;
    if (state.active && state.active.currentQuestionId && branchAnswer.kind !== 'none') {
      const symptom = clinicalCtx.symptoms[state.active.symptomId];
      const question = symptom ? questionById(symptom, state.active.currentQuestionId) : null;
      if (question) {
        if (branchAnswer.kind === 'branch' && question.branches?.[branchAnswer.key]) {
          const branch = question.branches[branchAnswer.key];
          state.active.riskShift += branch.risk_shift ?? 0;
          state.active.unclearCount = 0;
          if (branch.escalate) {
            escalated = { trigger: 'branch', detail: `${question.id}:${branchAnswer.key}` };
          } else {
            this.moveToNextQuestion(state, clinicalCtx, question, branchAnswer.key);
          }
        } else if (branchAnswer.kind === 'unclear') {
          state.active.unclearCount += 1;
          if (state.active.unclearCount >= MAX_UNCLEAR) {
            state.active.unclearCount = 0;
            const firstKey = Object.keys(question.branches ?? {})[0];
            if (firstKey) this.moveToNextQuestion(state, clinicalCtx, question, firstKey);
          }
        }
        // off_topic / branch key not in question: hold the question.
      }
    }

    // 2. Unified escalation — branch flag OR any red-flag hit this turn.
    if (!escalated && redFlags.length > 0) {
      escalated = { trigger: 'red_flag', detail: redFlags[0].trigger };
    }
    if (escalated) return { state, escalated, nextQuestion: null };

    // 3. Promote newly-volunteered symptoms into the HPI queue.
    const known = new Set(inPlaySymptomIds(state));
    for (const s of newSymptoms) {
      if (!known.has(s.id) && clinicalCtx.symptoms[s.id]) {
        state.hpiQueue.push(newItem(s.id, 'HPI', clinicalCtx));
        known.add(s.id);
      }
    }

    // 4. ROS queue from mandatory_screening symptoms not already in play (empty until #162).
    for (const id of mandatoryScreeningSymptomIds(clinicalCtx)) {
      if (!known.has(id)) {
        state.rosQueue.push(newItem(id, 'ROS', clinicalCtx));
        known.add(id);
      }
    }

    // 5. D6 partition — if any HPI symptom is mandatory_screening, only those are
    //    drilled; non-mandatory volunteered symptoms are noted-not-drilled.
    const hpiHasMandatory =
      state.hpiQueue.some(i => i.mandatoryScreening) ||
      (state.active?.source === 'HPI' && state.active.mandatoryScreening === true);
    if (hpiHasMandatory) {
      const demoted = state.hpiQueue.filter(i => !i.mandatoryScreening);
      state.hpiQueue = state.hpiQueue.filter(i => i.mandatoryScreening);
      for (const d of demoted) { d.status = 'noted'; state.noted.push(d); }
      if (state.active && state.active.source === 'HPI' && !state.active.mandatoryScreening) {
        state.active.status = 'noted';
        state.noted.push(state.active);
        state.active = null;
      }
    }

    // 6. Activate the next item if none is active.
    this.activateNext(state, clinicalCtx);

    // 7. Emit the question for whatever is now active.
    let nextQuestion: AdvanceResult['nextQuestion'] = null;
    if (state.active && state.active.currentQuestionId) {
      const symptom = clinicalCtx.symptoms[state.active.symptomId];
      const q = symptom ? questionById(symptom, state.active.currentQuestionId) : null;
      if (q) nextQuestion = { id: q.id, promptEn: q.prompt };
    }
    return { state, escalated: null, nextQuestion };
  }

  private activateNext(state: AgendaState, clinicalCtx: ClinicalContext): void {
    if (state.active) return;
    const item = state.hpiQueue.shift() ?? state.rosQueue.shift() ?? null;
    if (!item) return;
    if (!item.currentQuestionId) {
      const symptom = clinicalCtx.symptoms[item.symptomId];
      const first = symptom ? firstQuestion(symptom) : null;
      item.currentQuestionId = first?.id ?? null;
      if (first) item.askedQuestionIds.push(first.id);
    }
    state.active = item;
  }

  private moveToNextQuestion(
    state: AgendaState,
    clinicalCtx: ClinicalContext,
    answered: { id: string },
    branchKey: string,
  ): void {
    if (!state.active) return;
    const symptom = clinicalCtx.symptoms[state.active.symptomId];
    const answeredQ = symptom ? questionById(symptom, answered.id) : null;
    const nextId = answeredQ?.branches?.[branchKey]?.next ?? null;
    if (nextId && symptom && questionById(symptom, nextId)) {
      state.active.currentQuestionId = nextId;
      if (!state.active.askedQuestionIds.includes(nextId)) state.active.askedQuestionIds.push(nextId);
      return;
    }
    state.active.status = 'done';
    state.active.currentQuestionId = null;
    state.completed.push(state.active);
    state.active = null;
    this.activateNext(state, clinicalCtx);
  }
}
