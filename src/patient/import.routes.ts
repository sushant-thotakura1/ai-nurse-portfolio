import { Router, Request, Response } from 'express';
import { patientImportService } from './import.service';
import { logger } from '../core/logger';
import { createTenantMiddleware } from '../core/tenant-middleware';
import { prisma } from '../core/database';

const router = Router();

// Note: Tenant middleware is now applied at the app level for multi-tenant routes
// Legacy /api routes work without tenant context for backward compatibility

// Import patients from CSV
router.post('/import', async (req: Request, res: Response) => {
  try {
    const csvData = req.body.csvData;

    if (!csvData) {
      return res.status(400).json({ error: 'CSV data is required' });
    }

    const result = await patientImportService.importPatients(csvData);

    res.json({
      message: 'Import completed',
      ...result,
    });
  } catch (error: any) {
    logger.error('Patient import failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Download CSV template
router.get('/import/template', (req: Request, res: Response) => {
  const template = patientImportService.generateTemplate();

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=patient-import-template.csv');
  res.send(template);
});

export default router;
