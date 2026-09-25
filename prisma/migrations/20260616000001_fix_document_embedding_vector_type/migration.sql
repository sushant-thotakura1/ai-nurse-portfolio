-- Change document_embeddings.embedding from double precision[] to vector(1536).
-- The USING clause handles existing rows; if the table is empty the cast is a no-op.
ALTER TABLE "document_embeddings"
  ALTER COLUMN "embedding" TYPE vector(1536)
  USING embedding::vector;
