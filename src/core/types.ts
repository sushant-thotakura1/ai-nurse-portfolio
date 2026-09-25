import { Tenant } from '@prisma/client';

/**
 * TenantContext carries tenant information through the request lifecycle.
 * This context is extracted from the URL (/v1/api/:tenantId/...) by tenant middleware
 * and passed to all services for tenant-scoped operations.
 */
export interface TenantContext {
  /**
   * The tenant ID from the URL parameter
   */
  tenantId: string;

  /**
   * The tenant slug (e.g., 'rean-foundation')
   * Used for validation and logging
   */
  tenantSlug: string;

  /**
   * Cached tenant record from the database
   * Populated by tenant middleware to avoid repeated DB queries
   */
  tenant: Tenant;

  /**
   * Whether this is a super-admin context
   * Super-admins can access data across all tenants
   */
  isSuperAdmin: boolean;
}

/**
 * User context for authentication and authorization
 */
export interface UserContext {
  userId: string;
  email: string;
  role: string;
}

/**
 * Complete request context combining tenant and user information
 */
export interface RequestContext {
  tenant: TenantContext;
  user?: UserContext; // Optional because some endpoints might not require auth
}
