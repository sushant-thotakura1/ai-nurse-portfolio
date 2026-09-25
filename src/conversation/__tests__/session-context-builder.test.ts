import { buildSessionContext } from '../session-context-builder';
import { MessageState } from '../../messaging/session';

const makePatient = (overrides = {}) => ({
  id: 'p1',
  condition: 'Heart Failure',
  classification: 'HFpEF',
  conditionStartDate: new Date('2026-01-01'),
  knowledgeGraphId: 'kg1',
  preferredLocale: 'en-IN',
  ...overrides,
});

const makeSession = (transcript: any[] = []) => ({
  state: MessageState.CONVERSATION,
  transcript,
});

describe('buildSessionContext', () => {
  it('assembles basic fields from patient and session', () => {
    const ctx = buildSessionContext(
      makePatient(), makeSession(), null, 'hello', 'en-NG', 'en-NG',
    );
    expect(ctx.patientId).toBe('p1');
    expect(ctx.condition).toBe('Heart Failure');
    expect(ctx.classification).toBe('HFpEF');
    expect(ctx.locale).toBe('en-NG');
    expect(ctx.currentMessage).toBe('hello');
    expect(ctx.detectedLocale).toBe('en-NG');
    expect(ctx.sessionState).toBe(MessageState.CONVERSATION);
  });

  it('trims transcript to last 8 turns', () => {
    const transcript = Array.from({ length: 12 }, (_, i) => ({
      speaker: i % 2 === 0 ? 'patient' : 'agent',
      originalText: `turn ${i}`,
    }));
    const ctx = buildSessionContext(makePatient(), makeSession(transcript), null, 'hi', null, 'en-IN');
    expect(ctx.recentTranscript).toHaveLength(8);
    expect(ctx.recentTranscript[0].text).toBe('turn 4');
  });

  it('maps transcript speaker field correctly', () => {
    const transcript = [
      { speaker: 'patient', originalText: 'I feel sick' },
      { speaker: 'agent', originalText: 'Tell me more' },
    ];
    const ctx = buildSessionContext(makePatient(), makeSession(transcript), null, 'hi', null, 'en-IN');
    expect(ctx.recentTranscript[0]).toEqual({ speaker: 'patient', text: 'I feel sick' });
    expect(ctx.recentTranscript[1]).toEqual({ speaker: 'agent', text: 'Tell me more' });
  });

  it('extracts currentPhase from clinicalCtx when present', () => {
    const clinicalCtx = { patientContext: { currentPhase: 'PHASE_II:episodic' } } as any;
    const ctx = buildSessionContext(makePatient(), makeSession(), clinicalCtx, 'hi', null, 'en-IN');
    expect(ctx.currentPhase).toBe('PHASE_II:episodic');
  });

  it('sets currentPhase to null when no clinicalCtx', () => {
    const ctx = buildSessionContext(makePatient(), makeSession(), null, 'hi', null, 'en-IN');
    expect(ctx.currentPhase).toBeNull();
  });

  it('builds transcriptHistory as ChatMessage array', () => {
    const transcript = [
      { speaker: 'patient', originalText: 'I feel sick' },
      { speaker: 'agent', originalText: 'Tell me more' },
    ];
    const ctx = buildSessionContext(makePatient(), makeSession(transcript), null, 'hi', null, 'en-IN');
    expect(ctx.transcriptHistory).toEqual([
      { role: 'user', content: 'I feel sick' },
      { role: 'assistant', content: 'Tell me more' },
    ]);
  });

  it('passes replyingToQuestion through when the patient quote-replied to a question', () => {
    const ctx = buildSessionContext(
      makePatient(), makeSession(), null, 'yes it is', null, 'en-IN', null,
      'Is your vision blurry?',
    );
    expect(ctx.replyingToQuestion).toBe('Is your vision blurry?');
  });

  it('leaves replyingToQuestion undefined when no quoted question is supplied', () => {
    const ctx = buildSessionContext(makePatient(), makeSession(), null, 'hi', null, 'en-IN');
    expect(ctx.replyingToQuestion).toBeUndefined();
  });

  it('trims transcriptHistory to last 8 turns to bound main LLM token cost', () => {
    const transcript = Array.from({ length: 12 }, (_, i) => ({
      speaker: i % 2 === 0 ? 'patient' : 'agent',
      originalText: `turn ${i}`,
    }));
    const ctx = buildSessionContext(makePatient(), makeSession(transcript), null, 'hi', null, 'en-IN');
    expect(ctx.transcriptHistory).toHaveLength(8);
    expect(ctx.transcriptHistory[0]).toEqual({ role: 'user', content: 'turn 4' });
  });
});
