import { MessagingProvider, InboundMessage } from '../interfaces';
import { LLMProvider } from '../../ai-agent/interfaces';

export interface BotFlowResult {
  handled: boolean;   // true = orchestrator should return early
  done: boolean;      // true = flow completed, clear flowState
}

export interface BotFlow {
  readonly name: string;
  readonly triggerPhrases: string[];   // matched case-insensitively after trim + trailing-punctuation stripped
  isActive(session: any): boolean;
  handle(
    session: any,
    message: string,
    patient: any,
    tenantId: string,
    prisma: any,
    adapter: MessagingProvider,
    llm: LLMProvider,
  ): Promise<BotFlowResult>;
}
