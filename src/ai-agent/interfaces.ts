export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stopSequences?: string[];
  timeoutMs?: number;
}

/**
 * Thrown by an LLMProvider on failure. Carries enough of the underlying
 * HTTP failure (status, Retry-After) for a caller to implement a retry
 * policy -- without every caller needing to know the specific provider SDK.
 * Extends Error, so existing `catch (e) { e.message }` callers are unaffected.
 */
export class LLMProviderError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly retryAfterSeconds?: number,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'LLMProviderError';
  }
}

export interface LLMResponse {
  content: string;
  finishReason: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface LLMChunk {
  content: string;
  isComplete: boolean;
}

export interface LLMProvider {
  /**
   * Complete a chat conversation
   */
  complete(
    messages: ChatMessage[],
    options?: LLMOptions
  ): Promise<LLMResponse>;

  /**
   * Stream a chat conversation response
   */
  stream(
    messages: ChatMessage[],
    options?: LLMOptions
  ): AsyncIterable<LLMChunk>;
}

export interface ClinicalEvent {
  type: 'SYMPTOM_CHECK' | 'MED_ADHERENCE' | 'RISK_ASSESSMENT' | 'ESCALATION';
  data: Record<string, any>;
  riskScore?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  timestamp: Date;
}
