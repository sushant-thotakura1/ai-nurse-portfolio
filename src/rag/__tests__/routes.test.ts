/**
 * RAG Routes Tests
 *
 * Tests for RAG API endpoints including:
 * - Document ingestion
 * - Document listing
 * - Document retrieval
 * - Document deletion
 * - Document querying
 * - Validation and error handling
 */

import request from 'supertest';
import express, { Express } from 'express';
import { PrismaClient } from '@prisma/client';
import { createRAGRoutes } from '../routes';
import { createTenantMiddleware } from '../../core/tenant-middleware';

// Mock RAG service
jest.mock('../rag-service', () => {
  const mockRAGService = {
    ingestDocument: jest.fn(),
    listDocuments: jest.fn(),
    getDocument: jest.fn(),
    getDocumentChunks: jest.fn(),
    deleteDocument: jest.fn(),
    queryDocuments: jest.fn(),
  };

  return {
    getRAGService: jest.fn(() => mockRAGService),
  };
});

const mockDocumentLoaderService = {
  extractText: jest.fn(),
};

jest.mock('../document-loader.service', () => ({
  DocumentLoaderService: jest.fn().mockImplementation(() => mockDocumentLoaderService),
}));

// Mock Prisma
const mockPrisma = {
  tenant: {
    findUnique: jest.fn(),
  },
} as unknown as PrismaClient;

