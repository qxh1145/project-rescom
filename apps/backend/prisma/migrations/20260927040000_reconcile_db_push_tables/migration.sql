-- Reconcile the migration history with schema.prisma.
--
-- Sixteen tables (forms, form_versions, responses, survey_attempts,
-- fraud_logs, outbox_events, processed_handlers, demographic_profiles,
-- gamification_stats, integrity_consents, integrity_events,
-- integrity_assessments, respondent_reputations, integrity_incidents,
-- integrity_reviews, scoring_policies) and their enums were only ever created
-- by `prisma db push`, and eight later migrations guarded their ALTER/INDEX
-- statements with `to_regclass(...) IS NOT NULL`, so a fresh
-- `prisma migrate deploy` produced an incomplete database.
--
-- Section 1 (generated with `prisma migrate diff --from-migrations
-- --to-schema-datamodel`) creates the missing enums, tables, indexes and
-- foreign keys. It is fully idempotent: on a database built by `db push` it
-- only adds what is missing (enum values, columns, indexes, constraints).
--
-- Section 2 re-asserts, unconditionally, every object the guarded migrations
-- may have skipped plus the objects Prisma cannot express. It is kept
-- byte-identical to prisma/sql/post-push-invariants.sql.
--
-- Deliberately NOT reconciled (pre-existing ledger drift where the migrations
-- are stricter than schema.prisma): ledger_journals_reverses_journal_id_fkey
-- stays ON DELETE/UPDATE RESTRICT, and the ledger_entries journal_id/account_id
-- indexes are kept.

-- ===========================================================================
-- SECTION 1: tables created only by `prisma db push` until now
-- ===========================================================================

-- 1a. Enums (created if missing; values added in place when the type
--     already exists from an older `prisma db push`).

