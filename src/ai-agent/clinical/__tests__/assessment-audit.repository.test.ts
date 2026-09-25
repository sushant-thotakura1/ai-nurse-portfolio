import { PrismaClient } from '@prisma/client';
import { AssessmentAuditRepository, AssessmentFlagInput } from '../assessment-audit.repository';

// Mock Prisma Client — inline object cast, following the project pattern
// (src/decision/__tests__/patient-fact.repository.test.ts).
//
// $transaction is mocked to actually invoke the callback with a `tx` object
// whose `assessment.create` / `assessmentFlag.createMany` are their own
// jest.fn()s. This means assertions against mockTx only pass if the
// implementation genuinely calls tx.* from inside the transaction callback —
// not if it calls prisma.assessment.create() directly at the top level.
const mockTx = {
  assessment: { create: jest.fn() },
  assessmentFlag: { createMany: jest.fn() },
};

const mockPrisma = {
  $transaction: jest.fn((cb: (tx: typeof mockTx) => unknown) => cb(mockTx)),
} as unknown as PrismaClient;

describe('AssessmentAuditRepository', () => {
  let repo: AssessmentAuditRepository;
  const tenantId = 'tenant-1';
  const patientId = 'patient-1';
  const sessionId = 'session-1';

  beforeEach(() => {
    jest.clearAllMocks();
    (mockPrisma.$transaction as jest.Mock).mockImplementation((cb: (tx: typeof mockTx) => unknown) => cb(mockTx));
    repo = new AssessmentAuditRepository(mockPrisma);
  });

  function makeFlag(overrides: Partial<AssessmentFlagInput> = {}): AssessmentFlagInput {
    return {
      redFlagId: 'flag-1',
      decidedBy: 'rule',
      fired: true,
      evidence: null,
      rulesTried: [],
      ...overrides,
    };
  }

  it('writes one Assessment row and calls assessmentFlag.createMany with N rows for N input flags', async () => {
    (mockTx.assessment.create as jest.Mock).mockResolvedValue({ id: 'assessment-1' });
    (mockTx.assessmentFlag.createMany as jest.Mock).mockResolvedValue({ count: 2 });

    const flags = [makeFlag({ redFlagId: 'flag-1' }), makeFlag({ redFlagId: 'flag-2' })];

    await repo.persist({
      tenantId,
      patientId,
      sessionId,
      outcome: 'ESCALATE',
      patientAction: 'CALL_911',
      escalationType: 'CLINICAL_RED_FLAG',
      deterministic: true,
      flags,
    });

    expect(mockTx.assessment.create).toHaveBeenCalledTimes(1);
    const createManyCall = (mockTx.assessmentFlag.createMany as jest.Mock).mock.calls[0][0];
    expect(createManyCall.data).toHaveLength(2);
  });

  it('carries the correct tenantId on the Assessment row and on every AssessmentFlag row', async () => {
    (mockTx.assessment.create as jest.Mock).mockResolvedValue({ id: 'assessment-1' });
    (mockTx.assessmentFlag.createMany as jest.Mock).mockResolvedValue({ count: 2 });

    const flags = [makeFlag({ redFlagId: 'flag-1' }), makeFlag({ redFlagId: 'flag-2' })];

    await repo.persist({
      tenantId,
      patientId,
      sessionId,
      outcome: 'ESCALATE',
      patientAction: null,
      escalationType: null,
      deterministic: true,
      flags,
    });

    const assessmentCreateArg = (mockTx.assessment.create as jest.Mock).mock.calls[0][0];
    expect(assessmentCreateArg.data.tenantId).toBe(tenantId);

    const createManyCall = (mockTx.assessmentFlag.createMany as jest.Mock).mock.calls[0][0];
    for (const row of createManyCall.data) {
      expect(row.tenantId).toBe(tenantId);
    }
  });

  it("stamps each AssessmentFlag row's assessmentId with the id of the just-created Assessment row", async () => {
    (mockTx.assessment.create as jest.Mock).mockResolvedValue({ id: 'assessment-xyz' });
    (mockTx.assessmentFlag.createMany as jest.Mock).mockResolvedValue({ count: 2 });

    const flags = [makeFlag({ redFlagId: 'flag-1' }), makeFlag({ redFlagId: 'flag-2' })];

    await repo.persist({
      tenantId,
      patientId,
      sessionId,
      outcome: 'ADVISE',
      patientAction: null,
      escalationType: null,
      deterministic: false,
      flags,
    });

    const createManyCall = (mockTx.assessmentFlag.createMany as jest.Mock).mock.calls[0][0];
    for (const row of createManyCall.data) {
      expect(row.assessmentId).toBe('assessment-xyz');
    }
  });

  it("round-trips fired: null and decidedBy: 'unevaluated' for an unevaluated flag without coercion", async () => {
    (mockTx.assessment.create as jest.Mock).mockResolvedValue({ id: 'assessment-1' });
    (mockTx.assessmentFlag.createMany as jest.Mock).mockResolvedValue({ count: 1 });

    const flags = [
      makeFlag({
        redFlagId: 'flag-unevaluated',
        decidedBy: 'unevaluated',
        fired: null,
        evidence: null,
        rulesTried: [],
      }),
    ];

    await repo.persist({
      tenantId,
      patientId,
      sessionId,
      outcome: 'INCOMPLETE',
      patientAction: null,
      escalationType: null,
      deterministic: true,
      flags,
    });

    const createManyCall = (mockTx.assessmentFlag.createMany as jest.Mock).mock.calls[0][0];
    const row = createManyCall.data[0];
    expect(row.decidedBy).toBe('unevaluated');
    expect(row.fired).toBeNull();
    // Explicitly assert it's not undefined either -- a falsy-check bug could
    // drop the key entirely rather than coercing to some other falsy value.
    expect('fired' in row).toBe(true);
  });

  it('performs the entire write inside a single $transaction call, never touching top-level prisma methods', async () => {
    (mockTx.assessment.create as jest.Mock).mockResolvedValue({ id: 'assessment-1' });
    (mockTx.assessmentFlag.createMany as jest.Mock).mockResolvedValue({ count: 1 });

    await repo.persist({
      tenantId,
      patientId,
      sessionId,
      outcome: 'REASSURE',
      patientAction: null,
      escalationType: null,
      deterministic: true,
      flags: [makeFlag()],
    });

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    // Top-level mockPrisma has no assessment/assessmentFlag properties at all --
    // if the implementation called prisma.assessment.create() directly instead
    // of tx.assessment.create(), this would throw (cannot read property of
    // undefined) rather than silently pass.
    expect((mockPrisma as unknown as Record<string, unknown>).assessment).toBeUndefined();
    expect((mockPrisma as unknown as Record<string, unknown>).assessmentFlag).toBeUndefined();
  });

  it('returns the created assessment id', async () => {
    (mockTx.assessment.create as jest.Mock).mockResolvedValue({ id: 'assessment-returned-id' });
    (mockTx.assessmentFlag.createMany as jest.Mock).mockResolvedValue({ count: 1 });

    const result = await repo.persist({
      tenantId,
      patientId,
      sessionId,
      outcome: 'REASSURE',
      patientAction: null,
      escalationType: null,
      deterministic: true,
      flags: [makeFlag()],
    });

    expect(result.assessmentId).toBe('assessment-returned-id');
  });
});
