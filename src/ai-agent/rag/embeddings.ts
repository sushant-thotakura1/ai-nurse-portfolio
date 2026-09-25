import OpenAI from 'openai';
import { logger } from '../../core/logger';

interface EmbeddingConfig {
  apiKey: string;
  model?: string;
}

export class EmbeddingService {
  private client: OpenAI;
  private model: string;

  constructor(config: EmbeddingConfig) {
    this.client = new OpenAI({ apiKey: config.apiKey });
    this.model = config.model || 'text-embedding-3-small';
  }

  /**
   * Generate embedding vector for text
   * Returns 1536-dimensional vector for text-embedding-3-small
   */
  async generateEmbedding(text: string): Promise<number[]> {
    try {
      logger.info('Generating embedding', {
        textLength: text.length,
        model: this.model,
      });

      const response = await this.client.embeddings.create({
        model: this.model,
        input: text,
      });

      const embedding = response.data[0].embedding;

      logger.info('Embedding generated', {
        dimensions: embedding.length,
      });

      return embedding;
    } catch (error: any) {
      logger.error('Failed to generate embedding', {
        error: error.message,
      });
      throw new Error(`Failed to generate embedding: ${error.message}`);
    }
  }

  /**
   * Generate embeddings for multiple texts in batch
   */
  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    try {
      logger.info('Generating batch embeddings', {
        count: texts.length,
      });

      const response = await this.client.embeddings.create({
        model: this.model,
        input: texts,
      });

      return response.data.map((item) => item.embedding);
    } catch (error: any) {
      logger.error('Failed to generate batch embeddings', {
        error: error.message,
      });
      throw new Error(`Failed to generate embeddings: ${error.message}`);
    }
  }
}
