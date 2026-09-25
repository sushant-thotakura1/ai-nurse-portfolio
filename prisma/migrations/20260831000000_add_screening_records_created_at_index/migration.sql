-- DropIndex
DROP INDEX "screening_records_tenant_id_idx";

-- CreateIndex
CREATE INDEX "screening_records_tenant_id_created_at_idx" ON "screening_records"("tenant_id", "created_at");
