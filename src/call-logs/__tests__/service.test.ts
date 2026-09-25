import { PrismaClient } from '@prisma/client';

const mockPrisma = {
  callSession: { findMany: jest.fn() },
  assessment: { findMany: jest.fn() },
  patientFact: { findMany: jest.fn() },
  knowledgeGraph: { findMany: jest.fn() },
} as unknown as PrismaClient;

jest.mock('../../core/database', () => ({ prisma: mockPrisma }));
jest.mock('../../core/encryption', () => ({
  decrypt: jest.fn((v: string) => v.replace(/^enc:/, '')),
}));

const mockGetTranscript = jest.fn();
jest.mock('../../conversations/service', () => ({
  conversationsService: { getTranscript: (...args: unknown[]) => mockGetTranscript(...args) },
}));

import { CallLogsService } from '../service';

describe('CallLogsService.getExportBundle', () => {
  let service: CallLogsService;

  const session1 = {
    id: 'session-1',
    tenantId: 'tenant-1',
    messageSessionId: 'msg-1',
    knowledgeGraphId: 'kg-1',
    callPurpose: 'WHATSAPP_CHAT',
    outcome: 'ESCALATE',
    startedAt: new Date('2026-08-01'),
    patient: { phoneNumber: '+911234567890', encryptedName: 'enc:Patient One', condition: 'Heart Failure', classification: 'HFrEF', conditionStartDate: null },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CallLogsService();
    (mockPrisma.callSession.findMany as jest.Mock).mockResolvedValue([session1]);
    (mockPrisma.assessment.findMany as jest.Mock).mockResolvedValue([]);
    (mockPrisma.patientFact.findMany as jest.Mock).mockResolvedValue([]);
    (mockPrisma.knowledgeGraph.findMany as jest.Mock).mockResolvedValue([{ id: 'kg-1', version: 'v3.1', status: 'ACTIVE' }]);
    mockGetTranscript.mockResolvedValue({ formattedTranscript: '[transcript]' });
  });

  it('includes assessments with nested flags for the matched session', async () => {
    (mockPrisma.assessment.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'a1', sessionId: 'session-1', outcome: 'ESCALATE', patientAction: 'ER_NOW',
        escalationType: 'CLINICAL_RED_FLAG', deterministic: true, createdAt: new Date(),
        flags: [{ id: 'f1', redFlagId: 'RF_1', decidedBy: 'rule', fired: true, evidence: null, rulesTried: [], createdAt: new Date() }],
      },
    ]);

    const [row] = await service.getExportBundle({ condition: 'Heart Failure' });

    expect(row.assessments).toHaveLength(1);
    expect(row.assessments[0].flags).toHaveLength(1);
    expect(row.assessments[0].flags[0].redFlagId).toBe('RF_1');
  });

  it('scopes patientFacts to sourceSessionId matching the exported session only', async () => {
    (mockPrisma.patientFact.findMany as jest.Mock).mockResolvedValue([
      { id: 'pf1', factId: 'weight', valueNumber: 80, valueBoolean: null, valueString: null, sourceSessionId: 'session-1', extractionClass: 'DIRECT', observedAt: new Date(), timeUncertaintyHours: 0, recordedAt: new Date(), confidence: null },
    ]);

    const [row] = await service.getExportBundle({ condition: 'Heart Failure' });

    expect(row.patientFacts).toHaveLength(1);
    expect(row.patientFacts[0].factId).toBe('weight');
    // Assert the query itself was scoped by sourceSessionId, not patientId --
    // this is the whole point of the session-scoped-only decision.
    expect(mockPrisma.patientFact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 'tenant-1', sourceSessionId: { in: ['session-1'] } } }),
    );
  });

  it('does not bleed one session\'s assessments/facts/transcript into another session\'s row', async () => {
    const session2 = { ...session1, id: 'session-2', messageSessionId: 'msg-2' };
    (mockPrisma.callSession.findMany as jest.Mock).mockResolvedValue([session1, session2]);
    (mockPrisma.assessment.findMany as jest.Mock).mockResolvedValue([
      { id: 'a1', sessionId: 'session-1', outcome: 'ESCALATE', patientAction: null, escalationType: null, deterministic: true, createdAt: new Date(), flags: [] },
      { id: 'a2', sessionId: 'session-2', outcome: 'REASSURE', patientAction: null, escalationType: null, deterministic: true, createdAt: new Date(), flags: [] },
    ]);
    (mockPrisma.patientFact.findMany as jest.Mock).mockResolvedValue([
      { id: 'pf1', factId: 'weight', valueNumber: 80, valueBoolean: null, valueString: null, sourceSessionId: 'session-1', extractionClass: 'DIRECT', observedAt: new Date(), timeUncertaintyHours: 0, recordedAt: new Date(), confidence: null },
      { id: 'pf2', factId: 'edema', valueNumber: null, valueBoolean: true, valueString: null, sourceSessionId: 'session-2', extractionClass: 'DIRECT', observedAt: new Date(), timeUncertaintyHours: 0, recordedAt: new Date(), confidence: null },
    ]);
    mockGetTranscript.mockImplementation((_tenantId: string, sessionOrMsgId: string) =>
      Promise.resolve({ formattedTranscript: `[transcript for ${sessionOrMsgId}]` }),
    );

    const rows = await service.getExportBundle({ condition: 'Heart Failure' });

    expect(rows).toHaveLength(2);
    const row1 = rows.find((r: any) => r.id === 'session-1')!;
    const row2 = rows.find((r: any) => r.id === 'session-2')!;

    expect(row1.assessments).toHaveLength(1);
    expect(row1.assessments[0].id).toBe('a1');
    expect(row1.patientFacts).toHaveLength(1);
    expect(row1.patientFacts[0].factId).toBe('weight');

    expect(row2.assessments).toHaveLength(1);
    expect(row2.assessments[0].id).toBe('a2');
    expect(row2.patientFacts).toHaveLength(1);
    expect(row2.patientFacts[0].factId).toBe('edema');
  });

  it('resolves knowledgeGraph version/status when knowledgeGraphId is present', async () => {
    const [row] = await service.getExportBundle({ condition: 'Heart Failure' });
    expect(row.knowledgeGraph).toEqual({ version: 'v3.1', status: 'ACTIVE' });
  });

  it('returns knowledgeGraph: null when knowledgeGraphId is absent, without guessing', async () => {
    (mockPrisma.callSession.findMany as jest.Mock).mockResolvedValue([{ ...session1, knowledgeGraphId: null }]);

    const [row] = await service.getExportBundle({ condition: 'Heart Failure' });
    expect(row.knowledgeGraph).toBeNull();
  });

  it('fetches the transcript using messageSessionId, not the bare CallSession id', async () => {
    await service.getExportBundle({ condition: 'Heart Failure' });
    expect(mockGetTranscript).toHaveBeenCalledWith('tenant-1', 'msg-1');
  });

  it('falls back to the bare CallSession id when messageSessionId is null', async () => {
    (mockPrisma.callSession.findMany as jest.Mock).mockResolvedValue([{ ...session1, messageSessionId: null }]);
    await service.getExportBundle({ condition: 'Heart Failure' });
    expect(mockGetTranscript).toHaveBeenCalledWith('tenant-1', 'session-1');
  });

  it('does not crash the whole export when one session\'s transcript lookup throws', async () => {
    mockGetTranscript.mockRejectedValue(new Error('Session not found'));
    const [row] = await service.getExportBundle({ condition: 'Heart Failure' });
    expect(row.formattedTranscript).toBeNull();
  });

  describe('filters', () => {
    it('translates outcome: IN_PROGRESS to outcome: null in the query', async () => {
      await service.getExportBundle({ outcome: 'IN_PROGRESS' });
      expect(mockPrisma.callSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ outcome: null }) }),
      );
    });

    it('translates channel: VOICE to "not WHATSAPP_CHAT", not a literal enum match', async () => {
      await service.getExportBundle({ channel: 'VOICE' });
      expect(mockPrisma.callSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ callPurpose: { not: 'WHATSAPP_CHAT' } }) }),
      );
    });

    it('applies dateTo as end-of-day', async () => {
      await service.getExportBundle({ dateTo: '2026-08-01' });
      const callArg = (mockPrisma.callSession.findMany as jest.Mock).mock.calls[0][0];
      expect(callArg.where.startedAt.lte.toISOString()).toBe('2026-08-01T23:59:59.999Z');
    });

    it('matches sessionIds against either CallSession.id or messageSessionId', async () => {
      await service.getExportBundle({ sessionIds: ['abc', 'def'] });
      const callArg = (mockPrisma.callSession.findMany as jest.Mock).mock.calls[0][0];
      expect(callArg.where.OR).toEqual([
        { id: { in: ['abc', 'def'] } },
        { messageSessionId: { in: ['abc', 'def'] } },
      ]);
    });

    it('ANDs sessionIds with other filters', async () => {
      await service.getExportBundle({ condition: 'Heart Failure', sessionIds: ['session-1', 'session-2'] });
      const callArg = (mockPrisma.callSession.findMany as jest.Mock).mock.calls[0][0];
      // Prisma ANDs top-level keys with OR: (condition) AND (id OR messageSessionId)
      expect(callArg.where.patient).toEqual({ condition: 'Heart Failure' });
      expect(callArg.where.OR).toEqual([
        { id: { in: ['session-1', 'session-2'] } },
        { messageSessionId: { in: ['session-1', 'session-2'] } },
      ]);
    });
  });
});
