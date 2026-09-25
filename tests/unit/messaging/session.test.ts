// tests/unit/messaging/session.test.ts
import { MessageStateMachine, MessageState, findOrResetSession } from '../../../src/messaging/session';

// ── MessageStateMachine ───────────────────────────────────────────────────────

describe('MessageStateMachine', () => {
  let machine: MessageStateMachine;

  beforeEach(() => {
    machine = new MessageStateMachine();
  });

  it('allows INITIATED → LANGUAGE_DETECTION', () => {
    const result = machine.transition(MessageState.INITIATED, MessageState.LANGUAGE_DETECTION);
    expect(result.success).toBe(true);
    expect(result.state).toBe(MessageState.LANGUAGE_DETECTION);
  });

  it('allows INITIATED → FAILED', () => {
    const result = machine.transition(MessageState.INITIATED, MessageState.FAILED);
    expect(result.success).toBe(true);
  });

  it('allows INITIATED → CONVERSATION (returning patients who already consented)', () => {
    // This transition is intentionally valid: returning patients with consentStatus === 'GRANTED'
    // skip LANGUAGE_DETECTION and CONSENT_CHECK and jump straight to CONVERSATION.
    const result = machine.transition(MessageState.INITIATED, MessageState.CONVERSATION);
    expect(result.success).toBe(true);
    expect(result.state).toBe(MessageState.CONVERSATION);
  });

  it('allows full happy path transitions', () => {
    const path = [
      [MessageState.INITIATED, MessageState.LANGUAGE_DETECTION],
      [MessageState.LANGUAGE_DETECTION, MessageState.CONSENT_CHECK],
      [MessageState.CONSENT_CHECK, MessageState.CONVERSATION],
      [MessageState.CONVERSATION, MessageState.ENDING],
      [MessageState.ENDING, MessageState.COMPLETED],
    ] as [MessageState, MessageState][];

    for (const [from, to] of path) {
      const result = machine.transition(from, to);
      expect(result.success).toBe(true);
    }
  });

  it('treats COMPLETED as a terminal state (no further transitions)', () => {
    expect(machine.isTerminalState(MessageState.COMPLETED)).toBe(true);
    expect(machine.isTerminalState(MessageState.FAILED)).toBe(true);
    expect(machine.isTerminalState(MessageState.CONVERSATION)).toBe(false);
  });

  it('does NOT include RINGING or CONNECTED (voice-only states)', () => {
    // These are CallState values — if they somehow appeared in MessageState that would be a bug
    const states = Object.values(MessageState);
    expect(states).not.toContain('RINGING');
    expect(states).not.toContain('CONNECTED');
  });
});

// ── findOrResetSession ────────────────────────────────────────────────────────

describe('findOrResetSession', () => {
  const fakeSession = {
    id: 'session-1',
    channel: 'whatsapp',
    senderId: '+919876543210',
    tenantId: 'tenant-1',
    patientId: '',
    state: MessageState.CONVERSATION,
    expiresAt: new Date(Date.now() + 60_000), // not expired
    closedAt: null,
    lastMessageAt: new Date(),
    transcript: [],
    clinicalEvents: [],
    locale: null,
    createdAt: new Date(),
  };

  const expiredSession = {
    ...fakeSession,
    expiresAt: new Date(Date.now() - 1000), // already expired
  };

  it('slides the expiry window for an active session', async () => {
    const mockPrisma = {
      messageSession: {
        findFirst: jest.fn().mockResolvedValue(fakeSession),
        update: jest.fn().mockResolvedValue({ ...fakeSession }),
        upsert: jest.fn(),
      },
    };

    await findOrResetSession(mockPrisma as any, 'whatsapp', '+919876543210', 'tenant-1');

    expect(mockPrisma.messageSession.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'session-1' } })
    );
    expect(mockPrisma.messageSession.upsert).not.toHaveBeenCalled();
  });

  it('upserts to reset when session is expired', async () => {
    const mockPrisma = {
      messageSession: {
        findFirst: jest.fn().mockResolvedValue(expiredSession),
        update: jest.fn(),
        upsert: jest.fn().mockResolvedValue({ ...expiredSession, state: MessageState.INITIATED }),
      },
    };

    await findOrResetSession(mockPrisma as any, 'whatsapp', '+919876543210', 'tenant-1');

    expect(mockPrisma.messageSession.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ state: MessageState.INITIATED }),
      })
    );
  });

  it('upserts to create when no session exists', async () => {
    const mockPrisma = {
      messageSession: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
        upsert: jest.fn().mockResolvedValue({ state: MessageState.INITIATED }),
      },
    };

    await findOrResetSession(mockPrisma as any, 'whatsapp', '+919876543210', 'tenant-1');

    expect(mockPrisma.messageSession.upsert).toHaveBeenCalled();
    expect(mockPrisma.messageSession.update).not.toHaveBeenCalled();
  });

  it('sets expiresAt to approximately 24 hours from now', async () => {
    const mockPrisma = {
      messageSession: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
        upsert: jest.fn().mockResolvedValue({ state: MessageState.INITIATED }),
      },
    };

    const before = Date.now();
    await findOrResetSession(mockPrisma as any, 'whatsapp', '+919876543210', 'tenant-1');
    const after = Date.now();

    const call = mockPrisma.messageSession.upsert.mock.calls[0][0];
    const expiresAt = call.create.expiresAt as Date;
    const expectedMin = before + 24 * 60 * 60 * 1000 - 1000;
    const expectedMax = after + 24 * 60 * 60 * 1000 + 1000;

    expect(expiresAt.getTime()).toBeGreaterThan(expectedMin);
    expect(expiresAt.getTime()).toBeLessThan(expectedMax);
  });

  it('resets flowState to null when creating a new session', async () => {
    const mockPrisma = {
      messageSession: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
        upsert: jest.fn().mockResolvedValue({
          id: 'new-session',
          state: 'INITIATED',
          flowState: null,
        }),
      },
    };

    await findOrResetSession(mockPrisma as any, 'whatsapp', '+91123', 'tenant-1');

    const upsertCall = (mockPrisma.messageSession.upsert as jest.Mock).mock.calls[0][0];
    expect(upsertCall.create.flowState).toBeNull();
    expect(upsertCall.update.flowState).toBeNull();
  });

  it('resets flowState to null when session is expired', async () => {
    const expiredSession = {
      id: 'old-session',
      state: 'CONVERSATION',
      expiresAt: new Date(Date.now() - 1000),
      flowState: { flow: 'set_health_condition', step: 'awaiting_phase' },
    };
    const mockPrisma = {
      messageSession: {
        findFirst: jest.fn().mockResolvedValue(expiredSession),
        update: jest.fn(),
        upsert: jest.fn().mockResolvedValue({ id: 'old-session' }),
      },
    };

    await findOrResetSession(mockPrisma as any, 'whatsapp', '+91123', 'tenant-1');

    const upsertCall = (mockPrisma.messageSession.upsert as jest.Mock).mock.calls[0][0];
    expect(upsertCall.update.flowState).toBeNull();
  });
});
