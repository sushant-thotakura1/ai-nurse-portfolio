-- CreateTable
CREATE TABLE "screening_records" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "schema_id" TEXT NOT NULL,
    "schema_version" TEXT NOT NULL,
    "encrypted_name" TEXT,
    "encrypted_phone" TEXT,
    "encrypted_external_id" TEXT,
    "encrypted_abha_id" TEXT,
    "filled_by" TEXT NOT NULL,
    "answers" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'in_progress',
    "recommendation" JSONB,
    "stop_outcome" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "screening_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "screening_records_tenant_id_idx" ON "screening_records"("tenant_id");

-- AddForeignKey
ALTER TABLE "screening_records" ADD CONSTRAINT "screening_records_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
