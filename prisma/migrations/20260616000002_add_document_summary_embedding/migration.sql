-- Add summary text, keywords array, and vector embedding to tenant_documents.
-- summary_embedding uses IVFFlat for fast cosine ANN; doc count per tenant is small (<1000).
ALTER TABLE "tenant_documents"
  ADD COLUMN "summary" TEXT,
  ADD COLUMN "keywords" TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN "summary_embedding" vector(1536);

CREATE INDEX tenant_documents_summary_embedding_idx
  ON tenant_documents
  USING ivfflat (summary_embedding vector_cosine_ops);