DO $$ BEGIN
  CREATE TYPE "FormStatus" AS ENUM ('DRAFT', 'ESCROW_LOCKED', 'MODERATION_QUEUE', 'PUBLISHED', 'CLOSED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
ALTER TYPE "FormStatus" ADD VALUE IF NOT EXISTS 'DRAFT';
ALTER TYPE "FormStatus" ADD VALUE IF NOT EXISTS 'ESCROW_LOCKED';
ALTER TYPE "FormStatus" ADD VALUE IF NOT EXISTS 'MODERATION_QUEUE';
ALTER TYPE "FormStatus" ADD VALUE IF NOT EXISTS 'PUBLISHED';
ALTER TYPE "FormStatus" ADD VALUE IF NOT EXISTS 'CLOSED';

DO $$ BEGIN
  CREATE TYPE "ResponseStatus" AS ENUM ('IN_PROGRESS', 'SUBMITTED', 'VALIDATED', 'DISPUTED', 'REJECTED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
ALTER TYPE "ResponseStatus" ADD VALUE IF NOT EXISTS 'IN_PROGRESS';
ALTER TYPE "ResponseStatus" ADD VALUE IF NOT EXISTS 'SUBMITTED';
ALTER TYPE "ResponseStatus" ADD VALUE IF NOT EXISTS 'VALIDATED';
ALTER TYPE "ResponseStatus" ADD VALUE IF NOT EXISTS 'DISPUTED';
ALTER TYPE "ResponseStatus" ADD VALUE IF NOT EXISTS 'REJECTED';

DO $$ BEGIN
  CREATE TYPE "AttemptStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'ABANDONED', 'LOCKED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
ALTER TYPE "AttemptStatus" ADD VALUE IF NOT EXISTS 'IN_PROGRESS';
ALTER TYPE "AttemptStatus" ADD VALUE IF NOT EXISTS 'COMPLETED';
ALTER TYPE "AttemptStatus" ADD VALUE IF NOT EXISTS 'ABANDONED';
ALTER TYPE "AttemptStatus" ADD VALUE IF NOT EXISTS 'LOCKED';

DO $$ BEGIN
  CREATE TYPE "IntegrityEventType" AS ENUM ('SURVEY_ATTEMPT_STARTED', 'SURVEY_ATTEMPT_RESUMED', 'SURVEY_ATTEMPT_ABANDONED', 'SURVEY_SUBMITTED', 'QUESTION_SHOWN', 'QUESTION_FOCUSED', 'QUESTION_BLURRED', 'ANSWER_SELECTED', 'ANSWER_ENTERED', 'ANSWER_CHANGED', 'ANSWER_CLEARED', 'QUESTION_SKIPPED', 'QUESTION_RETURNED', 'PAGE_HIDDEN', 'PAGE_VISIBLE', 'ATTENTION_CHECK_PASSED', 'ATTENTION_CHECK_FAILED', 'TIME_BARRIER_TRIGGERED', 'RATE_LIMIT_TRIGGERED', 'DEMOGRAPHIC_CONFLICT_DETECTED', 'DUPLICATE_PATTERN_DETECTED', 'SEMANTIC_QUALITY_EVALUATED', 'INTEGRITY_ASSESSMENT_CREATED', 'INTEGRITY_POLICY_DECIDED', 'INTEGRITY_REVIEW_COMPLETED', 'REWARD_PENDING', 'REWARD_RELEASED', 'REWARD_HELD', 'REWARD_REJECTED', 'ESCROW_RELEASED', 'ESCROW_REFUNDED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
ALTER TYPE "IntegrityEventType" ADD VALUE IF NOT EXISTS 'SURVEY_ATTEMPT_STARTED';
ALTER TYPE "IntegrityEventType" ADD VALUE IF NOT EXISTS 'SURVEY_ATTEMPT_RESUMED';
ALTER TYPE "IntegrityEventType" ADD VALUE IF NOT EXISTS 'SURVEY_ATTEMPT_ABANDONED';
ALTER TYPE "IntegrityEventType" ADD VALUE IF NOT EXISTS 'SURVEY_SUBMITTED';
ALTER TYPE "IntegrityEventType" ADD VALUE IF NOT EXISTS 'QUESTION_SHOWN';
ALTER TYPE "IntegrityEventType" ADD VALUE IF NOT EXISTS 'QUESTION_FOCUSED';
ALTER TYPE "IntegrityEventType" ADD VALUE IF NOT EXISTS 'QUESTION_BLURRED';
ALTER TYPE "IntegrityEventType" ADD VALUE IF NOT EXISTS 'ANSWER_SELECTED';
ALTER TYPE "IntegrityEventType" ADD VALUE IF NOT EXISTS 'ANSWER_ENTERED';
ALTER TYPE "IntegrityEventType" ADD VALUE IF NOT EXISTS 'ANSWER_CHANGED';
ALTER TYPE "IntegrityEventType" ADD VALUE IF NOT EXISTS 'ANSWER_CLEARED';
ALTER TYPE "IntegrityEventType" ADD VALUE IF NOT EXISTS 'QUESTION_SKIPPED';
ALTER TYPE "IntegrityEventType" ADD VALUE IF NOT EXISTS 'QUESTION_RETURNED';
ALTER TYPE "IntegrityEventType" ADD VALUE IF NOT EXISTS 'PAGE_HIDDEN';
ALTER TYPE "IntegrityEventType" ADD VALUE IF NOT EXISTS 'PAGE_VISIBLE';
ALTER TYPE "IntegrityEventType" ADD VALUE IF NOT EXISTS 'ATTENTION_CHECK_PASSED';
ALTER TYPE "IntegrityEventType" ADD VALUE IF NOT EXISTS 'ATTENTION_CHECK_FAILED';
ALTER TYPE "IntegrityEventType" ADD VALUE IF NOT EXISTS 'TIME_BARRIER_TRIGGERED';
ALTER TYPE "IntegrityEventType" ADD VALUE IF NOT EXISTS 'RATE_LIMIT_TRIGGERED';
ALTER TYPE "IntegrityEventType" ADD VALUE IF NOT EXISTS 'DEMOGRAPHIC_CONFLICT_DETECTED';
ALTER TYPE "IntegrityEventType" ADD VALUE IF NOT EXISTS 'DUPLICATE_PATTERN_DETECTED';
ALTER TYPE "IntegrityEventType" ADD VALUE IF NOT EXISTS 'SEMANTIC_QUALITY_EVALUATED';
ALTER TYPE "IntegrityEventType" ADD VALUE IF NOT EXISTS 'INTEGRITY_ASSESSMENT_CREATED';
ALTER TYPE "IntegrityEventType" ADD VALUE IF NOT EXISTS 'INTEGRITY_POLICY_DECIDED';
ALTER TYPE "IntegrityEventType" ADD VALUE IF NOT EXISTS 'INTEGRITY_REVIEW_COMPLETED';
ALTER TYPE "IntegrityEventType" ADD VALUE IF NOT EXISTS 'REWARD_PENDING';
ALTER TYPE "IntegrityEventType" ADD VALUE IF NOT EXISTS 'REWARD_RELEASED';
ALTER TYPE "IntegrityEventType" ADD VALUE IF NOT EXISTS 'REWARD_HELD';
ALTER TYPE "IntegrityEventType" ADD VALUE IF NOT EXISTS 'REWARD_REJECTED';
ALTER TYPE "IntegrityEventType" ADD VALUE IF NOT EXISTS 'ESCROW_RELEASED';
ALTER TYPE "IntegrityEventType" ADD VALUE IF NOT EXISTS 'ESCROW_REFUNDED';

DO $$ BEGIN
  CREATE TYPE "IntegrityRiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
ALTER TYPE "IntegrityRiskLevel" ADD VALUE IF NOT EXISTS 'LOW';
ALTER TYPE "IntegrityRiskLevel" ADD VALUE IF NOT EXISTS 'MEDIUM';
ALTER TYPE "IntegrityRiskLevel" ADD VALUE IF NOT EXISTS 'HIGH';

DO $$ BEGIN
  CREATE TYPE "FraudLogType" AS ENUM ('TIME_BARRIER', 'RATE_LIMIT', 'DEMO_MISMATCH', 'RECAPTCHA_FAIL', 'SECURITY_VIOLATION');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
ALTER TYPE "FraudLogType" ADD VALUE IF NOT EXISTS 'TIME_BARRIER';
ALTER TYPE "FraudLogType" ADD VALUE IF NOT EXISTS 'RATE_LIMIT';
ALTER TYPE "FraudLogType" ADD VALUE IF NOT EXISTS 'DEMO_MISMATCH';
ALTER TYPE "FraudLogType" ADD VALUE IF NOT EXISTS 'RECAPTCHA_FAIL';
ALTER TYPE "FraudLogType" ADD VALUE IF NOT EXISTS 'SECURITY_VIOLATION';

DO $$ BEGIN
  CREATE TYPE "IntegrityIncidentType" AS ENUM ('SPEED_ANOMALY', 'ATTENTION_FAILURE', 'DEMOGRAPHIC_CONFLICT', 'ANSWER_INCONSISTENCY', 'DUPLICATE_PATTERN', 'ACCOUNT_BEHAVIOR_ANOMALY', 'AUTOMATION_SUSPECTED', 'NETWORK_ANOMALY');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
ALTER TYPE "IntegrityIncidentType" ADD VALUE IF NOT EXISTS 'SPEED_ANOMALY';
ALTER TYPE "IntegrityIncidentType" ADD VALUE IF NOT EXISTS 'ATTENTION_FAILURE';
ALTER TYPE "IntegrityIncidentType" ADD VALUE IF NOT EXISTS 'DEMOGRAPHIC_CONFLICT';
ALTER TYPE "IntegrityIncidentType" ADD VALUE IF NOT EXISTS 'ANSWER_INCONSISTENCY';
ALTER TYPE "IntegrityIncidentType" ADD VALUE IF NOT EXISTS 'DUPLICATE_PATTERN';
ALTER TYPE "IntegrityIncidentType" ADD VALUE IF NOT EXISTS 'ACCOUNT_BEHAVIOR_ANOMALY';
ALTER TYPE "IntegrityIncidentType" ADD VALUE IF NOT EXISTS 'AUTOMATION_SUSPECTED';
ALTER TYPE "IntegrityIncidentType" ADD VALUE IF NOT EXISTS 'NETWORK_ANOMALY';

DO $$ BEGIN
  CREATE TYPE "IntegrityIncidentStatus" AS ENUM ('OPEN', 'REVIEWED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
ALTER TYPE "IntegrityIncidentStatus" ADD VALUE IF NOT EXISTS 'OPEN';
ALTER TYPE "IntegrityIncidentStatus" ADD VALUE IF NOT EXISTS 'REVIEWED';

DO $$ BEGIN
  CREATE TYPE "IntegritySeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
ALTER TYPE "IntegritySeverity" ADD VALUE IF NOT EXISTS 'LOW';
ALTER TYPE "IntegritySeverity" ADD VALUE IF NOT EXISTS 'MEDIUM';
ALTER TYPE "IntegritySeverity" ADD VALUE IF NOT EXISTS 'HIGH';
ALTER TYPE "IntegritySeverity" ADD VALUE IF NOT EXISTS 'CRITICAL';

DO $$ BEGIN
  CREATE TYPE "IntegrityResolution" AS ENUM ('DISMISSED', 'CONFIRMED_LOW_QUALITY', 'CONFIRMED_FRAUD');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
ALTER TYPE "IntegrityResolution" ADD VALUE IF NOT EXISTS 'DISMISSED';
ALTER TYPE "IntegrityResolution" ADD VALUE IF NOT EXISTS 'CONFIRMED_LOW_QUALITY';
ALTER TYPE "IntegrityResolution" ADD VALUE IF NOT EXISTS 'CONFIRMED_FRAUD';

DO $$ BEGIN
  CREATE TYPE "PolicyStatus" AS ENUM ('DRAFT', 'SHADOW', 'ADVISORY', 'ENFORCED', 'RETIRED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
ALTER TYPE "PolicyStatus" ADD VALUE IF NOT EXISTS 'DRAFT';
ALTER TYPE "PolicyStatus" ADD VALUE IF NOT EXISTS 'SHADOW';
ALTER TYPE "PolicyStatus" ADD VALUE IF NOT EXISTS 'ADVISORY';
ALTER TYPE "PolicyStatus" ADD VALUE IF NOT EXISTS 'ENFORCED';
ALTER TYPE "PolicyStatus" ADD VALUE IF NOT EXISTS 'RETIRED';

DO $$ BEGIN
  CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSED', 'FAILED', 'DEAD_LETTER');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
ALTER TYPE "OutboxStatus" ADD VALUE IF NOT EXISTS 'PENDING';
ALTER TYPE "OutboxStatus" ADD VALUE IF NOT EXISTS 'PROCESSED';
ALTER TYPE "OutboxStatus" ADD VALUE IF NOT EXISTS 'FAILED';
ALTER TYPE "OutboxStatus" ADD VALUE IF NOT EXISTS 'DEAD_LETTER';

DO $$ BEGIN
  CREATE TYPE "AssessmentApplicability" AS ENUM ('APPLICABLE', 'NOT_ASSESSED', 'INSUFFICIENT_EVIDENCE');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
ALTER TYPE "AssessmentApplicability" ADD VALUE IF NOT EXISTS 'APPLICABLE';
ALTER TYPE "AssessmentApplicability" ADD VALUE IF NOT EXISTS 'NOT_ASSESSED';
ALTER TYPE "AssessmentApplicability" ADD VALUE IF NOT EXISTS 'INSUFFICIENT_EVIDENCE';

-- 1b. Tables (created if missing; every column added in place when the
--     table already exists from an older `prisma db push`).

CREATE TABLE IF NOT EXISTS "demographic_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "age" INTEGER,
    "location" TEXT,
    "household_income" TEXT,
    "specific_interests" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "demographic_profiles_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "demographic_profiles" ADD COLUMN IF NOT EXISTS "id" UUID NOT NULL;
ALTER TABLE "demographic_profiles" ADD COLUMN IF NOT EXISTS "user_id" UUID NOT NULL;
ALTER TABLE "demographic_profiles" ADD COLUMN IF NOT EXISTS "age" INTEGER;
ALTER TABLE "demographic_profiles" ADD COLUMN IF NOT EXISTS "location" TEXT;
ALTER TABLE "demographic_profiles" ADD COLUMN IF NOT EXISTS "household_income" TEXT;
ALTER TABLE "demographic_profiles" ADD COLUMN IF NOT EXISTS "specific_interests" JSONB;
ALTER TABLE "demographic_profiles" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "demographic_profiles" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL;

CREATE TABLE IF NOT EXISTS "forms" (
    "id" UUID NOT NULL,
    "publisher_id" UUID NOT NULL,
    "type" "FormType" NOT NULL,
    "status" "FormStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "reward_per_response" INTEGER NOT NULL,
    "expected_completions" INTEGER NOT NULL,
    "close_count" INTEGER NOT NULL DEFAULT 0,
    "close_kind" "FormCloseKind",
    "estimated_duration_minutes" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "forms_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "forms" ADD COLUMN IF NOT EXISTS "id" UUID NOT NULL;
ALTER TABLE "forms" ADD COLUMN IF NOT EXISTS "publisher_id" UUID NOT NULL;
ALTER TABLE "forms" ADD COLUMN IF NOT EXISTS "type" "FormType" NOT NULL;
ALTER TABLE "forms" ADD COLUMN IF NOT EXISTS "status" "FormStatus" NOT NULL DEFAULT 'DRAFT';
ALTER TABLE "forms" ADD COLUMN IF NOT EXISTS "title" TEXT NOT NULL;
ALTER TABLE "forms" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "forms" ADD COLUMN IF NOT EXISTS "reward_per_response" INTEGER NOT NULL;
ALTER TABLE "forms" ADD COLUMN IF NOT EXISTS "expected_completions" INTEGER NOT NULL;
ALTER TABLE "forms" ADD COLUMN IF NOT EXISTS "close_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "forms" ADD COLUMN IF NOT EXISTS "close_kind" "FormCloseKind";
ALTER TABLE "forms" ADD COLUMN IF NOT EXISTS "estimated_duration_minutes" INTEGER;
ALTER TABLE "forms" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "forms" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL;

CREATE TABLE IF NOT EXISTS "form_versions" (
    "id" UUID NOT NULL,
    "form_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "schema_json" JSONB NOT NULL,
    "targeting_json" JSONB,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "external_url" TEXT,
    "completion_code" TEXT,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "form_versions_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "form_versions" ADD COLUMN IF NOT EXISTS "id" UUID NOT NULL;
ALTER TABLE "form_versions" ADD COLUMN IF NOT EXISTS "form_id" UUID NOT NULL;
ALTER TABLE "form_versions" ADD COLUMN IF NOT EXISTS "version_number" INTEGER NOT NULL;
ALTER TABLE "form_versions" ADD COLUMN IF NOT EXISTS "schema_json" JSONB NOT NULL;
ALTER TABLE "form_versions" ADD COLUMN IF NOT EXISTS "targeting_json" JSONB;
ALTER TABLE "form_versions" ADD COLUMN IF NOT EXISTS "is_published" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "form_versions" ADD COLUMN IF NOT EXISTS "external_url" TEXT;
ALTER TABLE "form_versions" ADD COLUMN IF NOT EXISTS "completion_code" TEXT;
ALTER TABLE "form_versions" ADD COLUMN IF NOT EXISTS "published_at" TIMESTAMP(3);
ALTER TABLE "form_versions" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE IF NOT EXISTS "responses" (
    "id" UUID NOT NULL,
    "form_id" UUID NOT NULL,
    "form_version_id" UUID NOT NULL,
    "attempt_id" UUID,
    "respondent_id" UUID,
    "status" "ResponseStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "answers_json" JSONB,
    "ip_address" TEXT NOT NULL,
    "is_guest" BOOLEAN NOT NULL DEFAULT false,
    "submitted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "responses_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "responses" ADD COLUMN IF NOT EXISTS "id" UUID NOT NULL;
ALTER TABLE "responses" ADD COLUMN IF NOT EXISTS "form_id" UUID NOT NULL;
ALTER TABLE "responses" ADD COLUMN IF NOT EXISTS "form_version_id" UUID NOT NULL;
ALTER TABLE "responses" ADD COLUMN IF NOT EXISTS "attempt_id" UUID;
ALTER TABLE "responses" ADD COLUMN IF NOT EXISTS "respondent_id" UUID;
ALTER TABLE "responses" ADD COLUMN IF NOT EXISTS "status" "ResponseStatus" NOT NULL DEFAULT 'IN_PROGRESS';
ALTER TABLE "responses" ADD COLUMN IF NOT EXISTS "answers_json" JSONB;
ALTER TABLE "responses" ADD COLUMN IF NOT EXISTS "ip_address" TEXT NOT NULL;
ALTER TABLE "responses" ADD COLUMN IF NOT EXISTS "is_guest" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "responses" ADD COLUMN IF NOT EXISTS "submitted_at" TIMESTAMP(3);
ALTER TABLE "responses" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "responses" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL;

CREATE TABLE IF NOT EXISTS "survey_attempts" (
    "id" UUID NOT NULL,
    "respondent_id" UUID,
    "survey_id" UUID NOT NULL,
    "form_version_id" UUID NOT NULL,
    "status" "AttemptStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "is_guest" BOOLEAN NOT NULL DEFAULT false,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submitted_at" TIMESTAMP(3),
    "client_context" JSONB,
    "failed_code_verifications" INTEGER NOT NULL DEFAULT 0,
    "last_failed_verification_at" TIMESTAMP(3),
    "missing_code_reported_at" TIMESTAMP(3),
    "missing_code_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "survey_attempts_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "survey_attempts" ADD COLUMN IF NOT EXISTS "id" UUID NOT NULL;
ALTER TABLE "survey_attempts" ADD COLUMN IF NOT EXISTS "respondent_id" UUID;
ALTER TABLE "survey_attempts" ADD COLUMN IF NOT EXISTS "survey_id" UUID NOT NULL;
ALTER TABLE "survey_attempts" ADD COLUMN IF NOT EXISTS "form_version_id" UUID NOT NULL;
ALTER TABLE "survey_attempts" ADD COLUMN IF NOT EXISTS "status" "AttemptStatus" NOT NULL DEFAULT 'IN_PROGRESS';
ALTER TABLE "survey_attempts" ADD COLUMN IF NOT EXISTS "is_guest" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "survey_attempts" ADD COLUMN IF NOT EXISTS "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "survey_attempts" ADD COLUMN IF NOT EXISTS "submitted_at" TIMESTAMP(3);
ALTER TABLE "survey_attempts" ADD COLUMN IF NOT EXISTS "client_context" JSONB;
ALTER TABLE "survey_attempts" ADD COLUMN IF NOT EXISTS "failed_code_verifications" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "survey_attempts" ADD COLUMN IF NOT EXISTS "last_failed_verification_at" TIMESTAMP(3);
ALTER TABLE "survey_attempts" ADD COLUMN IF NOT EXISTS "missing_code_reported_at" TIMESTAMP(3);
ALTER TABLE "survey_attempts" ADD COLUMN IF NOT EXISTS "missing_code_reason" TEXT;
ALTER TABLE "survey_attempts" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "survey_attempts" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL;

CREATE TABLE IF NOT EXISTS "integrity_consents" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "notice_version" INTEGER NOT NULL,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "integrity_consents_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "integrity_consents" ADD COLUMN IF NOT EXISTS "id" UUID NOT NULL;
ALTER TABLE "integrity_consents" ADD COLUMN IF NOT EXISTS "user_id" UUID NOT NULL;
ALTER TABLE "integrity_consents" ADD COLUMN IF NOT EXISTS "purpose" TEXT NOT NULL;
ALTER TABLE "integrity_consents" ADD COLUMN IF NOT EXISTS "notice_version" INTEGER NOT NULL;
ALTER TABLE "integrity_consents" ADD COLUMN IF NOT EXISTS "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "integrity_consents" ADD COLUMN IF NOT EXISTS "revoked_at" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "integrity_events" (
    "id" UUID NOT NULL,
    "client_event_id" TEXT NOT NULL,
    "attempt_id" UUID NOT NULL,
    "respondent_id" UUID,
    "form_version_id" UUID NOT NULL,
    "question_id" TEXT,
    "consent_id" UUID,
    "event_type" "IntegrityEventType" NOT NULL,
    "event_version" INTEGER NOT NULL DEFAULT 1,
    "sequence" INTEGER,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "server_receipt_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integrity_events_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "integrity_events" ADD COLUMN IF NOT EXISTS "id" UUID NOT NULL;
ALTER TABLE "integrity_events" ADD COLUMN IF NOT EXISTS "client_event_id" TEXT NOT NULL;
ALTER TABLE "integrity_events" ADD COLUMN IF NOT EXISTS "attempt_id" UUID NOT NULL;
ALTER TABLE "integrity_events" ADD COLUMN IF NOT EXISTS "respondent_id" UUID;
ALTER TABLE "integrity_events" ADD COLUMN IF NOT EXISTS "form_version_id" UUID NOT NULL;
ALTER TABLE "integrity_events" ADD COLUMN IF NOT EXISTS "question_id" TEXT;
ALTER TABLE "integrity_events" ADD COLUMN IF NOT EXISTS "consent_id" UUID;
ALTER TABLE "integrity_events" ADD COLUMN IF NOT EXISTS "event_type" "IntegrityEventType" NOT NULL;
ALTER TABLE "integrity_events" ADD COLUMN IF NOT EXISTS "event_version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "integrity_events" ADD COLUMN IF NOT EXISTS "sequence" INTEGER;
ALTER TABLE "integrity_events" ADD COLUMN IF NOT EXISTS "occurred_at" TIMESTAMP(3) NOT NULL;
ALTER TABLE "integrity_events" ADD COLUMN IF NOT EXISTS "server_receipt_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "integrity_events" ADD COLUMN IF NOT EXISTS "metadata" JSONB;
ALTER TABLE "integrity_events" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE IF NOT EXISTS "integrity_assessments" (
    "id" UUID NOT NULL,
    "attempt_id" UUID NOT NULL,
    "response_id" UUID NOT NULL,
    "respondent_id" UUID,
    "applicability" "AssessmentApplicability" NOT NULL DEFAULT 'APPLICABLE',
    "score" DECIMAL(65,30),
    "confidence" DECIMAL(65,30),
    "evidence_coverage" DECIMAL(65,30),
    "risk_level" "IntegrityRiskLevel",
    "component_scores" JSONB,
    "reason_codes" JSONB,
    "input_lineage_checksum" TEXT,
    "feature_version" TEXT NOT NULL,
    "scoring_version" TEXT NOT NULL,
    "policy_version" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integrity_assessments_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "integrity_assessments" ADD COLUMN IF NOT EXISTS "id" UUID NOT NULL;
ALTER TABLE "integrity_assessments" ADD COLUMN IF NOT EXISTS "attempt_id" UUID NOT NULL;
ALTER TABLE "integrity_assessments" ADD COLUMN IF NOT EXISTS "response_id" UUID NOT NULL;
ALTER TABLE "integrity_assessments" ADD COLUMN IF NOT EXISTS "respondent_id" UUID;
ALTER TABLE "integrity_assessments" ADD COLUMN IF NOT EXISTS "applicability" "AssessmentApplicability" NOT NULL DEFAULT 'APPLICABLE';
ALTER TABLE "integrity_assessments" ADD COLUMN IF NOT EXISTS "score" DECIMAL(65,30);
ALTER TABLE "integrity_assessments" ADD COLUMN IF NOT EXISTS "confidence" DECIMAL(65,30);
ALTER TABLE "integrity_assessments" ADD COLUMN IF NOT EXISTS "evidence_coverage" DECIMAL(65,30);
ALTER TABLE "integrity_assessments" ADD COLUMN IF NOT EXISTS "risk_level" "IntegrityRiskLevel";
ALTER TABLE "integrity_assessments" ADD COLUMN IF NOT EXISTS "component_scores" JSONB;
ALTER TABLE "integrity_assessments" ADD COLUMN IF NOT EXISTS "reason_codes" JSONB;
ALTER TABLE "integrity_assessments" ADD COLUMN IF NOT EXISTS "input_lineage_checksum" TEXT;
ALTER TABLE "integrity_assessments" ADD COLUMN IF NOT EXISTS "feature_version" TEXT NOT NULL;
ALTER TABLE "integrity_assessments" ADD COLUMN IF NOT EXISTS "scoring_version" TEXT NOT NULL;
ALTER TABLE "integrity_assessments" ADD COLUMN IF NOT EXISTS "policy_version" TEXT;
ALTER TABLE "integrity_assessments" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE IF NOT EXISTS "respondent_reputations" (
    "id" UUID NOT NULL,
    "respondent_id" UUID NOT NULL,
    "integrity_score_rolling" DECIMAL(65,30) NOT NULL,
    "confidence" DECIMAL(65,30) NOT NULL,
    "accepted_responses" INTEGER NOT NULL DEFAULT 0,
    "reviewed_responses" INTEGER NOT NULL DEFAULT 0,
    "confirmed_incidents" INTEGER NOT NULL DEFAULT 0,
    "metrics" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "calculated_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "respondent_reputations_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "respondent_reputations" ADD COLUMN IF NOT EXISTS "id" UUID NOT NULL;
ALTER TABLE "respondent_reputations" ADD COLUMN IF NOT EXISTS "respondent_id" UUID NOT NULL;
ALTER TABLE "respondent_reputations" ADD COLUMN IF NOT EXISTS "integrity_score_rolling" DECIMAL(65,30) NOT NULL;
ALTER TABLE "respondent_reputations" ADD COLUMN IF NOT EXISTS "confidence" DECIMAL(65,30) NOT NULL;
ALTER TABLE "respondent_reputations" ADD COLUMN IF NOT EXISTS "accepted_responses" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "respondent_reputations" ADD COLUMN IF NOT EXISTS "reviewed_responses" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "respondent_reputations" ADD COLUMN IF NOT EXISTS "confirmed_incidents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "respondent_reputations" ADD COLUMN IF NOT EXISTS "metrics" JSONB NOT NULL;
ALTER TABLE "respondent_reputations" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "respondent_reputations" ADD COLUMN IF NOT EXISTS "calculated_at" TIMESTAMP(3) NOT NULL;
ALTER TABLE "respondent_reputations" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL;

CREATE TABLE IF NOT EXISTS "integrity_incidents" (
    "id" UUID NOT NULL,
    "attempt_id" UUID,
    "response_id" UUID,
    "respondent_id" UUID NOT NULL,
    "type" "IntegrityIncidentType" NOT NULL,
    "status" "IntegrityIncidentStatus" NOT NULL DEFAULT 'OPEN',
    "severity" "IntegritySeverity" NOT NULL,
    "evidence" JSONB NOT NULL,
    "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMP(3),
    "resolution" "IntegrityResolution",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integrity_incidents_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "integrity_incidents" ADD COLUMN IF NOT EXISTS "id" UUID NOT NULL;
ALTER TABLE "integrity_incidents" ADD COLUMN IF NOT EXISTS "attempt_id" UUID;
ALTER TABLE "integrity_incidents" ADD COLUMN IF NOT EXISTS "response_id" UUID;
ALTER TABLE "integrity_incidents" ADD COLUMN IF NOT EXISTS "respondent_id" UUID NOT NULL;
ALTER TABLE "integrity_incidents" ADD COLUMN IF NOT EXISTS "type" "IntegrityIncidentType" NOT NULL;
ALTER TABLE "integrity_incidents" ADD COLUMN IF NOT EXISTS "status" "IntegrityIncidentStatus" NOT NULL DEFAULT 'OPEN';
ALTER TABLE "integrity_incidents" ADD COLUMN IF NOT EXISTS "severity" "IntegritySeverity" NOT NULL;
ALTER TABLE "integrity_incidents" ADD COLUMN IF NOT EXISTS "evidence" JSONB NOT NULL;
ALTER TABLE "integrity_incidents" ADD COLUMN IF NOT EXISTS "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "integrity_incidents" ADD COLUMN IF NOT EXISTS "reviewed_at" TIMESTAMP(3);
ALTER TABLE "integrity_incidents" ADD COLUMN IF NOT EXISTS "resolution" "IntegrityResolution";
ALTER TABLE "integrity_incidents" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE IF NOT EXISTS "integrity_reviews" (
    "id" UUID NOT NULL,
    "incident_id" UUID NOT NULL,
    "reviewer_id" UUID NOT NULL,
    "decision" "IntegrityResolution" NOT NULL,
    "reason" TEXT,
    "evidence" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integrity_reviews_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "integrity_reviews" ADD COLUMN IF NOT EXISTS "id" UUID NOT NULL;
ALTER TABLE "integrity_reviews" ADD COLUMN IF NOT EXISTS "incident_id" UUID NOT NULL;
ALTER TABLE "integrity_reviews" ADD COLUMN IF NOT EXISTS "reviewer_id" UUID NOT NULL;
ALTER TABLE "integrity_reviews" ADD COLUMN IF NOT EXISTS "decision" "IntegrityResolution" NOT NULL;
ALTER TABLE "integrity_reviews" ADD COLUMN IF NOT EXISTS "reason" TEXT;
ALTER TABLE "integrity_reviews" ADD COLUMN IF NOT EXISTS "evidence" JSONB;
ALTER TABLE "integrity_reviews" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE IF NOT EXISTS "fraud_logs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "FraudLogType" NOT NULL,
    "details" JSONB,
    "dedupe_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fraud_logs_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "fraud_logs" ADD COLUMN IF NOT EXISTS "id" UUID NOT NULL;
ALTER TABLE "fraud_logs" ADD COLUMN IF NOT EXISTS "user_id" UUID NOT NULL;
ALTER TABLE "fraud_logs" ADD COLUMN IF NOT EXISTS "type" "FraudLogType" NOT NULL;
ALTER TABLE "fraud_logs" ADD COLUMN IF NOT EXISTS "details" JSONB;
ALTER TABLE "fraud_logs" ADD COLUMN IF NOT EXISTS "dedupe_key" TEXT;
ALTER TABLE "fraud_logs" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE IF NOT EXISTS "scoring_policies" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "PolicyStatus" NOT NULL,
    "definition" JSONB NOT NULL,
    "activated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scoring_policies_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "scoring_policies" ADD COLUMN IF NOT EXISTS "id" UUID NOT NULL;
ALTER TABLE "scoring_policies" ADD COLUMN IF NOT EXISTS "name" TEXT NOT NULL;
ALTER TABLE "scoring_policies" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL;
ALTER TABLE "scoring_policies" ADD COLUMN IF NOT EXISTS "status" "PolicyStatus" NOT NULL;
ALTER TABLE "scoring_policies" ADD COLUMN IF NOT EXISTS "definition" JSONB NOT NULL;
ALTER TABLE "scoring_policies" ADD COLUMN IF NOT EXISTS "activated_at" TIMESTAMP(3);
ALTER TABLE "scoring_policies" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE IF NOT EXISTS "outbox_events" (
    "id" UUID NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "producer" TEXT NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "aggregate_version" INTEGER NOT NULL DEFAULT 1,
    "ordering_stream" TEXT,
    "stream_sequence" INTEGER,
    "correlation_id" UUID,
    "causation_id" UUID,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claim_owner" TEXT,
    "claim_fencing_token" TEXT,
    "claim_expires_at" TIMESTAMP(3),
    "last_error" TEXT,
    "terminal_state" TEXT,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "outbox_events" ADD COLUMN IF NOT EXISTS "id" UUID NOT NULL;
ALTER TABLE "outbox_events" ADD COLUMN IF NOT EXISTS "idempotency_key" TEXT NOT NULL;
ALTER TABLE "outbox_events" ADD COLUMN IF NOT EXISTS "event_type" TEXT NOT NULL;
ALTER TABLE "outbox_events" ADD COLUMN IF NOT EXISTS "schema_version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "outbox_events" ADD COLUMN IF NOT EXISTS "producer" TEXT NOT NULL;
ALTER TABLE "outbox_events" ADD COLUMN IF NOT EXISTS "aggregate_type" TEXT NOT NULL;
ALTER TABLE "outbox_events" ADD COLUMN IF NOT EXISTS "aggregate_id" TEXT NOT NULL;
ALTER TABLE "outbox_events" ADD COLUMN IF NOT EXISTS "aggregate_version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "outbox_events" ADD COLUMN IF NOT EXISTS "ordering_stream" TEXT;
ALTER TABLE "outbox_events" ADD COLUMN IF NOT EXISTS "stream_sequence" INTEGER;
ALTER TABLE "outbox_events" ADD COLUMN IF NOT EXISTS "correlation_id" UUID;
ALTER TABLE "outbox_events" ADD COLUMN IF NOT EXISTS "causation_id" UUID;
ALTER TABLE "outbox_events" ADD COLUMN IF NOT EXISTS "payload" JSONB NOT NULL;
ALTER TABLE "outbox_events" ADD COLUMN IF NOT EXISTS "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING';
ALTER TABLE "outbox_events" ADD COLUMN IF NOT EXISTS "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "outbox_events" ADD COLUMN IF NOT EXISTS "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "outbox_events" ADD COLUMN IF NOT EXISTS "claim_owner" TEXT;
ALTER TABLE "outbox_events" ADD COLUMN IF NOT EXISTS "claim_fencing_token" TEXT;
ALTER TABLE "outbox_events" ADD COLUMN IF NOT EXISTS "claim_expires_at" TIMESTAMP(3);
ALTER TABLE "outbox_events" ADD COLUMN IF NOT EXISTS "last_error" TEXT;
ALTER TABLE "outbox_events" ADD COLUMN IF NOT EXISTS "terminal_state" TEXT;
ALTER TABLE "outbox_events" ADD COLUMN IF NOT EXISTS "processed_at" TIMESTAMP(3);
ALTER TABLE "outbox_events" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "outbox_events" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL;

CREATE TABLE IF NOT EXISTS "processed_handlers" (
    "id" UUID NOT NULL,
    "handler_name" TEXT NOT NULL,
    "event_id" UUID,
    "stream_sequence" INTEGER,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_handlers_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "processed_handlers" ADD COLUMN IF NOT EXISTS "id" UUID NOT NULL;
ALTER TABLE "processed_handlers" ADD COLUMN IF NOT EXISTS "handler_name" TEXT NOT NULL;
ALTER TABLE "processed_handlers" ADD COLUMN IF NOT EXISTS "event_id" UUID;
ALTER TABLE "processed_handlers" ADD COLUMN IF NOT EXISTS "stream_sequence" INTEGER;
ALTER TABLE "processed_handlers" ADD COLUMN IF NOT EXISTS "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE IF NOT EXISTS "gamification_stats" (
    "user_id" UUID NOT NULL,
    "current_streak" INTEGER NOT NULL DEFAULT 0,
    "max_streak" INTEGER NOT NULL DEFAULT 0,
    "total_surveys_completed" INTEGER NOT NULL DEFAULT 0,
    "is_trusted_researcher" BOOLEAN NOT NULL DEFAULT false,
    "last_survey_date" TIMESTAMP(3),

    CONSTRAINT "gamification_stats_pkey" PRIMARY KEY ("user_id")
);
ALTER TABLE "gamification_stats" ADD COLUMN IF NOT EXISTS "user_id" UUID NOT NULL;
ALTER TABLE "gamification_stats" ADD COLUMN IF NOT EXISTS "current_streak" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "gamification_stats" ADD COLUMN IF NOT EXISTS "max_streak" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "gamification_stats" ADD COLUMN IF NOT EXISTS "total_surveys_completed" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "gamification_stats" ADD COLUMN IF NOT EXISTS "is_trusted_researcher" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "gamification_stats" ADD COLUMN IF NOT EXISTS "last_survey_date" TIMESTAMP(3);

-- 1c. Indexes.

CREATE UNIQUE INDEX IF NOT EXISTS "demographic_profiles_user_id_key" ON "demographic_profiles"("user_id");

CREATE UNIQUE INDEX IF NOT EXISTS "form_versions_form_id_version_number_key" ON "form_versions"("form_id", "version_number");

CREATE UNIQUE INDEX IF NOT EXISTS "responses_attempt_id_key" ON "responses"("attempt_id");

CREATE INDEX IF NOT EXISTS "survey_attempts_respondent_id_status_submitted_at_idx" ON "survey_attempts"("respondent_id", "status", "submitted_at");

CREATE INDEX IF NOT EXISTS "survey_attempts_respondent_id_form_version_id_idx" ON "survey_attempts"("respondent_id", "form_version_id");

CREATE INDEX IF NOT EXISTS "integrity_events_attempt_id_event_type_idx" ON "integrity_events"("attempt_id", "event_type");

CREATE UNIQUE INDEX IF NOT EXISTS "integrity_events_attempt_id_client_event_id_key" ON "integrity_events"("attempt_id", "client_event_id");

CREATE INDEX IF NOT EXISTS "integrity_assessments_respondent_id_created_at_idx" ON "integrity_assessments"("respondent_id", "created_at");

CREATE INDEX IF NOT EXISTS "integrity_assessments_response_id_idx" ON "integrity_assessments"("response_id");

CREATE UNIQUE INDEX IF NOT EXISTS "respondent_reputations_respondent_id_key" ON "respondent_reputations"("respondent_id");

CREATE UNIQUE INDEX IF NOT EXISTS "fraud_logs_dedupe_key_key" ON "fraud_logs"("dedupe_key");

CREATE UNIQUE INDEX IF NOT EXISTS "scoring_policies_name_version_key" ON "scoring_policies"("name", "version");

CREATE UNIQUE INDEX IF NOT EXISTS "outbox_events_idempotency_key_key" ON "outbox_events"("idempotency_key");

CREATE INDEX IF NOT EXISTS "outbox_events_status_available_at_idx" ON "outbox_events"("status", "available_at");

CREATE UNIQUE INDEX IF NOT EXISTS "processed_handlers_handler_name_event_id_key" ON "processed_handlers"("handler_name", "event_id");

-- 1d. Foreign keys (added only when missing).

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'demographic_profiles_user_id_fkey' AND conrelid = '"demographic_profiles"'::regclass
  ) THEN
    ALTER TABLE "demographic_profiles" ADD CONSTRAINT "demographic_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'forms_publisher_id_fkey' AND conrelid = '"forms"'::regclass
  ) THEN
    ALTER TABLE "forms" ADD CONSTRAINT "forms_publisher_id_fkey" FOREIGN KEY ("publisher_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'form_versions_form_id_fkey' AND conrelid = '"form_versions"'::regclass
  ) THEN
    ALTER TABLE "form_versions" ADD CONSTRAINT "form_versions_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'responses_form_id_fkey' AND conrelid = '"responses"'::regclass
  ) THEN
    ALTER TABLE "responses" ADD CONSTRAINT "responses_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "forms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'responses_form_version_id_fkey' AND conrelid = '"responses"'::regclass
  ) THEN
    ALTER TABLE "responses" ADD CONSTRAINT "responses_form_version_id_fkey" FOREIGN KEY ("form_version_id") REFERENCES "form_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'responses_respondent_id_fkey' AND conrelid = '"responses"'::regclass
  ) THEN
    ALTER TABLE "responses" ADD CONSTRAINT "responses_respondent_id_fkey" FOREIGN KEY ("respondent_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'responses_attempt_id_fkey' AND conrelid = '"responses"'::regclass
  ) THEN
    ALTER TABLE "responses" ADD CONSTRAINT "responses_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "survey_attempts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'survey_attempts_respondent_id_fkey' AND conrelid = '"survey_attempts"'::regclass
  ) THEN
    ALTER TABLE "survey_attempts" ADD CONSTRAINT "survey_attempts_respondent_id_fkey" FOREIGN KEY ("respondent_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'survey_attempts_survey_id_fkey' AND conrelid = '"survey_attempts"'::regclass
  ) THEN
    ALTER TABLE "survey_attempts" ADD CONSTRAINT "survey_attempts_survey_id_fkey" FOREIGN KEY ("survey_id") REFERENCES "forms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'survey_attempts_form_version_id_fkey' AND conrelid = '"survey_attempts"'::regclass
  ) THEN
    ALTER TABLE "survey_attempts" ADD CONSTRAINT "survey_attempts_form_version_id_fkey" FOREIGN KEY ("form_version_id") REFERENCES "form_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'integrity_consents_user_id_fkey' AND conrelid = '"integrity_consents"'::regclass
  ) THEN
    ALTER TABLE "integrity_consents" ADD CONSTRAINT "integrity_consents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'integrity_events_attempt_id_fkey' AND conrelid = '"integrity_events"'::regclass
  ) THEN
    ALTER TABLE "integrity_events" ADD CONSTRAINT "integrity_events_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "survey_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'integrity_events_form_version_id_fkey' AND conrelid = '"integrity_events"'::regclass
  ) THEN
    ALTER TABLE "integrity_events" ADD CONSTRAINT "integrity_events_form_version_id_fkey" FOREIGN KEY ("form_version_id") REFERENCES "form_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'integrity_events_consent_id_fkey' AND conrelid = '"integrity_events"'::regclass
  ) THEN
    ALTER TABLE "integrity_events" ADD CONSTRAINT "integrity_events_consent_id_fkey" FOREIGN KEY ("consent_id") REFERENCES "integrity_consents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'integrity_assessments_attempt_id_fkey' AND conrelid = '"integrity_assessments"'::regclass
  ) THEN
    ALTER TABLE "integrity_assessments" ADD CONSTRAINT "integrity_assessments_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "survey_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'integrity_assessments_response_id_fkey' AND conrelid = '"integrity_assessments"'::regclass
  ) THEN
    ALTER TABLE "integrity_assessments" ADD CONSTRAINT "integrity_assessments_response_id_fkey" FOREIGN KEY ("response_id") REFERENCES "responses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'integrity_assessments_respondent_id_fkey' AND conrelid = '"integrity_assessments"'::regclass
  ) THEN
    ALTER TABLE "integrity_assessments" ADD CONSTRAINT "integrity_assessments_respondent_id_fkey" FOREIGN KEY ("respondent_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'integrity_incidents_respondent_id_fkey' AND conrelid = '"integrity_incidents"'::regclass
  ) THEN
    ALTER TABLE "integrity_incidents" ADD CONSTRAINT "integrity_incidents_respondent_id_fkey" FOREIGN KEY ("respondent_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'integrity_incidents_attempt_id_fkey' AND conrelid = '"integrity_incidents"'::regclass
  ) THEN
    ALTER TABLE "integrity_incidents" ADD CONSTRAINT "integrity_incidents_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "survey_attempts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'integrity_reviews_incident_id_fkey' AND conrelid = '"integrity_reviews"'::regclass
  ) THEN
    ALTER TABLE "integrity_reviews" ADD CONSTRAINT "integrity_reviews_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "integrity_incidents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'integrity_reviews_reviewer_id_fkey' AND conrelid = '"integrity_reviews"'::regclass
  ) THEN
    ALTER TABLE "integrity_reviews" ADD CONSTRAINT "integrity_reviews_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fraud_logs_user_id_fkey' AND conrelid = '"fraud_logs"'::regclass
  ) THEN
    ALTER TABLE "fraud_logs" ADD CONSTRAINT "fraud_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'gamification_stats_user_id_fkey' AND conrelid = '"gamification_stats"'::regclass
  ) THEN
    ALTER TABLE "gamification_stats" ADD CONSTRAINT "gamification_stats_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ===========================================================================
