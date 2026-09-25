import dotenv from 'dotenv';

// IMPORTANT: Load environment variables FIRST before importing anything else
dotenv.config();

// Fail fast if JWT_SECRET is not configured
if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET is not set. Refusing to start.');
  process.exit(1);
}

import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import { config } from './core/config';
import { logger } from './core/logger';
import patientRoutes from './patient/routes';
import patientImportRoutes from './patient/import.routes';
import schedulingRoutes from './patient/scheduling.routes';
import callLogsRoutes from './call-logs/routes';
import conversationsRoutes from './conversations/routes';
import { createRAGRoutes } from './rag/routes';
import knowledgeGraphRoutes from './knowledge-graph/routes';
import screeningRoutes from './screening/routes';
import testConversationRoutes from './conversation/test-conversation.routes';
import { prisma, systemPrisma } from './core/database';
import { createTenantMiddleware } from './core/tenant-middleware';
import { requireTenantCapability } from './core/require-tenant-capability';
import { featuresRouter } from './core/features.routes';
import authRoutes from './admin/auth/auth.routes';
import { whatsappRoutes, telegramRoutes } from './messaging/routes';
import { createChannelsRoutes } from './messaging/channels.routes';
import { tenantsRouter } from './admin/tenants.routes';
import { languagePackRouter } from './language-pack/routes';
import { reviewerRouter } from './admin/routes/reviewer';
import { SessionReaper } from './messaging/session-reaper';
import { SessionClosingService } from './messaging/session-closing.service';
import { OpenAIAdapter } from './ai-agent/adapters/openai.adapter';

const app: Express = express();

// Create tenant middleware instance
const tenantMiddleware = createTenantMiddleware(prisma);

// Enable CORS for frontend communication
app.use(cors({
  origin: ['http://localhost:3001', 'http://localhost:3003'],
  credentials: true
}));

// Normalize Content-Type media-type casing — body-parser rejects uppercase "UTF-8".
// Only lowercase the media-type token; preserve parameters (e.g. multipart boundary)
// because the boundary value is case-sensitive and must match what is in the body.
app.use((req, _res, next) => {
  const ct = req.headers['content-type'];
  if (ct) {
    const semi = ct.indexOf(';');
    req.headers['content-type'] = semi === -1
      ? ct.toLowerCase()
      : ct.slice(0, semi).toLowerCase() + ct.slice(semi);
  }
  next();
});

// Capture raw body for webhook HMAC verification (WhatsApp requires this)
app.use(express.json({
  verify: (req: any, _res, buf) => { req.rawBody = buf; },
}));

// Auth routes — no tenantId segment, mounted before tenantMiddleware
app.use('/v1/api/auth', authRoutes);

app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Admin routes — no tenantId segment, mounted BEFORE :tenantId wildcard
app.use('/v1/api/admin', tenantsRouter);
app.use('/v1/api/admin', languagePackRouter);
app.use('/v1/api/reviewer', reviewerRouter);

// Mount patient routes with multi-tenant URL structure
app.use('/v1/api/:tenantId/patients', tenantMiddleware, patientRoutes);

// Mount patient import routes with multi-tenant URL structure
app.use('/v1/api/:tenantId/patients', tenantMiddleware, patientImportRoutes);

// Mount scheduling routes with multi-tenant URL structure
app.use('/v1/api/:tenantId/scheduling', tenantMiddleware, schedulingRoutes);

// Mount call logs routes with multi-tenant URL structure
app.use('/v1/api/:tenantId/calls', tenantMiddleware, callLogsRoutes);

// Mount conversations routes with multi-tenant URL structure
app.use('/v1/api/:tenantId/conversations', tenantMiddleware, conversationsRoutes);

// Mount RAG routes with multi-tenant URL structure
app.use('/v1/api/:tenantId/documents', tenantMiddleware, createRAGRoutes(prisma));

// Mount knowledge graph routes with multi-tenant URL structure
app.use('/v1/api/:tenantId/knowledge-graphs', tenantMiddleware, knowledgeGraphRoutes);

// Mount test conversation routes with multi-tenant URL structure
app.use('/v1/api/:tenantId/test-conversation', tenantMiddleware, testConversationRoutes);

// Mount screening routes with multi-tenant URL structure — gated on the
// `screening` tenant capability (Tenant.settings.features.enabledCapabilities)
app.use(
  '/v1/api/:tenantId/screening',
  tenantMiddleware,
  requireTenantCapability('screening'),
  screeningRoutes,
);

// Tenant feature flags — behind tenantMiddleware only (NOT the screening guard),
// so a tenant without screening can still discover that. Feeds dashboard nav.
app.use('/v1/api/:tenantId/features', tenantMiddleware, featuresRouter);

// Messaging webhook routes — tenant-scoped
app.use('/v1/api/:tenantId/webhooks/whatsapp', tenantMiddleware, whatsappRoutes());
app.use('/v1/api/:tenantId/webhooks/telegram', tenantMiddleware, telegramRoutes());

// Channel admin routes — tenant-scoped
// systemPrisma: provider config reads/writes must use explicit tenantId without ALS interference
app.use('/v1/api/:tenantId/channels', tenantMiddleware, createChannelsRoutes(systemPrisma));

// Keep legacy routes for backward compatibility (optional, can be removed later)
app.use('/api/patients', patientRoutes);
app.use('/api/patients', patientImportRoutes);
app.use('/api/scheduling', schedulingRoutes);
app.use('/api/calls', callLogsRoutes);
app.use('/api/knowledge-graphs', knowledgeGraphRoutes);
app.use('/api/test-conversation', testConversationRoutes);

const reaper = new SessionReaper(new SessionClosingService());

const port = config.port;

app.listen(port, () => {
  logger.info(`Server running on port ${port}`);
  logger.info('Routes mounted:', {
    patients: {
      multiTenant: '/v1/api/:tenantId/patients',
      legacy: '/api/patients (deprecated)'
    },
    scheduling: {
      multiTenant: '/v1/api/:tenantId/scheduling',
      legacy: '/api/scheduling (deprecated)'
    },
    calls: {
      multiTenant: '/v1/api/:tenantId/calls',
      legacy: '/api/calls (deprecated)'
    },
    documents: {
      multiTenant: '/v1/api/:tenantId/documents'
    },
    knowledgeGraphs: {
      multiTenant: '/v1/api/:tenantId/knowledge-graphs',
      legacy: '/api/knowledge-graphs'
    },
    testConversation: {
      multiTenant: '/v1/api/:tenantId/test-conversation',
      legacy: '/api/test-conversation'
    },
    messaging: {
      whatsapp: '/v1/api/:tenantId/webhooks/whatsapp',
      telegram: '/v1/api/:tenantId/webhooks/telegram',
    },
    channels: '/v1/api/:tenantId/channels',
  });
  const llm = new OpenAIAdapter({ apiKey: config.providers.openai.apiKey });
  reaper.start(prisma, llm);
});

process.on('SIGTERM', () => reaper.stop());
process.on('SIGINT',  () => reaper.stop());

export default app;
