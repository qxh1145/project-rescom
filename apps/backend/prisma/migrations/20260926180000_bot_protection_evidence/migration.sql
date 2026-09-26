-- Story 8.2: Automated Bot Protection (FR-28, FR-45, FR-46, FR-47, NFR-4).
-- 1. FraudLog evidence idempotency: one TIME_BARRIER row per attempt and one
--    RATE_LIMIT row per window (`dedupe_key`, unique, NULL for legacy rows).
--    FraudLog stays append-only: writers use INSERT ... ON CONFLICT DO NOTHING.
-- 2. Index for the PostgreSQL-authoritative rolling-window completion count.
-- "fraud_logs" and "survey_attempts" are not created by an earlier migration
-- (they come from `prisma db push`), so every statement is drift-tolerant and
-- re-runnable.

DO $$ BEGIN
  IF to_regclass('public.fraud_logs') IS NOT NULL THEN
    ALTER TABLE "fraud_logs" ADD COLUMN IF NOT EXISTS "dedupe_key" TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS "fraud_logs_dedupe_key_key" ON "fraud_logs"("dedupe_key");
  END IF;
  IF to_regclass('public.survey_attempts') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS "survey_attempts_respondent_id_status_submitted_at_idx" ON "survey_attempts"("respondent_id", "status", "submitted_at");
  END IF;
END $$;
