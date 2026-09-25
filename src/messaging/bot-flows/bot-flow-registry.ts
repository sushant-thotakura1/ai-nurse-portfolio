import { BotFlow } from './bot-flow.interface';
import { MessagingProvider, InboundMessage } from '../interfaces';
import { LLMProvider } from '../../ai-agent/interfaces';

// Patients naturally punctuate short commands ("End session.", "bye!",
// "Stop."). Trigger phrases are authored without trailing punctuation, so an
// exact match on the raw trimmed/lowercased text silently misses these --
// the message falls through to the general LLM chat path instead of the
// intended flow (e.g. EndCallFlow), leaving the session open. Stripping
// trailing punctuation before matching is safe: trigger phrases themselves
// never contain it, so this only widens what already-intended phrases match.
const TRAILING_PUNCTUATION = /[.!?,;:]+$/;

function normalizeTriggerText(message: string): string {
  return message.trim().toLowerCase().replace(TRAILING_PUNCTUATION, '');
}

export class BotFlowRegistry {
  private readonly flows: BotFlow[] = [];

  register(flow: BotFlow): void {
    this.flows.push(flow);
  }

  shouldHandle(session: any, message: string): boolean {
    const text = normalizeTriggerText(message);
    return this.flows.some(
      s => s.isActive(session) || s.triggerPhrases.includes(text)
    );
  }

  async handle(
    session: any,
    inbound: InboundMessage,
    patient: any,
    tenantId: string,
    prisma: any,
    adapter: MessagingProvider,
    llm: LLMProvider,
  ): Promise<void> {
    const text = normalizeTriggerText(inbound.text);
    const flow = this.flows.find(
      s => s.isActive(session) || s.triggerPhrases.includes(text)
    );
    if (flow) {
      await flow.handle(session, inbound.text, patient, tenantId, prisma, adapter, llm);
    }
  }
}
