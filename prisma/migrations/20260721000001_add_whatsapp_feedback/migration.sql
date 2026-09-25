-- AlterTable
ALTER TABLE "call_sessions" ADD COLUMN IF NOT EXISTS "summary_wamid" TEXT;
ALTER TABLE "call_sessions" ADD COLUMN IF NOT EXISTS "feedback_text" TEXT;

-- Index for feedback wamid lookup
CREATE INDEX IF NOT EXISTS "call_sessions_summary_wamid_idx" ON "call_sessions"("summary_wamid");