-- SECTION 2: invariants (BEGIN post-push-invariants.sql)
-- ===========================================================================
-- Post-`db push` invariants: database objects Prisma 6 cannot express in
-- schema.prisma (partial unique indexes, CHECK constraints, NULLS NOT
-- DISTINCT) plus the objects earlier migrations only created behind a
-- `to_regclass(...) IS NOT NULL` guard (and therefore skipped on a fresh
-- `prisma migrate deploy`).
--
-- This exact text is also section 2 of migration
-- `20260927040000_reconcile_db_push_tables` (a unit test keeps them equal).
-- Environments built with `prisma db push` must apply it afterwards:
--   npm run prisma:db-push --workspace backend
-- Every statement is unconditional (the tables must exist) and re-runnable.

-- 20260926150000_survey_moderation_decisions: foreign keys to forms and
-- form_versions.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'survey_moderation_decisions_form_id_fkey' AND conrelid = '"survey_moderation_decisions"'::regclass
  ) THEN
    ALTER TABLE "survey_moderation_decisions" ADD CONSTRAINT "survey_moderation_decisions_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "forms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'survey_moderation_decisions_form_version_id_fkey' AND conrelid = '"survey_moderation_decisions"'::regclass
  ) THEN
    ALTER TABLE "survey_moderation_decisions" ADD CONSTRAINT "survey_moderation_decisions_form_version_id_fkey" FOREIGN KEY ("form_version_id") REFERENCES "form_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- 20260926180000_bot_protection_evidence: FraudLog idempotency key and the
