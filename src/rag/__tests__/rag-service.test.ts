/**
 * RAG Service Tests
 *
 * Tests for RAGService including:
 * - Document ingestion with LangChain
 * - Semantic search/querying
 * - Tenant isolation
 * - Error handling
 */

import { PrismaClient } from '@prisma/client';
import { RAGService } from '../rag-service';
import { runWithTenantContext } from '../../core/tenant-context-storage';
import { TenantContext } from '../../core/types';

// Mock LangChain modules
jest.mock('@langchain/textsplitters', () => {
  return {
    RecursiveCharacterTextSplitter: jest.fn().mockImplementation(() => ({
      createDocuments: jest.fn().mockResolvedValue([
        { pageContent: 'This is chunk 1.' },
        { pageContent: 'This is chunk 2.' },
      ]),
    })),
  };
});

jest.mock('@langchain/openai', () => {
  return {
    OpenAIEmbeddings: jest.fn().mockImplementation(() => ({
      embedDocuments: jest.fn().mockResolvedValue([
        new Array(1536).fill(0.1),
        new Array(1536).fill(0.2),
      ]),
      embedQuery: jest.fn().mockResolvedValue(new Array(1536).fill(0.15)),
    })),
  };
});

// Mock Prisma Client
const mockPrisma = {
  tenantDocument: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    delete: jest.fn(),
  },
  documentEmbedding: {
    findMany: jest.fn(),
    count: jest.fn(),
  },
  $queryRaw: jest.fn(),
  $queryRawUnsafe: jest.fn().mockResolvedValue([]),
  $executeRawUnsafe: jest.fn().mockResolvedValue(1),
  $transaction: jest.fn().mockImplementation((ops: any) =>
    Array.isArray(ops) ? Promise.all(ops) : ops(),
  ),
} as unknown as PrismaClient;

