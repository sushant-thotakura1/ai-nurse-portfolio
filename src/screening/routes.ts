// src/screening/routes.ts
import { Router, Request, Response } from 'express';
import { screeningService } from './service';
import * as recordsService from './records.service';
import type { StatusFilter } from './records.service';
import { logger } from '../core/logger';

const STATUS_FILTERS: StatusFilter[] = ['all', 'in_progress', 'completed', 'stopped'];

function parseStatus(raw: unknown): StatusFilter {
  if (raw === undefined) return 'all';
  if (typeof raw === 'string' && (STATUS_FILTERS as string[]).includes(raw)) {
    return raw as StatusFilter;
  }
  throw new Error(`Invalid status filter: ${String(raw)}`);
}

function parseIntParam(raw: unknown, fallback: number, max: number): number {
  if (raw === undefined) return fallback;
  const n = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(n, max);
}

const router = Router();

router.post('/sessions', async (req: Request, res: Response) => {
  try {
    const record = await screeningService.start(req.body.filledBy);
    res.status(201).json(record);
  } catch (error: any) {
    logger.error('POST /screening/sessions failed', { error: error.message });
    res.status(400).json({ error: error.message });
  }
});

router.post('/sessions/:id/answers', async (req: Request, res: Response) => {
  try {
    const record = await screeningService.submitAnswer(
      req.params.id as string,
      req.body.questionId,
      req.body.value,
    );
    res.json(record);
  } catch (error: any) {
    logger.error('POST /screening/sessions/:id/answers failed', { error: error.message });
    res.status(/not found/i.test(error.message) ? 404 : 400).json({ error: error.message });
  }
});

router.get('/sessions/:id/state', async (req: Request, res: Response) => {
  try {
    const state = await screeningService.getState(req.params.id as string);
    res.json(state);
  } catch (error: any) {
    logger.error('GET /screening/sessions/:id/state failed', { error: error.message });
    res.status(/not found/i.test(error.message) ? 404 : 400).json({ error: error.message });
  }
});

router.post('/sessions/:id/complete', async (req: Request, res: Response) => {
  try {
    const record = await screeningService.complete(req.params.id as string);
    res.json(record);
  } catch (error: any) {
    logger.error('POST /screening/sessions/:id/complete failed', { error: error.message });
    res.status(/not found/i.test(error.message) ? 404 : 400).json({ error: error.message });
  }
});

router.get('/records', async (req: Request, res: Response) => {
  try {
    const status = parseStatus(req.query.status);
    const limit = parseIntParam(req.query.limit, 25, 100);
    const safeLimit = Math.max(1, limit);
    const offset = parseIntParam(req.query.offset, 0, Number.MAX_SAFE_INTEGER);
    const result = await recordsService.listRecords({ status, limit: safeLimit, offset });
    res.json(result);
  } catch (error: any) {
    logger.error('GET /screening/records failed', { error: error.message });
    res.status(400).json({ error: error.message });
  }
});

router.get('/records.csv', async (req: Request, res: Response) => {
  try {
    const status = parseStatus(req.query.status);
    const csv = await recordsService.recordsCsv({ status });
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="screening-records-${stamp}.csv"`);
    res.send(csv);
  } catch (error: any) {
    logger.error('GET /screening/records.csv failed', { error: error.message });
    res.status(400).json({ error: error.message });
  }
});

router.get('/records/:id', async (req: Request, res: Response) => {
  try {
    const detail = await recordsService.getRecordDetail(req.params.id as string);
    res.json(detail);
  } catch (error: any) {
    logger.error('GET /screening/records/:id failed', { error: error.message });
    res.status(/not found/i.test(error.message) ? 404 : 400).json({ error: error.message });
  }
});

export default router;
