import { TurnPlanner } from '../turn-planner';
import { ConversationSkillRegistry } from '../conversation-skill';
import { MessageState } from '../../messaging/session';
import { SessionContext } from '../conversation-skill';

function makeRegistry(descriptions = 'symptom_check and qa') {
  const registry = new ConversationSkillRegistry();
  registry.register({
    name: 'symptom_check',
    description: 'Patient is reporting symptoms, feelings, pain, or health status updates',
    execute: jest.fn() as any,
  });
  registry.register({
    name: 'qa',
    description: 'Patient is asking a medical or health-related question',
    execute: jest.fn() as any,
  });
  return registry;
}

function makeContext(message: string): SessionContext {
  return {
    patientId: 'p1',
    condition: 'Heart Failure',
    classification: 'HFpEF',
    currentPhase: 'PHASE_II:episodic',
    locale: 'en-IN',
    recentTranscript: [],
    sessionState: MessageState.CONVERSATION,
    currentMessage: message,
    detectedLocale: null,
    clinicalCtx: null,
    transcriptHistory: [],
    isFirstConversationTurn: false,
    patientName: null,
  };
}

describe('TurnPlanner', () => {
  let mockLlm: any;
  let registry: ConversationSkillRegistry;

  beforeEach(() => {
    mockLlm = { complete: jest.fn() };
    registry = makeRegistry();
  });

  it('returns parsed skill list from LLM JSON response', async () => {
    mockLlm.complete.mockResolvedValue({
      content: '{"skills":["symptom_check"],"reasoning":"symptom report"}',
    });
    const planner = new TurnPlanner(mockLlm, registry);
    const plan = await planner.plan(makeContext('I feel short of breath'));
    expect(plan.skills).toEqual(['symptom_check']);
    expect(plan.reasoning).toBe('symptom report');
  });

  it('returns multiple skills when message spans intents', async () => {
    mockLlm.complete.mockResolvedValue({
      content: '{"skills":["symptom_check","qa"],"reasoning":"both"}',
    });
    const planner = new TurnPlanner(mockLlm, registry);
    const plan = await planner.plan(makeContext('I have chest pain, can I take aspirin?'));
    expect(plan.skills).toEqual(['symptom_check', 'qa']);
  });

  it('falls back to ["symptom_check"] when LLM returns invalid JSON', async () => {
    mockLlm.complete.mockResolvedValue({ content: 'not json' });
    const planner = new TurnPlanner(mockLlm, registry);
    const plan = await planner.plan(makeContext('hello'));
    expect(plan.skills).toEqual(['symptom_check']);
    expect(plan.reasoning).toBe('fallback: LLM returned invalid JSON');
  });

  it('falls back to ["symptom_check"] when LLM call throws', async () => {
    mockLlm.complete.mockRejectedValue(new Error('LLM unavailable'));
    const planner = new TurnPlanner(mockLlm, registry);
    const plan = await planner.plan(makeContext('hello'));
    expect(plan.skills).toEqual(['symptom_check']);
    expect(plan.reasoning).toBe('fallback: TurnPlanner LLM call failed');
  });

  it('includes skill descriptions in the prompt sent to LLM', async () => {
    mockLlm.complete.mockResolvedValue({
      content: '{"skills":["symptom_check"],"reasoning":"ok"}',
    });
    const planner = new TurnPlanner(mockLlm, registry);
    await planner.plan(makeContext('test'));
    const promptSent: string = mockLlm.complete.mock.calls[0][0][0].content;
    expect(promptSent).toContain('symptom_check');
    expect(promptSent).toContain('qa');
  });

  it('uses maxTokens 150 for the planner call', async () => {
    mockLlm.complete.mockResolvedValue({
      content: '{"skills":["symptom_check"],"reasoning":"ok"}',
    });
    const planner = new TurnPlanner(mockLlm, registry);
    await planner.plan(makeContext('test'));
    const opts = mockLlm.complete.mock.calls[0][1];
    expect(opts.maxTokens).toBe(150);
  });

  it('filters out unknown skill names hallucinated by the LLM', async () => {
    mockLlm.complete.mockResolvedValue({
      content: '{"skills":["symptom_check","triage","medication_check"],"reasoning":"mixed"}',
    });
    const planner = new TurnPlanner(mockLlm, registry);
    const plan = await planner.plan(makeContext('test'));
    expect(plan.skills).toEqual(['symptom_check']);
  });

  it('falls back to symptom_check when all LLM skills are unknown', async () => {
    mockLlm.complete.mockResolvedValue({
      content: '{"skills":["triage"],"reasoning":"unknown"}',
    });
    const planner = new TurnPlanner(mockLlm, registry);
    const plan = await planner.plan(makeContext('test'));
    expect(plan.skills).toEqual(['symptom_check']);
  });
});

describe('TurnPlanner.plan with enabledSkills filter', () => {
  function makeFilterRegistry(skills: string[]) {
    const reg = new ConversationSkillRegistry();
    for (const s of skills) {
      reg.register({ name: s, description: `${s} description`, execute: jest.fn() } as any);
    }
    return reg;
  }

  it('only shows qa skill in prompt when enabledSkills is [qa]', async () => {
    const mockLlm = { complete: jest.fn().mockResolvedValue({ content: '{"skills":["qa"],"reasoning":"faq"}' }) };
    const planner = new TurnPlanner(mockLlm as any, makeFilterRegistry(['symptom_check', 'qa']));

    await planner.plan(makeContext('hello'), ['qa']);

    const promptSent = mockLlm.complete.mock.calls[0][0][0].content as string;
    expect(promptSent).toContain('- qa:');
    expect(promptSent).not.toContain('- symptom_check:');
  });

  it('filters out disallowed skills from LLM response', async () => {
    const mockLlm = { complete: jest.fn().mockResolvedValue({ content: '{"skills":["symptom_check"],"reasoning":""}' }) };
    const planner = new TurnPlanner(mockLlm as any, makeFilterRegistry(['symptom_check', 'qa']));

    const plan = await planner.plan(makeContext('hello'), ['qa']);

    expect(plan.skills).toEqual(['qa']);
  });

  it('uses first enabledSkill as fallback when LLM returns invalid JSON', async () => {
    const mockLlm = { complete: jest.fn().mockResolvedValue({ content: 'not json' }) };
    const planner = new TurnPlanner(mockLlm as any, makeFilterRegistry(['symptom_check', 'qa']));

    const plan = await planner.plan(makeContext('hello'), ['qa']);

    expect(plan.skills).toEqual(['qa']);
  });

  it('uses symptom_check as fallback when enabledSkills is not provided', async () => {
    const mockLlm = { complete: jest.fn().mockResolvedValue({ content: 'not json' }) };
    const planner = new TurnPlanner(mockLlm as any, makeFilterRegistry(['symptom_check', 'qa']));

    const plan = await planner.plan(makeContext('hello'));

    expect(plan.skills).toEqual(['symptom_check']);
  });
});
