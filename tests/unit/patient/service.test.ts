import { PatientService } from '../../../src/patient/service';
import { prisma } from '../../../src/core/database';
import { encrypt, decrypt } from '../../../src/core/encryption';
import { runWithTenantContext } from '../../../src/core/tenant-context-storage';
import { TenantContext } from '../../../src/core/types';

// Mock Prisma
jest.mock('../../../src/core/database', () => ({
  prisma: {
    patient: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
  },
}));

// Mock encryption
jest.mock('../../../src/core/encryption');

// Mock knowledge graph service
jest.mock('../../../src/knowledge-graph/knowledge-graph.service', () => ({
  knowledgeGraphService: {
    getActiveKnowledgeGraph: jest.fn(),
  },
}));

// Mock tenant context
const mockTenantContext: TenantContext = {
  tenantId: 'tenant-123',
  tenantSlug: 'test-tenant',
  tenant: {
    id: 'tenant-123',
    slug: 'test-tenant',
    name: 'Test Tenant',
    status: 'ACTIVE',
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any,
  isSuperAdmin: false,
};

describe('PatientService', () => {
  let service: PatientService;

  beforeEach(() => {
    service = new PatientService();
    jest.clearAllMocks();
  });

  describe('createPatient', () => {
    it('should create patient with encrypted PII', async () => {
      const patientData = {
        phoneNumber: '+919876543210',
        name: 'John Doe',
        dob: '1985-05-15',
        preferredLocale: 'hi-IN',
        consentStatus: 'GRANTED',
      };

      (encrypt as jest.Mock).mockImplementation((data) => `encrypted_${data}`);

      (prisma.patient.create as jest.Mock).mockResolvedValueOnce({
        id: 'uuid-123',
        phoneNumber: '+919876543210',
        encryptedName: 'encrypted_John Doe',
        encryptedDob: 'encrypted_1985-05-15',
        preferredLocale: 'hi-IN',
        consentStatus: 'GRANTED',
        consentRecordedAt: new Date(),
        tenantId: 'tenant-123',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await runWithTenantContext(mockTenantContext, () =>
        service.createPatient(patientData)
      );

      expect(encrypt).toHaveBeenCalledWith('John Doe');
      expect(encrypt).toHaveBeenCalledWith('1985-05-15');
      expect(prisma.patient.create).toHaveBeenCalledWith({
        data: {
          phoneNumber: '+919876543210',
          encryptedName: 'encrypted_John Doe',
          encryptedDob: 'encrypted_1985-05-15',
          preferredLocale: 'hi-IN',
          consentStatus: 'GRANTED',
          consentRecordedAt: expect.any(Date),
          condition: undefined,
          classification: null,
          knowledgeGraphId: undefined,
          conditionStartDate: null,
          triggerType: null,
          metadata: undefined,
          tenantId: 'tenant-123',
        },
      });
      expect(result.id).toBe('uuid-123');
    });

    it('should persist triggerType when provided', async () => {
      (encrypt as jest.Mock).mockImplementation((data) => `encrypted_${data}`);
      (prisma.patient.create as jest.Mock).mockResolvedValueOnce({
        id: 'uuid-456',
        phoneNumber: '+919876543210',
        encryptedName: 'encrypted_Jane',
        preferredLocale: 'hi-IN',
        consentStatus: 'GRANTED',
        triggerType: 'discharge_date',
        consentRecordedAt: new Date(),
        tenantId: 'tenant-123',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await runWithTenantContext(mockTenantContext, () =>
        service.createPatient({
          phoneNumber: '+919876543210',
          name: 'Jane',
          preferredLocale: 'hi-IN',
          consentStatus: 'GRANTED',
          triggerType: 'discharge_date',
        })
      );

      expect(prisma.patient.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ triggerType: 'discharge_date' }),
        })
      );
    });

    it('should store null triggerType when not provided', async () => {
      (encrypt as jest.Mock).mockImplementation((data) => `encrypted_${data}`);
      (prisma.patient.create as jest.Mock).mockResolvedValueOnce({
        id: 'uuid-789',
        phoneNumber: '+910000000001',
        encryptedName: 'encrypted_Bob',
        preferredLocale: 'hi-IN',
        consentStatus: 'GRANTED',
        triggerType: null,
        consentRecordedAt: new Date(),
        tenantId: 'tenant-123',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await runWithTenantContext(mockTenantContext, () =>
        service.createPatient({
          phoneNumber: '+910000000001',
          name: 'Bob',
          preferredLocale: 'hi-IN',
          consentStatus: 'GRANTED',
        })
      );

      expect(prisma.patient.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ triggerType: null }),
        })
      );
    });
  });

  describe('getPatientById', () => {
    it('should retrieve and decrypt patient data', async () => {
      const mockPatient = {
        id: 'uuid-123',
        phoneNumber: '+919876543210',
        encryptedName: 'encrypted_John Doe',
        encryptedDob: 'encrypted_1985-05-15',
        preferredLocale: 'hi-IN',
        consentStatus: 'GRANTED',
      };

      (decrypt as jest.Mock).mockImplementation((data) => data.replace('encrypted_', ''));
      (prisma.patient.findUnique as jest.Mock).mockResolvedValueOnce(mockPatient);

      const result = await runWithTenantContext(mockTenantContext, () =>
        service.getPatientById('uuid-123')
      );

      expect(result.name).toBe('John Doe');
      expect(result.dob).toBe('1985-05-15');
      expect(decrypt).toHaveBeenCalledWith('encrypted_John Doe');
      expect(decrypt).toHaveBeenCalledWith('encrypted_1985-05-15');
    });

    it('should throw error if patient not found', async () => {
      (prisma.patient.findUnique as jest.Mock).mockResolvedValueOnce(null);

      await expect(
        runWithTenantContext(mockTenantContext, () =>
          service.getPatientById('nonexistent')
        )
      ).rejects.toThrow('Patient not found');
    });
  });

  describe('getPatientByPhone', () => {
    it('should find patient by phone number', async () => {
      const mockPatient = {
        id: 'uuid-123',
        phoneNumber: '+919876543210',
        encryptedName: 'encrypted_John Doe',
        preferredLocale: 'hi-IN',
      };

      (decrypt as jest.Mock).mockImplementation((data) => data.replace('encrypted_', ''));
      (prisma.patient.findFirst as jest.Mock).mockResolvedValueOnce(mockPatient);

      const result = await runWithTenantContext(mockTenantContext, () =>
        service.getPatientByPhone('+919876543210')
      );

      expect(result).toBeDefined();
      expect(result?.phoneNumber).toBe('+919876543210');
    });
  });

  describe('updatePatient', () => {
    it('should update patient with encrypted data', async () => {
      const updateData = {
        name: 'Jane Doe',
        preferredLocale: 'te-IN',
      };

      (encrypt as jest.Mock).mockImplementation((data) => `encrypted_${data}`);
      (prisma.patient.update as jest.Mock).mockResolvedValueOnce({
        id: 'uuid-123',
        encryptedName: 'encrypted_Jane Doe',
        preferredLocale: 'te-IN',
      });

      await runWithTenantContext(mockTenantContext, () =>
        service.updatePatient('uuid-123', updateData)
      );

      expect(encrypt).toHaveBeenCalledWith('Jane Doe');
      expect(prisma.patient.update).toHaveBeenCalledWith({
        where: { id: 'uuid-123' },
        data: expect.objectContaining({
          encryptedName: 'encrypted_Jane Doe',
          preferredLocale: 'te-IN',
        }),
      });
    });

    it('should update triggerType when provided', async () => {
      (prisma.patient.update as jest.Mock).mockResolvedValueOnce({
        id: 'uuid-123',
        triggerType: 'enrollment_date',
      });

      await runWithTenantContext(mockTenantContext, () =>
        service.updatePatient('uuid-123', { triggerType: 'enrollment_date' })
      );

      expect(prisma.patient.update).toHaveBeenCalledWith({
        where: { id: 'uuid-123' },
        data: expect.objectContaining({ triggerType: 'enrollment_date' }),
      });
    });
  });
});
