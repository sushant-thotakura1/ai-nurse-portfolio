import { Router, Request, Response, NextFunction } from 'express';
import * as authModule from '../admin/auth/middleware';
import { conversationsService } from './service';
import { logger } from '../core/logger';

const router = Router({ mergeParams: true });

router.use(
  (req: Request, res: Response, next: NextFunction) => authModule.authMiddleware(req, res, next),
  authModule.requireRole('admin', 'super_admin'),
);

router.get('/:sessionId/transcript', async (req: Request, res: Response): Promise<void> => {
  const tenantId = (req as any).tenantContext?.tenantId as string;
  const sessionId = req.params.sessionId as string;
  try {
    const result = await conversationsService.getTranscript(tenantId, sessionId);
    res.json(result);
  } catch (err: any) {
    logger.error('GET /conversations/:sessionId/transcript failed', { error: err.message });
    if (err.message === 'Session not found') {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
