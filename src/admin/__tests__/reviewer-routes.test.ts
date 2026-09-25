// src/admin/__tests__/reviewer-routes.test.ts
import request from 'supertest';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';

jest.mock('../auth/middleware', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { email: 'reviewer@test.com', role: 'reviewer' };
    next();
  },
  requireRole: (..._roles: string[]) => (_req: any, _res: any, next: any) => next(),
}));

jest.mock('../services/feedback-store', () => ({
  loadFeedback: jest.fn().mockReturnValue([]),
  saveFeedback: jest.fn(),
  approveScenario: jest.fn(),
}));

jest.mock('../auth/user.service', () => ({
  findUserByEmail: jest.fn().mockResolvedValue({
    email: 'reviewer@test.com',
    role: 'reviewer',
    conditions: ['cardiac_surgery'],
  }),
}));

let tmpBase: string;

beforeEach(() => {
  tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'reviewer-routes-test-'));
  // Create fake generated dataset structure for allowlist
  const cabgDir = path.join(tmpBase, 'generated', 'cardiac_surgery', 'CABG');
  fs.mkdirSync(cabgDir, { recursive: true });
  fs.writeFileSync(path.join(cabgDir, 'readable.csv'), 'scenario_id,row_type\ns1,greeting', 'utf-8');
  fs.writeFileSync(path.join(cabgDir, 'dataset.csv'), 'scenario_id,row_type\ns1,greeting', 'utf-8');
});

afterEach(() => {
  fs.rmSync(tmpBase, { recursive: true });
  jest.resetModules();
});

async function buildApp() {
  const { createReviewerRouter } = await import('../routes/reviewer');
  const app = express();
  app.use(express.json());
  app.use('/api/reviewer', createReviewerRouter(tmpBase));
  return app;
}

describe('GET /api/reviewer/assignments', () => {
  it('returns assigned conditions with classifications', async () => {
    const app = await buildApp();
    const res = await request(app).get('/api/reviewer/assignments');
    expect(res.status).toBe(200);
    expect(res.body.assignments).toBeDefined();
  });
});

describe('POST /api/reviewer/:condition/:classification/feedback', () => {
  it('returns 400 for unknown condition', async () => {
    const app = await buildApp();
    const res = await request(app)
      .post('/api/reviewer/unknown_condition/CABG/feedback')
      .send({ scenario_id: 's1', row_type: 'greeting', field: 'warm_tone', decision: 'correct' });
    expect(res.status).toBe(400);
  });

  it('returns 200 for valid feedback', async () => {
    const app = await buildApp();
    const res = await request(app)
      .post('/api/reviewer/cardiac_surgery/CABG/feedback')
      .send({ scenario_id: 's1', row_type: 'greeting', field: 'warm_tone', decision: 'correct' });
    expect(res.status).toBe(200);
  });
});
