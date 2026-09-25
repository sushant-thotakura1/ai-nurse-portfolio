// src/screening/gated-mount.test.ts
import request from 'supertest';
import express from 'express';

jest.mock('../core/tenant-features', () => ({ getTenantFeatures: jest.fn() }));
jest.mock('./service', () => ({
  screeningService: { start: jest.fn(), submitAnswer: jest.fn(), complete: jest.fn(), getState: jest.fn() },
}));
jest.mock('./records.service', () => ({
  listRecords: jest.fn(),
  getRecordDetail: jest.fn(),
  recordsCsv: jest.fn(),
}));

import { getTenantFeatures } from '../core/tenant-features';
import { runWithTenantContext } from '../core/tenant-context-storage';
import { requireTenantCapability } from '../core/require-tenant-capability';
import screeningRoutes from './routes';
import { screeningService } from './service';
import * as recordsService from './records.service';

function appForTenant(tenantId: string) {
  const app = express();
  app.use(express.json());
  // stand-in for tenantMiddleware: establish the async context the guard reads
  app.use('/v1/api/:tenantId/screening', (req, _res, next) => {
    runWithTenantContext(
      { tenantId, tenantSlug: req.params.tenantId, isSuperAdmin: false } as any,
      () => next(),
    );
  });
  app.use('/v1/api/:tenantId/screening', requireTenantCapability('screening'), screeningRoutes);
  return app;
}

describe('screening mount — capability gate', () => {
  beforeEach(() => jest.clearAllMocks());

  it('lets the request through when the tenant has the screening capability', async () => {
    (getTenantFeatures as jest.Mock).mockResolvedValue({ enabledSkills: [], enabledCapabilities: ['screening'], welcomeMessage: null });
    (screeningService.start as jest.Mock).mockResolvedValue({ id: 'rec-1', status: 'in_progress' });

    const res = await request(appForTenant('tenant-with')).post('/v1/api/tenant-with/screening/sessions').send({ filledBy: 'patient' });

    expect(res.status).toBe(201);
    expect(screeningService.start).toHaveBeenCalledWith('patient');
  });

  it('404s and never calls the service when the tenant lacks the capability', async () => {
    (getTenantFeatures as jest.Mock).mockResolvedValue({ enabledSkills: ['qa'], enabledCapabilities: [], welcomeMessage: null });

    const res = await request(appForTenant('tenant-without')).post('/v1/api/tenant-without/screening/sessions').send({ filledBy: 'patient' });

    expect(res.status).toBe(404);
    expect(screeningService.start).not.toHaveBeenCalled();
  });

  it('404s the state endpoint too when the capability is off', async () => {
    (getTenantFeatures as jest.Mock).mockResolvedValue({ enabledSkills: [], enabledCapabilities: [], welcomeMessage: null });

    const res = await request(appForTenant('t')).get('/v1/api/t/screening/sessions/rec-1/state');

    expect(res.status).toBe(404);
    expect(screeningService.getState).not.toHaveBeenCalled();
  });

  it('404s GET /records and never calls the records service when the capability is off', async () => {
    (getTenantFeatures as jest.Mock).mockResolvedValue({ enabledSkills: ['qa'], enabledCapabilities: [], welcomeMessage: null });

    const res = await request(appForTenant('tenant-without')).get('/v1/api/tenant-without/screening/records');

    expect(res.status).toBe(404);
    expect(recordsService.listRecords).not.toHaveBeenCalled();
  });

  it('reaches the GET /records handler when the tenant has the screening capability', async () => {
    (getTenantFeatures as jest.Mock).mockResolvedValue({ enabledSkills: [], enabledCapabilities: ['screening'], welcomeMessage: null });
    (recordsService.listRecords as jest.Mock).mockResolvedValue({ records: [], total: 0, limit: 25, offset: 0 });

    const res = await request(appForTenant('tenant-with')).get('/v1/api/tenant-with/screening/records');

    expect(res.status).toBe(200);
    expect(recordsService.listRecords).toHaveBeenCalledWith({ status: 'all', limit: 25, offset: 0 });
  });
});
