/**
 * RAG (Retrieval-Augmented Generation) Service with LangChain
 *
 * This service provides document ingestion, chunking, embedding generation,
 * and semantic search capabilities using LangChain and OpenAI embeddings.
 *
 * Features:
 * - Multi-tenant document storage and retrieval
 * - Automatic document chunking using LangChain's RecursiveCharacterTextSplitter
 * - OpenAI embeddings (text-embedding-3-small)
 * - Vector similarity search with pgvector
 * - Tenant isolation via AsyncLocalStorage context
 */

import { randomUUID } from 'crypto';
import { PrismaClient, TenantDocument, DocumentEmbedding } from '@prisma/client';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { OpenAIEmbeddings } from '@langchain/openai';
import { getTenantContext } from '../core/tenant-context-storage';
import { logger } from '../core/logger';

/**
 * Configuration for RAG service
 */
export interface RAGConfig {
  /** Chunk size for document splitting (default: 1000) */
  chunkSize: number;
  /** Chunk overlap for context preservation (default: 200) */
  chunkOverlap: number;
  /** OpenAI embedding model (default: text-embedding-3-small) */
  embeddingModel: string;
  /** Number of results to return in similarity search (default: 5) */
  topK: number;
}

/**
 * Default RAG configuration
 */
const DEFAULT_RAG_CONFIG: RAGConfig = {
  chunkSize: 1000,
  chunkOverlap: 200,
  embeddingModel: 'text-embedding-3-small',
  topK: 5,
};

/**
 * Tracer interface for recording RAG pipeline metrics
 */
export interface RagTracer {
  recordFilter(attrs: {
    'rag.filter.matched_count': number;
    'rag.filter.fallback': boolean;
    'rag.filter.threshold': number;
  }): void;
  recordSearch(attrs: {
    'rag.search.result_count': number;
    'rag.search.top_similarity': number;
    'rag.search.doc_count': number;
  }): void;
}

/**
 * Document input for ingestion
 */
export interface DocumentInput {
  title: string;
  description?: string;
  content: string;
  contentType: string;
  metadata?: Record<string, any>;
  summary?: string;    // if provided, concatenated with keywords and embedded as summaryEmbedding
  keywords?: string[]; // optional; appended to summary text before embedding
}

/**
 * Query result with document chunks and similarity scores
 */
export interface QueryResult {
  documentId: string;
  documentTitle: string;
  chunkIndex: number;
  chunkText: string;
  similarity: number;
  metadata?: Record<string, any>;
}

/**
 * Document with embeddings count and summary embedding flag
 */
export interface DocumentWithStats extends TenantDocument {
  embeddingsCount: number;
  hasSummaryEmbedding: boolean;
}

const SUMMARY_THRESHOLD = 0.5; // cosine distance — <=> operator; 0=identical, 2=opposite; <0.5 means relevant
const SUMMARY_TOP_K = 10;

/**
 * RAG Service for document management and semantic search
 */
export class RAGService {
  private prisma: PrismaClient;
  private config: RAGConfig;
  private textSplitter: RecursiveCharacterTextSplitter;
  private embeddings: OpenAIEmbeddings | null = null;

