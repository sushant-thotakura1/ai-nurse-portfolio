// tests/unit/messaging/message-formatter.test.ts
import { formatForChannel } from '../../../src/messaging/message-formatter';
import { MessageState } from '../../../src/messaging/session';
import { LLMProvider } from '../../../src/ai-agent/interfaces';

function makeMockLLM(responseJson: object): LLMProvider {
  return {
    complete: jest.fn().mockResolvedValue({
      content: JSON.stringify(responseJson),
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    }),
    stream: jest.fn(),
  } as any;
}

describe('formatForChannel', () => {
  it('returns valid text content from LLM response', async () => {
    const llm = makeMockLLM([{ type: 'text', text: 'Hello patient' }]);
    const result = await formatForChannel(llm, 'How are you?', MessageState.CONVERSATION, 'whatsapp', 'en');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ type: 'text', text: 'Hello patient' });
  });

  it('returns interactive buttons content', async () => {
    const llm = makeMockLLM([{
      type: 'interactive',
      interactive: {
        type: 'button',
        body: 'Select language',
        buttons: [{ id: 'hi', title: 'Hindi' }, { id: 'en', title: 'English' }],
      },
    }]);
    const result = await formatForChannel(llm, 'Choose language', MessageState.LANGUAGE_DETECTION, 'whatsapp', 'en');
    expect(result[0].type).toBe('interactive');
  });

  it('falls back to plain text when LLM returns invalid JSON', async () => {
    const llm = {
      complete: jest.fn().mockResolvedValue({ content: 'not valid json', finishReason: 'stop', usage: {} }),
    } as any;
    const result = await formatForChannel(llm, 'Clinical text here', MessageState.CONVERSATION, 'whatsapp', 'en');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ type: 'text', text: 'Clinical text here' });
  });

  it('falls back to plain text when LLM returns Zod-invalid content (missing type field)', async () => {
    const llm = makeMockLLM([{ notAType: 'wrong' }]);
    const result = await formatForChannel(llm, 'Clinical text here', MessageState.CONVERSATION, 'whatsapp', 'en');
    expect(result[0]).toMatchObject({ type: 'text', text: 'Clinical text here' });
  });

  it('falls back to plain text when LLM throws', async () => {
    const llm = { complete: jest.fn().mockRejectedValue(new Error('LLM error')) } as any;
    const result = await formatForChannel(llm, 'Clinical text here', MessageState.CONVERSATION, 'telegram', 'hi');
    expect(result[0]).toMatchObject({ type: 'text', text: 'Clinical text here' });
  });

  it('falls back when button title exceeds 20 chars (Zod constraint)', async () => {
    const llm = makeMockLLM([{
      type: 'interactive',
      interactive: {
        type: 'button',
        body: 'Choose',
        buttons: [{ id: 'x', title: 'This title is way too long for WhatsApp' }],
      },
    }]);
    const result = await formatForChannel(llm, 'Choose', MessageState.LANGUAGE_DETECTION, 'whatsapp', 'en');
    // Should fall back because title > 20 chars fails Zod
    expect(result[0].type).toBe('text');
  });
});
