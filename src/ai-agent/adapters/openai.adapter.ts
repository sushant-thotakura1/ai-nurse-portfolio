import OpenAI, { APIError } from 'openai';
import {
  LLMProvider,
  ChatMessage,
  LLMOptions,
  LLMResponse,
  LLMChunk,
  LLMProviderError,
} from '../interfaces';
import { logger } from '../../core/logger';

/** Parses a Retry-After header's integer-seconds form. HTTP-date form is not handled. */
function parseRetryAfterSeconds(headers: Headers | undefined): number | undefined {
  const raw = headers?.get('retry-after');
  if (!raw) return undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) ? seconds : undefined;
}

interface OpenAIConfig {
  apiKey: string;
  baseURL?: string;
}

export class OpenAIAdapter implements LLMProvider {
  private client: OpenAI;
  private config: OpenAIConfig;

  constructor(config: OpenAIConfig) {
    this.config = config;
    this.client = new OpenAI({
      apiKey: config.apiKey,
      ...(config.baseURL && { baseURL: config.baseURL }),
    });
  }

  async complete(
    messages: ChatMessage[],
    options?: LLMOptions
  ): Promise<LLMResponse> {
    try {
      logger.info('Requesting OpenAI completion', {
        messageCount: messages.length,
        model: options?.model || 'gpt-4o-mini',
      });

      const body = {
        model: options?.model || 'gpt-4o-mini',
        messages: messages.map((msg) => ({
          role: msg.role,
          content: msg.content,
        })),
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens,
        stop: options?.stopSequences,
      };
      const response = options?.timeoutMs !== undefined
        ? await this.client.chat.completions.create(body, { timeout: options.timeoutMs })
        : await this.client.chat.completions.create(body);

      const choice = response.choices[0];
      const content = choice.message.content || '';

      const result: LLMResponse = {
        content,
        finishReason: choice.finish_reason || 'unknown',
        usage: {
          promptTokens: response.usage?.prompt_tokens || 0,
          completionTokens: response.usage?.completion_tokens || 0,
          totalTokens: response.usage?.total_tokens || 0,
        },
      };

      logger.info('OpenAI completion successful', {
        finishReason: result.finishReason,
        totalTokens: result.usage.totalTokens,
      });

      return result;
    } catch (error: any) {
      logger.error('OpenAI completion failed', {
        error: error.message,
      });
      const status = error instanceof APIError ? error.status : undefined;
      const retryAfterSeconds = error instanceof APIError
        ? parseRetryAfterSeconds(error.headers)
        : undefined;
      throw new LLMProviderError(
        `OpenAI completion failed: ${error.message}`,
        status,
        retryAfterSeconds,
        { cause: error },
      );
    }
  }

  async *stream(
    messages: ChatMessage[],
    options?: LLMOptions
  ): AsyncIterable<LLMChunk> {
    try {
      logger.info('Requesting OpenAI streaming completion', {
        messageCount: messages.length,
        model: options?.model || 'gpt-4o-mini',
      });

      const stream = await this.client.chat.completions.create({
        model: options?.model || 'gpt-4o-mini',
        messages: messages.map((msg) => ({
          role: msg.role,
          content: msg.content,
        })),
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens,
        stop: options?.stopSequences,
        stream: true,
      });

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        const finishReason = chunk.choices[0]?.finish_reason;

        if (delta?.content) {
          yield {
            content: delta.content,
            isComplete: false,
          };
        }

        if (finishReason) {
          yield {
            content: '',
            isComplete: true,
          };
          logger.info('OpenAI streaming completed', {
            finishReason,
          });
        }
      }
    } catch (error: any) {
      logger.error('OpenAI streaming failed', {
        error: error.message,
      });
      throw new Error(`OpenAI streaming failed: ${error.message}`);
    }
  }
}
