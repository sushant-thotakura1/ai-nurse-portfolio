import { findOrResetSession, MessageState } from '../session';

function makePrisma(existing: any) {
  const upserted: any[] = [];
  const updated: any[] = [];
  return {
    _upserted: upserted,
    _updated: updated,
    messageSession: {
      findFirst: jest.fn().mockResolvedValue(existing),
      upsert: jest.fn().mockImplementation((args: any) => {
        upserted.push(args);
        return Promise.resolve({ ...args.create, id: 'new-session-id' });
      }),
      update: jest.fn().mockImplementation((args: any) => {
        updated.push(args);
        return Promise.resolve({ id: existing?.id ?? 'session-id', ...args.data });
      }),
    },
  };
}

describe('findOrResetSession', () => {
  const channel = 'whatsapp';
  const senderId = '+919876543210';
  const tenantId = 'tenant-abc';

  it('creates a fresh session when no existing session is found', async () => {
    const prisma = makePrisma(null);
    const result = await findOrResetSession(prisma, channel, senderId, tenantId);
    expect(prisma.messageSession.upsert).toHaveBeenCalledTimes(1);
    expect(result.state).toBe(MessageState.INITIATED);
  });

  it('resets an expired session (expiresAt in the past)', async () => {
    const expired = {
      id: 'old-id',
      channel,
      senderId,
      tenantId,
      expiresAt: new Date(Date.now() - 1000),
      closedAt: null,
      state: MessageState.CONVERSATION,
    };
    const prisma = makePrisma(expired);
    await findOrResetSession(prisma, channel, senderId, tenantId);
    expect(prisma.messageSession.upsert).toHaveBeenCalledTimes(1);
    // closedAt must be explicitly cleared
    expect(prisma._upserted[0].create.closedAt).toBeNull();
    expect(prisma._upserted[0].update.closedAt).toBeNull();
  });

  it('resets a reaped session (closedAt is non-null, even if not expired)', async () => {
    const reaped = {
      id: 'reaped-id',
      channel,
      senderId,
      tenantId,
      expiresAt: new Date(Date.now() + 60_000), // still within 24h window
      closedAt: new Date(Date.now() - 5_000),   // but was reaped 5 seconds ago
      state: MessageState.CONVERSATION,
    };
    const prisma = makePrisma(reaped);
    await findOrResetSession(prisma, channel, senderId, tenantId);
    // Must upsert (reset), not update (slide window)
    expect(prisma.messageSession.upsert).toHaveBeenCalledTimes(1);
    expect(prisma._upserted[0].create.closedAt).toBeNull();
    expect(prisma._upserted[0].update.closedAt).toBeNull();
  });

  it('slides the window for an active, open session', async () => {
    const active = {
      id: 'active-id',
      channel,
      senderId,
      tenantId,
      expiresAt: new Date(Date.now() + 60_000),
      closedAt: null,
      state: MessageState.CONVERSATION,
    };
    const prisma = makePrisma(active);
    await findOrResetSession(prisma, channel, senderId, tenantId);
    expect(prisma.messageSession.update).toHaveBeenCalledTimes(1);
    expect(prisma.messageSession.upsert).not.toHaveBeenCalled();
  });
});
