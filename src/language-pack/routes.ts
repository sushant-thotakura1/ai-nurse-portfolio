import { Router } from 'express';
import { authMiddleware, requireRole } from '../admin/auth/middleware';
import { prisma } from '../core/database';
import { logger } from '../core/logger';

export const languagePackRouter = Router();

// GET /v1/api/admin/language-packs — list all language packs
languagePackRouter.get(
  '/language-packs',
  authMiddleware,
  requireRole('super_admin', 'admin'),
  async (_req, res) => {
    try {
      const packs = await prisma.languagePack.findMany({
        orderBy: { displayName: 'asc' },
      });
      res.json({ languagePacks: packs });
    } catch (err: any) {
      logger.error('Failed to list language packs', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  },
);

// POST /v1/api/admin/language-packs — create a language pack
languagePackRouter.post(
  '/language-packs',
  authMiddleware,
  requireRole('super_admin'),
  async (req, res) => {
    const { localeCode, displayName, scripts, medicalLexicon, voiceProfile, sttHints, isActive } = req.body;
    if (!localeCode || !displayName || !scripts || !medicalLexicon) {
      res.status(400).json({ error: 'localeCode, displayName, scripts, and medicalLexicon are required' });
      return;
    }
    try {
      const pack = await prisma.languagePack.create({
        data: { localeCode, displayName, scripts, medicalLexicon, voiceProfile, sttHints, isActive: isActive ?? true },
      });
      logger.info('Language pack created', { localeCode });
      res.status(201).json({ languagePack: pack });
    } catch (err: any) {
      if (err.code === 'P2002') {
        res.status(409).json({ error: 'Language pack with this locale code already exists' });
        return;
      }
      logger.error('Failed to create language pack', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  },
);

// PUT /v1/api/admin/language-packs/:localeCode — update a language pack
languagePackRouter.put(
  '/language-packs/:localeCode',
  authMiddleware,
  requireRole('super_admin'),
  async (req, res) => {
    const localeCode = req.params['localeCode'] as string;
    const { displayName, scripts, medicalLexicon, voiceProfile, sttHints, isActive } = req.body;

    const data: Record<string, any> = {};
    if (displayName !== undefined) data.displayName = displayName;
    if (scripts !== undefined) data.scripts = scripts;
    if (medicalLexicon !== undefined) data.medicalLexicon = medicalLexicon;
    if (voiceProfile !== undefined) data.voiceProfile = voiceProfile;
    if (sttHints !== undefined) data.sttHints = sttHints;
    if (isActive !== undefined) data.isActive = isActive;

    if (Object.keys(data).length === 0) {
      res.status(400).json({ error: 'At least one field to update is required' });
      return;
    }

    try {
      const pack = await prisma.languagePack.update({
        where: { localeCode },
        data,
      });
      logger.info('Language pack updated', { localeCode });
      res.json({ languagePack: pack });
    } catch (err: any) {
      if (err.code === 'P2025') {
        res.status(404).json({ error: 'Language pack not found' });
        return;
      }
      logger.error('Failed to update language pack', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  },
);

// DELETE /v1/api/admin/language-packs/:localeCode — delete a language pack
languagePackRouter.delete(
  '/language-packs/:localeCode',
  authMiddleware,
  requireRole('super_admin'),
  async (req, res) => {
    const localeCode = req.params['localeCode'] as string;
    try {
      await prisma.languagePack.delete({ where: { localeCode } });
      logger.info('Language pack deleted', { localeCode });
      res.json({ success: true });
    } catch (err: any) {
      if (err.code === 'P2025') {
        res.status(404).json({ error: 'Language pack not found' });
        return;
      }
      logger.error('Failed to delete language pack', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  },
);
