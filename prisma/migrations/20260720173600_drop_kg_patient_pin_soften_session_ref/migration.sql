-- Patient.knowledgeGraphId is removed entirely: patients always resolve to
-- whatever KG is currently ACTIVE for their condition, never a snapshot
-- pinned at enrollment/assignment time (see git history for the reasoning).
--
-- CallSession.knowledgeGraphId is kept as a column (historical record of
-- which KG a past call actually used) but its foreign key is dropped -- it
-- is a soft/unenforced reference so it can outlive the KG it points to,
-- which is exactly what lets an old/archived KnowledgeGraph row be deleted
-- without being blocked by, or destroying, historical CallSession data.

-- DropForeignKey
ALTER TABLE "call_sessions" DROP CONSTRAINT "call_sessions_knowledge_graph_id_fkey";

-- DropForeignKey
ALTER TABLE "patients" DROP CONSTRAINT "patients_knowledge_graph_id_fkey";

-- AlterTable
ALTER TABLE "patients" DROP COLUMN "knowledge_graph_id";