  constructor(prisma: PrismaClient, config?: Partial<RAGConfig>) {
    this.prisma = prisma;
    this.config = { ...DEFAULT_RAG_CONFIG, ...config };

    // Initialize LangChain text splitter
    this.textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: this.config.chunkSize,
      chunkOverlap: this.config.chunkOverlap,
      separators: ['\n\n', '\n', '. ', '! ', '? ', ', ', ' ', ''],
    });

    // Don't initialize OpenAI embeddings here - do it lazily on first use

    logger.info('RAGService initialized', {
      chunkSize: this.config.chunkSize,
      chunkOverlap: this.config.chunkOverlap,
      embeddingModel: this.config.embeddingModel,
    });
  }

  /**
   * Get OpenAI embeddings, initializing them on first use (lazy initialization)
   */
  private getEmbeddings(): OpenAIEmbeddings {
    if (!this.embeddings) {
      // Read API key directly from process.env at runtime, not from config object
      const apiKey = process.env.OPENAI_API_KEY || '';

      logger.info('Lazily initializing OpenAI embeddings', {
        apiKeySet: !!apiKey,
        apiKeyLength: apiKey?.length || 0,
        model: this.config.embeddingModel,
      });

      if (!apiKey) {
        throw new Error(
          'OPENAI_API_KEY is not configured. Please set the OPENAI_API_KEY environment variable.'
        );
      }

      this.embeddings = new OpenAIEmbeddings({
        modelName: this.config.embeddingModel,
        openAIApiKey: apiKey,
      });

      logger.info('OpenAI embeddings initialized successfully');
    }

    return this.embeddings;
  }

  /**
   * Get tenant context and validate it exists
   * @throws Error if no tenant context is found
   */
  private getTenantContextOrThrow() {
    const tenantContext = getTenantContext();
    if (!tenantContext) {
      throw new Error(
        'No tenant context found. RAG operations must be called within a tenant context.'
      );
    }
    return tenantContext;
  }

  /**
   * Ingest a document: chunk it, generate embeddings, and store in database
   *
   * @param input - Document input with title, content, contentType, etc.
   * @returns The created document with embeddings
   */
  async ingestDocument(input: DocumentInput): Promise<DocumentWithStats> {
    const tenantContext = this.getTenantContextOrThrow();
    const { tenantId, tenantSlug } = tenantContext;

    logger.info('Starting document ingestion', {
      tenantId,
      tenantSlug,
      title: input.title,
      contentType: input.contentType,
      contentLength: input.content.length,
    });

    try {
      // Step 1: Create the document record (summary/keywords stored as plain columns)
      const document = await this.prisma.tenantDocument.create({
        data: {
          tenantId,
          title: input.title,
          description: input.description,
          content: input.content,
          contentType: input.contentType,
          metadata: input.metadata,
          summary: input.summary ?? null,
          keywords: input.keywords ?? [],
          status: 'ACTIVE',
        },
      });

      logger.info('Document created in database', { documentId: document.id, tenantId });

      // Step 2: Chunk the document
      const chunks = await this.textSplitter.createDocuments([input.content]);

      logger.info('Document chunked', { documentId: document.id, chunkCount: chunks.length });

      // Step 3: Generate chunk embeddings
      const chunkTexts = chunks.map((chunk) => chunk.pageContent);
      const embeddingVectors = await this.getEmbeddings().embedDocuments(chunkTexts);

      logger.info('Chunk embeddings generated', {
        documentId: document.id,
        embeddingCount: embeddingVectors.length,
      });

      // Step 4: Store chunk embeddings via raw SQL (Prisma cannot write Unsupported() columns)
      await this.prisma.$transaction(
        embeddingVectors.map((embedding, index) => {
          const vectorStr = `[${embedding.join(',')}]`;
          return this.prisma.$executeRawUnsafe(
            `INSERT INTO document_embeddings
               (id, document_id, chunk_index, chunk_text, embedding, embedding_model, created_at)
             VALUES ($1, $2, $3, $4, $5::vector, $6, NOW())`,
            randomUUID(),
            document.id,
            index,
            chunkTexts[index],
            vectorStr,
            this.config.embeddingModel,
          );
        }),
      );

      logger.info('Chunk embeddings stored', {
        documentId: document.id,
        embeddingCount: embeddingVectors.length,
      });

      // Step 5: Embed and persist summary if provided
      if (input.summary) {
        try {
          const summaryText = [input.summary, ...(input.keywords ?? [])].join(' ');
          const summaryEmbedding = await this.getEmbeddings().embedQuery(summaryText);
          const vectorStr = `[${summaryEmbedding.join(',')}]`;
          await this.prisma.$executeRawUnsafe(
            `UPDATE tenant_documents SET summary_embedding = $1::vector WHERE id = $2`,
            vectorStr,
            document.id,
          );
          logger.info('Summary embedding stored', { documentId: document.id });
        } catch (summaryErr) {
          logger.error('Summary embedding failed — rolling back document', {
            documentId: document.id,
            error: summaryErr instanceof Error ? summaryErr.message : String(summaryErr),
          });
          await this.prisma.tenantDocument.delete({ where: { id: document.id } }).catch(() => {});
          throw summaryErr;
        }
      }

      return {
        ...document,
        embeddingsCount: embeddingVectors.length,
        hasSummaryEmbedding: document.summary !== null,
      };
    } catch (error) {
      logger.error('Error ingesting document', {
        tenantId,
        title: input.title,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Query documents using two-phase semantic search:
   * Phase 1 — cosine vector search against document-level summary embeddings to identify relevant docs.
   * Phase 2 — L2 chunk vector search constrained to those doc IDs (or all docs on fallback).
   *
   * @param query - The search query
   * @param topK - Number of results to return (default: from config)
   * @param tracer - Optional tracer for recording pipeline metrics
   * @returns Array of query results with similarity scores
   */
  async queryDocuments(
    query: string,
    topK?: number,
    tracer?: RagTracer,
  ): Promise<QueryResult[]> {
    const tenantContext = this.getTenantContextOrThrow();
    const { tenantId, tenantSlug } = tenantContext;
    const k = topK ?? this.config.topK;

    logger.info('Starting document query', {
      tenantId,
      tenantSlug,
      query: query.substring(0, 100),
      topK: k,
    });

    try {
      // Embed the query once — reused for both Phase 1 and Phase 2
      const queryEmbedding = await this.getEmbeddings().embedQuery(query);
      const vectorStr = `[${queryEmbedding.join(',')}]`;

      // Phase 1: summary vector search — one row per document, fast
      const summaryRows = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id
         FROM tenant_documents
         WHERE tenant_id = $1
           AND status = 'ACTIVE'
           AND summary_embedding IS NOT NULL
           AND summary_embedding <=> $2::vector < $3
         ORDER BY summary_embedding <=> $2::vector
         LIMIT $4`,
        tenantId,
        vectorStr,
        SUMMARY_THRESHOLD,
        SUMMARY_TOP_K,
      );

      const filteredIds = summaryRows.map((r) => r.id);
      const fallback = filteredIds.length === 0;

      logger.info('Phase 1 summary filter complete', {
        tenantId,
        matchedCount: filteredIds.length,
        fallback,
      });

      tracer?.recordFilter({
        'rag.filter.matched_count': filteredIds.length,
        'rag.filter.fallback': fallback,
        'rag.filter.threshold': SUMMARY_THRESHOLD,
      });

      // Phase 2: chunk vector search, constrained to filtered doc IDs (or all on fallback)
      const chunkRows = fallback
        ? await this.prisma.$queryRawUnsafe<Array<{
            id: string;
            document_id: string;
            chunk_index: number;
            chunk_text: string;
            distance: number;
          }>>(
            `SELECT de.id, de.document_id, de.chunk_index, de.chunk_text,
                    de.embedding <-> $1::vector AS distance
             FROM document_embeddings de
             INNER JOIN tenant_documents td ON de.document_id = td.id
             WHERE td.tenant_id = $2
               AND td.status = 'ACTIVE'
             ORDER BY de.embedding <-> $1::vector
             LIMIT $3`,
            vectorStr,
            tenantId,
            k,
          )
        : await this.prisma.$queryRawUnsafe<Array<{
            id: string;
            document_id: string;
            chunk_index: number;
            chunk_text: string;
            distance: number;
          }>>(
            `SELECT de.id, de.document_id, de.chunk_index, de.chunk_text,
                    de.embedding <-> $1::vector AS distance
             FROM document_embeddings de
             INNER JOIN tenant_documents td ON de.document_id = td.id
             WHERE td.tenant_id = $2
               AND td.status = 'ACTIVE'
               AND de.document_id::text = ANY($3::text[])
             ORDER BY de.embedding <-> $1::vector
             LIMIT $4`,
            vectorStr,
            tenantId,
            filteredIds,
            k,
          );

      logger.info('Phase 2 chunk search complete', {
        tenantId,
        resultCount: chunkRows.length,
      });

      // Fetch full document details for result metadata
      const documentIds = Array.from(new Set(chunkRows.map((r) => r.document_id)));
      const documents = await this.prisma.tenantDocument.findMany({
        where: { id: { in: documentIds }, tenantId },
      });
      const documentMap = new Map(documents.map((doc) => [doc.id, doc]));

      const queryResults: QueryResult[] = chunkRows.map((result) => {
        const document = documentMap.get(result.document_id);
        return {
          documentId: result.document_id,
          documentTitle: document?.title ?? 'Unknown',
          chunkIndex: result.chunk_index,
          chunkText: result.chunk_text,
          similarity: Math.max(0, 1 - (result.distance * result.distance) / 2),
          metadata: document?.metadata as Record<string, any> | undefined,
        };
      });

      tracer?.recordSearch({
        'rag.search.result_count': queryResults.length,
        'rag.search.top_similarity': queryResults[0]?.similarity ?? 0,
        'rag.search.doc_count': documentIds.length,
      });

      logger.info('Query results formatted', { tenantId, resultCount: queryResults.length });

      return queryResults;
    } catch (error) {
      logger.error('Error querying documents', {
        tenantId,
        query: query.substring(0, 100),
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * List all documents for the current tenant
   *
   * @param status - Filter by status (default: ACTIVE)
   * @returns Array of documents with embeddings count
   */
  async listDocuments(status: string = 'ACTIVE'): Promise<DocumentWithStats[]> {
    const tenantContext = this.getTenantContextOrThrow();
    const { tenantId, tenantSlug } = tenantContext;

    logger.info('Listing documents', {
      tenantId,
      tenantSlug,
      status,
    });

    try {
      const documents = await this.prisma.tenantDocument.findMany({
        where: {
          tenantId,
          status,
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

      const documentsWithStats: DocumentWithStats[] = documents.map((doc) => ({
        id: doc.id,
        tenantId: doc.tenantId,
        title: doc.title,
        description: doc.description,
        content: doc.content,
        contentType: doc.contentType,
        metadata: doc.metadata,
        summary: doc.summary,
        keywords: doc.keywords,
        status: doc.status,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        embeddingsCount: doc.embeddings.length,
        hasSummaryEmbedding: doc.summary !== null,
      }));

      logger.info('Documents listed', {
        tenantId,
        documentCount: documentsWithStats.length,
      });

      return documentsWithStats;
    } catch (error) {
      logger.error('Error listing documents', {
        tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get a specific document by ID
   *
   * @param documentId - The document ID
   * @returns The document with embeddings count
   * @throws Error if document not found or doesn't belong to tenant
   */
  async getDocument(documentId: string): Promise<DocumentWithStats> {
    const tenantContext = this.getTenantContextOrThrow();
    const { tenantId, tenantSlug } = tenantContext;

    logger.info('Getting document', {
      tenantId,
      tenantSlug,
      documentId,
    });

    try {
      const document = await this.prisma.tenantDocument.findFirst({
        where: {
          id: documentId,
          tenantId, // Explicit tenant filter (middleware also applies this)
        },
        include: {
          embeddings: {
            select: {
              id: true,
            },
          },
        },
      });

      if (!document) {
        throw new Error(`Document not found: ${documentId}`);
      }

      const documentWithStats: DocumentWithStats = {
        id: document.id,
        tenantId: document.tenantId,
        title: document.title,
        description: document.description,
        content: document.content,
        contentType: document.contentType,
        metadata: document.metadata,
        summary: document.summary,
        keywords: document.keywords,
        status: document.status,
        createdAt: document.createdAt,
        updatedAt: document.updatedAt,
        embeddingsCount: document.embeddings.length,
        hasSummaryEmbedding: document.summary !== null,
      };

      logger.info('Document retrieved', {
        tenantId,
        documentId,
        embeddingsCount: documentWithStats.embeddingsCount,
      });

      return documentWithStats;
    } catch (error) {
      logger.error('Error getting document', {
        tenantId,
        documentId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get paginated chunk content for a document
   *
   * @param documentId - The document ID
   * @param page - 1-indexed page number
   * @param pageSize - Number of chunks per page
   * @returns Paginated chunks with total count
   * @throws Error if document not found or doesn't belong to tenant
   */
  async getDocumentChunks(
    documentId: string,
    page: number,
    pageSize: number,
  ): Promise<{
    chunks: Array<{ chunkIndex: number; chunkText: string; characterCount: number }>;
    total: number;
    page: number;
    pageSize: number;
  }> {
    const tenantContext = this.getTenantContextOrThrow();
    const { tenantId, tenantSlug } = tenantContext;

    logger.info('Getting document chunks', {
      tenantId,
      tenantSlug,
      documentId,
      page,
      pageSize,
    });

    try {
      // Confirm the document exists and belongs to this tenant before querying
      // its chunks -- same tenant-scoping posture as getDocument().
      const document = await this.prisma.tenantDocument.findFirst({
        where: { id: documentId, tenantId },
        select: { id: true },
      });
      if (!document) {
        throw new Error(`Document not found: ${documentId}`);
      }

      const [rows, total] = await Promise.all([
        this.prisma.documentEmbedding.findMany({
          where: { documentId },
          orderBy: { chunkIndex: 'asc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: { chunkIndex: true, chunkText: true },
        }),
        this.prisma.documentEmbedding.count({ where: { documentId } }),
      ]);

      const result = {
        chunks: rows.map((r) => ({
          chunkIndex: r.chunkIndex,
          chunkText: r.chunkText,
          characterCount: r.chunkText.length,
        })),
        total,
        page,
        pageSize,
      };

      logger.info('Document chunks retrieved', {
        tenantId,
        documentId,
        chunksReturned: result.chunks.length,
      });

      return result;
    } catch (error) {
      logger.error('Error getting document chunks', {
        tenantId,
        documentId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete a document and its embeddings
   *
   * @param documentId - The document ID
   * @throws Error if document not found or doesn't belong to tenant
   */
  async deleteDocument(documentId: string): Promise<void> {
    const tenantContext = this.getTenantContextOrThrow();
    const { tenantId, tenantSlug } = tenantContext;

    logger.info('Deleting document', {
      tenantId,
      tenantSlug,
      documentId,
    });

    try {
      // Verify document exists and belongs to tenant
      const document = await this.prisma.tenantDocument.findFirst({
        where: {
          id: documentId,
          tenantId,
        },
      });

      if (!document) {
        throw new Error(`Document not found: ${documentId}`);
      }

      // Delete document (embeddings will be cascade deleted)
      await this.prisma.tenantDocument.delete({
        where: {
          id: documentId,
        },
      });

      logger.info('Document deleted', {
        tenantId,
        documentId,
      });
    } catch (error) {
      logger.error('Error deleting document', {
        tenantId,
        documentId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}

/**
 * Create a singleton RAG service instance
 */
let ragServiceInstance: RAGService | null = null;

/**
 * Get or create the RAG service instance
 *
 * @param prisma - Prisma client
 * @param config - Optional RAG configuration
 * @returns RAG service instance
 */
export function getRAGService(
  prisma: PrismaClient,
  config?: Partial<RAGConfig>
): RAGService {
  if (!ragServiceInstance) {
    ragServiceInstance = new RAGService(prisma, config);
  }
  return ragServiceInstance;
}