-- rolling-window completion index.
ALTER TABLE "fraud_logs" ADD COLUMN IF NOT EXISTS "dedupe_key" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "fraud_logs_dedupe_key_key" ON "fraud_logs"("dedupe_key");
CREATE INDEX IF NOT EXISTS "survey_attempts_respondent_id_status_submitted_at_idx" ON "survey_attempts"("respondent_id", "status", "submitted_at");

-- 20260926200000_survey_feedback: CHECK constraints and foreign keys.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'survey_feedback_rating_range_check' AND conrelid = '"survey_feedback"'::regclass
  ) THEN
    ALTER TABLE "survey_feedback" ADD CONSTRAINT "survey_feedback_rating_range_check" CHECK ("rating" BETWEEN 1 AND 5);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'survey_feedback_comment_length_check' AND conrelid = '"survey_feedback"'::regclass
  ) THEN
    ALTER TABLE "survey_feedback" ADD CONSTRAINT "survey_feedback_comment_length_check" CHECK ("comment" IS NULL OR char_length("comment") BETWEEN 1 AND 500);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'survey_feedback_attempt_id_fkey' AND conrelid = '"survey_feedback"'::regclass
  ) THEN
    ALTER TABLE "survey_feedback" ADD CONSTRAINT "survey_feedback_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "survey_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'survey_feedback_response_id_fkey' AND conrelid = '"survey_feedback"'::regclass
  ) THEN
    ALTER TABLE "survey_feedback" ADD CONSTRAINT "survey_feedback_response_id_fkey" FOREIGN KEY ("response_id") REFERENCES "responses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'survey_feedback_form_id_fkey' AND conrelid = '"survey_feedback"'::regclass
  ) THEN
    ALTER TABLE "survey_feedback" ADD CONSTRAINT "survey_feedback_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "forms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'survey_feedback_form_version_id_fkey' AND conrelid = '"survey_feedback"'::regclass
  ) THEN
    ALTER TABLE "survey_feedback" ADD CONSTRAINT "survey_feedback_form_version_id_fkey" FOREIGN KEY ("form_version_id") REFERENCES "form_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- 20260926220000_form_close_count.
