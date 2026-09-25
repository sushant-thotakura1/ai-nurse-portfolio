import { BotFlow, BotFlowResult } from './bot-flow.interface';
import { MessagingProvider } from '../interfaces';
import { LLMProvider } from '../../ai-agent/interfaces';
import { SessionClosingService } from '../session-closing.service';
import { logger } from '../../core/logger';

export class EndCallFlow implements BotFlow {
  readonly name = 'end_call';
  readonly triggerPhrases = [
    'end call', 'end session',
    'bye', 'goodbye', 'good bye',
    'stop', 'done',
  ];

  constructor(private readonly sessionClosingService: SessionClosingService) {}

  /** Single-shot flow — no intermediate state machine. */
  isActive(_session: any): boolean {
    return false;
  }

  async handle(
    session:   any,
    _message:  string,
    _patient:  any,
    _tenantId: string,
    prisma:    any,
    adapter:   MessagingProvider,
    llm:       LLMProvider,
  ): Promise<BotFlowResult> {
    // Acknowledge immediately so the patient knows the request is being
    // processed. A failed send here must not block closing the session --
    // proven to happen (the same channel token that 401'd on an earlier
    // live-tested conversation) and would otherwise silently leave the
    // patient's "end session" request unfulfilled with no error visible
    // anywhere but a generic top-level log line.
    try {
      await adapter.sendMessage({
        channel:     session.channel,
        recipientId: session.senderId,
        content:     [{ type: 'text', text: 'Ending session, please wait…' }],
      });
    } catch (err: unknown) {
      logger.warn('EndCallFlow: failed to send acknowledgment; closing anyway', {
        sessionId: session.id, error: err instanceof Error ? err.message : String(err),
      });
    }

    const result = await this.sessionClosingService.close(session, prisma, llm);

    if (!result) {
      // Race condition — another process already closed this session
      try {
        await adapter.sendMessage({
          channel:     session.channel,
          recipientId: session.senderId,
          content:     [{ type: 'text', text: 'This session has already been closed.' }],
        });
      } catch (err: unknown) {
        logger.warn('EndCallFlow: failed to send already-closed notice', {
          sessionId: session.id, error: err instanceof Error ? err.message : String(err),
        });
      }
      return { handled: true, done: true };
    }

    // Send the full clinical summary back to the patient. The assessment is
    // already computed and persisted by this point (this send is best-effort
    // delivery on top of it) -- a failure here must not look like the close
    // silently did nothing.
    let wamid: string | null = null;
    try {
      wamid = await adapter.sendMessage({
        channel:     session.channel,
        recipientId: session.senderId,
        content:     [{ type: 'text', text: result.summaryText }],
      });
    } catch (err: unknown) {
      logger.warn('EndCallFlow: failed to send summary; assessment already persisted', {
        sessionId: session.id, callSessionId: result.callSessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    if (wamid) {
      try {
        await this.sessionClosingService.storeSummaryWamid(result.callSessionId, wamid, prisma);
      } catch (err: any) {
        logger.warn('EndCallFlow: failed to store summary wamid', {
          sessionId: session.id,
          error: err?.message,
        });
      }
    }

    return { handled: true, done: true };
  }
}
