-- Story 9.2: Respondent Post-Completion Feedback (FR-43).
-- Participation-owned "survey_feedback": at most one feedback per completed
-- attempt (unique attempt_id). Rows start PENDING; only ACCEPTED feedback is
-- ever aggregated into Survey Quality (Phase 2).
-- "FormType", "forms", "form_versions", "survey_attempts" and "responses" are
-- not created by an earlier migration (they may come from `prisma db push`),
-- so every statement is drift-tolerant and re-runnable.

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "FormType" AS ENUM ('INTERNAL', 'EXTERNAL');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "SurveyFeedbackIssueTag" AS ENUM (
    'UNCLEAR_QUESTIONS',
    'LONGER_THAN_ESTIMATED',
    'MISLEADING_DESCRIPTION',
    'TECHNICAL_ISSUE'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "SurveyFeedbackValidationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXCLUDED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "survey_feedback" (
    "id" UUID NOT NULL,
    "attempt_id" UUID NOT NULL,
    "response_id" UUID,
    "form_id" UUID NOT NULL,
    "form_version_id" UUID NOT NULL,
    "respondent_id" UUID NOT NULL,
    "form_type" "FormType" NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "issue_tags" "SurveyFeedbackIssueTag"[] DEFAULT ARRAY[]::"SurveyFeedbackIssueTag"[],
    "validation_status" "SurveyFeedbackValidationStatus" NOT NULL DEFAULT 'PENDING',
    "validated_at" TIMESTAMP(3),
    "submitted_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "survey_feedback_pkey" PRIMARY KEY ("id")
);

-- Constraints Prisma cannot express (FR-43: 5-star rating, bounded plain text).
ALTER TABLE "survey_feedback" DROP CONSTRAINT IF EXISTS "survey_feedback_rating_range_check";
ALTER TABLE "survey_feedback" ADD CONSTRAINT "survey_feedback_rating_range_check" CHECK ("rating" BETWEEN 1 AND 5);
ALTER TABLE "survey_feedback" DROP CONSTRAINT IF EXISTS "survey_feedback_comment_length_check";
ALTER TABLE "survey_feedback" ADD CONSTRAINT "survey_feedback_comment_length_check" CHECK ("comment" IS NULL OR char_length("comment") BETWEEN 1 AND 500);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "survey_feedback_attempt_id_key" ON "survey_feedback"("attempt_id");
CREATE UNIQUE INDEX IF NOT EXISTS "survey_feedback_response_id_key" ON "survey_feedback"("response_id");
CREATE INDEX IF NOT EXISTS "survey_feedback_form_id_validation_status_idx" ON "survey_feedback"("form_id", "validation_status");
CREATE INDEX IF NOT EXISTS "survey_feedback_form_version_id_validation_status_idx" ON "survey_feedback"("form_version_id", "validation_status");
CREATE INDEX IF NOT EXISTS "survey_feedback_respondent_id_submitted_at_idx" ON "survey_feedback"("respondent_id", "submitted_at");

-- AddForeignKey
ALTER TABLE "survey_feedback" DROP CONSTRAINT IF EXISTS "survey_feedback_respondent_id_fkey";
ALTER TABLE "survey_feedback" ADD CONSTRAINT "survey_feedback_respondent_id_fkey" FOREIGN KEY ("respondent_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DO $$ BEGIN
  IF to_regclass('public.survey_attempts') IS NOT NULL THEN
    ALTER TABLE "survey_feedback" DROP CONSTRAINT IF EXISTS "survey_feedback_attempt_id_fkey";
    ALTER TABLE "survey_feedback" ADD CONSTRAINT "survey_feedback_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "survey_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF to_regclass('public.responses') IS NOT NULL THEN
    ALTER TABLE "survey_feedback" DROP CONSTRAINT IF EXISTS "survey_feedback_response_id_fkey";
    ALTER TABLE "survey_feedback" ADD CONSTRAINT "survey_feedback_response_id_fkey" FOREIGN KEY ("response_id") REFERENCES "responses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF to_regclass('public.forms') IS NOT NULL THEN
    ALTER TABLE "survey_feedback" DROP CONSTRAINT IF EXISTS "survey_feedback_form_id_fkey";
    ALTER TABLE "survey_feedback" ADD CONSTRAINT "survey_feedback_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "forms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF to_regclass('public.form_versions') IS NOT NULL THEN
    ALTER TABLE "survey_feedback" DROP CONSTRAINT IF EXISTS "survey_feedback_form_version_id_fkey";
    ALTER TABLE "survey_feedback" ADD CONSTRAINT "survey_feedback_form_version_id_fkey" FOREIGN KEY ("form_version_id") REFERENCES "form_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
