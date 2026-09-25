import { Prisma, Tenant } from '@prisma/client';
import {
  createPrismaTenantMiddleware,
  TENANT_SCOPED_MODELS,
  NON_TENANT_MODELS
} from '../prisma-tenant-middleware';
import { runWithTenantContext } from '../tenant-context-storage';
import { TenantContext } from '../types';

// Type helper for middleware params
type MiddlewareParams = Prisma.MiddlewareParams & {
  args?: any;
};

describe('Prisma Tenant Middleware', () => {
  let middleware: Prisma.Middleware;
  let mockNext: jest.Mock;

  const mockTenant: Tenant = {
    id: 'tenant-123',
    name: 'Test Tenant',
    slug: 'test-tenant',
    status: 'ACTIVE',
    settings: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01')
  };

  const mockTenantContext: TenantContext = {
    tenantId: 'tenant-123',
    tenantSlug: 'test-tenant',
    tenant: mockTenant,
    isSuperAdmin: false
  };

  beforeEach(() => {
    middleware = createPrismaTenantMiddleware();
    mockNext = jest.fn((params) => Promise.resolve({ id: 'result-id' }));
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Model filtering', () => {
    it('should filter tenant-scoped models', () => {
      const tenantScopedModels = ['Patient', 'CallSession', 'KnowledgeGraph', 'ScheduledCall', 'ClinicalEvent', 'TenantDocument', 'MessageSession', 'ProviderConfig', 'ScreeningRecord'];
      expect(TENANT_SCOPED_MODELS).toEqual(tenantScopedModels);
    });

    it('should not filter non-tenant models', () => {
      const nonTenantModels = ['User', 'Tenant', 'TenantUser'];
      expect(NON_TENANT_MODELS).toEqual(nonTenantModels);
    });

    it('should skip filtering for non-tenant models', async () => {
      const params: MiddlewareParams = {
        model: 'User' as Prisma.ModelName,
        action: 'findMany',
        args: { where: { email: 'test@example.com' } },
        dataPath: [],
        runInTransaction: false
      };

      await runWithTenantContext(mockTenantContext, async () => {
        await middleware(params, mockNext);
      });

      expect(mockNext).toHaveBeenCalledWith(params);
      expect(params.args.where).toEqual({ email: 'test@example.com' });
    });

    it('should skip filtering when no model is specified', async () => {
      const params: MiddlewareParams = {
        model: undefined,
        action: 'queryRaw',
        args: {},
        dataPath: [],
        runInTransaction: false
      };

      await runWithTenantContext(mockTenantContext, async () => {
        await middleware(params, mockNext);
      });

      expect(mockNext).toHaveBeenCalledWith(params);
    });
  });

  describe('findMany operation', () => {
    it('should add tenantId filter to findMany with no existing where clause', async () => {
      const params: MiddlewareParams = {
        model: 'Patient' as Prisma.ModelName,
        action: 'findMany',
        args: {},
        dataPath: [],
        runInTransaction: false
      };

      await runWithTenantContext(mockTenantContext, async () => {
        await middleware(params, mockNext);
      });

      expect(params.args.where).toEqual({ tenantId: 'tenant-123' });
      expect(mockNext).toHaveBeenCalledWith(params);
    });

    it('should merge tenantId filter with existing where clause', async () => {
      const params: MiddlewareParams = {
        model: 'Patient' as Prisma.ModelName,
        action: 'findMany',
        args: {
          where: { name: 'John Doe' }
        },
        dataPath: [],
        runInTransaction: false
      };

      await runWithTenantContext(mockTenantContext, async () => {
        await middleware(params, mockNext);
      });

      expect(params.args.where).toEqual({
        AND: [
          { name: 'John Doe' },
          { tenantId: 'tenant-123' }
        ]
      });
      expect(mockNext).toHaveBeenCalledWith(params);
    });

    it('should append to existing AND array', async () => {
      const params: MiddlewareParams = {
        model: 'Patient' as Prisma.ModelName,
        action: 'findMany',
        args: {
          where: {
            AND: [
              { name: 'John Doe' },
              { age: { gte: 18 } }
            ]
          }
        },
        dataPath: [],
        runInTransaction: false
      };

      await runWithTenantContext(mockTenantContext, async () => {
        await middleware(params, mockNext);
      });

      expect(params.args.where).toEqual({
        AND: [
          { name: 'John Doe' },
          { age: { gte: 18 } },
          { tenantId: 'tenant-123' }
        ]
      });
    });

    it('should handle AND as single object', async () => {
      const params: MiddlewareParams = {
        model: 'Patient' as Prisma.ModelName,
        action: 'findMany',
        args: {
          where: {
            AND: { name: 'John Doe' }
          }
        },
        dataPath: [],
        runInTransaction: false
      };

      await runWithTenantContext(mockTenantContext, async () => {
        await middleware(params, mockNext);
      });

      expect(params.args.where).toEqual({
        AND: [
          { name: 'John Doe' },
          { tenantId: 'tenant-123' }
        ]
      });
    });
  });

  describe('findFirst operation', () => {
    it('should add tenantId filter to findFirst', async () => {
      const params: MiddlewareParams = {
        model: 'CallSession' as Prisma.ModelName,
        action: 'findFirst',
        args: {
          where: { status: 'ACTIVE' }
        },
        dataPath: [],
        runInTransaction: false
      };

      await runWithTenantContext(mockTenantContext, async () => {
        await middleware(params, mockNext);
      });

      expect(params.args.where).toEqual({
        AND: [
          { status: 'ACTIVE' },
          { tenantId: 'tenant-123' }
        ]
      });
    });
  });

  describe('findUnique operation', () => {
    it('should add tenantId filter to findUnique', async () => {
      const params: MiddlewareParams = {
        model: 'Patient' as Prisma.ModelName,
        action: 'findUnique',
        args: {
          where: { id: 'patient-456' }
        },
        dataPath: [],
        runInTransaction: false
      };

      await runWithTenantContext(mockTenantContext, async () => {
        await middleware(params, mockNext);
      });

      expect(params.args.where).toEqual({
        id: 'patient-456',
        tenantId: 'tenant-123'
      });
    });
  });

  describe('update operation', () => {
    it('should add tenantId filter to update', async () => {
      const params: MiddlewareParams = {
        model: 'Patient' as Prisma.ModelName,
        action: 'update',
        args: {
          where: { id: 'patient-456' },
          data: { name: 'Jane Doe' }
        },
        dataPath: [],
        runInTransaction: false
      };

      await runWithTenantContext(mockTenantContext, async () => {
        await middleware(params, mockNext);
      });

      expect(params.args.where).toEqual({
        id: 'patient-456',
        tenantId: 'tenant-123'
      });
      expect(params.args.data).toEqual({ name: 'Jane Doe' });
    });
  });

  describe('updateMany operation', () => {
    it('should add tenantId filter to updateMany', async () => {
      const params: MiddlewareParams = {
        model: 'ScheduledCall' as Prisma.ModelName,
        action: 'updateMany',
        args: {
          where: { status: 'PENDING' },
          data: { status: 'CANCELLED' }
        },
        dataPath: [],
        runInTransaction: false
      };

      await runWithTenantContext(mockTenantContext, async () => {
        await middleware(params, mockNext);
      });

      expect(params.args.where).toEqual({
        AND: [
          { status: 'PENDING' },
          { tenantId: 'tenant-123' }
        ]
      });
    });
  });

  describe('delete operation', () => {
    it('should add tenantId filter to delete', async () => {
      const params: MiddlewareParams = {
        model: 'ClinicalEvent' as Prisma.ModelName,
        action: 'delete',
        args: {
          where: { id: 'event-789' }
        },
        dataPath: [],
        runInTransaction: false
      };

      await runWithTenantContext(mockTenantContext, async () => {
        await middleware(params, mockNext);
      });

      expect(params.args.where).toEqual({
        id: 'event-789',
        tenantId: 'tenant-123'
      });
    });
  });

  describe('deleteMany operation', () => {
    it('should add tenantId filter to deleteMany', async () => {
      const params: MiddlewareParams = {
        model: 'KnowledgeGraph' as Prisma.ModelName,
        action: 'deleteMany',
        args: {
          where: { type: 'OUTDATED' }
        },
        dataPath: [],
        runInTransaction: false
      };

      await runWithTenantContext(mockTenantContext, async () => {
        await middleware(params, mockNext);
      });

      expect(params.args.where).toEqual({
        AND: [
          { type: 'OUTDATED' },
          { tenantId: 'tenant-123' }
        ]
      });
    });
  });

  describe('count operation', () => {
    it('should add tenantId filter to count', async () => {
      const params: MiddlewareParams = {
        model: 'Patient' as Prisma.ModelName,
        action: 'count',
        args: {
          where: { status: 'ACTIVE' }
        },
        dataPath: [],
        runInTransaction: false
      };

      await runWithTenantContext(mockTenantContext, async () => {
        await middleware(params, mockNext);
      });

      expect(params.args.where).toEqual({
        AND: [
          { status: 'ACTIVE' },
          { tenantId: 'tenant-123' }
        ]
      });
    });
  });

  describe('aggregate operation', () => {
    it('should add tenantId filter to aggregate', async () => {
      const params: MiddlewareParams = {
        model: 'CallSession' as Prisma.ModelName,
        action: 'aggregate',
        args: {
          where: { duration: { gte: 300 } },
          _avg: { duration: true }
        },
        dataPath: [],
        runInTransaction: false
      };

      await runWithTenantContext(mockTenantContext, async () => {
        await middleware(params, mockNext);
      });

      expect(params.args.where).toEqual({
        AND: [
          { duration: { gte: 300 } },
          { tenantId: 'tenant-123' }
        ]
      });
    });
  });

  describe('create operation', () => {
    it('should inject tenantId into create operation', async () => {
      const params: MiddlewareParams = {
        model: 'Patient' as Prisma.ModelName,
        action: 'create',
        args: {
          data: { name: 'John Doe', email: 'john@example.com' }
        },
        dataPath: [],
        runInTransaction: false
      };

      await runWithTenantContext(mockTenantContext, async () => {
        await middleware(params, mockNext);
      });

      expect(params.args.data).toEqual({
        name: 'John Doe',
        email: 'john@example.com',
        tenantId: 'tenant-123'
      });
    });

    it('should not override existing tenantId in create', async () => {
      const params: MiddlewareParams = {
        model: 'Patient' as Prisma.ModelName,
        action: 'create',
        args: {
          data: {
            name: 'John Doe',
            tenantId: 'tenant-999' // Explicitly provided
          }
        },
        dataPath: [],
        runInTransaction: false
      };

      await runWithTenantContext(mockTenantContext, async () => {
        await middleware(params, mockNext);
      });

      // Should preserve the explicitly provided tenantId
      expect(params.args.data.tenantId).toBe('tenant-999');
    });
  });

  describe('createMany operation', () => {
    it('should inject tenantId into createMany operation', async () => {
      const params: MiddlewareParams = {
        model: 'ClinicalEvent' as Prisma.ModelName,
        action: 'createMany',
        args: {
          data: [
            { type: 'APPOINTMENT', description: 'Event 1' },
            { type: 'MEDICATION', description: 'Event 2' }
          ]
        },
        dataPath: [],
        runInTransaction: false
      };

      await runWithTenantContext(mockTenantContext, async () => {
        await middleware(params, mockNext);
      });

      expect(params.args.data).toEqual([
        { type: 'APPOINTMENT', description: 'Event 1', tenantId: 'tenant-123' },
        { type: 'MEDICATION', description: 'Event 2', tenantId: 'tenant-123' }
      ]);
    });

    it('should not override existing tenantId in createMany', async () => {
      const params: MiddlewareParams = {
        model: 'ClinicalEvent' as Prisma.ModelName,
        action: 'createMany',
        args: {
          data: [
            { type: 'APPOINTMENT', description: 'Event 1', tenantId: 'tenant-999' },
            { type: 'MEDICATION', description: 'Event 2' }
          ]
        },
        dataPath: [],
        runInTransaction: false
      };

      await runWithTenantContext(mockTenantContext, async () => {
        await middleware(params, mockNext);
      });

      expect(params.args.data).toEqual([
        { type: 'APPOINTMENT', description: 'Event 1', tenantId: 'tenant-999' },
        { type: 'MEDICATION', description: 'Event 2', tenantId: 'tenant-123' }
      ]);
    });
  });

  describe('Super-admin bypass', () => {
    it('should skip filtering for super-admin', async () => {
      const superAdminContext: TenantContext = {
        ...mockTenantContext,
        isSuperAdmin: true
      };

      const params: MiddlewareParams = {
        model: 'Patient' as Prisma.ModelName,
        action: 'findMany',
        args: {
          where: { name: 'John Doe' }
        },
        dataPath: [],
        runInTransaction: false
      };

      await runWithTenantContext(superAdminContext, async () => {
        await middleware(params, mockNext);
      });

      // Should not modify where clause
      expect(params.args.where).toEqual({ name: 'John Doe' });
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Super-admin bypass')
      );
    });
  });

  describe('Missing tenant context', () => {
    it('should warn when tenant context is missing', async () => {
      const params: MiddlewareParams = {
        model: 'Patient' as Prisma.ModelName,
        action: 'findMany',
        args: {},
        dataPath: [],
        runInTransaction: false
      };

      // Call middleware WITHOUT tenant context
      await middleware(params, mockNext);

      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('No tenant context found')
      );
      expect(mockNext).toHaveBeenCalledWith(params);
      // Should not have added where clause
      expect(params.args.where).toBeUndefined();
    });

    it('should allow query to proceed without tenant context', async () => {
      const params: MiddlewareParams = {
        model: 'CallSession' as Prisma.ModelName,
        action: 'findFirst',
        args: {
          where: { id: 'session-123' }
        },
        dataPath: [],
        runInTransaction: false
      };

      await middleware(params, mockNext);

      expect(mockNext).toHaveBeenCalledWith(params);
      // Where clause should remain unchanged
      expect(params.args.where).toEqual({ id: 'session-123' });
    });
  });

  describe('Complex where clauses', () => {
    it('should handle OR conditions correctly', async () => {
      const params: MiddlewareParams = {
        model: 'Patient' as Prisma.ModelName,
        action: 'findMany',
        args: {
          where: {
            OR: [
              { name: 'John' },
              { name: 'Jane' }
            ]
          }
        },
        dataPath: [],
        runInTransaction: false
      };

      await runWithTenantContext(mockTenantContext, async () => {
        await middleware(params, mockNext);
      });

      expect(params.args.where).toEqual({
        AND: [
          {
            OR: [
              { name: 'John' },
              { name: 'Jane' }
            ]
          },
          { tenantId: 'tenant-123' }
        ]
      });
    });

    it('should handle nested conditions', async () => {
      const params: MiddlewareParams = {
        model: 'CallSession' as Prisma.ModelName,
        action: 'findMany',
        args: {
          where: {
            patient: {
              name: 'John Doe'
            },
            status: 'ACTIVE'
          }
        },
        dataPath: [],
        runInTransaction: false
      };

      await runWithTenantContext(mockTenantContext, async () => {
        await middleware(params, mockNext);
      });

      expect(params.args.where).toEqual({
        AND: [
          {
            patient: {
              name: 'John Doe'
            },
            status: 'ACTIVE'
          },
          { tenantId: 'tenant-123' }
        ]
      });
    });
  });

  describe('Logging', () => {
    it('should log when applying tenant filter', async () => {
      const params: MiddlewareParams = {
        model: 'Patient' as Prisma.ModelName,
        action: 'findMany',
        args: {},
        dataPath: [],
        runInTransaction: false
      };

      await runWithTenantContext(mockTenantContext, async () => {
        await middleware(params, mockNext);
      });

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Applied tenant filter: Patient.findMany')
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('tenant: test-tenant')
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('tenantId: tenant-123')
      );
    });

    it('should log when injecting tenantId for create', async () => {
      const params: MiddlewareParams = {
        model: 'Patient' as Prisma.ModelName,
        action: 'create',
        args: {
          data: { name: 'John Doe' }
        },
        dataPath: [],
        runInTransaction: false
      };

      await runWithTenantContext(mockTenantContext, async () => {
        await middleware(params, mockNext);
      });

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Injected tenantId for Patient.create')
      );
    });
  });
});
