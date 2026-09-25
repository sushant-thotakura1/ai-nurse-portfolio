// src/admin/__tests__/tenants.routes.test.ts
import request from 'supertest';
import express from 'express';

jest.mock('../auth/middleware', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { email: 'admin@test.com', role: 'super_admin' };
    next();
  },
  requireRole: (..._roles: string[]) => (_req: any, _res: any, next: any) => next(),
}));

async function buildApp() {
  const { tenantsRouter } = await import('../tenants.routes');
  const app = express();
  app.use(express.json());
  app.use('/v1/api/admin', tenantsRouter);
  return app;
}

describe('GET /v1/api/admin/capabilities', () => {
  it('returns the registered standalone tenant capabilities', async () => {
    const app = await buildApp();
    const res = await request(app).get('/v1/api/admin/capabilities');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      capabilities: [{ name: 'screening', label: 'Screening' }],
    });
  });
});

describe('GET /v1/api/admin/skills', () => {
  it('still lists the registered conversation skills after the import-path change', async () => {
    const app = await buildApp();
    const res = await request(app).get('/v1/api/admin/skills');
    expect(res.status).toBe(200);
    const names = (res.body.skills as Array<{ name: string }>).map((s) => s.name);
    expect(names).toContain('symptom_check');
    expect(names).toContain('qa');
  });
});