ALTER TABLE "forms" ADD COLUMN IF NOT EXISTS "close_count" INTEGER NOT NULL DEFAULT 0;

-- 20260926230000_participation_concurrency_guards: server-owned
-- completion-code columns and the two partial unique indexes (see the `///`
-- comment on `model SurveyAttempt`).
ALTER TABLE "survey_attempts" ADD COLUMN IF NOT EXISTS "failed_code_verifications" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "survey_attempts" ADD COLUMN IF NOT EXISTS "last_failed_verification_at" TIMESTAMP(3);
ALTER TABLE "survey_attempts" ADD COLUMN IF NOT EXISTS "missing_code_reported_at" TIMESTAMP(3);
ALTER TABLE "survey_attempts" ADD COLUMN IF NOT EXISTS "missing_code_reason" TEXT;

-- Keep only the newest IN_PROGRESS attempt per (respondent, logical Form) so
-- the partial unique index can be built; older ones become ABANDONED.
UPDATE "survey_attempts" AS sa
SET "status" = 'ABANDONED', "updated_at" = CURRENT_TIMESTAMP
FROM (
  SELECT "id",
         ROW_NUMBER() OVER (
           PARTITION BY "respondent_id", "survey_id"
           ORDER BY "started_at" DESC, "id" DESC
         ) AS rn
  FROM "survey_attempts"
  WHERE "status" = 'IN_PROGRESS' AND "respondent_id" IS NOT NULL
) AS ranked
WHERE sa."id" = ranked."id" AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "survey_attempts_one_active_per_account"
  ON "survey_attempts" ("respondent_id", "survey_id")
  WHERE "status" = 'IN_PROGRESS' AND "respondent_id" IS NOT NULL;

