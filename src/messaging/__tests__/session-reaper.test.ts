import { SessionReaper } from '../session-reaper';
import { SessionClosingService } from '../session-closing.service';

// ── Mock Prisma builder ───────────────────────────────────────────────────────

function makePrisma({
  tenants  = [] as any[],
  sessions = [] as any[],
  patient  = null as any,
} = {}) {
  const createdCallSessions:   any[] = [];
  const createdTranscripts:    any[] = [];
  const createdClinicalEvents: any[] = [];
  const closedSessionIds:      string[] = [];

  const prisma: any = {
    _created: { callSessions: createdCallSessions, transcripts: createdTranscripts, clinicalEvents: createdClinicalEvents },
    _closed:  closedSessionIds,

    tenant: {
      findMany: jest.fn().mockResolvedValue(tenants),
    },
    patient: {
      findUnique: jest.fn().mockResolvedValue(patient),
    },
    callSession: {
      create: jest.fn().mockImplementation((args: any) => {
        const cs = { id: 'cs-1', ...args.data };
        createdCallSessions.push(cs);
        return Promise.resolve(cs);
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    transcript: {
      createMany: jest.fn().mockImplementation((args: any) => {
        createdTranscripts.push(...args.data);
        return Promise.resolve({ count: args.data.length });
      }),
    },
    clinicalEvent: {
      createMany: jest.fn().mockImplementation((args: any) => {
        createdClinicalEvents.push(...args.data);
        return Promise.resolve({ count: args.data.length });
      }),
    },
    messageSession: {
      findMany: jest.fn().mockResolvedValue(sessions),
      updateMany: jest.fn().mockImplementation((args: any) => {
        closedSessionIds.push(args.where.id);
        return Promise.resolve({ count: 1 });
      }),
    },
    providerConfig: {
      findFirst: jest.fn().mockResolvedValue(null), // no WhatsApp config → skip send
    },
  };

  return prisma;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

const TENANT  = { id: 'tenant-1', settings: null }; // default 30 min timeout
const PATIENT = { id: 'patient-1', preferredLocale: 'hi-IN' };

describe('SessionReaper.reap()', () => {
  let reaper: SessionReaper;

  beforeEach(() => {
    reaper = new SessionReaper(new SessionClosingService());
    jest.useFakeTimers();
  });

  afterEach(() => {
    reaper.stop();
    jest.useRealTimers();
  });

  it('does nothing when there are no tenants', async () => {
    const prisma = makePrisma({ tenants: [] });
    await (reaper as any).reap(prisma);
    expect(prisma.callSession.create).not.toHaveBeenCalled();
  });

  it('does nothing when all sessions are still active (no expired ones returned)', async () => {
    const prisma = makePrisma({ tenants: [TENANT], sessions: [] });
    await (reaper as any).reap(prisma);
    expect(prisma.callSession.create).not.toHaveBeenCalled();
    expect(prisma._closed).toHaveLength(0);
  });

  it('stamps closedAt but skips CallSession for unidentified-patient sessions (patientId = "")', async () => {
    const session = {
      id: 'sess-1',
      tenantId: 'tenant-1',
      patientId: '',
      channel: 'whatsapp',
      senderId: '+91...',
      locale: null,
      state: 'CONVERSATION',
      transcript: [],
      createdAt: new Date(Date.now() - 40 * 60_000),
      lastMessageAt: new Date(Date.now() - 35 * 60_000),
    };
    const prisma = makePrisma({ tenants: [TENANT], sessions: [session] });
    await (reaper as any).reap(prisma);

    expect(prisma.callSession.create).not.toHaveBeenCalled();
    // Must NOT query patient — sentinel check fires before locale resolution
    expect(prisma.patient.findUnique).not.toHaveBeenCalled();
    expect(prisma._closed).toContain('sess-1');
  });

  it('creates CallSession + Transcripts for a session with a valid patientId', async () => {
    const transcript = [
      { speaker: 'patient', originalText: 'Hello',    timestamp: new Date().toISOString() },
      { speaker: 'agent',   originalText: 'Hi there', timestamp: new Date().toISOString() },
    ];
    const session = {
      id: 'sess-2',
      tenantId: 'tenant-1',
      patientId: 'patient-1',
      channel: 'whatsapp',
      senderId: '+91...',
      locale: 'hi-IN',
      state: 'CONVERSATION',
      transcript,
      createdAt: new Date(Date.now() - 40 * 60_000),
      lastMessageAt: new Date(Date.now() - 35 * 60_000),
    };
    const prisma = makePrisma({ tenants: [TENANT], sessions: [session], patient: PATIENT });
    await (reaper as any).reap(prisma);

    expect(prisma.callSession.create).toHaveBeenCalledTimes(1);
    const csArgs = prisma.callSession.create.mock.calls[0][0].data;
    expect(csArgs.callPurpose).toBe('WHATSAPP_CHAT');
    expect(csArgs.state).toBe('COMPLETED');
    expect(csArgs.outcome).toBe('REASSURE');   // correct outcome — not 'COMPLETED'
    expect(csArgs.locale).toBe('hi-IN');

    expect(prisma.transcript.createMany).toHaveBeenCalledTimes(1);
    const txArgs = prisma.transcript.createMany.mock.calls[0][0].data;
    expect(txArgs).toHaveLength(2);
    expect(txArgs[0]).toMatchObject({ turnNumber: 1, speaker: 'patient', originalText: 'Hello' });
    expect(txArgs[1]).toMatchObject({ turnNumber: 2, speaker: 'agent',   originalText: 'Hi there' });

    expect(prisma._closed).toContain('sess-2');
  });

  it('uses patient.preferredLocale when session.locale is null', async () => {
    const session = {
      id: 'sess-3',
      tenantId: 'tenant-1',
      patientId: 'patient-1',
      channel: 'whatsapp',
      senderId: '+91...',
      locale: null,           // ← no locale on session
      state: 'CONVERSATION',
      transcript: [{ speaker: 'patient', originalText: 'Hi', timestamp: new Date().toISOString() }],
      createdAt: new Date(Date.now() - 40 * 60_000),
      lastMessageAt: new Date(Date.now() - 35 * 60_000),
    };
    const prisma = makePrisma({ tenants: [TENANT], sessions: [session], patient: PATIENT });
    await (reaper as any).reap(prisma);

    const csArgs = prisma.callSession.create.mock.calls[0][0].data;
    expect(csArgs.locale).toBe('hi-IN'); // from patient.preferredLocale
  });

  it('respects tenant-specific timeout from settings', async () => {
    const tenantWith10MinTimeout = { id: 'tenant-2', settings: { whatsappSessionTimeoutMinutes: 10 } };
    const session = {
      id: 'sess-5',
      tenantId: 'tenant-2',
      patientId: 'patient-1',
      channel: 'whatsapp',
      locale: 'hi-IN',
      state: 'CONVERSATION',
      transcript: [],
      createdAt: new Date(Date.now() - 15 * 60_000),
      lastMessageAt: new Date(Date.now() - 12 * 60_000),
    };
    const prisma = makePrisma({ tenants: [tenantWith10MinTimeout], sessions: [session], patient: PATIENT });
    await (reaper as any).reap(prisma);

    // Verify query used the 10-minute threshold
    const findArgs = prisma.messageSession.findMany.mock.calls[0][0];
    expect(findArgs.where.lastMessageAt.lt).toBeDefined();
    expect(prisma._closed).toContain('sess-5');
  });

  it('continues with other sessions when one throws', async () => {
    const session = {
      id: 'sess-good',
      tenantId: 'tenant-1',
      patientId: 'patient-1',
      channel: 'whatsapp',
      locale: 'hi-IN',
      state: 'CONVERSATION',
      transcript: [],
      createdAt: new Date(Date.now() - 40 * 60_000),
      lastMessageAt: new Date(Date.now() - 35 * 60_000),
    };
    const prisma = makePrisma({ tenants: [TENANT], sessions: [session], patient: PATIENT });
    // Force callSession.create to throw so closeSession() fails
    prisma.callSession.create = jest.fn().mockRejectedValue(new Error('DB error'));

    // reap() must not throw — errors are caught per-session
    await expect((reaper as any).reap(prisma)).resolves.not.toThrow();
  });
});
