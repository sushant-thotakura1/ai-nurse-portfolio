import { ClinicalContext } from '../../knowledge-graph/context-loader';
import { LLMProvider, ChatMessage } from '../interfaces';

/**
 * Generate a single nurse turn response using the KG clinical system prompt.
 * Single implementation shared by all channels (WhatsApp, voice) and eval generation
 * so the prompt, temperature, and token budget are identical across every path.
 *
 * @param ctx      Already-loaded clinical context — caller is responsible for loading it
 *                 (avoids a redundant DB round-trip when the caller already has it).
 * @param history  Conversation messages WITHOUT the system prompt (transcript + current
 *                 patient message). This function prepends ctx.systemPrompt.
 * @param llm      LLM provider to use.
 */
export async function generateTurnResponse(
  ctx: ClinicalContext,
  history: ChatMessage[],
  llm: LLMProvider,
): Promise<string> {
  const messages: ChatMessage[] = [
    { role: 'system', content: ctx.systemPrompt },
    ...history,
  ];
  const response = await llm.complete(messages, { temperature: 0.7, maxTokens: 600 });
  return response.content;
}
