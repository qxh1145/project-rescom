-- Story IR.2a (API-03, decision Q8): every ABANDONED survey attempt records
-- why it closed. "closed_reason" is CANCELLED when the Respondent cancels it
-- (`POST /attempts/:attemptId/cancel`) and EXPIRED when the lazy expiry inside
-- an attempt start — and later IR.2b's reservation-expiry job — abandons it;
-- "closed_at" is when that transition was written (a cancel replay returns it
-- unchanged).
--
-- Expand-only: both columns are nullable and there is no backfill. Rows
-- abandoned before this migration keep NULL, and clients fall back to their
-- `expiresAt` rule. No index: the columns are only read with their row.
--
-- "survey_attempts" exists for certain after
-- 20260927040000_reconcile_db_push_tables, so no to_regclass guard is needed;
-- every statement is re-runnable.

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "AttemptCloseReason" AS ENUM ('EXPIRED', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "survey_attempts" ADD COLUMN IF NOT EXISTS "closed_reason" "AttemptCloseReason";
ALTER TABLE "survey_attempts" ADD COLUMN IF NOT EXISTS "closed_at" TIMESTAMP(3);
