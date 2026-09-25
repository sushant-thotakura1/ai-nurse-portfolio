import { Router, Request, Response } from 'express';
import { patientService } from './service';
import { logger } from '../core/logger';
import { createTenantMiddleware } from '../core/tenant-middleware';
import { prisma } from '../core/database';

const router = Router();

// Note: Tenant middleware is now applied at the app level for multi-tenant routes
// Legacy /api routes work without tenant context for backward compatibility

// Create patient
router.post('/', async (req: Request, res: Response) => {
  try {
    const patient = await patientService.createPatient(req.body);
    res.status(201).json(patient);
  } catch (error: any) {
    logger.error('POST /patients failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Get patient by ID
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const patient = await patientService.getPatientById(req.params.id as string);
    res.json(patient);
  } catch (error: any) {
    logger.error('GET /patients/:id failed', { error: error.message });
    res.status(404).json({ error: error.message });
  }
});

// Get all patients
router.get('/', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const patients = await patientService.getAllPatients(limit, offset);
    res.json(patients);
  } catch (error: any) {
    logger.error('GET /patients failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Update patient
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const patient = await patientService.updatePatient(req.params.id as string, req.body);
    res.json(patient);
  } catch (error: any) {
    logger.error('PUT /patients/:id failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

export default router;