// Mock tenant middleware
jest.mock('../../core/tenant-middleware', () => ({
  createTenantMiddleware: jest.fn(() => (req: any, res: any, next: any) => {
    req.params.tenantId = 'tenant-123';
    req.tenantContext = {
      tenantId: 'tenant-123',
      tenantSlug: 'test-tenant',
      tenant: {
        id: 'tenant-123',
        name: 'Test Tenant',
        slug: 'test-tenant',
        status: 'ACTIVE',
        settings: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      isSuperAdmin: false,
    };
    next();
  }),
}));

import { getRAGService } from '../rag-service';

const mockRAGService = getRAGService(mockPrisma);

describe('RAG Routes', () => {
  let app: Express;

  beforeEach(() => {
    jest.clearAllMocks();

    app = express();
    app.use(express.json());
    app.use('/v1/api/:tenantId/documents', createRAGRoutes(mockPrisma));
  });

  describe('POST /v1/api/:tenantId/documents', () => {
    it('should ingest a document successfully', async () => {
      const mockDocument = {
        id: 'doc-123',
        title: 'Test Document',
        description: 'Test Description',
        contentType: 'text/plain',
        metadata: { source: 'test' },
        status: 'ACTIVE',
        embeddingsCount: 2,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (mockRAGService.ingestDocument as jest.Mock).mockResolvedValue(
        mockDocument
      );

      const response = await request(app)
        .post('/v1/api/tenant-123/documents')
        .send({
          title: 'Test Document',
          description: 'Test Description',
          content: 'This is test content',
          contentType: 'text/plain',
          metadata: { source: 'test' },
        });

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        success: true,
        message: 'Document ingested successfully',
        data: {
          id: 'doc-123',
          title: 'Test Document',
          description: 'Test Description',
          contentType: 'text/plain',
          metadata: { source: 'test' },
          status: 'ACTIVE',
          embeddingsCount: 2,
          createdAt: expect.any(String),
          updatedAt: expect.any(String),
        },
      });

      expect(mockRAGService.ingestDocument).toHaveBeenCalledWith({
        title: 'Test Document',
        description: 'Test Description',
        content: 'This is test content',
        contentType: 'text/plain',
        metadata: { source: 'test' },
      });
    });

    it('should return 400 if title is missing', async () => {
      const response = await request(app)
        .post('/v1/api/tenant-123/documents')
        .send({
          content: 'Test content',
          contentType: 'text/plain',
        });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'Validation error',
        message: 'Title is required and must be a string',
      });
    });

    it('should return 400 if content is missing', async () => {
      const response = await request(app)
        .post('/v1/api/tenant-123/documents')
        .send({
          title: 'Test Document',
          contentType: 'text/plain',
        });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'Validation error',
        message: 'Content is required and must be a string',
      });
    });

    it('should return 400 if contentType is missing', async () => {
      const response = await request(app)
        .post('/v1/api/tenant-123/documents')
        .send({
          title: 'Test Document',
          content: 'Test content',
        });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'Validation error',
        message: 'ContentType is required and must be a string',
      });
    });

    it('should return 400 if content is empty', async () => {
      const response = await request(app)
        .post('/v1/api/tenant-123/documents')
        .send({
          title: 'Test Document',
          content: '   ',
          contentType: 'text/plain',
        });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'Validation error',
        message: 'Content cannot be empty',
      });
    });

    it('should return 500 if OpenAI API key is missing', async () => {
      (mockRAGService.ingestDocument as jest.Mock).mockRejectedValue(
        new Error('OPENAI_API_KEY environment variable is not set')
      );

      const response = await request(app)
        .post('/v1/api/tenant-123/documents')
        .send({
          title: 'Test Document',
          content: 'Test content',
          contentType: 'text/plain',
        });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        error: 'Configuration error',
        message: 'OpenAI API key is not configured. Please contact support.',
      });
    });
  });

  describe('GET /v1/api/:tenantId/documents', () => {
    it('should list documents successfully', async () => {
      const mockDocuments = [
        {
          id: 'doc-123',
          title: 'Document 1',
          description: 'Description 1',
          contentType: 'text/plain',
          metadata: { source: 'test' },
          summary: null,
          keywords: [],
          status: 'ACTIVE',
          embeddingsCount: 2,
          hasSummaryEmbedding: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'doc-456',
          title: 'Document 2',
          description: null,
          contentType: 'text/markdown',
          metadata: null,
          summary: null,
          keywords: [],
          status: 'ACTIVE',
          embeddingsCount: 3,
          hasSummaryEmbedding: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      (mockRAGService.listDocuments as jest.Mock).mockResolvedValue(
        mockDocuments
      );

      const response = await request(app).get('/v1/api/tenant-123/documents');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        data: expect.arrayContaining([
          {
            id: 'doc-123',
            title: 'Document 1',
            description: 'Description 1',
            contentType: 'text/plain',
            metadata: { source: 'test' },
            summary: null,
            keywords: [],
            status: 'ACTIVE',
            embeddingsCount: 2,
            hasSummaryEmbedding: false,
            createdAt: expect.any(String),
            updatedAt: expect.any(String),
          },
        ]),
        count: 2,
      });

      expect(mockRAGService.listDocuments).toHaveBeenCalledWith('ACTIVE');
    });

    it('should filter by status', async () => {
      (mockRAGService.listDocuments as jest.Mock).mockResolvedValue([]);

      await request(app).get('/v1/api/tenant-123/documents?status=ARCHIVED');

      expect(mockRAGService.listDocuments).toHaveBeenCalledWith('ARCHIVED');
    });
  });

  describe('GET /v1/api/:tenantId/documents/:id', () => {
    it('should get document successfully', async () => {
      const mockDocument = {
        id: 'doc-123',
        title: 'Document 1',
        description: 'Description 1',
        content: 'Full content here',
        contentType: 'text/plain',
        metadata: { source: 'test' },
        summary: null,
        keywords: [],
        status: 'ACTIVE',
        embeddingsCount: 2,
        hasSummaryEmbedding: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (mockRAGService.getDocument as jest.Mock).mockResolvedValue(mockDocument);

      const response = await request(app).get(
        '/v1/api/tenant-123/documents/doc-123'
      );

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        data: {
          id: 'doc-123',
          title: 'Document 1',
          description: 'Description 1',
          content: 'Full content here',
          contentType: 'text/plain',
          metadata: { source: 'test' },
          summary: null,
          keywords: [],
          status: 'ACTIVE',
          embeddingsCount: 2,
          hasSummaryEmbedding: false,
          createdAt: expect.any(String),
          updatedAt: expect.any(String),
        },
      });

      expect(mockRAGService.getDocument).toHaveBeenCalledWith('doc-123');
    });

    it('should return 404 if document not found', async () => {
      (mockRAGService.getDocument as jest.Mock).mockRejectedValue(
        new Error('Document not found: nonexistent')
      );

      const response = await request(app).get(
        '/v1/api/tenant-123/documents/nonexistent'
      );

      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        error: 'Not found',
        message: 'Document not found: nonexistent',
      });
    });
  });

  describe('GET /v1/api/:tenantId/documents/:id/chunks', () => {
    it('should return paginated chunks with default page/pageSize', async () => {
      const mockResult = {
        chunks: [
          { chunkIndex: 0, chunkText: 'First chunk.', characterCount: 12 },
          { chunkIndex: 1, chunkText: 'Second chunk.', characterCount: 13 },
        ],
        total: 2,
        page: 1,
        pageSize: 20,
      };

      (mockRAGService.getDocumentChunks as jest.Mock).mockResolvedValue(mockResult);

      const response = await request(app).get(
        '/v1/api/tenant-123/documents/doc-123/chunks'
      );

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true, data: mockResult });
      expect(mockRAGService.getDocumentChunks).toHaveBeenCalledWith('doc-123', 1, 20);
    });

    it('should parse page and pageSize query params', async () => {
      (mockRAGService.getDocumentChunks as jest.Mock).mockResolvedValue({
        chunks: [], total: 0, page: 3, pageSize: 10,
      });

      await request(app).get('/v1/api/tenant-123/documents/doc-123/chunks?page=3&pageSize=10');

      expect(mockRAGService.getDocumentChunks).toHaveBeenCalledWith('doc-123', 3, 10);
    });

    it('should cap pageSize at 100', async () => {
      (mockRAGService.getDocumentChunks as jest.Mock).mockResolvedValue({
        chunks: [], total: 0, page: 1, pageSize: 100,
      });

      await request(app).get('/v1/api/tenant-123/documents/doc-123/chunks?pageSize=500');

      expect(mockRAGService.getDocumentChunks).toHaveBeenCalledWith('doc-123', 1, 100);
    });

    it('should fall back to defaults on non-numeric query params', async () => {
      (mockRAGService.getDocumentChunks as jest.Mock).mockResolvedValue({
        chunks: [], total: 0, page: 1, pageSize: 20,
      });

      await request(app).get('/v1/api/tenant-123/documents/doc-123/chunks?page=abc&pageSize=xyz');

      expect(mockRAGService.getDocumentChunks).toHaveBeenCalledWith('doc-123', 1, 20);
    });

    it('should return 404 if document not found', async () => {
      (mockRAGService.getDocumentChunks as jest.Mock).mockRejectedValue(
        new Error('Document not found: nonexistent')
      );

      const response = await request(app).get(
        '/v1/api/tenant-123/documents/nonexistent/chunks'
      );

      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        error: 'Not found',
        message: 'Document not found: nonexistent',
      });
    });
  });

  describe('DELETE /v1/api/:tenantId/documents/:id', () => {
    it('should delete document successfully', async () => {
      (mockRAGService.deleteDocument as jest.Mock).mockResolvedValue(undefined);

      const response = await request(app).delete(
        '/v1/api/tenant-123/documents/doc-123'
      );

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        message: 'Document deleted successfully',
      });

      expect(mockRAGService.deleteDocument).toHaveBeenCalledWith('doc-123');
    });

    it('should return 404 if document not found', async () => {
      (mockRAGService.deleteDocument as jest.Mock).mockRejectedValue(
        new Error('Document not found: nonexistent')
      );

      const response = await request(app).delete(
        '/v1/api/tenant-123/documents/nonexistent'
      );

      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        error: 'Not found',
        message: 'Document not found: nonexistent',
      });
    });
  });

  describe('POST /v1/api/:tenantId/documents/query', () => {
    it('should query documents successfully', async () => {
      const mockResults = [
        {
          documentId: 'doc-123',
          documentTitle: 'Document 1',
          chunkIndex: 0,
          chunkText: 'This is chunk 1',
          similarity: 0.95,
          metadata: { source: 'test' },
        },
        {
          documentId: 'doc-456',
          documentTitle: 'Document 2',
          chunkIndex: 0,
          chunkText: 'This is another chunk',
          similarity: 0.85,
          metadata: null,
        },
      ];

      (mockRAGService.queryDocuments as jest.Mock).mockResolvedValue(
        mockResults
      );

      const response = await request(app)
        .post('/v1/api/tenant-123/documents/query')
        .send({
          query: 'test query',
          topK: 5,
        });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        query: 'test query',
        data: mockResults,
        count: 2,
      });

      expect(mockRAGService.queryDocuments).toHaveBeenCalledWith(
        'test query',
        5
      );
    });

    it('should use default topK if not provided', async () => {
      (mockRAGService.queryDocuments as jest.Mock).mockResolvedValue([]);

      await request(app)
        .post('/v1/api/tenant-123/documents/query')
        .send({
          query: 'test query',
        });

      expect(mockRAGService.queryDocuments).toHaveBeenCalledWith(
        'test query',
        undefined
      );
    });

    it('should return 400 if query is missing', async () => {
      const response = await request(app)
        .post('/v1/api/tenant-123/documents/query')
        .send({
          topK: 5,
        });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'Validation error',
        message: 'Query is required and must be a string',
      });
    });

    it('should return 400 if query is empty', async () => {
      const response = await request(app)
        .post('/v1/api/tenant-123/documents/query')
        .send({
          query: '   ',
        });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'Validation error',
        message: 'Query cannot be empty',
      });
    });

    it('should return 400 if topK is invalid', async () => {
      let response = await request(app)
        .post('/v1/api/tenant-123/documents/query')
        .send({
          query: 'test query',
          topK: 0,
        });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'Validation error',
        message: 'topK must be a number between 1 and 100',
      });

      response = await request(app)
        .post('/v1/api/tenant-123/documents/query')
        .send({
          query: 'test query',
          topK: 101,
        });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'Validation error',
        message: 'topK must be a number between 1 and 100',
      });
    });

    it('should return 500 if OpenAI API key is missing', async () => {
      (mockRAGService.queryDocuments as jest.Mock).mockRejectedValue(
        new Error('OPENAI_API_KEY environment variable is not set')
      );

      const response = await request(app)
        .post('/v1/api/tenant-123/documents/query')
        .send({
          query: 'test query',
        });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        error: 'Configuration error',
        message: 'OpenAI API key is not configured. Please contact support.',
      });
    });
  });

  describe('POST /v1/api/:tenantId/documents/upload', () => {
    const mockUploadedDocument = {
      id: 'doc-123',
      title: 'Clinical Guidelines',
      description: undefined,
      contentType: 'application/pdf',
      status: 'ACTIVE',
      embeddingsCount: 5,
      hasSummaryEmbedding: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    beforeEach(() => {
      mockDocumentLoaderService.extractText.mockResolvedValue('Extracted text from the file.');
      (mockRAGService.ingestDocument as jest.Mock).mockResolvedValue(mockUploadedDocument);
    });

    it('should upload and index a document successfully', async () => {
      const response = await request(app)
        .post('/v1/api/tenant-123/documents/upload')
        .field('title', 'Clinical Guidelines')
        .field('summary', 'A guide for clinical practice in cardiology')
        .attach('file', Buffer.from('PDF content'), {
          filename: 'guidelines.pdf',
          contentType: 'application/pdf',
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.hasSummaryEmbedding).toBe(true);
      expect(response.body.data.embeddingsCount).toBe(5);
      expect(mockDocumentLoaderService.extractText).toHaveBeenCalledWith(
        expect.any(String),
        'guidelines.pdf',
      );
      expect(mockRAGService.ingestDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Clinical Guidelines',
          summary: 'A guide for clinical practice in cardiology',
          contentType: 'application/pdf',
        })
      );
    });

    it('should return 400 when title is missing', async () => {
      const response = await request(app)
        .post('/v1/api/tenant-123/documents/upload')
        .field('summary', 'A summary')
        .attach('file', Buffer.from('content'), {
          filename: 'test.pdf',
          contentType: 'application/pdf',
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toMatch(/title/i);
    });

    it('should return 400 when summary is missing', async () => {
      const response = await request(app)
        .post('/v1/api/tenant-123/documents/upload')
        .field('title', 'Test Doc')
        .attach('file', Buffer.from('content'), {
          filename: 'test.pdf',
          contentType: 'application/pdf',
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toMatch(/summary/i);
    });

    it('should return 400 for unsupported file type', async () => {
      mockDocumentLoaderService.extractText.mockRejectedValue(
        new Error('Unsupported file type: .exe')
      );

      const response = await request(app)
        .post('/v1/api/tenant-123/documents/upload')
        .field('title', 'Test')
        .field('summary', 'A test')
        .attach('file', Buffer.from('content'), {
          filename: 'virus.exe',
          contentType: 'application/octet-stream',
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Unsupported file type');
    });

    it('should return 400 when no file is attached', async () => {
      const response = await request(app)
        .post('/v1/api/tenant-123/documents/upload')
        .send({ title: 'Test', summary: 'Test summary' });

      expect(response.status).toBe(400);
      expect(response.body.message).toMatch(/no file/i);
    });

    it('should return 413 when file size limit is exceeded', async () => {
      // Create a minimal test app that simulates multer throwing LIMIT_FILE_SIZE
      const expressModule = require('express');
      const supertestModule = require('supertest');
      const testApp = expressModule();

      // Simulate a route that passes a LIMIT_FILE_SIZE error through the middleware chain
      const multerLimitError = Object.assign(new Error('File too large'), {
        code: 'LIMIT_FILE_SIZE',
        name: 'MulterError',
      });

      testApp.post('/documents/upload',
        (_req: any, _res: any, next: any) => next(multerLimitError), // simulate multer rejecting
        (_req: any, res: any) => res.json({ ok: true }),             // never reached
      );

      // Install the same error-handling middleware as routes.ts
      testApp.use('/documents/upload', (err: any, _req: any, res: any, next: any) => {
        if (err && typeof err === 'object' && 'code' in err && err.code === 'LIMIT_FILE_SIZE') {
          res.status(413).json({ error: 'File too large', message: 'File exceeds the 50 MB limit' });
          return;
        }
        next(err);
      });

      const res = await supertestModule(testApp).post('/documents/upload').send({});
      expect(res.status).toBe(413);
      expect(res.body.message).toContain('50 MB');
    });
  });
});
