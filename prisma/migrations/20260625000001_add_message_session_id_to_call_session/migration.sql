-- AlterTable (idempotent)
ALTER TABLE "call_sessions" ADD COLUMN IF NOT EXISTS "message_session_id" TEXT;
