-- Story IR.4a AC9 (NFR-1, NFR-30): read indexes for the Publisher progress,
-- responses and analytics endpoints.
--   * responses_version_completed_feed_idx: cursor feed of completed
--     responses of one version, newest first (submitted_at DESC, id DESC).
--   * responses_form_completed_submitted_idx: completed responses of one
--     form by submission time (analytics window, time buckets).
--   * survey_attempts_survey_id_status_submitted_at_idx: progress buckets
--     and completed counts per survey (also declared in schema.prisma as
--     @@index([surveyId, status, submittedAt])).
--
-- The two partial indexes cannot be expressed in Prisma 6 (no WHERE clause);
-- they are documented on `model Response` and are intentionally absent from
-- `prisma db push` databases and from prisma/sql/post-push-invariants.sql
-- (db push is not a promotion path). `prisma migrate diff` does not report
-- them as drift.
--
-- Expand-only and re-runnable; "responses" and "survey_attempts" exist for
-- certain after 20260927040000_reconcile_db_push_tables.

-- CreateIndex
CREATE INDEX IF NOT EXISTS "responses_version_completed_feed_idx"
  ON "responses"("form_version_id", "submitted_at" DESC, "id" DESC)
  WHERE "status" IN ('SUBMITTED', 'VALIDATED');

CREATE INDEX IF NOT EXISTS "responses_form_completed_submitted_idx"
  ON "responses"("form_id", "submitted_at")
  WHERE "status" IN ('SUBMITTED', 'VALIDATED');

CREATE INDEX IF NOT EXISTS "survey_attempts_survey_id_status_submitted_at_idx"
  ON "survey_attempts"("survey_id", "status", "submitted_at");
