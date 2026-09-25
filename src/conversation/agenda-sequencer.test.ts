import {
  emptyAgendaState,
  firstQuestion,
  questionById,
  activeQuestionOf,
  inPlaySymptomIds,
  AgendaSequencer,
  AgendaState,
} from './agenda-sequencer';
import { ClinicalContext } from '../knowledge-graph/context-loader';

const REDNESS = {
  name: 'Redness', base_severity: 'high', severity_score: 3, mandatory_screening: true,
  assessment_questions: [
    { id: 'RQ1', order: 1, prompt: 'How many days since your surgery?', branches: {
      A: { label: '0-3 days', risk_shift: -1, escalate: false, next: 'RQ2' },
      B: { label: '4+ days', risk_shift: 1, escalate: false, next: 'RQ2' },
    } },
    { id: 'RQ2', order: 2, prompt: 'Is the redness increasing, the same, or reducing?', branches: {
      A: { label: 'same or reducing', risk_shift: -1, escalate: false, next: null },
      B: { label: 'increasing', risk_shift: 2, escalate: true, next: null },
    } },
  ],
} as any;

const WATERING = {
  name: 'Watering', base_severity: 'low', severity_score: 1,
  assessment_questions: [
    { id: 'WQ1', order: 1, prompt: 'Is the watering constant or intermittent?', branches: {
      A: { label: 'intermittent', risk_shift: -1, escalate: false, next: 'WQ2' },
      B: { label: 'constant', risk_shift: 1, escalate: false, next: 'WQ2' },
    } },
    { id: 'WQ2', order: 2, prompt: 'Getting better or worse?', branches: {
      A: { label: 'better', risk_shift: -1, escalate: false, next: null },
      B: { label: 'worse', risk_shift: 1, escalate: false, next: null },
    } },
  ],
} as any;

function ctx(symptoms: Record<string, any>): ClinicalContext {
  return { patientContext: {} as any, symptoms, redFlags: [], systemPrompt: '' } as unknown as ClinicalContext;
}

const seq = new AgendaSequencer();
const detected = (id: string, name: string) => ({ id, name, baseSeverity: 'moderate' as const, severityScore: 1 });
const NONE = { kind: 'none' as const };

