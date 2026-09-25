// src/core/features.routes.ts
import { Router, Request, Response } from 'express';
import { getTenantContext } from './tenant-context-storage';
import { getTenantFeatures } from './tenant-features';
import { logger } from './logger';

/**
 * GET /v1/api/:tenantId/features
 *
 * Tenant-scoped, unauthenticated (mount behind tenantMiddleware only — NOT
 * behind any capability guard, since a tenant without screening must still be
 * able to learn that it does not have it). Feeds dashboard nav visibility.
 */
export const featuresRouter = Router();

featuresRouter.get('/', async (_req: Request, res: Response) => {
  const ctx = getTenantContext();
  if (!ctx) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  try {
    const features = await getTenantFeatures(ctx.tenantId);
    res.json({
      enabledSkills: features.enabledSkills,
      enabledCapabilities: features.enabledCapabilities,
    });
  } catch (err: any) {
    logger.error('GET /features failed', { tenantId: ctx.tenantId, error: err.message });
    res.status(500).json({ error: 'Failed to load features' });
  }
});
