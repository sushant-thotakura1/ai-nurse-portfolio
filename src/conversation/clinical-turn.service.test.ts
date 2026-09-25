import { ClinicalTurnService } from './clinical-turn.service';
import { ClinicalContext } from '../knowledge-graph/context-loader';

const SYMPTOMS = {
  SYM_RED: { name: 'Redness', base_severity: 'high', severity_score: 3, assessment_questions: [] },
  SYM_WAT: { name: 'Watering', base_severity: 'low', severity_score: 1, assessment_questions: [] },
} as any;

const RED_FLAGS: any[] = [
  { id: 'RF_SYS', symptom_id: null, trigger: 'two or more RSVP signs at once', action: 'ESCALATE', urgency: 'immediate', rationale: 'rejection pattern' },
  { id: 'RF_RED', symptom_id: 'SYM_RED', trigger: 'increasing redness beyond 3 days post-op', action: 'ESCALATE', urgency: 'immediate', rationale: 'rejection' },
  { id: 'RF_WAT', symptom_id: 'SYM_WAT', trigger: 'watering with pus', action: 'ESCALATE', urgency: 'urgent', rationale: 'infection' },
];

function ctx(overrides: Partial<ClinicalContext> = {}): ClinicalContext {
  return {
    patientContext: { condition: 'Keratoplasty', classification: 'PK', currentPhase: 'PHASE_I', daysSinceStart: 2, conditionType: 'acute' } as any,
    symptoms: SYMPTOMS, redFlags: RED_FLAGS, systemPrompt: '',
    ...overrides,
  } as ClinicalContext;
}

function llm(content: string) {
  const complete = jest.fn().mockResolvedValue({ content });
  return { svc: new ClinicalTurnService({ complete, stream: jest.fn() } as any), complete };
}

const base = {
  recentTranscript: [] as Array<{ speaker: 'patient' | 'agent'; text: string }>,
  patient: { ageYears: 40, gender: 'female' },
  inPlaySymptomIds: [] as string[],
};