-- Completed duplicates cannot be normalized automatically (rewards may have
-- been paid): on dirty data the index is skipped with a WARNING; on a clean
-- or empty table it is always created.
DO $$
DECLARE
  duplicate_completions INTEGER;
BEGIN
  SELECT COUNT(*) INTO duplicate_completions
  FROM (
    SELECT 1
    FROM "survey_attempts"
    WHERE "status" = 'COMPLETED' AND "respondent_id" IS NOT NULL
    GROUP BY "respondent_id", "survey_id"
    HAVING COUNT(*) > 1
  ) AS duplicates;

  IF duplicate_completions = 0 THEN
    CREATE UNIQUE INDEX IF NOT EXISTS "survey_attempts_one_completion_per_account"
      ON "survey_attempts" ("respondent_id", "survey_id")
      WHERE "status" = 'COMPLETED' AND "respondent_id" IS NOT NULL;
  ELSE
    RAISE WARNING 'survey_attempts_one_completion_per_account not created: % (respondent_id, survey_id) pairs have more than one COMPLETED attempt. Resolve them manually, then re-run prisma/sql/post-push-invariants.sql.', duplicate_completions;
  END IF;
END $$;

-- 20260926233000_form_estimated_duration_minutes.
ALTER TABLE "forms" ADD COLUMN IF NOT EXISTS "estimated_duration_minutes" INTEGER;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'forms_estimated_duration_minutes_range' AND conrelid = '"forms"'::regclass
  ) THEN
    ALTER TABLE "forms"
      ADD CONSTRAINT "forms_estimated_duration_minutes_range"
      CHECK (
        "estimated_duration_minutes" IS NULL
        OR "estimated_duration_minutes" BETWEEN 1 AND 1440
      );
  END IF;
