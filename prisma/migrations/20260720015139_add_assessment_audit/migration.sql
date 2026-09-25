-- CreateTable
CREATE TABLE "patient_facts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "fact_id" TEXT NOT NULL,
    "value_number" DOUBLE PRECISION,
    "value_boolean" BOOLEAN,
    "value_string" TEXT,
    "observed_at" TIMESTAMP(3) NOT NULL,
    "time_uncertainty_hours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source_session_id" TEXT,
    "supersedes_id" TEXT,
    "confidence" DOUBLE PRECISION,
    "extraction_class" TEXT NOT NULL,

    CONSTRAINT "patient_facts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "patient_action" TEXT,
    "escalation_type" TEXT,
    "deterministic" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_flags" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "assessment_id" TEXT NOT NULL,
    "red_flag_id" TEXT NOT NULL,
    "decided_by" TEXT NOT NULL,
    "fired" BOOLEAN,
    "evidence" TEXT,
    "rules_tried" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assessment_flags_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "patient_facts_supersedes_id_key" ON "patient_facts"("supersedes_id");

-- CreateIndex
CREATE INDEX "patient_facts_tenant_id_patient_id_fact_id_observed_at_idx" ON "patient_facts"("tenant_id", "patient_id", "fact_id", "observed_at");

-- CreateIndex
CREATE INDEX "assessments_tenant_id_patient_id_session_id_idx" ON "assessments"("tenant_id", "patient_id", "session_id");

-- CreateIndex
CREATE INDEX "assessment_flags_tenant_id_assessment_id_idx" ON "assessment_flags"("tenant_id", "assessment_id");

-- AddForeignKey
ALTER TABLE "patient_facts" ADD CONSTRAINT "patient_facts_supersedes_id_fkey" FOREIGN KEY ("supersedes_id") REFERENCES "patient_facts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_facts" ADD CONSTRAINT "patient_facts_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_facts" ADD CONSTRAINT "patient_facts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_flags" ADD CONSTRAINT "assessment_flags_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_flags" ADD CONSTRAINT "assessment_flags_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_flags" ADD CONSTRAINT "assessment_flags_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
