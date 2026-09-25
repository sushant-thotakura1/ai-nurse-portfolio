import { prisma } from '../../core/database';
import { EmbeddingService } from './embeddings';
import { logger } from '../../core/logger';
import { Prisma } from '@prisma/client';

interface RetrievalOptions {
  limit?: number;
  minSimilarity?: number;
  locale?: string;
  contentType?: string;
}

interface RetrievalResult {
  id: string;
  content: string;
  contentType: string;
  source?: string;
  similarity: number;
  metadata?: any;
}

export class RetrievalService {
  constructor(private embeddingService: EmbeddingService) {}

  /**
   * Retrieve relevant knowledge using vector similarity search
   */
  async retrieve(
    query: string,
    options: RetrievalOptions = {}
  ): Promise<RetrievalResult[]> {
    try {
      const limit = options.limit || 5;
      const minSimilarity = options.minSimilarity || 0.7;

      logger.info('Retrieving knowledge', {
        query: query.substring(0, 50),
        limit,
        minSimilarity,
      });

      // Generate query embedding
      const queryEmbedding = await this.embeddingService.generateEmbedding(query);
      const embeddingVector = `[${queryEmbedding.join(',')}]`;

      // Build SQL query with pgvector similarity search
      let sql = Prisma.sql`
        SELECT
          id,
          content,
          content_type as "contentType",
          source,
          metadata,
          1 - (embedding <=> ${embeddingVector}::vector) as similarity
        FROM knowledge_base
        WHERE 1=1
      `;

      // Add locale filter if provided
      if (options.locale) {
        sql = Prisma.sql`${sql} AND locale = ${options.locale}`;
      }

      // Add content type filter if provided
      if (options.contentType) {
        sql = Prisma.sql`${sql} AND content_type = ${options.contentType}`;
      }

      // Add similarity threshold and ordering
      sql = Prisma.sql`
        ${sql}
        AND 1 - (embedding <=> ${embeddingVector}::vector) >= ${minSimilarity}
        ORDER BY embedding <=> ${embeddingVector}::vector
        LIMIT ${limit}
      `;

      const results = await prisma.$queryRaw<RetrievalResult[]>(sql);

      logger.info('Knowledge retrieved', {
        count: results.length,
      });

      return results;
    } catch (error: any) {
      logger.error('Failed to retrieve knowledge', {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Retrieve knowledge with context for RAG
   */
  async retrieveForRAG(query: string, locale?: string): Promise<string> {
    const results = await this.retrieve(query, {
      limit: 3,
      minSimilarity: 0.75,
      locale,
    });

    if (results.length === 0) {
      return '';
    }

    // Format results as context
    const context = results
      .map((r, i) => `[${i + 1}] ${r.content}`)
      .join('\n\n');

    return context;
  }
}
