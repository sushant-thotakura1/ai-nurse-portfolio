/**
 * RAG API Routes
 *
 * RESTful API endpoints for document management and semantic search.
 * All routes are tenant-scoped via middleware.
 *
 * Routes:
 * - POST   /v1/api/:tenantId/documents          - Upload/ingest document
 * - GET    /v1/api/:tenantId/documents          - List tenant documents
 * - GET    /v1/api/:tenantId/documents/:id      - Get specific document
 * - GET    /v1/api/:tenantId/documents/:id/chunks - Get paginated chunk content
 * - DELETE /v1/api/:tenantId/documents/:id      - Delete document
 * - POST   /v1/api/:tenantId/documents/query    - Query documents (RAG)
 */

import { Router, Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import multer from 'multer';
import os from 'os';
import fs from 'fs/promises';
import { getRAGService, RAGConfig } from './rag-service';
import { DocumentLoaderService } from './document-loader.service';
import { logger } from '../core/logger';

const router = Router({ mergeParams: true }); // mergeParams allows access to :tenantId from parent route

/**
 * Initialize RAG routes with Prisma client
 *
 * @param prisma - Prisma client instance
 * @param config - Optional RAG configuration
 * @returns Express router with RAG routes
 */
export function createRAGRoutes(
  prisma: PrismaClient,
  config?: Partial<RAGConfig>
): Router {
  const ragService = getRAGService(prisma, config);
  const documentLoaderService = new DocumentLoaderService();
  const upload = multer({
    dest: os.tmpdir(),
    limits: { fileSize: 50 * 1024 * 1024 },
  });

  /**
   * POST /v1/api/:tenantId/documents
   * Ingest a new document
   *
   * Body:
   * {
   *   "title": "Document title",
   *   "description": "Optional description",
   *   "content": "Document content text",
   *   "contentType": "text/plain",
   *   "metadata": { "source": "manual", "author": "John Doe" }
   * }
   */
  router.post('/', async (req: Request, res: Response): Promise<void> => {
    try {
      const { title, description, content, contentType, metadata } = req.body;

      // Validate required fields
      if (!title || typeof title !== 'string') {
        res.status(400).json({
          error: 'Validation error',
          message: 'Title is required and must be a string',
        });
        return;
      }

      if (!content || typeof content !== 'string') {
        res.status(400).json({
          error: 'Validation error',
          message: 'Content is required and must be a string',
        });
        return;
      }

      if (!contentType || typeof contentType !== 'string') {
        res.status(400).json({
          error: 'Validation error',
          message: 'ContentType is required and must be a string',
        });
        return;
      }

      // Validate content is not empty
      if (content.trim().length === 0) {
        res.status(400).json({
          error: 'Validation error',
          message: 'Content cannot be empty',
        });
        return;
      }

      logger.info('Ingesting document via API', {
        tenantId: req.params.tenantId,
        title,
        contentType,
        contentLength: content.length,
      });

      const document = await ragService.ingestDocument({
        title,
        description,
        content,
        contentType,
        metadata,
      });

      res.status(201).json({
        success: true,
        message: 'Document ingested successfully',
        data: {
          id: document.id,
          title: document.title,
          description: document.description,
          contentType: document.contentType,
          metadata: document.metadata,
          status: document.status,
          embeddingsCount: document.embeddingsCount,
          createdAt: document.createdAt,
          updatedAt: document.updatedAt,
        },
      });
    } catch (error) {
      logger.error('Error in POST /documents', {
        tenantId: req.params.tenantId,
        error: error instanceof Error ? error.message : String(error),
      });

      // Handle specific errors
      if (error instanceof Error) {
        if (error.message.includes('OPENAI_API_KEY')) {
          res.status(500).json({
            error: 'Configuration error',
            message: 'OpenAI API key is not configured. Please contact support.',
          });
          return;
        }

        if (error.message.includes('No tenant context')) {
          res.status(403).json({
            error: 'Forbidden',
            message: 'Tenant context is required for this operation',
          });
          return;
        }
      }

      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to ingest document',
      });
    }
  });

  /**
   * GET /v1/api/:tenantId/documents
   * List all documents for the tenant
   *
   * Query params:
   * - status: Filter by status (default: ACTIVE)
   */
  router.get('/', async (req: Request, res: Response): Promise<void> => {
    try {
      const status = (req.query.status as string) || 'ACTIVE';

      logger.info('Listing documents via API', {
        tenantId: req.params.tenantId,
        status,
      });

      const documents = await ragService.listDocuments(status);

      res.json({
        success: true,
        data: documents.map((doc) => ({
          id: doc.id,
          title: doc.title,
          description: doc.description,
          contentType: doc.contentType,
          metadata: doc.metadata,
          summary: doc.summary,
          keywords: doc.keywords,
          status: doc.status,
          embeddingsCount: doc.embeddingsCount,
          hasSummaryEmbedding: doc.hasSummaryEmbedding,
          createdAt: doc.createdAt,
          updatedAt: doc.updatedAt,
        })),
        count: documents.length,
      });
    } catch (error) {
      logger.error('Error in GET /documents', {
        tenantId: req.params.tenantId,
        error: error instanceof Error ? error.message : String(error),
      });

      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to list documents',
      });
    }
  });

  /**
   * GET /v1/api/:tenantId/documents/:id
   * Get a specific document by ID
   */
  router.get('/:id', async (req: Request, res: Response): Promise<void> => {
    try {
      const documentId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

      logger.info('Getting document via API', {
        tenantId: req.params.tenantId,
        documentId,
      });

      const document = await ragService.getDocument(documentId);

      res.json({
        success: true,
        data: {
          id: document.id,
          title: document.title,
          description: document.description,
          content: document.content,
          contentType: document.contentType,
          metadata: document.metadata,
          summary: document.summary,
          keywords: document.keywords,
          status: document.status,
          embeddingsCount: document.embeddingsCount,
          hasSummaryEmbedding: document.hasSummaryEmbedding,
          createdAt: document.createdAt,
          updatedAt: document.updatedAt,
        },
      });
    } catch (error) {
      logger.error('Error in GET /documents/:id', {
        tenantId: req.params.tenantId,
        documentId: req.params.id,
        error: error instanceof Error ? error.message : String(error),
      });

      if (error instanceof Error && error.message.includes('not found')) {
        res.status(404).json({
          error: 'Not found',
          message: error.message,
        });
        return;
      }

      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to get document',
      });
    }
  });

  /**
   * GET /v1/api/:tenantId/documents/:id/chunks
   * Paginated chunk content for a document
   */
  router.get('/:id/chunks', async (req: Request, res: Response): Promise<void> => {
    try {
      const documentId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string, 10) || 20));

      const result = await ragService.getDocumentChunks(documentId, page, pageSize);

      res.json({ success: true, data: result });
    } catch (error) {
      logger.error('Error in GET /documents/:id/chunks', {
        tenantId: req.params.tenantId,
        documentId: req.params.id,
        error: error instanceof Error ? error.message : String(error),
      });

      if (error instanceof Error && error.message.includes('not found')) {
        res.status(404).json({ error: 'Not found', message: error.message });
        return;
      }

      res.status(500).json({ error: 'Internal server error', message: 'Failed to get document chunks' });
    }
  });

  /**
   * DELETE /v1/api/:tenantId/documents/:id
   * Delete a document and its embeddings
   */
  router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
    try {
      const documentId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

      logger.info('Deleting document via API', {
        tenantId: req.params.tenantId,
        documentId,
      });

      await ragService.deleteDocument(documentId);

      res.json({
        success: true,
        message: 'Document deleted successfully',
      });
    } catch (error) {
      logger.error('Error in DELETE /documents/:id', {
        tenantId: req.params.tenantId,
        documentId: req.params.id,
        error: error instanceof Error ? error.message : String(error),
      });

      if (error instanceof Error && error.message.includes('not found')) {
        res.status(404).json({
          error: 'Not found',
          message: error.message,
        });
        return;
      }

      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to delete document',
      });
    }
  });

  /**
   * POST /v1/api/:tenantId/documents/upload
   * Upload a file and ingest it as a RAG document.
   * Accepts multipart/form-data: file (required), title (required), summary (required),
   * keywords (optional, comma-separated), description (optional).
   * Deletes the temp file in a finally block regardless of success or failure.
   */
  router.post('/upload', upload.single('file'), async (req: Request, res: Response): Promise<void> => {
    const file = req.file;
    const { title, summary, keywords, description } = req.body;

    if (!file) {
      res.status(400).json({ error: 'Validation error', message: 'No file uploaded' });
      return;
    }

    if (!title?.trim()) {
      await fs.unlink(file.path).catch(() => {});
      res.status(400).json({ error: 'Validation error', message: 'Title is required' });
      return;
    }

    if (!summary?.trim()) {
      await fs.unlink(file.path).catch(() => {});
      res.status(400).json({ error: 'Validation error', message: 'Summary is required' });
      return;
    }

    try {
      const content = await documentLoaderService.extractText(file.path, file.originalname);

      const keywordsArr = keywords
        ? (keywords as string).split(',').map((k: string) => k.trim()).filter(Boolean)
        : [];

      const document = await ragService.ingestDocument({
        title: (title as string).trim(),
        description: description ? (description as string).trim() : undefined,
        content,
        contentType: file.mimetype,
        summary: (summary as string).trim(),
        keywords: keywordsArr,
      });

      res.status(201).json({
        success: true,
        message: 'Document uploaded and indexed successfully',
        data: {
          id: document.id,
          title: document.title,
          description: document.description,
          contentType: document.contentType,
          status: document.status,
          embeddingsCount: document.embeddingsCount,
          hasSummaryEmbedding: document.hasSummaryEmbedding,
          createdAt: document.createdAt,
          updatedAt: document.updatedAt,
        },
      });
    } catch (error) {
      logger.error('Error in POST /documents/upload', {
        tenantId: req.params.tenantId,
        error: error instanceof Error ? error.message : String(error),
      });

      if (error instanceof Error && error.message.startsWith('Unsupported file type')) {
        res.status(400).json({ error: 'Validation error', message: error.message });
        return;
      }

      res.status(500).json({ error: 'Internal server error', message: 'Failed to process document' });
    } finally {
      await fs.unlink(file.path).catch(() => {});
    }
  });

  // Handle multer errors (must use 4-arg Express error middleware signature)
  router.use('/upload', (err: unknown, _req: Request, res: Response, next: NextFunction): void => {
    if (err && typeof err === 'object' && 'code' in err) {
      if ((err as { code: string }).code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({ error: 'File too large', message: 'File exceeds the 50 MB limit' });
        return;
      }
    }
    next(err);
  });

  router.post('/query', async (req: Request, res: Response): Promise<void> => {
    try {
      const { query, topK } = req.body;

      // Validate required fields
      if (!query || typeof query !== 'string') {
        res.status(400).json({
          error: 'Validation error',
          message: 'Query is required and must be a string',
        });
        return;
      }

      if (query.trim().length === 0) {
        res.status(400).json({
          error: 'Validation error',
          message: 'Query cannot be empty',
        });
        return;
      }

      // Validate topK if provided
      if (topK !== undefined) {
        if (typeof topK !== 'number' || topK <= 0 || topK > 100) {
          res.status(400).json({
            error: 'Validation error',
            message: 'topK must be a number between 1 and 100',
          });
          return;
        }
      }

      logger.info('Querying documents via API', {
        tenantId: req.params.tenantId,
        query: query.substring(0, 100),
        topK,
      });

      const results = await ragService.queryDocuments(query, topK);

      res.json({
        success: true,
        query,
        data: results,
        count: results.length,
      });
    } catch (error) {
      logger.error('Error in POST /documents/query', {
        tenantId: req.params.tenantId,
        error: error instanceof Error ? error.message : String(error),
      });

      // Handle specific errors
      if (error instanceof Error) {
        if (error.message.includes('OPENAI_API_KEY')) {
          res.status(500).json({
            error: 'Configuration error',
            message: 'OpenAI API key is not configured. Please contact support.',
          });
          return;
        }

        if (error.message.includes('No tenant context')) {
          res.status(403).json({
            error: 'Forbidden',
            message: 'Tenant context is required for this operation',
          });
          return;
        }
      }

      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to query documents',
      });
    }
  });

  return router;
}

// Default export for convenience
export default createRAGRoutes;
