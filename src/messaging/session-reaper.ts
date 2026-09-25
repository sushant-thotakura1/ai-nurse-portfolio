import { logger } from '../core/logger';
import { LLMProvider } from '../ai-agent/interfaces';
import { SessionClosingService } from './session-closing.service';
import { createAdapter } from './adapter-factory';

const POLL_INTERVAL_MS        = 5 * 60 * 1000;  // 5 minutes
const DEFAULT_TIMEOUT_MINUTES = 30;

export class SessionReaper {
  private timer: ReturnType<typeof setInterval> | null = null;
  private llm: LLMProvider | null = null;

  constructor(private readonly sessionClosingService: SessionClosingService) {}

  start(prisma: any, llm?: LLMProvider): void {
    if (this.timer) return;
    this.llm = llm ?? null;
    logger.info('SessionReaper started', { pollIntervalMs: POLL_INTERVAL_MS });
    this.timer = setInterval(() => {
      this.reap(prisma).catch((err: any) =>
        logger.error('SessionReaper tick error', { error: err?.message }),
      );
    }, POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info('SessionReaper stopped');
    }
  }

  // Non-private so tests can call directly
  async reap(prisma: any): Promise<void> {
    const tenants: any[] = await prisma.tenant.findMany({ select: { id: true, settings: true } });

    for (const tenant of tenants) {
      const timeoutMinutes: number =
        (tenant.settings as any)?.whatsappSessionTimeoutMinutes ?? DEFAULT_TIMEOUT_MINUTES;
      const cutoff = new Date(Date.now() - timeoutMinutes * 60 * 1000);

      const sessions: any[] = await prisma.messageSession.findMany({
        where: {
          tenantId:      tenant.id,
          channel:       'whatsapp',
          closedAt:      null,
          lastMessageAt: { lt: cutoff },
        },
      });

      let reaped = 0;
      for (const session of sessions) {
        try {
          await this.closeSession(session, prisma);
          reaped++;
        } catch (err: any) {
          logger.error('SessionReaper: failed to close session', {
            sessionId: session.id,
            tenantId:  session.tenantId,
            error:     err?.message,
          });
        }
      }

      if (reaped > 0) {
        logger.info('SessionReaper: reaped sessions', { tenantId: tenant.id, reaped });
      }
    }
  }

  private async closeSession(session: any, prisma: any): Promise<void> {
    const result = await this.sessionClosingService.close(session, prisma, this.llm);
    if (!result) return;

    try {
      const adapter = await createAdapter(session.tenantId, 'whatsapp', prisma);
      if (adapter) {
        const wamid = await adapter.sendMessage({
          channel:     'whatsapp',
          recipientId: session.senderId,
          content:     [{ type: 'text', text: result.summaryText }],
        });
        logger.info('SessionReaper: summary sent', { sessionId: session.id });

        if (wamid) {
          try {
            await this.sessionClosingService.storeSummaryWamid(result.callSessionId, wamid, prisma);
          } catch (err: any) {
            logger.warn('SessionReaper: failed to store summary wamid', {
              sessionId: session.id,
              error: err?.message,
            });
          }
        }
      } else {
        logger.warn('SessionReaper: no WhatsApp adapter, summary not sent', {
          sessionId: session.id,
          tenantId:  session.tenantId,
        });
      }
    } catch (err: any) {
      logger.warn('SessionReaper: failed to send summary', {
        sessionId: session.id,
        error:     err?.message,
      });
    }
  }
}
