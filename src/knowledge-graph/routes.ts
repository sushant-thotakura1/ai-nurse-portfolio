/**
 * Knowledge Graph API Routes
 */

import { Router, Request, Response } from 'express';
import { knowledgeGraphService } from './knowledge-graph.service';
import { logger } from '../core/logger';
import multer from 'multer';
import * as path from 'path';
import * as fs from 'fs';

const router = Router();

const uploadDir = path.join(__dirname, '..', '..', 'uploads', 'knowledge-graphs');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => { cb(null, uploadDir); },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${uniqueSuffix}-${file.originalname}`);
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (
      file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.originalname.toLowerCase().endsWith('.xlsx')
    ) {
      cb(null, true);
    } else {
      cb(new Error('Only .xlsx files are allowed'));
    }
  },
  limits: { fileSize: 50 * 1024 * 1024 },
});

/**
 * POST /api/knowledge-graphs/upload
 * Upload and parse XLSX clinical protocol file.
 * Body (multipart): version (string), file (xlsx)
 * Condition name is derived automatically from the parsed file.
 */
router.post('/upload', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { version } = req.body;

    if (!version) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Missing required field: version' });
    }

    logger.info('Upload request received', { filename: req.file.originalname, version });

    const result = await knowledgeGraphService.uploadKnowledgeGraph({
      condition: '', // derived from parsed file inside the service
      version,
      filePath: req.file.path,
    });

    res.status(201).json(result);
  } catch (error: any) {
    logger.error('Upload failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/knowledge-graphs/:id/activate
 */
router.post('/:id/activate', async (req: Request, res: Response) => {
  try {
    const result = await knowledgeGraphService.activateKnowledgeGraph({ id: req.params.id as string });
    res.status(200).json(result);
  } catch (error: any) {
    logger.error('Activation failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/knowledge-graphs/:id/archive
 */
router.post('/:id/archive', async (req: Request, res: Response) => {
  try {
    await knowledgeGraphService.archiveKnowledgeGraph(req.params.id as string);
    res.status(200).json({ success: true });
  } catch (error: any) {
    logger.error('Archive failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/knowledge-graphs
 * Query params: condition (string), status (DRAFT|ACTIVE|ARCHIVED)
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { condition, status } = req.query;
    const result = await knowledgeGraphService.listKnowledgeGraphs({
      condition: condition as string | undefined,
      status: status as 'DRAFT' | 'ACTIVE' | 'ARCHIVED' | undefined,
    });
    res.status(200).json(result);
  } catch (error: any) {
    logger.error('List failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/knowledge-graphs/:id
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const result = await knowledgeGraphService.getKnowledgeGraph(req.params.id as string);
    if (!result) return res.status(404).json({ error: 'Knowledge graph not found' });
    res.status(200).json(result);
  } catch (error: any) {
    logger.error('Get failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/knowledge-graphs/:id
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await knowledgeGraphService.deleteKnowledgeGraph(req.params.id as string);
    res.status(200).json({ success: true });
  } catch (error: any) {
    logger.error('Delete failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

export default router;
