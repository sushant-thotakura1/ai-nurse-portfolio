import { Router, Request, Response } from 'express';
import { callSchedulingService } from './scheduling.service';
import { logger } from '../core/logger';
import { createTenantMiddleware } from '../core/tenant-middleware';
import { prisma } from '../core/database';

const router = Router();

// Note: Tenant middleware is now applied at the app level for multi-tenant routes
// Legacy /api routes work without tenant context for backward compatibility

// Schedule a new call
router.post('/schedule', async (req: Request, res: Response) => {
  try {
    const { patientId, callPurpose, scheduledFor, maxRetries } = req.body;

    if (!patientId || !callPurpose || !scheduledFor) {
      return res.status(400).json({
        error: 'Missing required fields: patientId, callPurpose, scheduledFor',
      });
    }

    const scheduledCall = await callSchedulingService.scheduleCall({
      patientId,
      callPurpose,
      scheduledFor: new Date(scheduledFor),
      maxRetries,
    });

    res.status(201).json(scheduledCall);
  } catch (error: any) {
    logger.error('POST /schedule failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Get pending calls
router.get('/pending', async (req: Request, res: Response) => {
  try {
    const calls = await callSchedulingService.getPendingCalls();
    res.json(calls);
  } catch (error: any) {
    logger.error('GET /pending failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Get scheduled calls for a patient
router.get('/patient/:patientId', async (req: Request, res: Response) => {
  try {
    const patientId = Array.isArray(req.params.patientId)
      ? req.params.patientId[0]
      : req.params.patientId;
    const calls = await callSchedulingService.getPatientScheduledCalls(patientId);
    res.json(calls);
  } catch (error: any) {
    logger.error('GET /patient/:patientId failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Cancel a scheduled call
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const result = await callSchedulingService.cancelScheduledCall(id);
    res.json(result);
  } catch (error: any) {
    logger.error('DELETE /:id failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

export default router;
