import { Request, Response, NextFunction } from 'express';
import { PrismaClient, Tenant } from '@prisma/client';
import {
  createTenantMiddleware,
  clearTenantCache,
  invalidateTenantCache,
  getCacheStats
} from '../tenant-middleware';

// Mock Prisma Client
jest.mock('@prisma/client', () => {
  const mockPrismaClient = {
    tenant: {
      findUnique: jest.fn()
    }
  };
  return {
    PrismaClient: jest.fn(() => mockPrismaClient)
  };
});

describe('Tenant Middleware', () => {
  let prisma: PrismaClient;
  let middleware: ReturnType<typeof createTenantMiddleware>;
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;

  const mockActiveTenant: Tenant = {
    id: 'tenant-123',
    name: 'Test Tenant',
    slug: 'test-tenant',
    status: 'ACTIVE',
    settings: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01')
  };

  const mockInactiveTenant: Tenant = {
    id: 'tenant-456',
    name: 'Inactive Tenant',
    slug: 'inactive-tenant',
    status: 'INACTIVE',
    settings: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01')
  };

  beforeEach(() => {
    // Clear cache before each test
    clearTenantCache();

    // Create new Prisma instance
    prisma = new PrismaClient();

    // Create middleware
    middleware = createTenantMiddleware(prisma);

    // Setup mock response
    jsonMock = jest.fn();
    statusMock = jest.fn().mockReturnValue({ json: jsonMock });
    mockResponse = {
      status: statusMock,
      json: jsonMock
    };

    // Setup mock request
    mockRequest = {
      params: {}
    };

    // Setup mock next
    mockNext = jest.fn();

    // Reset mocks
    jest.clearAllMocks();
  });

  afterEach(() => {
    clearTenantCache();
  });

  describe('Valid tenant extraction', () => {
    it('should extract valid tenant and attach to request', async () => {
      mockRequest.params = { tenantId: 'tenant-123' };
      (prisma.tenant.findUnique as jest.Mock).mockResolvedValue(mockActiveTenant);

      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      // Middleware looks up by slug first
      expect(prisma.tenant.findUnique).toHaveBeenCalledWith({
        where: { slug: 'tenant-123' }
      });
      expect(mockRequest.tenantContext).toBeDefined();
      expect(mockRequest.tenantContext?.tenantId).toBe('tenant-123');
      expect(mockRequest.tenantContext?.tenantSlug).toBe('test-tenant');
      expect(mockRequest.tenantContext?.tenant).toEqual(mockActiveTenant);
      expect(mockRequest.tenantContext?.isSuperAdmin).toBe(false);
      expect(mockNext).toHaveBeenCalled();
      expect(statusMock).not.toHaveBeenCalled();
    });

    it('should attach full tenant object to context', async () => {
      mockRequest.params = { tenantId: 'tenant-123' };
      (prisma.tenant.findUnique as jest.Mock).mockResolvedValue(mockActiveTenant);

      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockRequest.tenantContext?.tenant).toMatchObject({
        id: 'tenant-123',
        name: 'Test Tenant',
        slug: 'test-tenant',
        status: 'ACTIVE'
      });
    });
  });

  describe('Missing tenantId parameter', () => {
    it('should return 404 when tenantId is not in params', async () => {
      mockRequest.params = {};

      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(404);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'Tenant not found',
        message: 'Tenant ID is required in the URL path'
      });
      expect(mockNext).not.toHaveBeenCalled();
      expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
    });

    it('should return 404 when tenantId is empty string', async () => {
      mockRequest.params = { tenantId: '' };

      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(404);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'Tenant not found',
        message: 'Tenant ID is required in the URL path'
      });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('Invalid tenant (404)', () => {
    it('should return 404 when tenant does not exist', async () => {
      mockRequest.params = { tenantId: 'nonexistent-tenant' };
      (prisma.tenant.findUnique as jest.Mock).mockResolvedValue(null);

      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      // Middleware tries slug first, then id (both return null)
      expect(prisma.tenant.findUnique).toHaveBeenCalledWith({
        where: { slug: 'nonexistent-tenant' }
      });
      expect(statusMock).toHaveBeenCalledWith(404);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'Tenant not found',
        message: "Tenant with slug or ID 'nonexistent-tenant' does not exist"
      });
      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRequest.tenantContext).toBeUndefined();
    });
  });

  describe('Inactive tenant (403)', () => {
    it('should return 403 when tenant status is not ACTIVE', async () => {
      mockRequest.params = { tenantId: 'tenant-456' };
      (prisma.tenant.findUnique as jest.Mock).mockResolvedValue(mockInactiveTenant);

      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      // Middleware tries slug first
      expect(prisma.tenant.findUnique).toHaveBeenCalledWith({
        where: { slug: 'tenant-456' }
      });
      expect(statusMock).toHaveBeenCalledWith(403);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'Tenant access forbidden',
        message: "Tenant 'inactive-tenant' is not active"
      });
      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRequest.tenantContext).toBeUndefined();
    });

    it('should return 403 for SUSPENDED tenant', async () => {
      const suspendedTenant = { ...mockActiveTenant, status: 'SUSPENDED', slug: 'suspended' };
      mockRequest.params = { tenantId: 'tenant-789' };
      (prisma.tenant.findUnique as jest.Mock).mockResolvedValue(suspendedTenant);

      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(403);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'Tenant access forbidden',
        message: "Tenant 'suspended' is not active"
      });
    });
  });

  describe('Caching behavior', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should cache tenant after first request', async () => {
      mockRequest.params = { tenantId: 'tenant-123' };
      (prisma.tenant.findUnique as jest.Mock).mockResolvedValue(mockActiveTenant);

      // First request - should query database
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);
      expect(prisma.tenant.findUnique).toHaveBeenCalledTimes(1);
      expect(mockNext).toHaveBeenCalledTimes(1);

      // Verify cache stats - middleware caches by both slug and id, so 2 entries
      const stats = getCacheStats();
      expect(stats.size).toBe(2);
      expect(stats.tenantIds).toContain('tenant-123');

      // Reset mocks
      jest.clearAllMocks();

      // Second request - should use cache
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);
      expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockRequest.tenantContext?.tenantId).toBe('tenant-123');
    });

    it('should refresh cache after TTL expires (5 minutes)', async () => {
      mockRequest.params = { tenantId: 'tenant-123' };
      (prisma.tenant.findUnique as jest.Mock).mockResolvedValue(mockActiveTenant);

      // First request - should query database
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);
      expect(prisma.tenant.findUnique).toHaveBeenCalledTimes(1);

      // Advance time by 6 minutes (beyond 5-minute TTL)
      jest.advanceTimersByTime(6 * 60 * 1000);

      // Reset mocks
      jest.clearAllMocks();

      // Second request - should query database again (cache expired)
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);
      expect(prisma.tenant.findUnique).toHaveBeenCalledTimes(1);
      expect(mockNext).toHaveBeenCalledTimes(1);
    });

    it('should use cache within TTL window', async () => {
      mockRequest.params = { tenantId: 'tenant-123' };
      (prisma.tenant.findUnique as jest.Mock).mockResolvedValue(mockActiveTenant);

      // First request
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);
      expect(prisma.tenant.findUnique).toHaveBeenCalledTimes(1);

      // Advance time by 4 minutes (within 5-minute TTL)
      jest.advanceTimersByTime(4 * 60 * 1000);

      // Reset mocks
      jest.clearAllMocks();

      // Second request - should still use cache
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);
      expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalledTimes(1);
    });

    it('should cache multiple tenants independently', async () => {
      (prisma.tenant.findUnique as jest.Mock)
        .mockResolvedValueOnce(mockActiveTenant)
        .mockResolvedValueOnce({ ...mockActiveTenant, id: 'tenant-999', slug: 'tenant-999' });

      // Request for first tenant
      mockRequest.params = { tenantId: 'tenant-123' };
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);
      expect(prisma.tenant.findUnique).toHaveBeenCalledTimes(1);

      // Request for second tenant
      mockRequest.params = { tenantId: 'tenant-999' };
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);
      expect(prisma.tenant.findUnique).toHaveBeenCalledTimes(2);

      // Verify both are cached
      // First tenant (id='tenant-123', slug='test-tenant') stores 2 cache entries (slug + id)
      // Second tenant (id='tenant-999', slug='tenant-999') stores 1 cache entry (slug=id)
      const stats = getCacheStats();
      expect(stats.size).toBe(3);
      expect(stats.tenantIds).toContain('tenant-123');
      expect(stats.tenantIds).toContain('tenant-999');
    });
  });

  describe('Cache management functions', () => {
    it('should clear all cached tenants', async () => {
      mockRequest.params = { tenantId: 'tenant-123' };
      (prisma.tenant.findUnique as jest.Mock).mockResolvedValue(mockActiveTenant);

      // Cache a tenant - middleware stores 2 entries (by slug + by id) when slug != id
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);
      expect(getCacheStats().size).toBe(2);

      // Clear cache
      clearTenantCache();
      expect(getCacheStats().size).toBe(0);
      expect(getCacheStats().tenantIds).toEqual([]);
    });

    it('should invalidate specific tenant from cache', async () => {
      (prisma.tenant.findUnique as jest.Mock)
        .mockResolvedValueOnce(mockActiveTenant)
        .mockResolvedValueOnce({ ...mockActiveTenant, id: 'tenant-999', slug: 'tenant-999' });

      // Cache two tenants
      mockRequest.params = { tenantId: 'tenant-123' };
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      mockRequest.params = { tenantId: 'tenant-999' };
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      // First tenant (id='tenant-123', slug='test-tenant') = 2 cache entries
      // Second tenant (id='tenant-999', slug='tenant-999') = 1 cache entry
      expect(getCacheStats().size).toBe(3);

      // Invalidate one tenant by id key
      invalidateTenantCache('tenant-123');

      const stats = getCacheStats();
      // After removing 'tenant-123' key, 'test-tenant' key and 'tenant-999' key remain
      expect(stats.size).toBe(2);
      expect(stats.tenantIds).toContain('tenant-999');
      expect(stats.tenantIds).not.toContain('tenant-123');
    });

    it('should return correct cache statistics', async () => {
      expect(getCacheStats()).toEqual({ size: 0, tenantIds: [] });

      mockRequest.params = { tenantId: 'tenant-123' };
      (prisma.tenant.findUnique as jest.Mock).mockResolvedValue(mockActiveTenant);
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      // Middleware caches by both slug ('test-tenant') and id ('tenant-123') since they differ
      const stats = getCacheStats();
      expect(stats.size).toBe(2);
      expect(stats.tenantIds).toContain('test-tenant');
      expect(stats.tenantIds).toContain('tenant-123');
    });
  });

  describe('Error handling', () => {
    it('should handle database errors gracefully', async () => {
      mockRequest.params = { tenantId: 'tenant-123' };
      const dbError = new Error('Database connection failed');
      (prisma.tenant.findUnique as jest.Mock).mockRejectedValue(dbError);

      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(500);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'Internal server error',
        message: 'Failed to process tenant context'
      });
      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRequest.tenantContext).toBeUndefined();
    });

    it('should handle unexpected errors during middleware execution', async () => {
      mockRequest.params = { tenantId: 'tenant-123' };
      (prisma.tenant.findUnique as jest.Mock).mockImplementation(() => {
        throw new Error('Unexpected error');
      });

      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(500);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'Internal server error',
        message: 'Failed to process tenant context'
      });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('Super admin functionality', () => {
    it('should set isSuperAdmin to false (placeholder)', async () => {
      mockRequest.params = { tenantId: 'tenant-123' };
      (prisma.tenant.findUnique as jest.Mock).mockResolvedValue(mockActiveTenant);

      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      // TODO: This will be implemented when user authentication is added
      expect(mockRequest.tenantContext?.isSuperAdmin).toBe(false);
    });
  });
});
