// src/core/features.routes.test.ts
import request from 'supertest';
import express from 'express';

jest.mock('./tenant-features', () => ({ getTenantFeatures: jest.fn() }));

import { getTenantFeatures } from './tenant-features';
import { runWithTenantContext } from './tenant-context-storage';
import { featuresRouter } from './features.routes';

function appForTenant(tenantId: string | null) {
  const app = express();
  app.use('/v1/api/:tenantId/features', (req, _res, next) => {
    if (tenantId === null) return next();
    runWithTenantContext(
      { tenantId, tenantSlug: req.params.tenantId, isSuperAdmin: false } as any,
      () => next(),
    );
  });
  app.use('/v1/api/:tenantId/features', featuresRouter);
  return app;
}

describe('GET /v1/api/:tenantId/features', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the tenant enabled skills + capabilities', async () => {
    (getTenantFeatures as jest.Mock).mockResolvedValue({
      enabledSkills: ['qa'],
      enabledCapabilities: ['screening'],
      welcomeMessage: 'hi',
    });

    const res = await request(appForTenant('tenant-1')).get('/v1/api/tenant-1/features');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabledSkills: ['qa'], enabledCapabilities: ['screening'] });
    expect(getTenantFeatures).toHaveBeenCalledWith('tenant-1');
  });

  it('404s when there is no tenant context', async () => {
    const res = await request(appForTenant(null)).get('/v1/api/whatever/features');
    expect(res.status).toBe(404);
    expect(getTenantFeatures).not.toHaveBeenCalled();
  });

  it('500s if the feature lookup throws', async () => {
    (getTenantFeatures as jest.Mock).mockRejectedValue(new Error('db down'));
    const res = await request(appForTenant('tenant-1')).get('/v1/api/tenant-1/features');
    expect(res.status).toBe(500);
  });
});
