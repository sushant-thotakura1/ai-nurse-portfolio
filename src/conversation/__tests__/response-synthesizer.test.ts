import { ResponseSynthesizer } from '../response-synthesizer';
import { ContextFragment, SessionContext } from '../conversation-skill';
import { MessageState } from '../../messaging/session';

function makeFragment(overrides: Partial<ContextFragment>): ContextFragment {
  return {
    skillName: 'test',
    content: 'test content',
    priority: 5,
    isEmpty: false,
    ...overrides,
  };
}

function makeContext(overrides: Partial<SessionContext> = {}): SessionContext {
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
    clinicalCtx: null,
    transcriptHistory: [],
    isFirstConversationTurn: false,
    patientName: null,
    ...overrides,
  };
}

describe('ResponseSynthesizer', () => {
  let mockLlm: any;
  let synthesizer: ResponseSynthesizer;

  beforeEach(() => {
    mockLlm = { complete: jest.fn().mockResolvedValue({ content: 'AI response' }) };
    synthesizer = new ResponseSynthesizer();
  });

  it('returns LLM response content', async () => {
    const fragments = [makeFragment({ content: 'clinical context', priority: 10 })];
    const result = await synthesizer.synthesize(fragments, makeContext(), [], 'hello', mockLlm);
    expect(result).toBe('AI response');
  });

  it('orders fragments by priority descending in system prompt', async () => {
    const fragments = [
      makeFragment({ skillName: 'qa', content: 'QA context', priority: 5 }),
      makeFragment({ skillName: 'symptom_check', content: 'Clinical context', priority: 10 }),
    ];
    await synthesizer.synthesize(fragments, makeContext(), [], 'hello', mockLlm);
    const systemContent: string = mockLlm.complete.mock.calls[0][0][0].content;
    expect(systemContent.indexOf('Clinical context')).toBeLessThan(systemContent.indexOf('QA context'));
  });

  it('skips isEmpty fragments', async () => {
    const fragments = [
      makeFragment({ skillName: 'symptom_check', content: 'Clinical', priority: 10, isEmpty: false }),
      makeFragment({ skillName: 'qa', content: 'should not appear', priority: 5, isEmpty: true }),
    ];
    await synthesizer.synthesize(fragments, makeContext(), [], 'hello', mockLlm);
    const systemContent: string = mockLlm.complete.mock.calls[0][0][0].content;
    expect(systemContent).not.toContain('should not appear');
    expect(systemContent).toContain('Clinical');
  });

  it('uses fallback prompt when all fragments are empty', async () => {
    const fragments = [makeFragment({ isEmpty: true })];
    await synthesizer.synthesize(fragments, makeContext(), [], 'hello', mockLlm);
    const systemContent: string = mockLlm.complete.mock.calls[0][0][0].content;
    expect(systemContent).toContain('clinical AI nurse');
  });

  it('includes transcript history and current message in LLM call', async () => {
    const history = [
      { role: 'user' as const, content: 'prior message' },
      { role: 'assistant' as const, content: 'prior reply' },
    ];
    const fragments = [makeFragment({ priority: 10 })];
    await synthesizer.synthesize(fragments, makeContext(), history, 'current message', mockLlm);
    const messages = mockLlm.complete.mock.calls[0][0];
    expect(messages[1]).toEqual({ role: 'user', content: 'prior message' });
    expect(messages[2]).toEqual({ role: 'assistant', content: 'prior reply' });
    expect(messages[3]).toEqual({ role: 'user', content: 'current message' });
  });

  it('prefixes the current message with the quoted question when replyingToQuestion is set', async () => {
    const fragments = [makeFragment({ priority: 10 })];
    const ctx = makeContext({ replyingToQuestion: 'Has your vision decreased?' });
    await synthesizer.synthesize(fragments, ctx, [], 'yes, a bit', mockLlm);
    const messages = mockLlm.complete.mock.calls[0][0];
    const lastMessage = messages[messages.length - 1];
    expect(lastMessage.role).toBe('user');
    expect(lastMessage.content).toContain('Has your vision decreased?');
    expect(lastMessage.content).toContain('yes, a bit');
  });

  it('sends the current message unchanged when replyingToQuestion is not set', async () => {
    const fragments = [makeFragment({ priority: 10 })];
    await synthesizer.synthesize(fragments, makeContext(), [], 'yes, a bit', mockLlm);
    const messages = mockLlm.complete.mock.calls[0][0];
    expect(messages[messages.length - 1]).toEqual({ role: 'user', content: 'yes, a bit' });
  });

  it('separates multiple fragments with a divider', async () => {
    const fragments = [
      makeFragment({ skillName: 'symptom_check', content: 'Clinical', priority: 10 }),
      makeFragment({ skillName: 'qa', content: 'QA', priority: 5 }),
    ];
    await synthesizer.synthesize(fragments, makeContext(), [], 'hello', mockLlm);
    const systemContent: string = mockLlm.complete.mock.calls[0][0][0].content;
    expect(systemContent).toContain('\n\n---\n\n');
  });

  it('calls LLM with temperature 0.7 and maxTokens 600', async () => {
    const fragments = [makeFragment({ priority: 10 })];
    await synthesizer.synthesize(fragments, makeContext(), [], 'hello', mockLlm);
    const opts = mockLlm.complete.mock.calls[0][1];
    expect(opts.temperature).toBe(0.7);
    expect(opts.maxTokens).toBe(600);
  });
});
