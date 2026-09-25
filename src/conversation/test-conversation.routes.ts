/**
 * Test Conversation API Routes
 * Endpoints for testing AI nurse conversations from the dashboard
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import { testConversationService } from './test-conversation.service';
import { logger } from '../core/logger';

const router = Router();

// Configure multer for audio file uploads (in-memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max
  },
  fileFilter: (req, file, cb) => {
    // Accept audio files
    if (file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error('Only audio files are allowed'));
    }
  },
});

/**
 * POST /api/test-conversation/start
 * Start a new test conversation
 */
router.post('/start', async (req: Request, res: Response) => {
  try {
    const { patientId, callPurpose, locale } = req.body;

    if (!patientId || !callPurpose || !locale) {
      return res.status(400).json({
        error: 'Missing required fields: patientId, callPurpose, locale',
      });
    }

    const result = await testConversationService.startConversation({
      patientId,
      callPurpose,
      locale,
    });

    res.json(result);
  } catch (error: any) {
    logger.error('POST /test-conversation/start failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/test-conversation/:sessionId/audio
 * Process patient audio response
 */
router.post('/:sessionId/audio', upload.single('audio'), async (req: Request, res: Response) => {
  try {
    const sessionId = req.params.sessionId as string;

    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    const result = await testConversationService.processAudio({
      sessionId,
      audioBuffer: req.file.buffer,
    });

    res.json(result);
  } catch (error: any) {
    logger.error('POST /test-conversation/:sessionId/audio failed', {
      error: error.message,
      sessionId: req.params.sessionId,
    });
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/test-conversation/:sessionId/end
 * End the test conversation
 */
router.post('/:sessionId/end', async (req: Request, res: Response) => {
  try {
    const sessionId = req.params.sessionId as string;

    const result = await testConversationService.endConversation(sessionId);

    res.json(result);
  } catch (error: any) {
    logger.error('POST /test-conversation/:sessionId/end failed', {
      error: error.message,
      sessionId: req.params.sessionId,
    });
    res.status(500).json({ error: error.message });
  }
});

export default router;
