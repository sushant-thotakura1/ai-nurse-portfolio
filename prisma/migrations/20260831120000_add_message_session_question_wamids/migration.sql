-- AlterTable: track outbound question wamids for quote-reply attribution (issue #141)
ALTER TABLE "message_sessions" ADD COLUMN IF NOT EXISTS "question_wamids" JSONB NOT NULL DEFAULT '{}';
