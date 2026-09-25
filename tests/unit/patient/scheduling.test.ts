import { CallSchedulingService } from '../../../src/patient/scheduling.service';
import { prisma } from '../../../src/core/database';
import { runWithTenantContext } from '../../../src/core/tenant-context-storage';
import { TenantContext } from '../../../src/core/types';

// Mock Prisma
jest.mock('../../../src/core/database', () => ({
  prisma: {
    scheduledCall: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
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

describe('CallSchedulingService', () => {
  let schedulingService: CallSchedulingService;

  beforeEach(() => {
    schedulingService = new CallSchedulingService();
    jest.clearAllMocks();
  });

  describe('scheduleCall', () => {
    it('should schedule a new call', async () => {
      const mockScheduledCall = {
        id: 'scheduled-123',
        patientId: 'patient-456',
        callPurpose: 'POST_SURGERY',
        scheduledFor: new Date('2024-12-25T10:00:00Z'),
        status: 'PENDING',
        retryCount: 0,
        maxRetries: 3,
        tenantId: 'tenant-123',
      };

      (prisma.scheduledCall.create as jest.Mock).mockResolvedValueOnce(mockScheduledCall);

      const result = await runWithTenantContext(mockTenantContext, () =>
        schedulingService.scheduleCall({
          patientId: 'patient-456',
          callPurpose: 'POST_SURGERY',
          scheduledFor: new Date('2024-12-25T10:00:00Z'),
        })
      );

      expect(result.id).toBe('scheduled-123');
      expect(result.status).toBe('PENDING');
      expect(prisma.scheduledCall.create).toHaveBeenCalledWith({
        data: {
          patientId: 'patient-456',
          callPurpose: 'POST_SURGERY',
          scheduledFor: new Date('2024-12-25T10:00:00Z'),
          status: 'PENDING',
          retryCount: 0,
          maxRetries: 3,
          tenantId: 'tenant-123',
        },
      });
    });

    it('should accept custom maxRetries', async () => {
      const mockScheduledCall = {
        id: 'scheduled-123',
        maxRetries: 5,
        tenantId: 'tenant-123',
      };

      (prisma.scheduledCall.create as jest.Mock).mockResolvedValueOnce(mockScheduledCall);

      await runWithTenantContext(mockTenantContext, () =>
        schedulingService.scheduleCall({
          patientId: 'patient-456',
          callPurpose: 'MEDICATION_REMINDER',
          scheduledFor: new Date(),
          maxRetries: 5,
        })
      );

      expect(prisma.scheduledCall.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          maxRetries: 5,
          tenantId: 'tenant-123',
        }),
      });
    });
  });

  describe('getPendingCalls', () => {
    it('should get all pending calls due now', async () => {
      const now = new Date('2024-12-25T10:00:00Z');
      const mockCalls = [
        {
          id: 'scheduled-1',
          patientId: 'patient-1',
          scheduledFor: new Date('2024-12-25T09:00:00Z'),
          status: 'PENDING',
        },
        {
          id: 'scheduled-2',
          patientId: 'patient-2',
          scheduledFor: new Date('2024-12-25T09:30:00Z'),
          status: 'PENDING',
        },
      ];

      (prisma.scheduledCall.findMany as jest.Mock).mockResolvedValueOnce(mockCalls);

      const result = await runWithTenantContext(mockTenantContext, () =>
        schedulingService.getPendingCalls(now)
      );

      expect(result).toHaveLength(2);
      expect(prisma.scheduledCall.findMany).toHaveBeenCalledWith({
        where: {
          status: 'PENDING',
          scheduledFor: {
            lte: now,
          },
        },
        include: {
          patient: true,
        },
        orderBy: {
          scheduledFor: 'asc',
        },
      });
    });
  });

  describe('markAsCompleted', () => {
    it('should mark call as completed', async () => {
      const mockUpdatedCall = {
        id: 'scheduled-123',
        status: 'COMPLETED',
        sessionId: 'session-456',
      };

      (prisma.scheduledCall.update as jest.Mock).mockResolvedValueOnce(mockUpdatedCall);

      const result = await runWithTenantContext(mockTenantContext, () =>
        schedulingService.markAsCompleted('scheduled-123', 'session-456')
      );

      expect(result.status).toBe('COMPLETED');
      expect(prisma.scheduledCall.update).toHaveBeenCalledWith({
        where: { id: 'scheduled-123' },
        data: {
          status: 'COMPLETED',
          sessionId: 'session-456',
        },
      });
    });
  });

  describe('markAsFailed', () => {
    it('should mark call as failed', async () => {
      const mockUpdatedCall = {
        id: 'scheduled-123',
        status: 'FAILED',
      };

      (prisma.scheduledCall.update as jest.Mock).mockResolvedValueOnce(mockUpdatedCall);

      const result = await runWithTenantContext(mockTenantContext, () =>
        schedulingService.markAsFailed('scheduled-123')
      );

      expect(result.status).toBe('FAILED');
      expect(prisma.scheduledCall.update).toHaveBeenCalledWith({
        where: { id: 'scheduled-123' },
        data: {
          status: 'FAILED',
        },
      });
    });
  });

  describe('incrementRetry', () => {
    it('should increment retry count', async () => {
      const existingCall = {
        id: 'scheduled-123',
        retryCount: 1,
        maxRetries: 3,
      };

      const updatedCall = {
        id: 'scheduled-123',
        retryCount: 2,
      };

      (prisma.scheduledCall.findUnique as jest.Mock).mockResolvedValueOnce(existingCall);
      (prisma.scheduledCall.update as jest.Mock).mockResolvedValueOnce(updatedCall);

      const result = await runWithTenantContext(mockTenantContext, () =>
        schedulingService.incrementRetry('scheduled-123')
      );

      expect(result.retryCount).toBe(2);
      expect(prisma.scheduledCall.update).toHaveBeenCalledWith({
        where: { id: 'scheduled-123' },
        data: {
          retryCount: 2,
        },
      });
    });

    it('should mark as failed if max retries exceeded', async () => {
      const existingCall = {
        id: 'scheduled-123',
        retryCount: 3,
        maxRetries: 3,
      };

      (prisma.scheduledCall.findUnique as jest.Mock).mockResolvedValueOnce(existingCall);
      (prisma.scheduledCall.update as jest.Mock).mockResolvedValueOnce({
        id: 'scheduled-123',
        status: 'FAILED',
      });

      const result = await runWithTenantContext(mockTenantContext, () =>
        schedulingService.incrementRetry('scheduled-123')
      );

      expect(result.status).toBe('FAILED');
    });
  });

  describe('cancelScheduledCall', () => {
    it('should cancel a scheduled call', async () => {
      const mockUpdatedCall = {
        id: 'scheduled-123',
        status: 'CANCELLED',
      };

      (prisma.scheduledCall.update as jest.Mock).mockResolvedValueOnce(mockUpdatedCall);

      const result = await runWithTenantContext(mockTenantContext, () =>
        schedulingService.cancelScheduledCall('scheduled-123')
      );

      expect(result.status).toBe('CANCELLED');
      expect(prisma.scheduledCall.update).toHaveBeenCalledWith({
        where: { id: 'scheduled-123' },
        data: {
          status: 'CANCELLED',
        },
      });
    });
  });
});