describe('ClinicalTurnService.assessTurn', () => {
  it('returns newSymptoms + branchAnswer none when there is no active question', async () => {
    const { svc } = llm('{"newSymptoms":["SYM_RED"],"redFlags":[],"branchAnswer":null}');
    const r = await svc.assessTurn({ ...base, patientText: 'my eye is red', clinicalCtx: ctx(), activeQuestion: null });
    expect(r.newSymptoms.map(s => s.id)).toEqual(['SYM_RED']);
    expect(r.branchAnswer).toEqual({ kind: 'none' });
  });

  it('classifies the answer to the active question and reports no new symptoms', async () => {
    const { svc } = llm('{"newSymptoms":[],"redFlags":[],"branchAnswer":"B"}');
    const r = await svc.assessTurn({
      ...base, patientText: 'it is getting worse', clinicalCtx: ctx(), inPlaySymptomIds: ['SYM_RED'],
      activeQuestion: { id: 'RQ2', promptEn: 'Is the redness increasing, the same, or reducing?', branches: { A: 'same or reducing', B: 'increasing' } },
    });
    expect(r.branchAnswer).toEqual({ kind: 'branch', key: 'B' });
    expect(r.newSymptoms).toEqual([]);
  });

  it('maps branchAnswer "unclear" and "off_topic"', async () => {
    let r = await (llm('{"newSymptoms":[],"redFlags":[],"branchAnswer":"unclear"}')).svc.assessTurn({
      ...base, patientText: 'hmm', clinicalCtx: ctx(),
      activeQuestion: { id: 'RQ2', promptEn: 'q', branches: { A: 'a', B: 'b' } },
    });
    expect(r.branchAnswer).toEqual({ kind: 'unclear' });
    r = await (llm('{"newSymptoms":["SYM_WAT"],"redFlags":[],"branchAnswer":"off_topic"}')).svc.assessTurn({
      ...base, patientText: 'also my eye waters', clinicalCtx: ctx(),
      activeQuestion: { id: 'RQ2', promptEn: 'q', branches: { A: 'a', B: 'b' } },
    });
    expect(r.branchAnswer).toEqual({ kind: 'off_topic' });
    expect(r.newSymptoms.map(s => s.id)).toEqual(['SYM_WAT']);
  });

  it('evaluates systemic red flags plus red flags for in-play symptoms only', async () => {
    const { svc, complete } = llm('{"newSymptoms":[],"redFlags":["RF_RED"],"branchAnswer":null}');
    const r = await svc.assessTurn({ ...base, patientText: 'redness worse', clinicalCtx: ctx(), inPlaySymptomIds: ['SYM_RED'], activeQuestion: null });
    const prompt = complete.mock.calls[0][0][1].content as string;
    expect(prompt).toContain('RF_SYS');   // systemic — always
    expect(prompt).toContain('RF_RED');   // in play
    expect(prompt).not.toContain('RF_WAT'); // not in play
    expect(r.redFlags.map(f => f.trigger)).toEqual(['increasing redness beyond 3 days post-op']);
  });

  it('a red flag the model returns for a symptom not in play is dropped', async () => {
    const { svc } = llm('{"newSymptoms":[],"redFlags":["RF_WAT"],"branchAnswer":null}');
    const r = await svc.assessTurn({ ...base, patientText: 'x', clinicalCtx: ctx(), inPlaySymptomIds: ['SYM_RED'], activeQuestion: null });
    expect(r.redFlags).toEqual([]);
  });

  it('includes patient context and recent transcript in the prompt', async () => {
    const { svc, complete } = llm('{"newSymptoms":[],"redFlags":[],"branchAnswer":null}');
    await svc.assessTurn({
      ...base, patientText: 'yes', clinicalCtx: ctx(),
      recentTranscript: [{ speaker: 'agent', text: 'has it been more than a day?' }, { speaker: 'patient', text: 'since yesterday' }],
      activeQuestion: null,
    });
    const prompt = complete.mock.calls[0][0][1].content as string;
    expect(prompt).toContain('PHASE_I');
    expect(prompt).toContain('Days since');
    expect(prompt).toContain('Patient age: 40');
    expect(prompt).toContain('since yesterday');
  });

  it('returns empty / none on unparseable output', async () => {
    const { svc } = llm('I cannot assess this');
    const r = await svc.assessTurn({ ...base, patientText: 'x', clinicalCtx: ctx(), activeQuestion: null });
    expect(r).toEqual({ newSymptoms: [], redFlags: [], branchAnswer: { kind: 'none' } });
  });

  it('returns empty / none on LLM throw', async () => {
    const complete = jest.fn().mockRejectedValue(new Error('down'));
    const svc = new ClinicalTurnService({ complete, stream: jest.fn() } as any);
    const r = await svc.assessTurn({ ...base, patientText: 'x', clinicalCtx: ctx(), activeQuestion: null });
    expect(r).toEqual({ newSymptoms: [], redFlags: [], branchAnswer: { kind: 'none' } });
  });

  it('makes no LLM call when the KG has no symptoms and no evaluable red flags', async () => {
    const { svc, complete } = llm('{"newSymptoms":[],"redFlags":[],"branchAnswer":null}');
    const r = await svc.assessTurn({ ...base, patientText: 'x', clinicalCtx: ctx({ symptoms: {}, redFlags: [] }), activeQuestion: null });
    expect(complete).not.toHaveBeenCalled();
    expect(r).toEqual({ newSymptoms: [], redFlags: [], branchAnswer: { kind: 'none' } });
  });

  it('branchAnswer key not in the active question -> off_topic', async () => {
    const { svc } = llm('{"newSymptoms":[],"redFlags":[],"branchAnswer":"Z"}');
    const r = await svc.assessTurn({
      ...base, patientText: 'x', clinicalCtx: ctx(),
      activeQuestion: { id: 'RQ2', promptEn: 'q', branches: { A: 'a', B: 'b' } },
    });
    expect(r.branchAnswer).toEqual({ kind: 'off_topic' });
  });

  it('resolves a terse day-count answer to the correct branch without calling the LLM', async () => {
    const { svc, complete } = llm('{"newSymptoms":[],"redFlags":[],"branchAnswer":"off_topic"}');
    const r = await svc.assessTurn({
      ...base, patientText: '4 days', clinicalCtx: ctx(),
      activeQuestion: { id: 'RQ3', promptEn: 'How many days has it been since your surgery?', branches: { A: '0–2 days', B: '3 or more days' } },
    });
    expect(r.branchAnswer).toEqual({ kind: 'branch', key: 'B' });
    expect(r.newSymptoms).toEqual([]);
    expect(complete).not.toHaveBeenCalled();
  });

  it('resolves a terse day-count answer into the lower branch of a range', async () => {
    const { svc, complete } = llm('{"newSymptoms":[],"redFlags":[],"branchAnswer":"off_topic"}');
    const r = await svc.assessTurn({
      ...base, patientText: 'it has been 2 days', clinicalCtx: ctx(),
      activeQuestion: { id: 'RQ3', promptEn: 'How many days has it been since your surgery?', branches: { A: '0–2 days', B: '3 or more days' } },
    });
    expect(r.branchAnswer).toEqual({ kind: 'branch', key: 'A' });
    expect(complete).not.toHaveBeenCalled();
  });

  it('resolves a word-form day-count answer ("One week") without calling the LLM (#184)', async () => {
    const { svc, complete } = llm('{"newSymptoms":[],"redFlags":[],"branchAnswer":"off_topic"}');
    const r = await svc.assessTurn({
      ...base, patientText: 'One week', clinicalCtx: ctx(),
      activeQuestion: { id: 'RQ3', promptEn: 'How many days has it been since your surgery?', branches: { A: '0–6 days', B: '7 or more days' } },
    });
    expect(r.branchAnswer).toEqual({ kind: 'branch', key: 'B' });
    expect(complete).not.toHaveBeenCalled();
  });

  it('resolves other word-form / non-day-unit day-count answers without calling the LLM', async () => {
    const branches = { A: '0–6 days', B: '7 or more days' };
    const cases: Array<[string, string]> = [
      ['a week', 'B'],
      ['It has been a week', 'B'],
      ['two weeks', 'B'],
      ['a month', 'B'],
      ['a couple of days', 'A'],
      ['since yesterday', 'A'],
      ['3 days', 'A'],
      ['1 year', 'B'],
      ['a year', 'B'],
      ['two years', 'B'],
      ['It has been a year', 'B'],
      ['It has been 6 months', 'B'],
      ['It has been 6 months.', 'B'],
      ["it's been 6 months", 'B'],
      ['since 6 months', 'B'],
    ];
    for (const [patientText, expectedKey] of cases) {
      const { svc, complete } = llm('{"newSymptoms":[],"redFlags":[],"branchAnswer":"off_topic"}');
      const r = await svc.assessTurn({
        ...base, patientText, clinicalCtx: ctx(),
        activeQuestion: { id: 'RQ3', promptEn: 'How many days has it been since your surgery?', branches },
      });
      expect([patientText, r.branchAnswer]).toEqual([patientText, { kind: 'branch', key: expectedKey }]);
      expect(complete).not.toHaveBeenCalled();
    }
  });

  it('falls back to the LLM when the answer is not a bare day count', async () => {
    const { svc, complete } = llm('{"newSymptoms":[],"redFlags":[],"branchAnswer":"B"}');
    const r = await svc.assessTurn({
      ...base, patientText: 'it has been about four days I think', clinicalCtx: ctx(),
      activeQuestion: { id: 'RQ3', promptEn: 'How many days has it been since your surgery?', branches: { A: '0–2 days', B: '3 or more days' } },
    });
    expect(complete).toHaveBeenCalled();
    expect(r.branchAnswer).toEqual({ kind: 'branch', key: 'B' });
  });

  it('falls back to the LLM when the active question branches are not day-count ranges', async () => {
    const { svc, complete } = llm('{"newSymptoms":[],"redFlags":[],"branchAnswer":"A"}');
    const r = await svc.assessTurn({
      ...base, patientText: '4 days', clinicalCtx: ctx(),
      activeQuestion: { id: 'RQ2', promptEn: 'q', branches: { A: 'a', B: 'b' } },
    });
    expect(complete).toHaveBeenCalled();
    expect(r.branchAnswer).toEqual({ kind: 'branch', key: 'A' });
  });
});
