-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "KnowledgeGraphStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "settings" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patients" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "phone_number" TEXT NOT NULL,
    "encrypted_name" TEXT NOT NULL,
    "encrypted_dob" TEXT,
    "preferred_locale" TEXT NOT NULL DEFAULT 'hi-IN',
    "consent_status" TEXT NOT NULL,
    "consent_recorded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,
    "condition" TEXT,
    "classification" TEXT,
    "condition_start_date" TIMESTAMP(3),
    "knowledge_graph_id" TEXT,

    CONSTRAINT "patients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_sessions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "call_purpose" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "duration_seconds" INTEGER,
    "outcome" TEXT,
    "recording_url" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "knowledge_graph_id" TEXT,
    "current_phase" TEXT,
    "days_since_start" INTEGER,

    CONSTRAINT "call_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transcripts" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "turn_number" INTEGER NOT NULL,
    "speaker" TEXT NOT NULL,
    "original_text" TEXT NOT NULL,
    "translated_text" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confidence_score" DOUBLE PRECISION,
    "metadata" JSONB,

    CONSTRAINT "transcripts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinical_events" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "event_data" JSONB NOT NULL,
    "risk_score" TEXT,
    "requires_escalation" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clinical_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_base" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "source" TEXT,
    "locale" TEXT,
    "embedding" vector(1536),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_base_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "language_packs" (
    "id" TEXT NOT NULL,
    "locale_code" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "scripts" JSONB NOT NULL,
    "medical_lexicon" JSONB NOT NULL,
    "voice_profile" TEXT,
    "stt_hints" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "language_packs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_calls" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "call_purpose" TEXT NOT NULL,
    "scheduled_for" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "max_retries" INTEGER NOT NULL DEFAULT 3,
    "session_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "encrypted_password" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "full_name" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_users" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "action" TEXT NOT NULL,
    "resource_type" TEXT,
    "resource_id" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "changes" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_configs" (
    "id" TEXT NOT NULL,
    "provider_type" TEXT NOT NULL,
    "provider_name" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "tenant_id" TEXT NOT NULL,

    CONSTRAINT "provider_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_sessions_cache" (
    "session_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "session_data" JSONB NOT NULL,
    "state" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "call_sessions_cache_pkey" PRIMARY KEY ("session_id")
);

-- CreateTable
CREATE TABLE "knowledge_graphs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "description" TEXT,
    "source_file_name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "status" "KnowledgeGraphStatus" NOT NULL DEFAULT 'DRAFT',
    "is_valid" BOOLEAN NOT NULL DEFAULT false,
    "validation_errors" JSONB,
    "json_data" JSONB NOT NULL,
    "file_path" TEXT NOT NULL,
    "phase_names" TEXT[],
    "uploaded_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_graphs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_documents" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "content" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "metadata" JSONB,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_embeddings" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "chunk_text" TEXT NOT NULL,
    "embedding" DOUBLE PRECISION[],
    "embedding_model" TEXT NOT NULL DEFAULT 'text-embedding-3-small',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_sessions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "sender_id" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "locale" TEXT,
    "transcript" JSONB NOT NULL DEFAULT '[]',
    "clinical_events" JSONB NOT NULL DEFAULT '[]',
    "flow_state" JSONB,
    "last_message_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE INDEX "tenants_slug_idx" ON "tenants"("slug");

-- CreateIndex
CREATE INDEX "tenants_status_idx" ON "tenants"("status");

-- CreateIndex
CREATE INDEX "patients_tenant_id_idx" ON "patients"("tenant_id");

-- CreateIndex
CREATE INDEX "patients_phone_number_idx" ON "patients"("phone_number");

-- CreateIndex
CREATE INDEX "patients_preferred_locale_idx" ON "patients"("preferred_locale");

-- CreateIndex
CREATE INDEX "patients_condition_idx" ON "patients"("condition");

-- CreateIndex
CREATE UNIQUE INDEX "patients_tenant_id_phone_number_key" ON "patients"("tenant_id", "phone_number");

-- CreateIndex
CREATE INDEX "call_sessions_tenant_id_idx" ON "call_sessions"("tenant_id");

-- CreateIndex
CREATE INDEX "call_sessions_patient_id_idx" ON "call_sessions"("patient_id");

-- CreateIndex
CREATE INDEX "call_sessions_started_at_idx" ON "call_sessions"("started_at" DESC);

-- CreateIndex
CREATE INDEX "call_sessions_outcome_idx" ON "call_sessions"("outcome");

-- CreateIndex
CREATE INDEX "call_sessions_knowledge_graph_id_idx" ON "call_sessions"("knowledge_graph_id");

-- CreateIndex
CREATE INDEX "transcripts_session_id_turn_number_idx" ON "transcripts"("session_id", "turn_number");

-- CreateIndex
CREATE INDEX "clinical_events_tenant_id_idx" ON "clinical_events"("tenant_id");

-- CreateIndex
CREATE INDEX "clinical_events_session_id_idx" ON "clinical_events"("session_id");

-- CreateIndex
CREATE INDEX "clinical_events_patient_id_idx" ON "clinical_events"("patient_id");

-- CreateIndex
CREATE INDEX "clinical_events_risk_score_idx" ON "clinical_events"("risk_score");

-- CreateIndex
CREATE INDEX "clinical_events_requires_escalation_idx" ON "clinical_events"("requires_escalation");

-- CreateIndex
CREATE INDEX "knowledge_base_locale_idx" ON "knowledge_base"("locale");

-- CreateIndex
CREATE INDEX "knowledge_base_content_type_idx" ON "knowledge_base"("content_type");

-- CreateIndex
CREATE UNIQUE INDEX "language_packs_locale_code_key" ON "language_packs"("locale_code");

-- CreateIndex
CREATE INDEX "language_packs_locale_code_idx" ON "language_packs"("locale_code");

-- CreateIndex
CREATE INDEX "scheduled_calls_tenant_id_idx" ON "scheduled_calls"("tenant_id");

-- CreateIndex
CREATE INDEX "scheduled_calls_scheduled_for_idx" ON "scheduled_calls"("scheduled_for");

-- CreateIndex
CREATE INDEX "scheduled_calls_status_idx" ON "scheduled_calls"("status");

-- CreateIndex
CREATE INDEX "scheduled_calls_patient_id_idx" ON "scheduled_calls"("patient_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "tenant_users_tenant_id_idx" ON "tenant_users"("tenant_id");

-- CreateIndex
CREATE INDEX "tenant_users_user_id_idx" ON "tenant_users"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_users_tenant_id_user_id_key" ON "tenant_users"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs"("user_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_resource_type_resource_id_idx" ON "audit_logs"("resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "provider_configs_tenant_id_provider_type_is_active_idx" ON "provider_configs"("tenant_id", "provider_type", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "provider_configs_tenant_id_provider_name_key" ON "provider_configs"("tenant_id", "provider_name");

-- CreateIndex
CREATE INDEX "call_sessions_cache_expires_at_idx" ON "call_sessions_cache"("expires_at");

-- CreateIndex
CREATE INDEX "call_sessions_cache_patient_id_idx" ON "call_sessions_cache"("patient_id");

-- CreateIndex
CREATE INDEX "call_sessions_cache_state_idx" ON "call_sessions_cache"("state");

-- CreateIndex
CREATE INDEX "knowledge_graphs_tenant_id_idx" ON "knowledge_graphs"("tenant_id");

-- CreateIndex
CREATE INDEX "knowledge_graphs_condition_idx" ON "knowledge_graphs"("condition");

-- CreateIndex
CREATE INDEX "knowledge_graphs_status_idx" ON "knowledge_graphs"("status");

-- CreateIndex
CREATE INDEX "knowledge_graphs_condition_version_idx" ON "knowledge_graphs"("condition", "version");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_graphs_tenant_id_condition_version_key" ON "knowledge_graphs"("tenant_id", "condition", "version");

-- CreateIndex
CREATE INDEX "tenant_documents_tenant_id_idx" ON "tenant_documents"("tenant_id");

-- CreateIndex
CREATE INDEX "tenant_documents_status_idx" ON "tenant_documents"("status");

-- CreateIndex
CREATE INDEX "tenant_documents_content_type_idx" ON "tenant_documents"("content_type");

-- CreateIndex
CREATE INDEX "document_embeddings_document_id_idx" ON "document_embeddings"("document_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_embeddings_document_id_chunk_index_key" ON "document_embeddings"("document_id", "chunk_index");

-- CreateIndex
CREATE INDEX "message_sessions_tenant_id_idx" ON "message_sessions"("tenant_id");

-- CreateIndex
CREATE INDEX "message_sessions_expires_at_idx" ON "message_sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "message_sessions_channel_sender_id_tenant_id_key" ON "message_sessions"("channel", "sender_id", "tenant_id");

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_knowledge_graph_id_fkey" FOREIGN KEY ("knowledge_graph_id") REFERENCES "knowledge_graphs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_sessions" ADD CONSTRAINT "call_sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_sessions" ADD CONSTRAINT "call_sessions_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_sessions" ADD CONSTRAINT "call_sessions_knowledge_graph_id_fkey" FOREIGN KEY ("knowledge_graph_id") REFERENCES "knowledge_graphs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transcripts" ADD CONSTRAINT "transcripts_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "call_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_events" ADD CONSTRAINT "clinical_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_events" ADD CONSTRAINT "clinical_events_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "call_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_events" ADD CONSTRAINT "clinical_events_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_calls" ADD CONSTRAINT "scheduled_calls_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_calls" ADD CONSTRAINT "scheduled_calls_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_users" ADD CONSTRAINT "tenant_users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_users" ADD CONSTRAINT "tenant_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_configs" ADD CONSTRAINT "provider_configs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_graphs" ADD CONSTRAINT "knowledge_graphs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_documents" ADD CONSTRAINT "tenant_documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_embeddings" ADD CONSTRAINT "document_embeddings_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "tenant_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_sessions" ADD CONSTRAINT "message_sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
