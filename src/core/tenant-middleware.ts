import { Request, Response, NextFunction } from 'express';
import { PrismaClient, Tenant } from '@prisma/client';
import { TenantContext } from './types';
import { runWithTenantContext } from './tenant-context-storage';

// Cache structure: tenantId -> { tenant, cachedAt }
interface CachedTenant {
  tenant: Tenant;
  cachedAt: number;
}

// In-memory cache for tenant data
const tenantCache = new Map<string, CachedTenant>();

// Cache TTL: 5 minutes (300000 ms)
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Tenant Middleware
 *
 * Extracts tenantId from URL parameters, validates the tenant exists,
 * caches tenant data, and attaches TenantContext to Express requests.
 *
 * Usage: Apply to routes with `:tenantId` parameter
 * Example: app.use('/v1/api/:tenantId', tenantMiddleware, routes);
 */
export function createTenantMiddleware(prisma: PrismaClient) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Extract tenantId from route parameters
      const tenantIdParam = req.params.tenantId;

      // Handle string array case (Express can return string[])
      const tenantId = Array.isArray(tenantIdParam) ? tenantIdParam[0] : tenantIdParam;

      // Validate tenantId parameter exists
      if (!tenantId) {
        console.warn('[TenantMiddleware] Missing tenantId parameter in route');
        res.status(404).json({
          error: 'Tenant not found',
          message: 'Tenant ID is required in the URL path'
        });
        return;
      }

      console.log(`[TenantMiddleware] Processing request for tenant: ${tenantId}`);

      // Check cache first
      const cached = tenantCache.get(tenantId);
      const now = Date.now();

      let tenant: Tenant | null = null;

      if (cached && (now - cached.cachedAt) < CACHE_TTL_MS) {
        // Cache hit and still valid
        console.log(`[TenantMiddleware] Cache hit for tenant: ${tenantId}`);
        tenant = cached.tenant;
      } else {
        // Cache miss or expired - query database
        console.log(`[TenantMiddleware] Cache miss for tenant: ${tenantId}, querying database`);

        // Try to find by slug first (for user-friendly URLs), then by ID (for UUID-based access)
        tenant = await prisma.tenant.findUnique({
          where: { slug: tenantId }
        });

        // If not found by slug, try by ID (for backward compatibility)
        if (!tenant) {
          tenant = await prisma.tenant.findUnique({
            where: { id: tenantId }
          });
        }

        if (tenant) {
          // Update cache (use the slug as the cache key for consistency)
          const cacheKey = tenant.slug;
          tenantCache.set(cacheKey, {
            tenant,
            cachedAt: now
          });
          // Also cache by ID for backward compatibility
          if (tenant.id !== cacheKey) {
            tenantCache.set(tenant.id, {
              tenant,
              cachedAt: now
            });
          }
          console.log(`[TenantMiddleware] Cached tenant: ${tenant.slug} (${tenant.id})`);
        }
      }

      // Validate tenant exists
      if (!tenant) {
        console.warn(`[TenantMiddleware] Tenant not found: ${tenantId}`);
        res.status(404).json({
          error: 'Tenant not found',
          message: `Tenant with slug or ID '${tenantId}' does not exist`
        });
        return;
      }

      // Validate tenant is active
      if (tenant.status !== 'ACTIVE') {
        console.warn(`[TenantMiddleware] Tenant is not active: ${tenantId}, status: ${tenant.status}`);
        res.status(403).json({
          error: 'Tenant access forbidden',
          message: `Tenant '${tenant.slug}' is not active`
        });
        return;
      }

      // Create TenantContext
      const tenantContext: TenantContext = {
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        tenant,
        // TODO: Implement super-admin access detection
        // This will be based on authenticated user's role
        isSuperAdmin: false
      };

      // Attach TenantContext to request
      // Note: Using AsyncLocalStorage instead of attaching to request
      // req.tenantContext = tenantContext;
      (req as any).tenantContext = tenantContext; // Using any to bypass type checking

      console.log(`[TenantMiddleware] Tenant context attached: ${tenant.slug} (${tenantId})`);

      // Wrap the rest of the request handling with AsyncLocalStorage context
      // This allows any code in the request chain to access tenant context via getTenantContext()
      return runWithTenantContext(tenantContext, () => {
        next();
      });
    } catch (error) {
      console.error('[TenantMiddleware] Error processing tenant middleware:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to process tenant context'
      });
    }
  };
}

/**
 * Clear the tenant cache
 * Useful for testing and manual cache invalidation
 */
export function clearTenantCache(): void {
  tenantCache.clear();
  console.log('[TenantMiddleware] Cache cleared');
}

/**
 * Invalidate a specific tenant in the cache
 * Useful when tenant data is updated
 */
export function invalidateTenantCache(tenantId: string): void {
  tenantCache.delete(tenantId);
  console.log(`[TenantMiddleware] Cache invalidated for tenant: ${tenantId}`);
}

/**
 * Get cache statistics
 * Useful for monitoring and debugging
 */
export function getCacheStats(): { size: number; tenantIds: string[] } {
  return {
    size: tenantCache.size,
    tenantIds: Array.from(tenantCache.keys())
  };
}
