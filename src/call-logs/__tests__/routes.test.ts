import request from 'supertest';
import express, { Express } from 'express';

const mockGetExportBundle = jest.fn();
jest.mock('../service', () => ({
  callLogsService: {
    getAllCallSessions: jest.fn(),
    getCallSessionById: jest.fn(),
    getTranscriptsBySessionId: jest.fn(),
    getClinicalEventsBySessionId: jest.fn(),
    getExportBundle: (...args: unknown[]) => mockGetExportBundle(...args),
  },
}));

const mockGetTenantContext = jest.fn();
jest.mock('../../core/tenant-context-storage', () => ({
  getTenantContext: () => mockGetTenantContext(),
}));

jest.mock('../../admin/auth/middleware', () => ({
  authMiddleware: jest.fn((req: any, _res: any, next: any) => {
    req.user = { role: (req.headers['x-test-role'] as string) ?? 'admin' };
    next();
  }),
  requireRole: (...roles: string[]) => (req: any, res: any, next: any) => {
    if (!roles.includes(req.user?.role)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    next();
  },
}));

import callLogsRoutes from '../routes';

describe('POST /calls/export', () => {
  let app: Express;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetTenantContext.mockReturnValue({ tenantId: 'tenant-1' });
    app = express();
    app.use(express.json());
    app.use('/calls', callLogsRoutes);
  });

  it('returns 403 for a non-admin role', async () => {
    const res = await request(app)
      .post('/calls/export')
      .set('x-test-role', 'nurse')
      .send({ condition: 'Heart Failure' });

    expect(res.status).toBe(403);
  });

  it('returns 400 when no filter and no sessionIds are provided', async () => {
    const res = await request(app).post('/calls/export').send({});
    expect(res.status).toBe(400);
    expect(mockGetExportBundle).not.toHaveBeenCalled();
  });

  it('accepts a request with only sessionIds', async () => {
    mockGetExportBundle.mockResolvedValue([{ id: 'session-1' }]);
    const res = await request(app).post('/calls/export').send({ sessionIds: ['session-1'] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 'session-1' }]);
  });

  it('accepts a request with only a date filter', async () => {
    mockGetExportBundle.mockResolvedValue([]);
    const res = await request(app).post('/calls/export').send({ dateFrom: '2026-08-01' });
    expect(res.status).toBe(200);
  });

  it('passes the request body through to getExportBundle unchanged', async () => {
    mockGetExportBundle.mockResolvedValue([]);
    const filters = { condition: 'Heart Failure', outcome: 'ESCALATE' };
    await request(app).post('/calls/export').send(filters);
    expect(mockGetExportBundle).toHaveBeenCalledWith(filters);
  });

  it('returns 500 with the error message when the service throws', async () => {
    mockGetExportBundle.mockRejectedValue(new Error('boom'));
    const res = await request(app).post('/calls/export').send({ condition: 'X' });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('boom');
  });

  it('returns 400 when reached without tenant context (e.g. the legacy /api/calls mount with no tenantMiddleware)', async () => {
    mockGetTenantContext.mockReturnValue(undefined);
    const res = await request(app).post('/calls/export').send({ condition: 'Heart Failure' });
    expect(res.status).toBe(400);
    expect(mockGetExportBundle).not.toHaveBeenCalled();
  });
});
