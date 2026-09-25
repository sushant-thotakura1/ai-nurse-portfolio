import { prisma } from '../../core/database';
import { EmbeddingService } from './embeddings';
import { logger } from '../../core/logger';
import { Prisma } from '@prisma/client';

interface KnowledgeInput {
  content: string;
  contentType: string;
  source?: string;
  locale?: string;
  metadata?: any;
}

export class VectorStore {
  constructor(private embeddingService: EmbeddingService) {}

  /**
   * Add knowledge to vector store
   */
  async addKnowledge(input: KnowledgeInput): Promise<any> {
    try {
      logger.info('Adding knowledge to vector store', {
        contentType: input.contentType,
        locale: input.locale,
      });

      // Generate embedding
      const embedding = await this.embeddingService.generateEmbedding(input.content);
      const embeddingVector = `[${embedding.join(',')}]`;

      // Use raw SQL to insert with embedding (Unsupported type in Prisma)
      const result = await prisma.$queryRaw<any[]>`
        INSERT INTO knowledge_base (content, content_type, source, locale, embedding, metadata, created_at, updated_at)
        VALUES (
          ${input.content},
          ${input.contentType},
          ${input.source || null},
          ${input.locale || null},
          ${Prisma.raw(embeddingVector)}::vector,
          ${input.metadata ? JSON.stringify(input.metadata) : null}::jsonb,
          NOW(),
          NOW()
        )
        RETURNING id, content, content_type as "contentType", source, locale, metadata, created_at as "createdAt", updated_at as "updatedAt"
      `;

      const knowledge = result[0];

      logger.info('Knowledge added to vector store', {
        id: knowledge.id,
        contentType: input.contentType,
      });

      return knowledge;
    } catch (error: any) {
      logger.error('Failed to add knowledge', {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Bulk insert knowledge
   */
  async addKnowledgeBatch(inputs: KnowledgeInput[]): Promise<void> {
    try {
      logger.info('Adding knowledge batch', { count: inputs.length });

      // Generate embeddings in batch
      const texts = inputs.map((i) => i.content);
      const embeddings = await this.embeddingService.generateEmbeddings(texts);

      // Insert all records
      for (let i = 0; i < inputs.length; i++) {
        await this.addKnowledge({
          ...inputs[i],
        });
      }

      logger.info('Knowledge batch added', { count: inputs.length });
    } catch (error: any) {
      logger.error('Failed to add knowledge batch', {
        error: error.message,
      });
      throw error;
    }
  }
}
