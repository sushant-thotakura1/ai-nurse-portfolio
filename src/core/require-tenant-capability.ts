import { RequestHandler } from 'express';
import { getTenantContext } from './tenant-context-storage';
import { getTenantFeatures } from './tenant-features';
import { logger } from './logger';

/**
 * Route guard: allow the request through only if the current tenant has the
 * named standalone capability enabled (Tenant.settings.features.enabledCapabilities).
 *
 * Mount AFTER tenantMiddleware (which populates the tenant context). A tenant
 * without the capability gets a 404 — the capability stays undiscoverable.
 * Fails closed: no tenant context, or a feature-lookup error, also yields 404.
 */
export function requireTenantCapability(capability: string): RequestHandler {
  return async (_req, res, next) => {
    const ctx = getTenantContext();
    if (!ctx) {
      logger.warn('requireTenantCapability: no tenant context', { capability });
      res.status(404).json({ error: 'Not found' });
      return;
    }
    let allowed: boolean;
    try {
      const features = await getTenantFeatures(ctx.tenantId);
      allowed = features.enabledCapabilities.includes(capability);
    } catch (err: any) {
      logger.error('requireTenantCapability: feature lookup failed', {
        capability,
        tenantId: ctx.tenantId,
        error: err?.message,
      });
      res.status(404).json({ error: 'Not found' });
      return;
    }

    // next() is deliberately outside the try — a synchronous throw from a
    // downstream handler must not be caught here and masked as a 404.
    if (allowed) {
      next();
      return;
    }
    res.status(404).json({ error: 'Not found' });
  };
}
