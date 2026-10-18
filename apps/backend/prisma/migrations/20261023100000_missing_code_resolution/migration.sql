-- Story 14.1: Missing-code report resolution fields, constraints, relations

-- CreateEnum
CREATE TYPE "MissingCodeResolution" AS ENUM ('CREDIT_RESPONDENT', 'DISMISSED');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'MISSING_CODE_REPORT_RESOLVED';

-- AlterTable
ALTER TABLE "survey_attempts"
  ADD COLUMN "missing_code_resolved_at" TIMESTAMP(3),
  ADD COLUMN "missing_code_resolution" "MissingCodeResolution",
  ADD COLUMN "missing_code_resolution_note" VARCHAR(500),
  ADD COLUMN "missing_code_resolved_by" UUID;

-- AddForeignKey
ALTER TABLE "survey_attempts" ADD CONSTRAINT "survey_attempts_missing_code_resolved_by_fkey" FOREIGN KEY ("missing_code_resolved_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Constraints
ALTER TABLE "survey_attempts"
  ADD CONSTRAINT "survey_attempts_missing_code_resolution_consistent" CHECK (
    ("missing_code_resolved_at" IS NULL AND "missing_code_resolution" IS NULL AND "missing_code_resolution_note" IS NULL AND "missing_code_resolved_by" IS NULL)
    OR
    ("missing_code_resolved_at" IS NOT NULL AND "missing_code_resolution" IS NOT NULL AND "missing_code_resolution_note" IS NOT NULL AND "missing_code_resolved_by" IS NOT NULL AND "missing_code_reported_at" IS NOT NULL)
  );
