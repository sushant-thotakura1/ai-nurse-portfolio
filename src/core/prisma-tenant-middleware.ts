import { Prisma } from '@prisma/client';
import { getTenantContext } from './tenant-context-storage';

/**
 * List of Prisma models that are tenant-scoped
 * These models have a tenantId field and should be automatically filtered
 */
const TENANT_SCOPED_MODELS = [
  'Patient',
  'CallSession',
  'KnowledgeGraph',
  'ScheduledCall',
  'ClinicalEvent',
  'TenantDocument',
  'MessageSession',   // messaging channel sessions
  'ProviderConfig',   // provider credentials are tenant-scoped
  'ScreeningRecord',  // adult vaccination screening records
];

/**
 * List of Prisma models that are NOT tenant-scoped
 * These models should never be filtered by tenantId
 */
const NON_TENANT_MODELS = [
  'User',
  'Tenant',
  'TenantUser'
];

/**
 * Check if a model is tenant-scoped
 */
function isTenantScopedModel(modelName: string): boolean {
  return TENANT_SCOPED_MODELS.includes(modelName);
}

/**
 * Prisma Middleware for Automatic Tenant Filtering
 *
 * This middleware intercepts all Prisma queries and automatically adds
 * tenantId filtering for tenant-scoped models. It uses AsyncLocalStorage
 * to get the current tenant context without explicit passing.
 *
 * Features:
 * - Automatic tenantId filtering for all CRUD operations
 * - Merges with existing where clauses
 * - Skips filtering for non-tenant models
 * - Super-admin bypass (if isSuperAdmin is true)
 * - Logging for debugging and security
 *
 * @returns Prisma middleware function
 */
export function createPrismaTenantMiddleware(): Prisma.Middleware {
  return async (params, next) => {
    const { model, action } = params;

    // Skip if no model name (raw queries, etc.)
    if (!model) {
      return next(params);
    }

    // Skip non-tenant-scoped models
    if (!isTenantScopedModel(model)) {
      return next(params);
    }

    // Get tenant context from AsyncLocalStorage
    const tenantContext = getTenantContext();

    // If no tenant context, log warning but continue
    // This allows the query to proceed, which will likely fail with proper error
    if (!tenantContext) {
      console.warn(
        `[PrismaTenantMiddleware] WARNING: No tenant context found for ${model}.${action}. ` +
        `Query will proceed without tenant filtering. This may be intentional (e.g., in tests or background jobs), ` +
        `but could also indicate a security issue if this is a user request.`
      );
      return next(params);
    }

    // Super-admin bypass: skip filtering if user is super-admin
    if (tenantContext.isSuperAdmin) {
      console.log(
        `[PrismaTenantMiddleware] Super-admin bypass for ${model}.${action} ` +
        `(tenant: ${tenantContext.tenantSlug})`
      );
      return next(params);
    }

    // Apply tenant filtering based on operation type
    const operations = [
      'findUnique',
      'findFirst',
      'findMany',
      'update',
      'updateMany',
      'delete',
      'deleteMany',
      'count',
      'aggregate'
    ];

    if (operations.includes(action)) {
      // Add tenantId filter to where clause
      const tenantFilter = { tenantId: tenantContext.tenantId };

      if (!params.args) {
        params.args = {};
      }

      if (!params.args.where) {
        // No existing where clause - just add tenant filter
        params.args.where = tenantFilter;
      } else {
        // For operations using unique identifiers (update, delete, findUnique),
        // add tenantId directly to the where clause to maintain unique constraint
        const uniqueOperations = ['update', 'delete', 'findUnique'];

        if (uniqueOperations.includes(action)) {
          // Simply add tenantId to the existing where clause
          params.args.where.tenantId = tenantContext.tenantId;
        } else {
          // For other operations (findMany, updateMany, etc.), use AND to merge
          const existingWhere = params.args.where;

          // If the existing where clause is already an AND array, append to it
          if (existingWhere.AND) {
            if (Array.isArray(existingWhere.AND)) {
              existingWhere.AND.push(tenantFilter);
            } else {
              existingWhere.AND = [existingWhere.AND, tenantFilter];
            }
          } else {
            // Wrap existing where and tenant filter in AND
            params.args.where = {
              AND: [existingWhere, tenantFilter]
            };
          }
        }
      }

      console.log(
        `[PrismaTenantMiddleware] Applied tenant filter: ${model}.${action} ` +
        `(tenant: ${tenantContext.tenantSlug}, tenantId: ${tenantContext.tenantId})`
      );
    }

    // Special handling for create operations
    if (action === 'create' || action === 'createMany') {
      // For create operations, inject tenantId into the data
      if (!params.args) {
        params.args = {};
      }

      if (action === 'create') {
        if (!params.args.data) {
          params.args.data = {};
        }
        // Only set tenantId if not already provided
        if (!params.args.data.tenantId) {
          params.args.data.tenantId = tenantContext.tenantId;
        }
      } else if (action === 'createMany') {
        if (params.args.data && Array.isArray(params.args.data)) {
          params.args.data = params.args.data.map((item: any) => {
            // Only set tenantId if not already provided
            if (!item.tenantId) {
              return { ...item, tenantId: tenantContext.tenantId };
            }
            return item;
          });
        }
      }

      console.log(
        `[PrismaTenantMiddleware] Injected tenantId for ${model}.${action} ` +
        `(tenant: ${tenantContext.tenantSlug}, tenantId: ${tenantContext.tenantId})`
      );
    }

    return next(params);
  };
}

/**
 * Export list of tenant-scoped models for testing and documentation
 */
export { TENANT_SCOPED_MODELS, NON_TENANT_MODELS };