END $$;

-- 20260927010000_completion_code_limit_resets: CHECK constraint, foreign keys
-- and the per-(respondent, form version) counter index.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'completion_code_limit_resets_failures_forgiven_positive' AND conrelid = '"completion_code_limit_resets"'::regclass
  ) THEN
    ALTER TABLE "completion_code_limit_resets" ADD CONSTRAINT "completion_code_limit_resets_failures_forgiven_positive" CHECK ("failures_forgiven" > 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'completion_code_limit_resets_respondent_id_fkey' AND conrelid = '"completion_code_limit_resets"'::regclass
  ) THEN
    ALTER TABLE "completion_code_limit_resets" ADD CONSTRAINT "completion_code_limit_resets_respondent_id_fkey" FOREIGN KEY ("respondent_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'completion_code_limit_resets_reset_by_id_fkey' AND conrelid = '"completion_code_limit_resets"'::regclass
  ) THEN
    ALTER TABLE "completion_code_limit_resets" ADD CONSTRAINT "completion_code_limit_resets_reset_by_id_fkey" FOREIGN KEY ("reset_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'completion_code_limit_resets_form_version_id_fkey' AND conrelid = '"completion_code_limit_resets"'::regclass
  ) THEN
    ALTER TABLE "completion_code_limit_resets" ADD CONSTRAINT "completion_code_limit_resets_form_version_id_fkey" FOREIGN KEY ("form_version_id") REFERENCES "form_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "survey_attempts_respondent_id_form_version_id_idx" ON "survey_attempts"("respondent_id", "form_version_id");

