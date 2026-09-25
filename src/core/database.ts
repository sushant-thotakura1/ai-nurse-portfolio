import { PrismaClient } from '@prisma/client';
import { logger } from './logger';
import { createPrismaTenantMiddleware } from './prisma-tenant-middleware';

const prisma = new PrismaClient({
  log: [
    { level: 'query', emit: 'event' },
    { level: 'error', emit: 'event' },
    { level: 'warn', emit: 'event' },
  ],
});

// Log slow queries
prisma.$on('query', (e) => {
  if (e.duration > 500) {
    logger.warn('Slow query detected', {
      query: e.query,
      duration: e.duration,
      params: e.params,
    });
  }
});

prisma.$on('error', (e) => {
  logger.error('Database error', { message: e.message });
});

// Register tenant middleware for automatic tenant filtering
prisma.$use(createPrismaTenantMiddleware());
logger.info('Prisma tenant middleware registered');

// ── systemPrisma ──────────────────────────────────────────────────────────────
//
// A plain PrismaClient with NO tenant middleware registered.
//
// Use this for system-level lookups (provider credentials, channel config,
// STT/TTS provider config) where the tenantId is supplied EXPLICITLY in the
// WHERE clause and must never be filtered or overridden by AsyncLocalStorage
// context.  Using the tenant-middleware `prisma` for these queries creates a
// risk of cross-tenant credential leakage when multiple tenants' webhook
// endpoints are handling concurrent requests: the ALS store could hold the
// wrong tenant's context when the Prisma middleware reads it, causing one
// tenant's credential query to return another tenant's record.
//
// All other queries (patient, session, transcript, clinical events) should
// continue to use the tenant-scoped `prisma` above.
//
const systemPrisma = new PrismaClient({
  log: [
    { level: 'error', emit: 'event' },
    { level: 'warn',  emit: 'event' },
  ],
});

systemPrisma.$on('error', (e) => {
  logger.error('System database error', { message: e.message });
});

export { prisma, systemPrisma };
