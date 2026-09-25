import { SymptomCheckSkill } from '../skills/symptom-check.skill';
import { MessageState } from '../../messaging/session';
import { SessionContext } from '../conversation-skill';

function makeContext(clinicalCtx: any | null): SessionContext {
  return {
    patientId: 'p1',
    condition: 'Heart Failure',
    classification: 'HFpEF',
    currentPhase: 'PHASE_II:episodic',
    locale: 'en-IN',
    recentTranscript: [],
    sessionState: MessageState.CONVERSATION,
    currentMessage: 'I feel tired',
    detectedLocale: null,
    clinicalCtx,
    transcriptHistory: [],
    isFirstConversationTurn: false,
    patientName: null,
  };
}

describe('SymptomCheckSkill', () => {
  const skill = new SymptomCheckSkill();

  it('has correct name and description', () => {
    expect(skill.name).toBe('symptom_check');
    expect(skill.description).toContain('symptom');
  });

  it('returns clinical system prompt when clinicalCtx is present', async () => {
    const clinicalCtx = { systemPrompt: 'You are a clinical AI nurse for Heart Failure...' } as any;
    const fragment = await skill.execute(makeContext(clinicalCtx), null);
    expect(fragment.skillName).toBe('symptom_check');
    expect(fragment.content).toBe('You are a clinical AI nurse for Heart Failure...');
    expect(fragment.priority).toBe(10);
    expect(fragment.isEmpty).toBe(false);
  });

  it('returns fallback prompt when clinicalCtx is null', async () => {
    const fragment = await skill.execute(makeContext(null), null);
    expect(fragment.isEmpty).toBe(false);
    expect(fragment.content).toContain('clinical AI nurse');
    expect(fragment.priority).toBe(10);
  });

  it('first-turn opening greeting does not state how long it has been since surgery', async () => {
    const clinicalCtx = {
      systemPrompt: 'You are a clinical AI nurse for Keratoplasty...',
      patientContext: { daysSinceStart: 49, condition: 'Keratoplasty' },
    } as any;
    const ctx = { ...makeContext(clinicalCtx), isFirstConversationTurn: true, patientName: 'Sushant' };
    const fragment = await skill.execute(ctx, null);
    expect(fragment.content).toContain('OPENING GREETING');
    expect(fragment.content).toContain('Sushant');
    // No concrete timeline (e.g. "7 weeks") and no "since your <condition> surgery" phrasing.
    expect(fragment.content).not.toMatch(/\b\d+\s*(day|week|month)s?\b|since your/i);
  });

  it('fallback prompt carries a language instruction (not the bare code)', async () => {
    const fragment = await skill.execute(makeContext(null), null);
    expect(fragment.content).toMatch(/simple English/i);
  });
});
