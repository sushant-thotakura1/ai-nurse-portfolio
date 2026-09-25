import { logger } from '../core/logger';

export enum MessageState {
  INITIATED          = 'INITIATED',
  LANGUAGE_DETECTION = 'LANGUAGE_DETECTION',
  CONSENT_CHECK      = 'CONSENT_CHECK',
  CONVERSATION       = 'CONVERSATION',
  ESCALATING         = 'ESCALATING',
  ENDING             = 'ENDING',
  COMPLETED          = 'COMPLETED',
  FAILED             = 'FAILED',
}

interface TransitionResult {
  success: boolean;
  state: MessageState;
  error?: string;
}

export class MessageStateMachine {
  private readonly transitions: Map<MessageState, MessageState[]> = new Map([
    [MessageState.INITIATED,          [MessageState.LANGUAGE_DETECTION, MessageState.CONVERSATION, MessageState.FAILED]],
    [MessageState.LANGUAGE_DETECTION, [MessageState.CONSENT_CHECK, MessageState.ENDING, MessageState.FAILED]],
    [MessageState.CONSENT_CHECK,      [MessageState.CONVERSATION, MessageState.ENDING, MessageState.FAILED]],
    [MessageState.CONVERSATION,       [MessageState.CONVERSATION, MessageState.ESCALATING, MessageState.ENDING, MessageState.FAILED]],
    [MessageState.ESCALATING,         [MessageState.ENDING, MessageState.FAILED]],
    [MessageState.ENDING,             [MessageState.COMPLETED, MessageState.FAILED]],
    [MessageState.COMPLETED,          []],
    [MessageState.FAILED,             []],
  ]);

  transition(from: MessageState, to: MessageState): TransitionResult {
    if (!this.canTransition(from, to)) {
      logger.error('Invalid messaging state transition', { from, to });
      return { success: false, state: from, error: `Invalid state transition from ${from} to ${to}` };
    }
    logger.info('Messaging state transition', { from, to });
    return { success: true, state: to };
  }

  canTransition(from: MessageState, to: MessageState): boolean {
    return (this.transitions.get(from) ?? []).includes(to);
  }

  isTerminalState(state: MessageState): boolean {
    const next = this.transitions.get(state);
    return !next || next.length === 0;
  }

  getValidNextStates(state: MessageState): MessageState[] {
    return this.transitions.get(state) ?? [];
  }
}

// ── Session upsert helper ─────────────────────────────────────────────────────

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Find an active session or upsert a fresh one.
 * prisma is passed explicitly so this function can be tested with a mock.
 *
 * Note: upsert is not intercepted by prisma-tenant-middleware.ts (only findFirst/update/etc
 * are). tenantId is supplied explicitly in both create and where clauses here to ensure
 * data isolation without middleware support.
 *
 * TODO: Replace `any` with `Pick<PrismaClient, 'messageSession'>` after Task 4 adds
 * the MessageSession model to the Prisma schema.
 */
export async function findOrResetSession(
  prisma: any,
  channel: string,
  senderId: string,
  tenantId: string,
): Promise<any> {
  const existing = await prisma.messageSession.findFirst({
    where: { channel, senderId, tenantId },
  });

  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);

  if (!existing || existing.expiresAt < now || existing.closedAt !== null) {
    // Delete the stale/closed record first so the CREATE below gets a fresh
    // UUID. The upsert approach kept the same id on every reset because Prisma
    // took the update path — meaning all conversations for the same patient
    // forever shared one MessageSession.id.
    // MessageSession has no FK references from other tables (transcript and
    // clinicalEvents are JSON fields), so the delete is safe.
    if (existing) {
      await prisma.messageSession.delete({ where: { id: existing.id } }).catch(() => {
        // Another concurrent request already deleted it — safe to ignore
      });
    }

    return prisma.messageSession.create({
      data: {
        channel,
        senderId,
        tenantId,
        patientId: '',            // set by orchestrator after patient lookup
        state: MessageState.INITIATED,
        locale: null,
        transcript: [],
        clinicalEvents: [],
        flowState: null,
        lastMessageAt: now,
        expiresAt,
        closedAt: null,
      },
    }).catch(async () => {
      // Race condition: another request created the session between our delete
      // and create. Find and return what they created.
      return prisma.messageSession.findFirst({ where: { channel, senderId, tenantId } });
    });
  }

  // Active session — slide the 24h window
  return prisma.messageSession.update({
    where: { id: existing.id },
    data: { lastMessageAt: now, expiresAt },
  });
}
