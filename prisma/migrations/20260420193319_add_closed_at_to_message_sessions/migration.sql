-- AlterTable (idempotent — prod already has this column from a prior migration run)
ALTER TABLE "message_sessions" ADD COLUMN IF NOT EXISTS "closed_at" TIMESTAMP(3);

-- CreateIndex (idempotent)
CREATE INDEX IF NOT EXISTS "message_sessions_channel_tenant_id_closed_at_last_message_at_idx" ON "message_sessions"("channel", "tenant_id", "closed_at", "last_message_at");
