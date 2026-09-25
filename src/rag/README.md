# RAG (Retrieval-Augmented Generation) Implementation

## Overview

This directory contains a complete RAG implementation using LangChain, providing semantic search and document management capabilities with multi-tenant isolation.

## Architecture

```
src/rag/
├── rag-service.ts          # Core RAG service with LangChain
├── routes.ts               # REST API endpoints
├── document-chunker.ts     # Legacy chunker (can be removed)
└── __tests__/
    ├── rag-service.test.ts # Service tests (16 tests)
    └── routes.test.ts      # API tests (18 tests)
```

## Technology Stack

- **LangChain**: Document processing framework
  - `@langchain/textsplitters`: RecursiveCharacterTextSplitter
  - `@langchain/openai`: OpenAI embeddings
  - `@langchain/core`: Core utilities
- **OpenAI Embeddings**: text-embedding-3-small (1536 dimensions)
- **PostgreSQL + pgvector**: Vector storage
- **Prisma**: Multi-tenant ORM with middleware

## Key Features

### 1. Document Ingestion
- Automatic chunking using RecursiveCharacterTextSplitter
- Configurable chunk size (default: 1000) and overlap (default: 200)
- Batch embedding generation via OpenAI API
- Atomic database transactions

### 2. Semantic Search
- Natural language queries
- Vector similarity search with pgvector
- Configurable result count (topK)
- Returns relevant chunks with similarity scores

### 3. Multi-Tenant Isolation
- Automatic tenant filtering via Prisma middleware
- Tenant context from AsyncLocalStorage
- All operations scoped by tenantId

### 4. Document Management
- CRUD operations for documents
- Status tracking (ACTIVE, ARCHIVED, DELETED)
- Rich metadata support
- Cascade deletion of embeddings

## API Endpoints

All endpoints are mounted at `/v1/api/:tenantId/documents`:

- `POST /` - Ingest document
- `GET /` - List documents
- `GET /:id` - Get document
- `DELETE /:id` - Delete document
- `POST /query` - Semantic search

See [RAG_API.md](../../docs/RAG_API.md) for detailed API documentation.

## Configuration

Environment variables (in `.env`):

```bash
# Required
OPENAI_API_KEY=your_openai_api_key

# Optional (defaults shown)
RAG_CHUNK_SIZE=1000
RAG_CHUNK_OVERLAP=200
RAG_EMBEDDING_MODEL=text-embedding-3-small
RAG_TOP_K=5
```

## Usage

### Service Layer

```typescript
import { getRAGService } from './rag/rag-service';
import { prisma } from './core/database';
import { runWithTenantContext } from './core/tenant-context-storage';

// Get service instance
const ragService = getRAGService(prisma);

// Ingest document (requires tenant context)
await runWithTenantContext(tenantContext, async () => {
  const doc = await ragService.ingestDocument({
    title: 'Clinical Guidelines',
    content: 'Full document content...',
    contentType: 'text/plain',
    metadata: { source: 'manual' }
  });
  console.log(`Ingested ${doc.embeddingsCount} chunks`);
});

// Query documents
const results = await ragService.queryDocuments('What are the symptoms?', 5);
console.log(`Found ${results.length} relevant chunks`);
```

### API Layer

```bash
# Ingest document
curl -X POST http://localhost:3000/v1/api/tenant-123/documents \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Clinical Guidelines",
    "content": "Document content here...",
    "contentType": "text/plain"
  }'

# Query documents
curl -X POST http://localhost:3000/v1/api/tenant-123/documents/query \
  -H "Content-Type: application/json" \
  -d '{
    "query": "What are the symptoms?",
    "topK": 5
  }'
```

## Database Schema

### TenantDocument
- `id`: UUID primary key
- `tenantId`: Foreign key to tenants
- `title`, `description`, `content`: Document data
- `contentType`: MIME type
- `metadata`: JSON metadata
- `status`: ACTIVE | ARCHIVED | DELETED

### DocumentEmbedding
- `id`: UUID primary key
- `documentId`: Foreign key to tenant_documents (CASCADE DELETE)
- `chunkIndex`: Index of chunk in document
- `chunkText`: The chunk content
- `embedding`: Float array (pgvector)
- `embeddingModel`: Model name