describe('helpers', () => {
  it('emptyAgendaState has all-empty queues', () => {
    expect(emptyAgendaState()).toEqual({ hpiQueue: [], rosQueue: [], noted: [], active: null, completed: [] });
  });

  it('firstQuestion returns the lowest-order question', () => {
    expect(firstQuestion(WATERING)?.id).toBe('WQ1');
    expect(firstQuestion({ ...WATERING, assessment_questions: [] })).toBeNull();
  });

  it('questionById finds by id', () => {
    expect(questionById(REDNESS, 'RQ2')?.prompt).toBe('Is the redness increasing, the same, or reducing?');
    expect(questionById(REDNESS, 'NOPE')).toBeNull();
  });

  it('activeQuestionOf returns the active item’s question with branch labels, or null', () => {
    const state: AgendaState = {
      ...emptyAgendaState(),
      active: { symptomId: 'S_W', source: 'HPI', mandatoryScreening: false, currentQuestionId: 'WQ1', askedQuestionIds: ['WQ1'], riskShift: 0, unclearCount: 0, status: 'active' },
    };
    expect(activeQuestionOf(state, ctx({ S_W: WATERING }))).toEqual({
      id: 'WQ1', promptEn: 'Is the watering constant or intermittent?',
      branches: { A: 'intermittent', B: 'constant' },
    });
    expect(activeQuestionOf(emptyAgendaState(), ctx({ S_W: WATERING }))).toBeNull();
  });

  it('inPlaySymptomIds collects every queue + active + noted + completed', () => {
    const state: AgendaState = {
      hpiQueue: [{ symptomId: 'a' } as any],
      rosQueue: [{ symptomId: 'b' } as any],
      noted: [{ symptomId: 'c' } as any],
      completed: [{ symptomId: 'd' } as any],
      active: { symptomId: 'e' } as any,
    };
    expect(inPlaySymptomIds(state).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});

describe('AgendaSequencer.advance', () => {
  it('promotes a new symptom, activates it, emits its first question', () => {
    const r = seq.advance({
      prev: emptyAgendaState(), newSymptoms: [detected('S_W', 'Watering')],
      redFlags: [], branchAnswer: NONE, clinicalCtx: ctx({ S_W: WATERING }),
    });
    expect(r.escalated).toBeNull();
    expect(r.nextQuestion).toEqual({ id: 'WQ1', promptEn: 'Is the watering constant or intermittent?' });
    expect(r.state.active?.symptomId).toBe('S_W');
  });

  it('applies a branch answer, adds risk_shift, advances to next', () => {
    const prev: AgendaState = {
      ...emptyAgendaState(),
      active: { symptomId: 'S_W', source: 'HPI', mandatoryScreening: false, currentQuestionId: 'WQ1', askedQuestionIds: ['WQ1'], riskShift: 0, unclearCount: 0, status: 'active' },
    };
    const r = seq.advance({ prev, newSymptoms: [], redFlags: [], branchAnswer: { kind: 'branch', key: 'B' }, clinicalCtx: ctx({ S_W: WATERING }) });
    expect(r.state.active?.currentQuestionId).toBe('WQ2');
    expect(r.state.active?.riskShift).toBe(1);
    expect(r.nextQuestion?.id).toBe('WQ2');
  });

  it('escalates when the applied branch has escalate:true', () => {
    const prev: AgendaState = {
      ...emptyAgendaState(),
      active: { symptomId: 'S_R', source: 'HPI', mandatoryScreening: true, currentQuestionId: 'RQ2', askedQuestionIds: ['RQ1', 'RQ2'], riskShift: 0, unclearCount: 0, status: 'active' },
    };
    const r = seq.advance({ prev, newSymptoms: [], redFlags: [], branchAnswer: { kind: 'branch', key: 'B' }, clinicalCtx: ctx({ S_R: REDNESS }) });
    expect(r.escalated).toEqual({ trigger: 'branch', detail: 'RQ2:B' });
    expect(r.nextQuestion).toBeNull();
  });

  it('escalates when redFlags is non-empty regardless of branch answer', () => {
    const prev: AgendaState = {
      ...emptyAgendaState(),
      active: { symptomId: 'S_W', source: 'HPI', mandatoryScreening: false, currentQuestionId: 'WQ1', askedQuestionIds: ['WQ1'], riskShift: 0, unclearCount: 0, status: 'active' },
    };
    const hit = { trigger: 'wound dehiscence', symptomId: null, action: 'ER', urgency: 'immediate' as const, rationale: 'x' };
    const r = seq.advance({ prev, newSymptoms: [], redFlags: [hit], branchAnswer: { kind: 'branch', key: 'A' }, clinicalCtx: ctx({ S_W: WATERING }) });
    expect(r.escalated).toEqual({ trigger: 'red_flag', detail: 'wound dehiscence' });
  });

  it('holds the question on off_topic, no strike', () => {
    const prev: AgendaState = {
      ...emptyAgendaState(),
      active: { symptomId: 'S_W', source: 'HPI', mandatoryScreening: false, currentQuestionId: 'WQ1', askedQuestionIds: ['WQ1'], riskShift: 0, unclearCount: 0, status: 'active' },
    };
    const r = seq.advance({ prev, newSymptoms: [], redFlags: [], branchAnswer: { kind: 'off_topic' }, clinicalCtx: ctx({ S_W: WATERING }) });
    expect(r.state.active?.currentQuestionId).toBe('WQ1');
    expect(r.state.active?.unclearCount).toBe(0);
    expect(r.nextQuestion?.id).toBe('WQ1');
  });

  it('re-asks once on unclear, force-advances on the second with no risk', () => {
    let state: AgendaState = {
      ...emptyAgendaState(),
      active: { symptomId: 'S_W', source: 'HPI', mandatoryScreening: false, currentQuestionId: 'WQ1', askedQuestionIds: ['WQ1'], riskShift: 5, unclearCount: 0, status: 'active' },
    };
    let r = seq.advance({ prev: state, newSymptoms: [], redFlags: [], branchAnswer: { kind: 'unclear' }, clinicalCtx: ctx({ S_W: WATERING }) });
    expect(r.state.active?.currentQuestionId).toBe('WQ1');
    expect(r.state.active?.unclearCount).toBe(1);
    r = seq.advance({ prev: r.state, newSymptoms: [], redFlags: [], branchAnswer: { kind: 'unclear' }, clinicalCtx: ctx({ S_W: WATERING }) });
    expect(r.state.active?.currentQuestionId).toBe('WQ2');
    expect(r.state.active?.riskShift).toBe(5);
    expect(r.state.active?.unclearCount).toBe(0);
  });

  it('D6: when a mandatory_screening symptom is volunteered alongside a normal one, the normal one is noted not drilled', () => {
    const r = seq.advance({
      prev: emptyAgendaState(),
      newSymptoms: [detected('S_W', 'Watering'), detected('S_R', 'Redness')],
      redFlags: [], branchAnswer: NONE,
      clinicalCtx: ctx({ S_W: WATERING, S_R: REDNESS }),
    });
    expect(r.state.active?.symptomId).toBe('S_R');
    expect(r.state.noted.map(i => i.symptomId)).toEqual(['S_W']);
    expect(r.state.hpiQueue).toEqual([]);
    expect(r.nextQuestion?.id).toBe('RQ1');
  });

  it('D6 mid-turn pivot: normal symptom active, mandatory one volunteered -> normal moves to noted', () => {
    const prev: AgendaState = {
      ...emptyAgendaState(),
      active: { symptomId: 'S_W', source: 'HPI', mandatoryScreening: false, currentQuestionId: 'WQ1', askedQuestionIds: ['WQ1'], riskShift: 0, unclearCount: 0, status: 'active' },
    };
    const r = seq.advance({
      prev, newSymptoms: [detected('S_R', 'Redness')], redFlags: [],
      branchAnswer: { kind: 'off_topic' }, clinicalCtx: ctx({ S_W: WATERING, S_R: REDNESS }),
    });
    expect(r.state.noted.map(i => i.symptomId)).toEqual(['S_W']);
    expect(r.state.active?.symptomId).toBe('S_R');
  });

  it('completes a chain and pulls the next HPI item (no mandatory involved -> FIFO)', () => {
    const prev: AgendaState = {
      hpiQueue: [{ symptomId: 'S_R2', source: 'HPI', mandatoryScreening: false, currentQuestionId: null, askedQuestionIds: [], riskShift: 0, unclearCount: 0, status: 'active' }],
      rosQueue: [], noted: [], completed: [],
      active: { symptomId: 'S_W', source: 'HPI', mandatoryScreening: false, currentQuestionId: 'WQ2', askedQuestionIds: ['WQ1', 'WQ2'], riskShift: 0, unclearCount: 0, status: 'active' },
    };
    const two = ctx({ S_W: WATERING, S_R2: { ...WATERING, name: 'Foreign body' } });
    const r = seq.advance({ prev, newSymptoms: [], redFlags: [], branchAnswer: { kind: 'branch', key: 'A' }, clinicalCtx: two });
    expect(r.state.completed.map(i => i.symptomId)).toEqual(['S_W']);
    expect(r.state.active?.symptomId).toBe('S_R2');
    expect(r.nextQuestion?.id).toBe('WQ1');
  });

  it('emits no nextQuestion when the agenda is fully drained', () => {
    const prev: AgendaState = {
      ...emptyAgendaState(),
      active: { symptomId: 'S_W', source: 'HPI', mandatoryScreening: false, currentQuestionId: 'WQ2', askedQuestionIds: ['WQ1', 'WQ2'], riskShift: 0, unclearCount: 0, status: 'active' },
    };
    const r = seq.advance({ prev, newSymptoms: [], redFlags: [], branchAnswer: { kind: 'branch', key: 'A' }, clinicalCtx: ctx({ S_W: WATERING }) });
    expect(r.state.active).toBeNull();
    expect(r.nextQuestion).toBeNull();
  });

  it('rosQueue stays empty when no symptom is mandatory_screening (pre-#162)', () => {
    const r = seq.advance({
      prev: emptyAgendaState(), newSymptoms: [detected('S_W', 'Watering')],
      redFlags: [], branchAnswer: NONE, clinicalCtx: ctx({ S_W: WATERING }),
    });
    expect(r.state.rosQueue).toEqual([]);
  });
});
