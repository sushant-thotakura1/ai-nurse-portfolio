-- AlterTable: deterministic question-sequencer state for the live text path (issue #161)
ALTER TABLE "message_sessions" ADD COLUMN IF NOT EXISTS "agenda_state" JSONB;
