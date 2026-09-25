import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { authMiddleware, requireRole } from './auth/middleware';
import { prisma } from '../core/database';
import { logger } from '../core/logger';
import { updateUserByEmail } from './auth/user.service';
import { SKILL_DEFINITIONS, CAPABILITY_DEFINITIONS } from '../core/tenant-features';

export const tenantsRouter = Router();

// GET /v1/api/admin/skills — list all registered conversation skills
tenantsRouter.get(
  '/skills',
  authMiddleware,
  requireRole('super_admin'),
  (_req, res) => {
    res.json({ skills: SKILL_DEFINITIONS });
  },
);

// GET /v1/api/admin/capabilities — list all registered standalone tenant capabilities
tenantsRouter.get(
  '/capabilities',
  authMiddleware,
  requireRole('super_admin'),
  (_req, res) => {
    res.json({ capabilities: CAPABILITY_DEFINITIONS });
  },
);

// GET /v1/api/admin/tenants — list all tenants
tenantsRouter.get(
  '/tenants',
  authMiddleware,
  requireRole('super_admin'),
  async (_req, res) => {
    try {
      const tenants = await prisma.tenant.findMany({
        select: { id: true, name: true, slug: true, status: true, settings: true },
        orderBy: { name: 'asc' },
      });
      logger.info('Tenants listed', { count: tenants.length });
      res.json({ tenants });
    } catch (err: any) {
      logger.error('Failed to list tenants', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  },
);

// POST /v1/api/admin/tenants — create a new tenant
tenantsRouter.post(
  '/tenants',
  authMiddleware,
  requireRole('super_admin'),
  async (req, res) => {
    const { name, slug } = req.body as { name: string; slug: string };
    if (!name || !slug) {
      res.status(400).json({ error: 'name and slug are required' });
      return;
    }
    try {
      const tenant = await prisma.tenant.create({
        data: { name, slug, status: 'ACTIVE' },
      });
      logger.info('Tenant created', { id: tenant.id, name: tenant.name, slug: tenant.slug });
      res.status(201).json({ tenant });
    } catch (err: any) {
      if (err.code === 'P2002') {
        logger.error('Failed to create tenant: duplicate slug', { slug, error: err.message });
        res.status(409).json({ error: 'Tenant slug already exists' });
        return;
      }
      logger.error('Failed to create tenant', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  },
);

// PUT /v1/api/admin/tenants/:id — update tenant name / slug / status
tenantsRouter.put(
  '/tenants/:id',
  authMiddleware,
  requireRole('super_admin'),
  async (req, res) => {
    const { id } = req.params as { id: string };
    const { name, slug, status, settings } = req.body as {
      name?: string;
      slug?: string;
      status?: string;
      settings?: Record<string, unknown>;
    };

    if (!name && !slug && !status && !settings) {
      res.status(400).json({ error: 'At least one of name, slug, status, or settings is required' });
      return;
    }

    try {
      const tenant = await prisma.tenant.update({
        where: { id },
        data: {
          ...(name     !== undefined && { name }),
          ...(slug     !== undefined && { slug }),
          ...(status   !== undefined && { status }),
          ...(settings !== undefined && { settings: settings as Prisma.InputJsonValue }),
        },
        select: { id: true, name: true, slug: true, status: true, settings: true },
      });
      logger.info('Tenant updated', { id: tenant.id, name: tenant.name });
      res.json({ tenant });
    } catch (err: any) {
      if (err.code === 'P2025') {
        res.status(404).json({ error: 'Tenant not found' });
        return;
      }
      if (err.code === 'P2002') {
        res.status(409).json({ error: 'Tenant slug already exists' });
        return;
      }
      logger.error('Failed to update tenant', { id, error: err.message });
      res.status(500).json({ error: err.message });
    }
  },
);

// PUT /v1/api/admin/users/:email — update user role and/or conditions
tenantsRouter.put(
  '/users/:email',
  authMiddleware,
  requireRole('super_admin'),
  async (req, res) => {
    const email = req.params.email as string;
    const { role, conditions } = req.body as { role?: string; conditions?: string[] };
    if (!role && !conditions) {
      res.status(400).json({ error: 'Provide role and/or conditions to update' });
      return;
    }
    try {
      const user = await updateUserByEmail(email, { role, conditions });
      res.json({ ok: true, user });
    } catch (err: any) {
      const notFound = err.code === 'P2025' || err.message === 'User not found';
      res.status(notFound ? 404 : 500).json({ error: err.message });
    }
  },
);