describe('RAGService', () => {
  let ragService: RAGService;
  let mockTenantContext: TenantContext;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Set up environment variable
    process.env.OPENAI_API_KEY = 'test-api-key';

    // Create RAG service instance
    ragService = new RAGService(mockPrisma);

    // Mock tenant context
    mockTenantContext = {
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
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  describe('ingestDocument', () => {
    it('should ingest a document successfully', async () => {
      const mockDocument = {
        id: 'doc-123',
        tenantId: 'tenant-123',
        title: 'Test Document',
        description: 'Test Description',
        content: 'This is a test document with some content.',
        contentType: 'text/plain',
        metadata: { source: 'test' },
        summary: null,
        keywords: [],
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (mockPrisma.tenantDocument.create as jest.Mock).mockResolvedValue(
        mockDocument
      );

      const result = await runWithTenantContext(mockTenantContext, async () => {
        return await ragService.ingestDocument({
          title: 'Test Document',
          description: 'Test Description',
          content: 'This is a test document with some content.',
          contentType: 'text/plain',
          metadata: { source: 'test' },
        });
      });

      expect(result).toEqual({
        ...mockDocument,
        embeddingsCount: 2,
        hasSummaryEmbedding: false,
      });

      expect(mockPrisma.tenantDocument.create).toHaveBeenCalledWith({
        data: {
          tenantId: 'tenant-123',
          title: 'Test Document',
          description: 'Test Description',
          content: 'This is a test document with some content.',
          contentType: 'text/plain',
          metadata: { source: 'test' },
          summary: null,
          keywords: [],
          status: 'ACTIVE',
        },
      });

      // Embeddings are inserted via $transaction + $executeRawUnsafe with ::vector cast
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledTimes(2);
      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('::vector'),
        expect.any(String), // uuid
        'doc-123',
        0,
        'This is chunk 1.',
        expect.stringMatching(/^\[/), // vector string "[0.1,0.1,...]"
        'text-embedding-3-small',
      );
    });

    it('should throw error if no tenant context', async () => {
      await expect(
        ragService.ingestDocument({
          title: 'Test',
          content: 'Test content',
          contentType: 'text/plain',
        })
      ).rejects.toThrow('No tenant context found');
    });

    it('should throw error if OPENAI_API_KEY is missing', async () => {
      delete process.env.OPENAI_API_KEY;

      await expect(
        runWithTenantContext(mockTenantContext, async () => {
          return await ragService.ingestDocument({
            title: 'Test',
            content: 'Test content',
            contentType: 'text/plain',
          });
        })
      ).rejects.toThrow('OPENAI_API_KEY is not configured. Please set the OPENAI_API_KEY environment variable.');
    });

    it('should embed and store summary when summary is provided', async () => {
      const mockDocument = {
        id: 'doc-123',
        tenantId: 'tenant-123',
        title: 'Test Document',
        description: null,
        content: 'This is a test document with some content.',
        contentType: 'text/plain',
        metadata: null,
        summary: 'A document about heart failure management',
        keywords: ['heart', 'failure'],
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (mockPrisma.tenantDocument.create as jest.Mock).mockResolvedValue(mockDocument);

      const result = await runWithTenantContext(mockTenantContext, async () => {
        return await ragService.ingestDocument({
          title: 'Test Document',
          content: 'This is a test document with some content.',
          contentType: 'text/plain',
          summary: 'A document about heart failure management',
          keywords: ['heart', 'failure'],
        });
      });

      // 2 chunk inserts (inside $transaction) + 1 summary embedding UPDATE
      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledTimes(3);
      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE tenant_documents SET summary_embedding'),
        expect.stringMatching(/^\[/), // vector string like "[0.15,0.15,...]"
        'doc-123',
      );
      expect(result.hasSummaryEmbedding).toBe(true);
    });

    it('should NOT embed summary when summary is not provided', async () => {
      const mockDocument = {
        id: 'doc-123',
        tenantId: 'tenant-123',
        title: 'Test Document',
        description: null,
        content: 'This is a test document.',
        contentType: 'text/plain',
        metadata: null,
        summary: null,
        keywords: [],
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (mockPrisma.tenantDocument.create as jest.Mock).mockResolvedValue(mockDocument);

      const result = await runWithTenantContext(mockTenantContext, async () => {
        return await ragService.ingestDocument({
          title: 'Test Document',
          content: 'This is a test document.',
          contentType: 'text/plain',
        });
      });

      // Only 2 chunk inserts — no summary embedding step
      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledTimes(2);
      expect(result.hasSummaryEmbedding).toBe(false);
    });

    it('should propagate errors when summary embedding UPDATE fails', async () => {
      const mockDocument = {
        id: 'doc-999',
        tenantId: 'tenant-123',
        title: 'Test Document',
        description: null,
        content: 'Content.',
        contentType: 'text/plain',
        metadata: null,
        summary: 'Some summary',
        keywords: [],
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (mockPrisma.tenantDocument.create as jest.Mock).mockResolvedValue(mockDocument);
      (mockPrisma.tenantDocument.delete as jest.Mock).mockResolvedValue(mockDocument);

      // Chunk inserts succeed; summary embedding UPDATE fails
      (mockPrisma.$executeRawUnsafe as jest.Mock)
        .mockResolvedValueOnce(1) // chunk 1
        .mockResolvedValueOnce(1) // chunk 2
        .mockRejectedValueOnce(new Error('DB connection lost'));

      await expect(
        runWithTenantContext(mockTenantContext, async () => {
          return await ragService.ingestDocument({
            title: 'Test Document',
            content: 'Content.',
            contentType: 'text/plain',
            summary: 'Some summary',
          });
        })
      ).rejects.toThrow('DB connection lost');

      // Document should be deleted on rollback
      expect(mockPrisma.tenantDocument.delete).toHaveBeenCalledWith({
        where: { id: 'doc-999' },
      });
    });
  });

  describe('queryDocuments', () => {
    it('should query documents successfully', async () => {
      const mockQueryResults = [
        { id: 'embed-1', document_id: 'doc-123', chunk_index: 0, chunk_text: 'This is chunk 1.', distance: 0.1 },
        { id: 'embed-2', document_id: 'doc-456', chunk_index: 0, chunk_text: 'This is another chunk.', distance: 0.2 },
      ];
      const mockDocuments = [
        {
          id: 'doc-123', tenantId: 'tenant-123', title: 'Document 1', description: null,
          content: 'Content 1', contentType: 'text/plain', metadata: { source: 'test' },
          summary: 'Heart failure guide', keywords: ['heart'], status: 'ACTIVE',
          createdAt: new Date(), updatedAt: new Date(),
        },
        {
          id: 'doc-456', tenantId: 'tenant-123', title: 'Document 2', description: null,
          content: 'Content 2', contentType: 'text/plain', metadata: null,
          summary: null, keywords: [], status: 'ACTIVE',
          createdAt: new Date(), updatedAt: new Date(),
        },
      ];

      // Phase 1 returns a match; Phase 2 returns chunk rows
      (mockPrisma.$queryRawUnsafe as jest.Mock)
        .mockResolvedValueOnce([{ id: 'doc-123' }])
        .mockResolvedValueOnce(mockQueryResults);
      (mockPrisma.tenantDocument.findMany as jest.Mock).mockResolvedValue(mockDocuments);

      const result = await runWithTenantContext(mockTenantContext, async () => {
        return await ragService.queryDocuments('test query');
      });

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        documentId: 'doc-123',
        documentTitle: 'Document 1',
        chunkIndex: 0,
        chunkText: 'This is chunk 1.',
        similarity: 0.9,
        metadata: { source: 'test' },
      });
    });

    it('should use filtered doc IDs in Phase 2 when Phase 1 returns matches', async () => {
      const mockChunkRows = [
        {
          id: 'embed-1',
          document_id: 'doc-123',
          chunk_index: 0,
          chunk_text: 'Filtered chunk.',
          distance: 0.1,
        },
      ];
      const mockDocuments = [
        {
          id: 'doc-123',
          tenantId: 'tenant-123',
          title: 'Document 1',
          description: null,
          content: 'Content 1',
          contentType: 'text/plain',
          metadata: null,
          summary: 'About heart failure',
          keywords: ['heart'],
          status: 'ACTIVE',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      // Phase 1 returns one matching doc; Phase 2 returns chunk rows
      (mockPrisma.$queryRawUnsafe as jest.Mock)
        .mockResolvedValueOnce([{ id: 'doc-123' }])  // Phase 1
        .mockResolvedValueOnce(mockChunkRows);         // Phase 2 filtered

      (mockPrisma.tenantDocument.findMany as jest.Mock).mockResolvedValue(mockDocuments);

      const result = await runWithTenantContext(mockTenantContext, async () => {
        return await ragService.queryDocuments('heart failure question');
      });

      expect(result).toHaveLength(1);
      expect(result[0].documentId).toBe('doc-123');
      expect(result[0].similarity).toBeCloseTo(0.9);
      expect(mockPrisma.$queryRawUnsafe).toHaveBeenCalledTimes(2);

      // Verify the second call used filtered doc IDs (contains ANY($3::uuid[]))
      const secondCallArgs = (mockPrisma.$queryRawUnsafe as jest.Mock).mock.calls[1];
      expect(secondCallArgs[0]).toContain('ANY($3::uuid[])');
    });

    it('should fall back to all docs when Phase 1 returns no matches', async () => {
      const mockChunkRows = [
        {
          id: 'embed-2',
          document_id: 'doc-456',
          chunk_index: 0,
          chunk_text: 'Fallback chunk.',
          distance: 0.3,
        },
      ];
      const mockDocuments = [
        {
          id: 'doc-456',
          tenantId: 'tenant-123',
          title: 'Document 2',
          description: null,
          content: 'Content 2',
          contentType: 'text/plain',
          metadata: null,
          summary: null,
          keywords: [],
          status: 'ACTIVE',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      // Phase 1 returns empty; Phase 2 uses full-tenant fallback
      (mockPrisma.$queryRawUnsafe as jest.Mock)
        .mockResolvedValueOnce([])          // Phase 1: no summary matches
        .mockResolvedValueOnce(mockChunkRows); // Phase 2 fallback

      (mockPrisma.tenantDocument.findMany as jest.Mock).mockResolvedValue(mockDocuments);

      const mockTracer = {
        recordFilter: jest.fn(),
        recordSearch: jest.fn(),
      };

      const result = await runWithTenantContext(mockTenantContext, async () => {
        return await ragService.queryDocuments('unrelated question', undefined, mockTracer);
      });

      expect(result).toHaveLength(1);
      expect(result[0].documentId).toBe('doc-456');
      expect(mockTracer.recordFilter).toHaveBeenCalledWith(
        expect.objectContaining({ 'rag.filter.fallback': true })
      );
      expect(mockTracer.recordSearch).toHaveBeenCalled();

      // Verify the second call did NOT include ANY (fallback path without filtering)
      const secondCallArgs = (mockPrisma.$queryRawUnsafe as jest.Mock).mock.calls[1];
      expect(secondCallArgs[0]).not.toContain('ANY($3::uuid[])');
    });

    it('should throw error if no tenant context', async () => {
      await expect(ragService.queryDocuments('test query')).rejects.toThrow(
        'No tenant context found'
      );
    });

    it('should throw error if OPENAI_API_KEY is missing', async () => {
      delete process.env.OPENAI_API_KEY;

      await expect(
        runWithTenantContext(mockTenantContext, async () => {
          return await ragService.queryDocuments('test query');
        })
      ).rejects.toThrow('OPENAI_API_KEY is not configured. Please set the OPENAI_API_KEY environment variable.');
    });
  });

  describe('listDocuments', () => {
    it('should list documents successfully', async () => {
      const mockDocuments = [
        {
          id: 'doc-123',
          tenantId: 'tenant-123',
          title: 'Document 1',
          description: 'Description 1',
          content: 'Content 1',
          contentType: 'text/plain',
          metadata: { source: 'test' },
          summary: null,
          keywords: [],
          status: 'ACTIVE',
          createdAt: new Date(),
          updatedAt: new Date(),
          embeddings: [{ id: 'embed-1' }, { id: 'embed-2' }],
        },
      ];

      (mockPrisma.tenantDocument.findMany as jest.Mock).mockResolvedValue(
        mockDocuments
      );

      const result = await runWithTenantContext(mockTenantContext, async () => {
        return await ragService.listDocuments();
      });

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: 'doc-123',
        tenantId: 'tenant-123',
        title: 'Document 1',
        description: 'Description 1',
        content: 'Content 1',
        contentType: 'text/plain',
        metadata: { source: 'test' },
        summary: null,
        keywords: [],
        status: 'ACTIVE',
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
        embeddingsCount: 2,
        hasSummaryEmbedding: false,
      });

      expect(mockPrisma.tenantDocument.findMany).toHaveBeenCalledWith({
        where: {
          tenantId: 'tenant-123',
          status: 'ACTIVE',
        },
        include: {
          embeddings: {
            select: {
              id: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });
    });

    it('should throw error if no tenant context', async () => {
      await expect(ragService.listDocuments()).rejects.toThrow(
        'No tenant context found'
      );
    });
  });

  describe('getDocument', () => {
    it('should get document successfully', async () => {
      const mockDocument = {
        id: 'doc-123',
        tenantId: 'tenant-123',
        title: 'Document 1',
        description: 'Description 1',
        content: 'Content 1',
        contentType: 'text/plain',
        metadata: { source: 'test' },
        summary: null,
        keywords: [],
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date(),
        embeddings: [{ id: 'embed-1' }, { id: 'embed-2' }],
      };

      (mockPrisma.tenantDocument.findFirst as jest.Mock).mockResolvedValue(
        mockDocument
      );

      const result = await runWithTenantContext(mockTenantContext, async () => {
        return await ragService.getDocument('doc-123');
      });

      expect(result).toEqual({
        id: 'doc-123',
        tenantId: 'tenant-123',
        title: 'Document 1',
        description: 'Description 1',
        content: 'Content 1',
        contentType: 'text/plain',
        metadata: { source: 'test' },
        summary: null,
        keywords: [],
        status: 'ACTIVE',
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
        embeddingsCount: 2,
        hasSummaryEmbedding: false,
      });
    });

    it('should throw error if document not found', async () => {
      (mockPrisma.tenantDocument.findFirst as jest.Mock).mockResolvedValue(
        null
      );

      await expect(
        runWithTenantContext(mockTenantContext, async () => {
          return await ragService.getDocument('nonexistent');
        })
      ).rejects.toThrow('Document not found: nonexistent');
    });

    it('should throw error if no tenant context', async () => {
      await expect(ragService.getDocument('doc-123')).rejects.toThrow(
        'No tenant context found'
      );
    });
  });

  describe('getDocumentChunks', () => {
    it('should return paginated chunks with correct skip/take', async () => {
      (mockPrisma.tenantDocument.findFirst as jest.Mock).mockResolvedValue({ id: 'doc-123' });
      (mockPrisma.documentEmbedding.findMany as jest.Mock).mockResolvedValue([
        { chunkIndex: 20, chunkText: 'abcdefghij' },
        { chunkIndex: 21, chunkText: 'klmnopqrst' },
      ]);
      (mockPrisma.documentEmbedding.count as jest.Mock).mockResolvedValue(45);

      const result = await runWithTenantContext(mockTenantContext, async () => {
        return await ragService.getDocumentChunks('doc-123', 2, 20);
      });

      expect(result).toEqual({
        chunks: [
          { chunkIndex: 20, chunkText: 'abcdefghij', characterCount: 10 },
          { chunkIndex: 21, chunkText: 'klmnopqrst', characterCount: 10 },
        ],
        total: 45,
        page: 2,
        pageSize: 20,
      });

      expect(mockPrisma.documentEmbedding.findMany).toHaveBeenCalledWith({
        where: { documentId: 'doc-123' },
        orderBy: { chunkIndex: 'asc' },
        skip: 20,
        take: 20,
        select: { chunkIndex: true, chunkText: true },
      });
      expect(mockPrisma.documentEmbedding.count).toHaveBeenCalledWith({
        where: { documentId: 'doc-123' },
      });
    });

    it('should throw error if document not found (or belongs to another tenant)', async () => {
      (mockPrisma.tenantDocument.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        runWithTenantContext(mockTenantContext, async () => {
          return await ragService.getDocumentChunks('nonexistent', 1, 20);
        })
      ).rejects.toThrow('Document not found: nonexistent');

      expect(mockPrisma.tenantDocument.findFirst).toHaveBeenCalledWith({
        where: { id: 'nonexistent', tenantId: 'tenant-123' },
        select: { id: true },
      });
      expect(mockPrisma.documentEmbedding.findMany).not.toHaveBeenCalled();
    });

    it('should return empty chunks array for a document with zero chunks', async () => {
      (mockPrisma.tenantDocument.findFirst as jest.Mock).mockResolvedValue({ id: 'doc-123' });
      (mockPrisma.documentEmbedding.findMany as jest.Mock).mockResolvedValue([]);
      (mockPrisma.documentEmbedding.count as jest.Mock).mockResolvedValue(0);

      const result = await runWithTenantContext(mockTenantContext, async () => {
        return await ragService.getDocumentChunks('doc-123', 1, 20);
      });

      expect(result).toEqual({ chunks: [], total: 0, page: 1, pageSize: 20 });
    });

    it('should throw error if no tenant context', async () => {
      await expect(ragService.getDocumentChunks('doc-123', 1, 20)).rejects.toThrow(
        'No tenant context found'
      );
    });
  });

  describe('deleteDocument', () => {
    it('should delete document successfully', async () => {
      const mockDocument = {
        id: 'doc-123',
        tenantId: 'tenant-123',
        title: 'Document 1',
        description: 'Description 1',
        content: 'Content 1',
        contentType: 'text/plain',
        metadata: { source: 'test' },
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (mockPrisma.tenantDocument.findFirst as jest.Mock).mockResolvedValue(
        mockDocument
      );
      (mockPrisma.tenantDocument.delete as jest.Mock).mockResolvedValue(
        mockDocument
      );

      await runWithTenantContext(mockTenantContext, async () => {
        await ragService.deleteDocument('doc-123');
      });

      expect(mockPrisma.tenantDocument.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'doc-123',
          tenantId: 'tenant-123',
        },
      });

      expect(mockPrisma.tenantDocument.delete).toHaveBeenCalledWith({
        where: {
          id: 'doc-123',
        },
      });
    });

    it('should throw error if document not found', async () => {
      (mockPrisma.tenantDocument.findFirst as jest.Mock).mockResolvedValue(
        null
      );

      await expect(
        runWithTenantContext(mockTenantContext, async () => {
          await ragService.deleteDocument('nonexistent');
        })
      ).rejects.toThrow('Document not found: nonexistent');
    });

    it('should throw error if no tenant context', async () => {
      await expect(ragService.deleteDocument('doc-123')).rejects.toThrow(
        'No tenant context found'
      );
    });
  });

  describe('tenant isolation', () => {
    it('should use correct tenant ID in all operations', async () => {
      const mockDocument = {
        id: 'doc-123',
        tenantId: 'tenant-123',
        title: 'Test Document',
        description: null,
        content: 'Test content',
        contentType: 'text/plain',
        metadata: null,
        summary: null,
        keywords: [],
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (mockPrisma.tenantDocument.create as jest.Mock).mockResolvedValue(
        mockDocument
      );

      await runWithTenantContext(mockTenantContext, async () => {
        await ragService.ingestDocument({
          title: 'Test Document',
          content: 'Test content',
          contentType: 'text/plain',
        });
      });

      expect(mockPrisma.tenantDocument.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: 'tenant-123',
        }),
      });
    });

    it('should fail if tenant context is missing', async () => {
      // No tenant context, should throw error
      await expect(
        ragService.ingestDocument({
          title: 'Test',
          content: 'Test content',
          contentType: 'text/plain',
        })
      ).rejects.toThrow('No tenant context found');

      await expect(ragService.queryDocuments('test query')).rejects.toThrow(
        'No tenant context found'
      );

      await expect(ragService.listDocuments()).rejects.toThrow(
        'No tenant context found'
      );

      await expect(ragService.getDocument('doc-123')).rejects.toThrow(
        'No tenant context found'
      );

      await expect(ragService.deleteDocument('doc-123')).rejects.toThrow(
        'No tenant context found'
      );
    });
  });
});
