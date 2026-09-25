// src/admin/routes/reviewer.ts
import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { authMiddleware, requireRole } from '../auth/middleware';
import { findUserByEmail } from '../auth/user.service';
import { loadFeedback, saveFeedback, approveScenario, FeedbackEntry } from '../services/feedback-store';
import { logger } from '../../core/logger';

const DATASET_BASE_DEFAULT = path.resolve(process.cwd(), 'reference-dataset');

export function createReviewerRouter(datasetBase: string = DATASET_BASE_DEFAULT): Router {
  const router = Router();

  // Build allowlist from generated/ subdirectory structure at startup
  const allowlist = buildAllowlist(path.join(datasetBase, 'generated'));

  function validateParams(condition: string, classification: string, res: Response): boolean {
    if (!allowlist[condition]?.includes(classification)) {
      res.status(400).json({ error: `Unknown condition "${condition}" or classification "${classification}"` });
      return false;
    }
    return true;
  }

  // GET /api/reviewer/available-conditions — list all generated conditions (admin use)
  router.get('/available-conditions', authMiddleware, requireRole('admin', 'super_admin'), (_req, res) => {
    const conditions = Object.entries(allowlist).map(([condition, classifications]) => ({
      condition,
      classifications,
    }));
    res.json({ conditions });
  });

  // GET /api/reviewer/assignments
  router.get('/assignments', authMiddleware, requireRole('reviewer', 'admin', 'super_admin'), async (req: any, res) => {
    const user = await findUserByEmail(req.user.email);
    const conditions = user?.conditions ?? [];
    const assignments = conditions.map((cond) => ({
      condition: cond,
      classifications: allowlist[cond] ?? [],
    }));
    res.json({ assignments });
  });

  // GET /api/reviewer/:condition/:classification/scenarios
  router.get('/:condition/:classification/scenarios', authMiddleware, requireRole('reviewer', 'admin', 'super_admin'), (req: any, res) => {
    const { condition, classification } = req.params;
    if (!validateParams(condition, classification, res)) return;

    const readablePath = path.join(datasetBase, 'generated', condition, classification, 'readable.csv');
    if (!fs.existsSync(readablePath)) {
      res.status(404).json({ error: 'Dataset not generated yet. Run generate-dataset CLI first.' });
      return;
    }

    const csvContent = fs.readFileSync(readablePath, 'utf-8');
    const feedback = loadFeedback(req.user.email, condition, classification);

    res.json({ csv: csvContent, feedback });
  });

  // POST /api/reviewer/:condition/:classification/feedback
  router.post('/:condition/:classification/feedback', authMiddleware, requireRole('reviewer', 'admin', 'super_admin'), (req: any, res) => {
    const { condition, classification } = req.params;
    if (!validateParams(condition, classification, res)) return;

    const { scenario_id, row_type, turn_number, field, decision, comment } = req.body as Partial<FeedbackEntry>;
    if (!scenario_id || !row_type || !field || !decision) {
      res.status(400).json({ error: 'scenario_id, row_type, field, and decision are required' });
      return;
    }
    if (decision !== 'correct' && decision !== 'needs_change') {
      res.status(400).json({ error: 'decision must be "correct" or "needs_change"' });
      return;
    }

    const entry: FeedbackEntry = {
      scenario_id,
      row_type,
      turn_number,
      field,
      decision,
      comment,
      reviewed_at: new Date().toISOString(),
    };

    try {
      saveFeedback(req.user.email, condition, classification, entry);
      logger.info('Reviewer feedback saved', { email: req.user.email, scenario_id, field, decision });
      res.json({ ok: true });
    } catch (err: any) {
      logger.error('Failed to save feedback', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/reviewer/:condition/:classification/approve
  router.post('/:condition/:classification/approve', authMiddleware, requireRole('reviewer', 'admin', 'super_admin'), (req: any, res) => {
    const { condition, classification } = req.params;
    if (!validateParams(condition, classification, res)) return;

    const { scenario_id } = req.body as { scenario_id?: string };
    if (!scenario_id) {
      res.status(400).json({ error: 'scenario_id is required' });
      return;
    }

    const feedback = loadFeedback(req.user.email, condition, classification);
    const allFeedback = feedback.filter((e) => e.scenario_id === scenario_id);
    const unapproved = allFeedback.filter((e) => !e.scenario_approved);
    if (allFeedback.length === 0) {
      res.status(400).json({ error: 'No feedback recorded for this scenario. Decide all fields before approving.' });
      return;
    }
    if (unapproved.length === 0) {
      res.status(400).json({ error: 'Scenario is already fully approved.' });
      return;
    }

    try {
      approveScenario(req.user.email, condition, classification, scenario_id);
      logger.info('Reviewer scenario approved', { email: req.user.email, scenario_id, condition, classification });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

function buildAllowlist(generatedDir: string): Record<string, string[]> {
  const allowlist: Record<string, string[]> = {};
  if (!fs.existsSync(generatedDir)) return allowlist;

  for (const condition of fs.readdirSync(generatedDir)) {
    const condPath = path.join(generatedDir, condition);
    if (!fs.statSync(condPath).isDirectory()) continue;
    allowlist[condition] = fs.readdirSync(condPath).filter((f) =>
      fs.statSync(path.join(condPath, f)).isDirectory()
    );
  }
  return allowlist;
}

// Default export for server.ts
export const reviewerRouter = createReviewerRouter();