## Testing

```bash
# Run all RAG tests (34 tests)
npm test -- src/rag/__tests__

# Run specific test suites
npm test -- src/rag/__tests__/rag-service.test.ts
npm test -- src/rag/__tests__/routes.test.ts
```

Test coverage:
- ✅ Document ingestion with chunking and embeddings
- ✅ Semantic search with similarity scoring
- ✅ CRUD operations
- ✅ Tenant isolation
- ✅ Error handling (missing API key, invalid input, etc.)
- ✅ API validation

## Integration Points

### 1. Server Registration
In `src/server.ts`:
```typescript
import { createRAGRoutes } from './rag/routes';
import { prisma } from './core/database';

app.use('/v1/api/:tenantId/documents', createRAGRoutes(prisma));
```

### 2. Tenant Middleware
In `src/core/prisma-tenant-middleware.ts`:
```typescript
const TENANT_SCOPED_MODELS = [
  'Patient',
  'CallSession',
  'TenantDocument',  // Added for RAG
  // ...
];
```

### 3. Database
- TenantDocument and DocumentEmbedding tables in Prisma schema
- pgvector extension enabled
- Automatic tenant filtering via middleware

## Performance

### Ingestion
- Chunking: ~1ms per 1000 characters (local)
- Embedding: ~100-500ms per chunk (OpenAI API)
- Storage: ~10ms for batch insert (local database)
- **Total**: ~2-10 seconds for a typical 10-page document

### Querying
- Query embedding: ~100-500ms (OpenAI API)
- Vector search: <50ms (pgvector indexed)
- **Total**: ~200-600ms per query

## Error Handling

The service handles:
- Missing OpenAI API key
- Missing tenant context
- OpenAI API failures
- Database errors
- Invalid input validation

All errors are logged and returned with appropriate HTTP status codes.

## Security

- ✅ Tenant isolation enforced at middleware level
- ✅ No cross-tenant data access possible
- ✅ Automatic tenant filtering on all queries
- ✅ Cascade deletion prevents orphaned embeddings

## Future Enhancements

1. **Advanced Features**
   - Metadata filtering in queries
   - Hybrid search (semantic + keyword)
   - Document versioning
   - Batch operations

2. **Performance**
   - Embedding caching
   - Async background processing
   - Compression for large documents

3. **Analytics**
   - Query logging and analytics
   - Popular searches tracking
   - Document usage statistics

4. **Format Support**
   - PDF parsing
   - DOCX support
   - HTML content extraction

## Dependencies

```json
{
  "dependencies": {
    "langchain": "^0.3.x",
    "@langchain/core": "^0.3.x",
    "@langchain/openai": "^0.3.x",
    "@langchain/textsplitters": "^0.1.x",
    "@langchain/community": "^0.3.x"
  }
}
```

## Migration Notes

If you have existing documents, you can migrate them:

```typescript
// Migrate existing documents to RAG
const existingDocs = await prisma.tenantDocument.findMany({
  where: { embeddingsCount: 0 }
});

for (const doc of existingDocs) {
  await runWithTenantContext(getTenantContext(doc.tenantId), async () => {
    await ragService.ingestDocument({
      title: doc.title,
      content: doc.content,
      contentType: doc.contentType,
      metadata: doc.metadata
    });
  });
}
```

## Troubleshooting

### "OPENAI_API_KEY environment variable is not set"
- Set `OPENAI_API_KEY` in your `.env` file
- Restart the server after updating `.env`

### "No tenant context found"
- Ensure RAG operations are called within tenant middleware
- Use `runWithTenantContext()` if calling from background jobs

### Slow ingestion
- Large documents take longer to process
- Consider splitting very large documents (>100KB)
- Check OpenAI API latency

### Poor search results
- Write more specific queries
- Add more relevant documents
- Check that documents are properly chunked

## Support

For issues or questions:
1. Check the [RAG API documentation](../../docs/RAG_API.md)
2. Review test cases for usage examples
3. Check logs for detailed error messages
