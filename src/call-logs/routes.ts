import { Router, Request, Response, NextFunction } from 'express';
import { callLogsService } from './service';
import { logger } from '../core/logger';
import { createTenantMiddleware } from '../core/tenant-middleware';
import { prisma } from '../core/database';
import * as authModule from '../admin/auth/middleware';
import { getTenantContext } from '../core/tenant-context-storage';

const router = Router();

// Note: Tenant middleware is now applied at the app level for multi-tenant routes
// Legacy /api routes work without tenant context for backward compatibility

// Get all call sessions
router.get('/', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const sessions = await callLogsService.getAllCallSessions(limit, offset);
    res.json(sessions);
  } catch (error: any) {
    logger.error('GET /calls failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Get call session by ID
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const session = await callLogsService.getCallSessionById(req.params.id as string);
    res.json(session);
  } catch (error: any) {
    logger.error('GET /calls/:id failed', { error: error.message });
    const statusCode = error.message === 'Call session not found' ? 404 : 500;
    res.status(statusCode).json({ error: error.message });
  }
});

// Get transcripts for a call session
router.get('/:id/transcripts', async (req: Request, res: Response) => {
  try {
    const transcripts = await callLogsService.getTranscriptsBySessionId(req.params.id as string);
    res.json(transcripts);
  } catch (error: any) {
    logger.error('GET /calls/:id/transcripts failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Get clinical events for a call session
router.get('/:id/events', async (req: Request, res: Response) => {
  try {
    const events = await callLogsService.getClinicalEventsBySessionId(req.params.id as string);
    res.json(events);
  } catch (error: any) {
    logger.error('GET /calls/:id/events failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Batch export -- one enriched row per session (transcript + assessments +
// flags + patient facts + KG version/status), replacing the frontend's
// previous N+1-per-row transcript fetch. Gated by auth (unlike the plain
// list route above) because it carries assessment reasoning and fact values
// in bulk -- more sensitive than the bare list, which has no auth check
// today; that pre-existing gap is out of scope here.
router.post(
  '/export',
  (req: Request, res: Response, next: NextFunction) => authModule.authMiddleware(req, res, next),
  authModule.requireRole('admin', 'super_admin'),
  async (req: Request, res: Response) => {
    try {
      const filters = req.body ?? {};
      const hasAnyFilter = Boolean(
        filters.channel ||
        filters.outcome ||
        filters.condition ||
        filters.dateFrom ||
        filters.dateTo ||
        (Array.isArray(filters.sessionIds) && filters.sessionIds.length > 0)
      );

      if (!hasAnyFilter) {
        res.status(400).json({ error: 'At least one filter or sessionIds is required' });
        return;
      }

      const tenantContext = getTenantContext();
      if (!tenantContext) {
        res.status(400).json({ error: 'Tenant context is required for this endpoint' });
        return;
      }

      const bundle = await callLogsService.getExportBundle(filters);
      res.json(bundle);
    } catch (error: any) {
      logger.error('POST /calls/export failed', { error: error.message });
      res.status(500).json({ error: error.message });
    }
  },
);

export default router;
