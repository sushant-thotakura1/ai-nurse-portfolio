import { PrismaClient } from '@prisma/client';
import { PatientFactRepository } from '../patient-fact.repository';

// Mock Prisma Client — inline object cast, following the project pattern
const mockTx = {
  patientFact: {
    updateMany: jest.fn(),
    deleteMany: jest.fn(),
  },
};

const mockPrisma = {
  patientFact: {
    findMany: jest.fn(),
    create: jest.fn(),
  },
  $transaction: jest.fn((cb: (tx: typeof mockTx) => unknown) => cb(mockTx)),
} as unknown as PrismaClient;

describe('PatientFactRepository', () => {
  let repo: PatientFactRepository;
  const tenantId = 'tenant-1';
  const patientId = 'patient-1';
  const factId = 'fact-hr';
  const now = new Date('2025-01-01T12:00:00Z');

  beforeEach(() => {
    jest.clearAllMocks();
    repo = new PatientFactRepository(mockPrisma);
    (mockPrisma.$transaction as jest.Mock).mockImplementation((cb: (tx: typeof mockTx) => unknown) => cb(mockTx));
    (mockTx.patientFact.updateMany as jest.Mock).mockReset();
    (mockTx.patientFact.deleteMany as jest.Mock).mockReset();
  });

  /** Build a realistic DB row with sensible defaults. */
  function makeRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: 'row-1',
      tenantId,
      patientId,
      factId,
      valueNumber: 72,
      valueBoolean: null,
      valueString: null,
      observedAt: new Date('2025-01-01T10:00:00Z'),
      timeUncertaintyHours: 0,
      recordedAt: new Date('2025-01-01T10:05:00Z'),
      sourceSessionId: null,
      supersedesId: null,
      confidence: null,
      extractionClass: 'DIRECT',
      ...overrides,
    };
  }

  // ──────────────────────────────────────────────────────────────────
  // Scenario 1 & 2: getLiveFacts — live-row filtering and total order
  // ──────────────────────────────────────────────────────────────────

  describe('getLiveFacts', () => {
    it('scenario 1: returns only live rows — row superseded by another is excluded', async () => {
      // Row A is superseded: some row B has supersedesId = A.id, meaning
      // A.supersededBy = B (not null). The Prisma query filters
      //   supersededBy: { is: null }
      // so row A is excluded. We simulate the DB returning only row B.
      const rowB = makeRow({ id: 'row-b', valueNumber: 80 });
      (mockPrisma.patientFact.findMany as jest.Mock).mockResolvedValue([rowB]);

      const result = await repo.getLiveFacts(tenantId, patientId, factId);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('row-b');
      expect(result[0].value).toBe(80);
    });

    it('scenario 1: passes supersededBy: { is: null } filter to Prisma', async () => {
      (mockPrisma.patientFact.findMany as jest.Mock).mockResolvedValue([]);

      await repo.getLiveFacts(tenantId, patientId, factId);

      expect(mockPrisma.patientFact.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId,
            patientId,
            factId,
            supersededBy: { is: null },
          }),
        }),
      );
    });

    it('scenario 2: orders by observedAt ASC, recordedAt ASC, id ASC (total order)', async () => {
      const sharedObservedAt = new Date('2025-01-01T10:00:00Z');
      // Two rows share the same observedAt; recordedAt breaks the tie
      const rowA = makeRow({
        id: 'row-a',
        observedAt: sharedObservedAt,
        recordedAt: new Date('2025-01-01T10:01:00Z'),
        valueNumber: 70,
      });
      const rowB = makeRow({
        id: 'row-b',
        observedAt: sharedObservedAt,
        recordedAt: new Date('2025-01-01T10:02:00Z'),
        valueNumber: 75,
      });
      (mockPrisma.patientFact.findMany as jest.Mock).mockResolvedValue([rowA, rowB]);

      const result = await repo.getLiveFacts(tenantId, patientId, factId);

      // Prisma returns in the order our orderBy specifies; mock returns rowA first
      expect(result[0].id).toBe('row-a');
      expect(result[1].id).toBe('row-b');
    });

    it('scenario 2: passes three-key orderBy to Prisma', async () => {
      (mockPrisma.patientFact.findMany as jest.Mock).mockResolvedValue([]);

      await repo.getLiveFacts(tenantId, patientId, factId);

      expect(mockPrisma.patientFact.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [
            { observedAt: 'asc' },
            { recordedAt: 'asc' },
            { id: 'asc' },
          ],
        }),
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // Scenario 3 & 5: getCurrentValue — current-value clock + correction
  // ──────────────────────────────────────────────────────────────────

  describe('getCurrentValue', () => {
    it('scenario 3: returns the newest live row within validForHours of now', async () => {
      const rowA = makeRow({
        id: 'row-a',
        observedAt: new Date('2025-01-01T10:00:00Z'),
        valueNumber: 70,
      });
      const rowB = makeRow({
        id: 'row-b',
        observedAt: new Date('2025-01-01T11:00:00Z'),
        valueNumber: 75,
      });
      // Mock returns both rows in ascending order; repository picks the last one
      (mockPrisma.patientFact.findMany as jest.Mock).mockResolvedValue([rowA, rowB]);

      const result = await repo.getCurrentValue(tenantId, patientId, factId, now, 4);

      expect(result).not.toBeNull();
      expect(result!.id).toBe('row-b');
      expect(result!.value).toBe(75);
    });

    it('scenario 3: returns null when no live row falls within validForHours', async () => {
      // DB returns empty — all live rows are outside the window
      (mockPrisma.patientFact.findMany as jest.Mock).mockResolvedValue([]);

      const result = await repo.getCurrentValue(tenantId, patientId, factId, now, 1);

      expect(result).toBeNull();
    });

    it('scenario 3: passes observedAt >= (now - validForHours) filter to Prisma', async () => {
      (mockPrisma.patientFact.findMany as jest.Mock).mockResolvedValue([]);

      await repo.getCurrentValue(tenantId, patientId, factId, now, 2);

      const expectedCutoff = new Date(now.getTime() - 2 * 60 * 60 * 1000);
      expect(mockPrisma.patientFact.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            supersededBy: { is: null },
            observedAt: { gte: expectedCutoff },
          }),
        }),
      );
    });

    it('scenario 5: when B supersedes A, getCurrentValue returns B value and observedAt', async () => {
      // B.supersedesId = A.id, so A is not live. The mock simulates
      // the DB returning only B (because A was filtered out by supersededBy: { is: null }).
      const rowB = makeRow({
        id: 'row-b',
        observedAt: new Date('2025-01-01T11:00:00Z'),
        valueNumber: 85,
        supersedesId: 'row-a',
      });
      (mockPrisma.patientFact.findMany as jest.Mock).mockResolvedValue([rowB]);

      const result = await repo.getCurrentValue(tenantId, patientId, factId, now, 4);

      expect(result).not.toBeNull();
      expect(result!.id).toBe('row-b');
      expect(result!.value).toBe(85);
      expect(result!.observedAt).toEqual(new Date('2025-01-01T11:00:00Z'));
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // Scenario 4: getWindowHistory — window clock, NOT validForHours
  // ──────────────────────────────────────────────────────────────────

  describe('getWindowHistory', () => {
    it('scenario 4: returns live rows in [now - windowHours, now], oldest first', async () => {
      const rowA = makeRow({
        id: 'row-a',
        observedAt: new Date('2025-01-01T06:00:00Z'),
        valueNumber: 68,
      });
      const rowB = makeRow({
        id: 'row-b',
        observedAt: new Date('2025-01-01T10:00:00Z'),
        valueNumber: 72,
      });
      // Mock returns in ascending order (oldest first)
      (mockPrisma.patientFact.findMany as jest.Mock).mockResolvedValue([rowA, rowB]);

      const result = await repo.getWindowHistory(tenantId, patientId, factId, now, 8);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('row-a');
      expect(result[1].id).toBe('row-b');
    });

    it('scenario 4: passes observedAt in [cutoff, now] filter to Prisma', async () => {
      (mockPrisma.patientFact.findMany as jest.Mock).mockResolvedValue([]);

      await repo.getWindowHistory(tenantId, patientId, factId, now, 6);

      const expectedCutoff = new Date(now.getTime() - 6 * 60 * 60 * 1000);
      expect(mockPrisma.patientFact.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            supersededBy: { is: null },
            observedAt: { gte: expectedCutoff, lte: now },
          }),
        }),
      );
    });

    it('scenario 4: uses same three-key orderBy as getLiveFacts', async () => {
      (mockPrisma.patientFact.findMany as jest.Mock).mockResolvedValue([]);

      await repo.getWindowHistory(tenantId, patientId, factId, now, 6);

      expect(mockPrisma.patientFact.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [
            { observedAt: 'asc' },
            { recordedAt: 'asc' },
            { id: 'asc' },
          ],
        }),
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // Scenario 6: save — tenantId is explicit in the Prisma create call
  // ──────────────────────────────────────────────────────────────────

  describe('save', () => {
    it('scenario 6: passes tenantId, patientId, factId explicitly to Prisma create', async () => {
      const createdRow = makeRow({ id: 'row-new', valueNumber: 95 });
      (mockPrisma.patientFact.create as jest.Mock).mockResolvedValue(createdRow);

      const result = await repo.save({
        tenantId,
        patientId,
        factId,
        valueNumber: 95,
        observedAt: new Date('2025-01-01T11:30:00Z'),
        extractionClass: 'DIRECT',
      });

      expect(mockPrisma.patientFact.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId,
            patientId,
            factId,
          }),
        }),
      );
      expect(result.id).toBe('row-new');
      expect(result.value).toBe(95);
    });

    it('scenario 6: maps value columns — valueNumber wins over null alternatives', async () => {
      const createdRow = makeRow({ id: 'row-n', valueNumber: 42, valueBoolean: null, valueString: null });
      (mockPrisma.patientFact.create as jest.Mock).mockResolvedValue(createdRow);

      const result = await repo.save({
        tenantId,
        patientId,
        factId,
        valueNumber: 42,
        observedAt: new Date('2025-01-01T11:00:00Z'),
        extractionClass: 'DIRECT',
      });

      expect(result.value).toBe(42);
    });

    it('scenario 6: maps valueBoolean correctly', async () => {
      const createdRow = makeRow({ id: 'row-b', valueNumber: null, valueBoolean: true, valueString: null });
      (mockPrisma.patientFact.create as jest.Mock).mockResolvedValue(createdRow);

      const result = await repo.save({
        tenantId,
        patientId,
        factId,
        valueBoolean: true,
        observedAt: new Date('2025-01-01T11:00:00Z'),
        extractionClass: 'DIRECT',
      });

      expect(result.value).toBe(true);
    });

    it('scenario 6: maps valueString correctly', async () => {
      const createdRow = makeRow({ id: 'row-s', valueNumber: null, valueBoolean: null, valueString: 'stable' });
      (mockPrisma.patientFact.create as jest.Mock).mockResolvedValue(createdRow);

      const result = await repo.save({
        tenantId,
        patientId,
        factId,
        valueString: 'stable',
        observedAt: new Date('2025-01-01T11:00:00Z'),
        extractionClass: 'DIRECT',
      });

      expect(result.value).toBe('stable');
    });

    it('maps valueBoolean false correctly — not treated as falsy null', async () => {
      const createdRow = makeRow({ id: 'row-bf', valueNumber: null, valueBoolean: false, valueString: null });
      (mockPrisma.patientFact.create as jest.Mock).mockResolvedValue(createdRow);

      const result = await repo.save({
        tenantId,
        patientId,
        factId,
        valueBoolean: false,
        observedAt: new Date('2025-01-01T11:00:00Z'),
        extractionClass: 'DIRECT',
      });

      expect(result.value).toBe(false);
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // flushForPatient — deletes all facts for a patient in one transaction
  // ──────────────────────────────────────────────────────────────────

  describe('flushForPatient', () => {
    it('nulls out supersedesId pointers before deleting, in that order, within one transaction', async () => {
      (mockTx.patientFact.updateMany as jest.Mock).mockResolvedValue({ count: 2 });
      (mockTx.patientFact.deleteMany as jest.Mock).mockResolvedValue({ count: 3 });

      await repo.flushForPatient(tenantId, patientId);

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockTx.patientFact.updateMany).toHaveBeenCalledWith({
        where: { tenantId, patientId },
        data: { supersedesId: null },
      });
      expect(mockTx.patientFact.deleteMany).toHaveBeenCalledWith({
        where: { tenantId, patientId },
      });

      // Order matters: updateMany must be called before deleteMany, or the
      // Restrict constraint on supersedesId can block the delete.
      const updateOrder = (mockTx.patientFact.updateMany as jest.Mock).mock.invocationCallOrder[0];
      const deleteOrder = (mockTx.patientFact.deleteMany as jest.Mock).mock.invocationCallOrder[0];
      expect(updateOrder).toBeLessThan(deleteOrder);
    });

    it('scopes both operations to the given tenantId and patientId only', async () => {
      (mockTx.patientFact.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
      (mockTx.patientFact.deleteMany as jest.Mock).mockResolvedValue({ count: 0 });

      await repo.flushForPatient('other-tenant', 'other-patient');

      expect(mockTx.patientFact.updateMany).toHaveBeenCalledWith({
        where: { tenantId: 'other-tenant', patientId: 'other-patient' },
        data: { supersedesId: null },
      });
      expect(mockTx.patientFact.deleteMany).toHaveBeenCalledWith({
        where: { tenantId: 'other-tenant', patientId: 'other-patient' },
      });
    });
  });
});
