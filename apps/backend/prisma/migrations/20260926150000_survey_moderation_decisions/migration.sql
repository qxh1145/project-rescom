-- Story 8.1: Survey Moderation Queue (FR-20, FR-53, AD-16).
-- One Admin moderation decision per submitted FormVersion. The "forms" and
-- "form_versions" tables are not created by any earlier migration (they come
-- from `prisma db push`), so the foreign keys to them are only added when the
-- tables exist. Every statement is drift-tolerant and re-runnable.
--
-- No data migration: legacy ESCROW_LOCKED forms keep their status. An Admin can
-- move one into MODERATION_QUEUE through POST /forms/:id/status only when it
-- passes the publish validations and its Escrow is fully reserved (Epic 8
-- review P2: otherwise 409 MODERATION_ESCROW_NOT_FUNDED; close it instead).
--
-- Decisions are append-only admin-action audit rows: the foreign keys are
-- ON DELETE RESTRICT (Epic 8 review P13), never CASCADE.

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "SurveyModerationOutcome" AS ENUM ('APPROVED', 'REJECTED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "survey_moderation_decisions" (
    "id" UUID NOT NULL,
    "form_id" UUID NOT NULL,
    "form_version_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "outcome" "SurveyModerationOutcome" NOT NULL,
    "admin_id" UUID NOT NULL,
    "reason" TEXT,
    "refund_amount" INTEGER NOT NULL DEFAULT 0,
    "refund_journal_id" UUID,
    "correlation_id" UUID NOT NULL,
    "decided_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "survey_moderation_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "survey_moderation_decisions_form_version_id_key" ON "survey_moderation_decisions"("form_version_id");
CREATE INDEX IF NOT EXISTS "survey_moderation_decisions_form_id_decided_at_idx" ON "survey_moderation_decisions"("form_id", "decided_at");
CREATE INDEX IF NOT EXISTS "survey_moderation_decisions_admin_id_decided_at_idx" ON "survey_moderation_decisions"("admin_id", "decided_at");

-- AddForeignKey
ALTER TABLE "survey_moderation_decisions" DROP CONSTRAINT IF EXISTS "survey_moderation_decisions_admin_id_fkey";
ALTER TABLE "survey_moderation_decisions" ADD CONSTRAINT "survey_moderation_decisions_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

DO $$ BEGIN
  IF to_regclass('public.forms') IS NOT NULL THEN
    ALTER TABLE "survey_moderation_decisions" DROP CONSTRAINT IF EXISTS "survey_moderation_decisions_form_id_fkey";
    ALTER TABLE "survey_moderation_decisions" ADD CONSTRAINT "survey_moderation_decisions_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "forms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF to_regclass('public.form_versions') IS NOT NULL THEN
    ALTER TABLE "survey_moderation_decisions" DROP CONSTRAINT IF EXISTS "survey_moderation_decisions_form_version_id_fkey";
    ALTER TABLE "survey_moderation_decisions" ADD CONSTRAINT "survey_moderation_decisions_form_version_id_fkey" FOREIGN KEY ("form_version_id") REFERENCES "form_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
