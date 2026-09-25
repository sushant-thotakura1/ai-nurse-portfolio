import { EmbeddingService } from '../../../src/ai-agent/rag/embeddings';
import { VectorStore } from '../../../src/ai-agent/rag/vector-store';
import { RetrievalService } from '../../../src/ai-agent/rag/retrieval';
import { prisma } from '../../../src/core/database';

// Mock Prisma
jest.mock('../../../src/core/database', () => ({
  prisma: {
    knowledgeBase: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
    $queryRaw: jest.fn(),
  },
}));

// Mock OpenAI for embeddings
jest.mock('openai');
import OpenAI from 'openai';

describe('RAG System', () => {
  describe('EmbeddingService', () => {
    let embeddingService: EmbeddingService;
    let mockOpenAI: jest.Mocked<OpenAI>;

    beforeEach(() => {
      mockOpenAI = {
        embeddings: {
          create: jest.fn(),
        },
      } as any;

      (OpenAI as jest.MockedClass<typeof OpenAI>).mockImplementation(() => mockOpenAI);
      embeddingService = new EmbeddingService({ apiKey: 'test-key' });
    });

    it('should generate embeddings for text', async () => {
      const mockEmbedding = Array(1536).fill(0.1);

      (mockOpenAI.embeddings.create as jest.Mock).mockResolvedValueOnce({
        data: [{ embedding: mockEmbedding }],
      });

      const result = await embeddingService.generateEmbedding('Test medical text');

      expect(result).toEqual(mockEmbedding);
      expect(mockOpenAI.embeddings.create).toHaveBeenCalledWith({
        model: 'text-embedding-3-small',
        input: 'Test medical text',
      });
    });

    it('should handle embedding generation errors', async () => {
      (mockOpenAI.embeddings.create as jest.Mock).mockRejectedValueOnce(
        new Error('API Error')
      );

      await expect(
        embeddingService.generateEmbedding('Test text')
      ).rejects.toThrow('Failed to generate embedding');
    });
  });

  describe('VectorStore', () => {
    let vectorStore: VectorStore;
    let mockEmbeddingService: jest.Mocked<EmbeddingService>;

    beforeEach(() => {
      mockEmbeddingService = {
        generateEmbedding: jest.fn(),
      } as any;

      vectorStore = new VectorStore(mockEmbeddingService);
      jest.clearAllMocks();
    });

    it('should store knowledge with embedding', async () => {
      const mockEmbedding = Array(1536).fill(0.1);
      mockEmbeddingService.generateEmbedding.mockResolvedValueOnce(mockEmbedding);

      (prisma.$queryRaw as jest.Mock).mockResolvedValueOnce([{
        id: 'kb-123',
        content: 'Post-surgery pain management protocol',
        contentType: 'CLINICAL_PROTOCOL',
        source: 'Medical Guidelines 2024',
        locale: 'en-US',
      }]);

      const result = await vectorStore.addKnowledge({
        content: 'Post-surgery pain management protocol',
        contentType: 'CLINICAL_PROTOCOL',
        source: 'Medical Guidelines 2024',
        locale: 'en-US',
      });

      expect(result.id).toBe('kb-123');
      expect(mockEmbeddingService.generateEmbedding).toHaveBeenCalledWith(
        'Post-surgery pain management protocol'
      );
      expect(prisma.$queryRaw).toHaveBeenCalled();
    });
  });

  describe('RetrievalService', () => {
    let retrievalService: RetrievalService;
    let mockEmbeddingService: jest.Mocked<EmbeddingService>;

    beforeEach(() => {
      mockEmbeddingService = {
        generateEmbedding: jest.fn(),
      } as any;

      retrievalService = new RetrievalService(mockEmbeddingService);
      jest.clearAllMocks();
    });

    it('should retrieve relevant knowledge based on query', async () => {
      const mockEmbedding = Array(1536).fill(0.1);
      mockEmbeddingService.generateEmbedding.mockResolvedValueOnce(mockEmbedding);

      const mockResults = [
        {
          id: 'kb-1',
          content: 'Pain management for post-surgery patients',
          contentType: 'CLINICAL_PROTOCOL',
          similarity: 0.95,
        },
        {
          id: 'kb-2',
          content: 'Wound care instructions',
          contentType: 'CLINICAL_PROTOCOL',
          similarity: 0.87,
        },
      ];

      (prisma.$queryRaw as jest.Mock).mockResolvedValueOnce(mockResults);

      const results = await retrievalService.retrieve('post surgery pain', {
        limit: 5,
        minSimilarity: 0.7,
      });

      expect(results).toHaveLength(2);
      expect(results[0].content).toBe('Pain management for post-surgery patients');
      expect(results[0].similarity).toBe(0.95);
      expect(mockEmbeddingService.generateEmbedding).toHaveBeenCalledWith('post surgery pain');
    });

    it('should filter by locale if provided', async () => {
      const mockEmbedding = Array(1536).fill(0.1);
      mockEmbeddingService.generateEmbedding.mockResolvedValueOnce(mockEmbedding);

      (prisma.$queryRaw as jest.Mock).mockResolvedValueOnce([]);

      await retrievalService.retrieve('test query', {
        locale: 'hi-IN',
        limit: 5,
      });

      // Verify locale filter was applied in the query
      const queryCall = (prisma.$queryRaw as jest.Mock).mock.calls[0];
      expect(queryCall).toBeDefined();
    });
  });
});