-- 20260927020000_form_close_kind.
DO $$ BEGIN
  CREATE TYPE "FormCloseKind" AS ENUM ('OWNER', 'ADMIN', 'MODERATION');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
ALTER TABLE "forms" ADD COLUMN IF NOT EXISTS "close_kind" "FormCloseKind";

-- 20260924120000_harden_double_entry_ledger: one balance projection per
-- (owner, class, currency) with system accounts (user_id NULL) included.
-- `@@unique` in schema.prisma cannot say NULLS NOT DISTINCT, so `db push`
-- builds the index without it; rebuild it in place. Duplicate system accounts
-- (same class and currency, user_id NULL) would make the rebuild fail and
-- abort the whole file, so they are counted first: on dirty data the existing
-- index is kept and a WARNING names the rows to merge.
DO $$
DECLARE
  duplicate_ledger_accounts INTEGER;
BEGIN
  SELECT COUNT(*) INTO duplicate_ledger_accounts
  FROM (
    SELECT 1
    FROM "ledger_accounts"
    GROUP BY "user_id", "account_class", "currency"
    HAVING COUNT(*) > 1
  ) AS duplicates;

  IF duplicate_ledger_accounts = 0 THEN
    IF EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = current_schema()
        AND indexname = 'ledger_accounts_user_id_account_class_currency_key'
        AND indexdef NOT ILIKE '%NULLS NOT DISTINCT%'
    ) THEN
      DROP INDEX "ledger_accounts_user_id_account_class_currency_key";
    END IF;
    CREATE UNIQUE INDEX IF NOT EXISTS "ledger_accounts_user_id_account_class_currency_key"
      ON "ledger_accounts"("user_id", "account_class", "currency") NULLS NOT DISTINCT;
  ELSE
    RAISE WARNING 'ledger_accounts_user_id_account_class_currency_key not rebuilt with NULLS NOT DISTINCT: % (user_id, account_class, currency) groups have more than one ledger_accounts row (system accounts with user_id NULL). List them with SELECT account_class, currency, array_agg(id ORDER BY created_at) FROM ledger_accounts GROUP BY user_id, account_class, currency HAVING COUNT(*) > 1; merge each group into its oldest account, then re-run prisma/sql/post-push-invariants.sql. The existing index is kept.', duplicate_ledger_accounts;
  END IF;
END $$;
-- ===========================================================================
-- END post-push-invariants.sql
-- ===========================================================================
