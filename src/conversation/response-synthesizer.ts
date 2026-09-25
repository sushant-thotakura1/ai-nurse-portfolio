import { LLMProvider, ChatMessage } from '../ai-agent/interfaces';
import { ContextFragment, SessionContext } from './conversation-skill';
import { logger } from '../core/logger';

const FALLBACK_SYSTEM_PROMPT = 'You are a clinical AI nurse. Respond helpfully and warmly to the patient.';

export class ResponseSynthesizer {
  async synthesize(
    fragments: ContextFragment[],
    context: SessionContext,
    transcriptHistory: ChatMessage[],
    currentMessage: string,
    llm: LLMProvider,
  ): Promise<string> {
    const active = fragments
      .filter(f => !f.isEmpty)
      .sort((a, b) => b.priority - a.priority);

    const systemPrompt = active.length > 0
      ? active.map(f => f.content).join('\n\n---\n\n')
      : FALLBACK_SYSTEM_PROMPT;

    logger.info('ResponseSynthesizer: merging fragments', {
      activeSkills: active.map(f => f.skillName),
      systemPromptLength: systemPrompt.length,
    });

    // When the patient quote-replied to a specific question, tell the model
    // which question this answer addresses instead of letting it assume the
    // answer belongs to the most recent question (#141).
    const userContent = context.replyingToQuestion
      ? `[Replying to your question: "${context.replyingToQuestion}"]\n\n${currentMessage}`
      : currentMessage;

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...transcriptHistory,
      { role: 'user', content: userContent },
    ];

    const response = await llm.complete(messages, { temperature: 0.7, maxTokens: 600 });
    return response.content;
  }
}
