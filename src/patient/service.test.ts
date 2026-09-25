import { PrismaClient } from '@prisma/client';

// core/database exports a live singleton `prisma` built at import time --
// mock it before importing anything that transitively imports it, matching
// the pattern used across this repo's other service tests.
const mockPrisma = {
  patient: {
    create: jest.fn(),
    update: jest.fn(),
    findUnique: jest.fn(),
  },
} as unknown as PrismaClient;

jest.mock('../core/database', () => ({ prisma: mockPrisma }));
jest.mock('../core/tenant-context-storage', () => ({
  getTenantContext: jest.fn(() => ({ tenantId: 'tenant-1' })),
}));
jest.mock('../core/encryption', () => ({
  encrypt: jest.fn((v: string) => `enc:${v}`),
  decrypt: jest.fn((v: string) => v.replace(/^enc:/, '')),
}));

import { PatientService } from './service';

describe('PatientService.isTestIdentity', () => {
  let service: PatientService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PatientService();
  });

  it('createPatient persists isTestIdentity: true when provided', async () => {
    (mockPrisma.patient.create as jest.Mock).mockResolvedValue({ id: 'p1' });

    await service.createPatient({
      phoneNumber: '+911234567890',
      name: 'Test Tester',
      preferredLocale: 'en-IN',
      consentStatus: 'PENDING',
      isTestIdentity: true,
    } as any);

    expect(mockPrisma.patient.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isTestIdentity: true }),
      }),
    );
  });

  it('createPatient defaults isTestIdentity to false when omitted', async () => {
    (mockPrisma.patient.create as jest.Mock).mockResolvedValue({ id: 'p1' });

    await service.createPatient({
      phoneNumber: '+911234567890',
      name: 'Real Patient',
      preferredLocale: 'en-IN',
      consentStatus: 'PENDING',
    } as any);

    expect(mockPrisma.patient.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isTestIdentity: false }),
      }),
    );
  });

  it('updatePatient sets isTestIdentity when explicitly provided', async () => {
    (mockPrisma.patient.update as jest.Mock).mockResolvedValue({ id: 'p1' });

    await service.updatePatient('p1', { isTestIdentity: true } as any);

    expect(mockPrisma.patient.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: expect.objectContaining({ isTestIdentity: true }),
    });
  });

  it('updatePatient omits isTestIdentity from the update payload when not provided', async () => {
    (mockPrisma.patient.update as jest.Mock).mockResolvedValue({ id: 'p1' });

    await service.updatePatient('p1', { name: 'New Name' } as any);

    const callArg = (mockPrisma.patient.update as jest.Mock).mock.calls[0][0];
    expect(callArg.data).not.toHaveProperty('isTestIdentity');
  });

  it('getPatientById returns isTestIdentity in the decrypted shape', async () => {
    (mockPrisma.patient.findUnique as jest.Mock).mockResolvedValue({
      id: 'p1',
      phoneNumber: '+911234567890',
      encryptedName: 'enc:Test Tester',
      preferredLocale: 'en-IN',
      consentStatus: 'PENDING',
      isTestIdentity: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await service.getPatientById('p1');

    expect(result.isTestIdentity).toBe(true);
  });
});
