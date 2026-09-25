-- CreateIndex
CREATE INDEX "assessment_flags_session_id_idx" ON "assessment_flags"("session_id");

-- CreateIndex
CREATE INDEX "assessments_session_id_idx" ON "assessments"("session_id");

-- CreateIndex
CREATE INDEX "patient_facts_source_session_id_idx" ON "patient_facts"("source_session_id");
