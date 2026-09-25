-- AlterTable
ALTER TABLE "patients" ADD COLUMN     "is_test_identity" BOOLEAN NOT NULL DEFAULT false;

-- AddForeignKey
ALTER TABLE "patient_facts" ADD CONSTRAINT "patient_facts_source_session_id_fkey" FOREIGN KEY ("source_session_id") REFERENCES "call_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "call_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_flags" ADD CONSTRAINT "assessment_flags_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "call_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
