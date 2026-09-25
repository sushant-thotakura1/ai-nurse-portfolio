// src/screening/service.test.ts
import { ScreeningService } from './service';
import { vaccinationSchema } from './schemas/vaccination.schema';

jest.mock('../core/database', () => ({
  prisma: {
    screeningRecord: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  },
}));
jest.mock('../core/tenant-context-storage', () => ({
  getTenantContext: jest.fn(),
}));
jest.mock('../core/encryption', () => ({
  encrypt: jest.fn((v: string) => `enc(${v})`),
  decrypt: jest.fn((v: string) => v.replace(/^enc\(|\)$/g, '')),
}));

import { prisma } from '../core/database';
import { getTenantContext } from '../core/tenant-context-storage';

describe('ScreeningService', () => {
  const service = new ScreeningService(vaccinationSchema);

  beforeEach(() => {
    jest.clearAllMocks();
    (getTenantContext as jest.Mock).mockReturnValue({ tenantId: 'tenant-1' });
  });

  it('throws if there is no tenant context', async () => {
    (getTenantContext as jest.Mock).mockReturnValue(undefined);
    await expect(service.start('patient')).rejects.toThrow(/tenant/i);
  });

  it('creates a record scoped to the current tenant on start', async () => {
    (prisma.screeningRecord.create as jest.Mock).mockResolvedValue({ id: 'rec-1', answers: {} });
    const record = await service.start('patient');
    expect(prisma.screeningRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'tenant-1',
          schemaId: 'adult-vaccination',
          filledBy: 'patient',
          status: 'in_progress',
        }),
      }),
    );
    expect(record.id).toBe('rec-1');
  });

  it('merges a new answer into the record and re-evaluates stop rules', async () => {
    (prisma.screeningRecord.findFirst as jest.Mock).mockResolvedValue({
      id: 'rec-1',
      answers: { severe_allergic_reaction: false },
      status: 'in_progress',
    });
    (prisma.screeningRecord.update as jest.Mock).mockResolvedValue({
      id: 'rec-1',
      answers: { severe_allergic_reaction: true },
      status: 'completed',
      stopOutcome: { outcome: 'stop', message: expect.any(String) },
    });

    const result = await service.submitAnswer('rec-1', 'severe_allergic_reaction', true);

    expect(prisma.screeningRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'rec-1' },
        data: expect.objectContaining({
          status: 'completed',
          stopOutcome: expect.objectContaining({ outcome: 'stop' }),
        }),
      }),
    );
    expect(result.status).toBe('completed');
  });

  it('encrypts the name answer into encryptedName rather than the plaintext answers blob', async () => {
    (prisma.screeningRecord.findFirst as jest.Mock).mockResolvedValue({
      id: 'rec-1',
      answers: {},
      status: 'in_progress',
    });
    (prisma.screeningRecord.update as jest.Mock).mockResolvedValue({ id: 'rec-1' });

    await service.submitAnswer('rec-1', 'name', 'Asha Verma');

    expect(prisma.screeningRecord.update).toHaveBeenCalledWith({
      where: { id: 'rec-1' },
      data: { encryptedName: 'enc(Asha Verma)' },
    });
  });

  it.each([
    ['phone', 'encryptedPhone'],
    ['external_id', 'encryptedExternalId'],
    ['abha_id', 'encryptedAbhaId'],
  ])('encrypts the %s answer into %s', async (questionId, column) => {
    (prisma.screeningRecord.findFirst as jest.Mock).mockResolvedValue({
      id: 'rec-1',
      answers: {},
      status: 'in_progress',
    });
    (prisma.screeningRecord.update as jest.Mock).mockResolvedValue({ id: 'rec-1' });

    await service.submitAnswer('rec-1', questionId, '9999999999');

    expect(prisma.screeningRecord.update).toHaveBeenCalledWith({
      where: { id: 'rec-1' },
      data: { [column]: 'enc(9999999999)' },
    });
  });

  it('does not put a PII answer into the plaintext answers blob', async () => {
    (prisma.screeningRecord.findFirst as jest.Mock).mockResolvedValue({
      id: 'rec-1',
      answers: {},
      status: 'in_progress',
    });
    (prisma.screeningRecord.update as jest.Mock).mockResolvedValue({ id: 'rec-1' });

    await service.submitAnswer('rec-1', 'name', 'Asha Verma');

    const call = (prisma.screeningRecord.update as jest.Mock).mock.calls[0][0];
    expect(call.data.answers).toBeUndefined();
  });

  it('completes the record with a recommendation derived from its answers', async () => {
    (prisma.screeningRecord.findFirst as jest.Mock).mockResolvedValue({
      id: 'rec-1',
      answers: { chronic_conditions: ['diabetes'], age: 40 },
      status: 'in_progress',
    });
    (prisma.screeningRecord.update as jest.Mock).mockResolvedValue({ id: 'rec-1', status: 'completed' });

    const result = await service.complete('rec-1');

    expect(prisma.screeningRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'rec-1' },
        data: expect.objectContaining({
          status: 'completed',
          recommendation: expect.objectContaining({
            vaccines: expect.arrayContaining(['influenza', 'pneumococcal', 'hepatitis_b', 'tdap']),
          }),
        }),
      }),
    );
    const call = (prisma.screeningRecord.update as jest.Mock).mock.calls[0][0];
    expect(call.data.recommendation.vaccines.length).toBeGreaterThan(0);
    expect(result.status).toBe('completed');
  });

  it('throws if the record is not found on complete', async () => {
    (prisma.screeningRecord.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(service.complete('missing')).rejects.toThrow(/not found/i);
  });

  describe('getState', () => {
    it('throws /not found/i when the record does not exist', async () => {
      (prisma.screeningRecord.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(service.getState('missing')).rejects.toThrow(/not found/i);
    });

    it('returns a full wizard snapshot for a fresh record', async () => {
      (prisma.screeningRecord.findFirst as jest.Mock).mockResolvedValue({
        id: 'rec-1',
        answers: {},
        status: 'in_progress',
        recommendation: null,
        stopOutcome: null,
      });

      const state = await service.getState('rec-1');

      expect(state.id).toBe('rec-1');
      expect(state.status).toBe('in_progress');
      expect(state.totalSteps).toBe(6);
      expect(state.steps).toHaveLength(6);
      expect(state.steps[0].id).toBe('consent');
      expect(state.steps[0].index).toBe(0);
      expect(state.steps[0].questions.map((q) => q.id)).toContain('consent_given');
      expect(state.recommendation).toBeNull();
      expect(state.stopOutcome).toBeNull();
    });

    it('never leaks the showIf function into returned questions', async () => {
      (prisma.screeningRecord.findFirst as jest.Mock).mockResolvedValue({
        id: 'rec-1',
        answers: { has_chronic_conditions: true, vaccinated_last_10_years: true },
        status: 'in_progress',
      });

      const state = await service.getState('rec-1');

      for (const step of state.steps) {
        for (const q of step.questions) {
          expect('showIf' in q).toBe(false);
        }
      }
    });

    it('includes a conditional question only when its showIf is satisfied', async () => {
      (prisma.screeningRecord.findFirst as jest.Mock).mockResolvedValue({
        id: 'rec-1',
        answers: { has_chronic_conditions: true },
        status: 'in_progress',
      });

      const shown = await service.getState('rec-1');
      const riskStepShown = shown.steps.find((s) => s.id === 'risk_factors')!;
      expect(riskStepShown.questions.map((q) => q.id)).toContain('chronic_conditions');
    });

    it('omits a conditional question when its showIf is not satisfied', async () => {
      (prisma.screeningRecord.findFirst as jest.Mock).mockResolvedValue({
        id: 'rec-1',
        answers: {},
        status: 'in_progress',
      });

      const hidden = await service.getState('rec-1');
      const riskStepHidden = hidden.steps.find((s) => s.id === 'risk_factors')!;
      expect(riskStepHidden.questions.map((q) => q.id)).not.toContain('chronic_conditions');
    });

    it('marks optional questions in the DTO but not required ones, without leaking showIf', async () => {
      (prisma.screeningRecord.findFirst as jest.Mock).mockResolvedValue({
        id: 'rec-1',
        answers: {},
        status: 'in_progress',
      });

      const state = await service.getState('rec-1');
      const demographics = state.steps.find((s) => s.id === 'demographics')!;
      const byId = Object.fromEntries(demographics.questions.map((q) => [q.id, q]));

      expect(byId.abha_id.optional).toBe(true);
      expect('optional' in byId.name).toBe(false);
      expect('showIf' in byId.abha_id).toBe(false);
      expect('showIf' in byId.name).toBe(false);
    });

    it('passes record.answers through as given', async () => {
      const answers = { consent_given: true, age: 42 };
      (prisma.screeningRecord.findFirst as jest.Mock).mockResolvedValue({
        id: 'rec-1',
        answers,
        status: 'in_progress',
      });

      const state = await service.getState('rec-1');
      expect(state.answers).toEqual(answers);
    });
  });
});
