import { OpenAIAdapter } from '../../../src/ai-agent/adapters/openai.adapter';
import { ChatMessage, LLMProviderError } from '../../../src/ai-agent/interfaces';

// Mock only the OpenAI client constructor -- keep the real error classes
// (APIError etc.) so `new APIError(...)` in tests actually sets .status/.headers,
// and the adapter's `instanceof APIError` check compares against the same real class.
jest.mock('openai', () => {
  const actual = jest.requireActual('openai');
  return { __esModule: true, default: jest.fn(), APIError: actual.APIError };
});
import OpenAI, { APIError } from 'openai';

describe('OpenAIAdapter', () => {
  let adapter: OpenAIAdapter;
  let mockOpenAI: jest.Mocked<OpenAI>;

  beforeEach(() => {
    mockOpenAI = {
      chat: {
        completions: {
          create: jest.fn(),
        },
      },
    } as any;

    (OpenAI as jest.MockedClass<typeof OpenAI>).mockImplementation(() => mockOpenAI);

    adapter = new OpenAIAdapter({
      apiKey: 'test-api-key',
    });
  });

  describe('complete', () => {
    it('should complete a chat conversation', async () => {
      const messages: ChatMessage[] = [
        { role: 'system', content: 'You are a helpful medical assistant.' },
        { role: 'user', content: 'I have a headache.' },
      ];

      (mockOpenAI.chat.completions.create as jest.Mock).mockResolvedValueOnce({
        choices: [{
          message: { content: 'I understand you have a headache. Can you describe the pain?' },
          finish_reason: 'stop',
        }],
        usage: {
          prompt_tokens: 25,
          completion_tokens: 15,
          total_tokens: 40,
        },
      });

      const result = await adapter.complete(messages);

      expect(result.content).toBe('I understand you have a headache. Can you describe the pain?');
      expect(result.finishReason).toBe('stop');
      expect(result.usage.totalTokens).toBe(40);
    });

    it('should use custom options when provided', async () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Hello' },
      ];

      const options = {
        model: 'gpt-4',
        temperature: 0.7,
        maxTokens: 500,
      };

      (mockOpenAI.chat.completions.create as jest.Mock).mockResolvedValueOnce({
        choices: [{
          message: { content: 'Hi there!' },
          finish_reason: 'stop',
        }],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
        },
      });

      await adapter.complete(messages, options);

      expect(mockOpenAI.chat.completions.create).toHaveBeenCalledWith({
        model: 'gpt-4',
        messages: expect.any(Array),
        temperature: 0.7,
        max_tokens: 500,
      });
    });

    it('should handle API errors gracefully', async () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Test' },
      ];

      (mockOpenAI.chat.completions.create as jest.Mock).mockRejectedValueOnce(
        new Error('API Error')
      );

      await expect(adapter.complete(messages)).rejects.toThrow('OpenAI completion failed');
    });

    it('preserves the provider status code and Retry-After on failure', async () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Test' },
      ];

      const apiError = new APIError(
        429,
        { message: 'Rate limited' },
        'Rate limited',
        new Headers({ 'retry-after': '30' }),
      );
      (mockOpenAI.chat.completions.create as jest.Mock).mockRejectedValueOnce(apiError);

      let caught: unknown;
      try {
        await adapter.complete(messages);
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeInstanceOf(LLMProviderError);
      const err = caught as LLMProviderError;
      expect(err.status).toBe(429);
      expect(err.retryAfterSeconds).toBe(30);
      expect(err.cause).toBe(apiError);
      expect(err.message).toContain('OpenAI completion failed');
    });

    it('leaves status and retryAfterSeconds undefined when the provider error carries neither', async () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Test' },
      ];

      (mockOpenAI.chat.completions.create as jest.Mock).mockRejectedValueOnce(
        new Error('connection reset')
      );

      let caught: unknown;
      try {
        await adapter.complete(messages);
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeInstanceOf(LLMProviderError);
      const err = caught as LLMProviderError;
      expect(err.status).toBeUndefined();
      expect(err.retryAfterSeconds).toBeUndefined();
    });

    it('honours a per-call timeout', async () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Hello' },
      ];

      (mockOpenAI.chat.completions.create as jest.Mock).mockResolvedValueOnce({
        choices: [{
          message: { content: 'Hi there!' },
          finish_reason: 'stop',
        }],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
        },
      });

      await adapter.complete(messages, { timeoutMs: 5000 });

      expect(mockOpenAI.chat.completions.create).toHaveBeenCalledWith(
        expect.any(Object),
        { timeout: 5000 },
      );
    });

    it('does not pass a second argument to the SDK when no timeout is set', async () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Hello' },
      ];

      (mockOpenAI.chat.completions.create as jest.Mock).mockResolvedValueOnce({
        choices: [{
          message: { content: 'Hi there!' },
          finish_reason: 'stop',
        }],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
        },
      });

      await adapter.complete(messages);

      expect(mockOpenAI.chat.completions.create).toHaveBeenCalledWith(expect.any(Object));
    });
  });

  describe('stream', () => {
    it('should stream chat response chunks', async () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Tell me a story' },
      ];

      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield { choices: [{ delta: { content: 'Once ' } }] };
          yield { choices: [{ delta: { content: 'upon ' } }] };
          yield { choices: [{ delta: { content: 'a time' } }] };
          yield { choices: [{ delta: {}, finish_reason: 'stop' }] };
        },
      };

      (mockOpenAI.chat.completions.create as jest.Mock).mockResolvedValueOnce(mockStream);

      const chunks: string[] = [];
      for await (const chunk of adapter.stream(messages)) {
        if (chunk.content) {
          chunks.push(chunk.content);
        }
      }

      expect(chunks).toEqual(['Once ', 'upon ', 'a time']);
    });
  });
});
