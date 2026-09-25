// src/screening/records.routes.test.ts
import request from 'supertest';
import express from 'express';
import screeningRoutes from './routes';
import * as recordsService from './records.service';

jest.mock('./service', () => ({
  screeningService: { start: jest.fn(), submitAnswer: jest.fn(), complete: jest.fn(), getState: jest.fn() },
}));
jest.mock('./records.service', () => ({
  listRecords: jest.fn(),
  getRecordDetail: jest.fn(),
  recordsCsv: jest.fn(),
}));

const app = express();
app.use(express.json());
app.use('/screening', screeningRoutes);

describe('GET /screening/records', () => {
  beforeEach(() => jest.clearAllMocks());

  it('parses status/limit/offset and returns the service result', async () => {
    (recordsService.listRecords as jest.Mock).mockResolvedValue({ records: [], total: 0, limit: 10, offset: 20 });

    const res = await request(app).get('/screening/records?status=stopped&limit=10&offset=20');

    expect(res.status).toBe(200);
    expect(recordsService.listRecords).toHaveBeenCalledWith({ status: 'stopped', limit: 10, offset: 20 });
  });

  it('defaults status=all, limit=25, offset=0 and clamps limit to 100', async () => {
    (recordsService.listRecords as jest.Mock).mockResolvedValue({ records: [], total: 0, limit: 25, offset: 0 });

    await request(app).get('/screening/records');
    expect(recordsService.listRecords).toHaveBeenLastCalledWith({ status: 'all', limit: 25, offset: 0 });

    await request(app).get('/screening/records?limit=9999');
    expect(recordsService.listRecords).toHaveBeenLastCalledWith({ status: 'all', limit: 100, offset: 0 });
  });

  it('rejects an unknown status with 400', async () => {
    const res = await request(app).get('/screening/records?status=nonsense');
    expect(res.status).toBe(400);
    expect(recordsService.listRecords).not.toHaveBeenCalled();
  });

  it('floors limit at 1 so ?limit=0 does not return a permanently empty page', async () => {
    (recordsService.listRecords as jest.Mock).mockResolvedValue({ records: [], total: 0, limit: 1, offset: 0 });

    await request(app).get('/screening/records?limit=0');

    expect(recordsService.listRecords).toHaveBeenLastCalledWith({ status: 'all', limit: 1, offset: 0 });
  });
});

describe('GET /screening/records.csv', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns text/csv with an attachment filename', async () => {
    (recordsService.recordsCsv as jest.Mock).mockResolvedValue('"submitted_at"');

    const res = await request(app).get('/screening/records.csv?status=completed');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="screening-records-.*\.csv"/);
    expect(res.text).toBe('"submitted_at"');
    expect(recordsService.recordsCsv).toHaveBeenCalledWith({ status: 'completed' });
  });

  it('rejects an unknown status with 400 and never calls the service', async () => {
    const res = await request(app).get('/screening/records.csv?status=nonsense');
    expect(res.status).toBe(400);
    expect(recordsService.recordsCsv).not.toHaveBeenCalled();
  });
});

describe('GET /screening/records/:id', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the detail payload', async () => {
    (recordsService.getRecordDetail as jest.Mock).mockResolvedValue({ id: 'rec-1', sections: [] });

    const res = await request(app).get('/screening/records/rec-1');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 'rec-1', sections: [] });
    expect(recordsService.getRecordDetail).toHaveBeenCalledWith('rec-1');
  });

  it('responds 404 when the record is not found (also covers cross-tenant)', async () => {
    (recordsService.getRecordDetail as jest.Mock).mockRejectedValue(
      new Error('Screening record not found: rec-x'),
    );

    const res = await request(app).get('/screening/records/rec-x');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Screening record not found: rec-x' });
  });
});
