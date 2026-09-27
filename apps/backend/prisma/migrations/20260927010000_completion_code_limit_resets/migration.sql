-- Code-review decision E5-D1 (2026-09-26, option B): cumulative
-- completion-code limit per account and FormVersion
-- (`completion-code-policy-v1`: 3 wrong codes lock an attempt, 6 per account
-- and FormVersion refuse further attempts; values provisional pending PRD
-- Open Question 14). The count is SUM("survey_attempts"."failed_code_verifications")
-- (the server-owned counter of Epic 5 review P2) minus the wrong codes
-- forgiven by an Admin in this append-only table (who, when, why, how many).
--
-- "users", "form_versions" and "survey_attempts" are not all created by an
-- earlier migration (they may come from `prisma db push`), so every statement
-- is drift-tolerant and re-runnable.

CREATE TABLE IF NOT EXISTS "completion_code_limit_resets" (
    "id" UUID NOT NULL,
    "respondent_id" UUID NOT NULL,
    "form_version_id" UUID NOT NULL,
    "failures_forgiven" INTEGER NOT NULL,
    "reset_by_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "policy_version" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "completion_code_limit_resets_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "completion_code_limit_resets_failures_forgiven_positive"
      CHECK ("failures_forgiven" > 0)
);

CREATE INDEX IF NOT EXISTS "completion_code_limit_resets_respondent_id_form_version_id_idx"
  ON "completion_code_limit_resets"("respondent_id", "form_version_id");

DO $$ BEGIN
  IF to_regclass('public.users') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'completion_code_limit_resets_respondent_id_fkey'
  ) THEN
    ALTER TABLE "completion_code_limit_resets"
      ADD CONSTRAINT "completion_code_limit_resets_respondent_id_fkey"
      FOREIGN KEY ("respondent_id") REFERENCES "users"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF to_regclass('public.users') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'completion_code_limit_resets_reset_by_id_fkey'
  ) THEN
    ALTER TABLE "completion_code_limit_resets"
      ADD CONSTRAINT "completion_code_limit_resets_reset_by_id_fkey"
      FOREIGN KEY ("reset_by_id") REFERENCES "users"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF to_regclass('public.form_versions') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'completion_code_limit_resets_form_version_id_fkey'
  ) THEN
    ALTER TABLE "completion_code_limit_resets"
      ADD CONSTRAINT "completion_code_limit_resets_form_version_id_fkey"
      FOREIGN KEY ("form_version_id") REFERENCES "form_versions"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  -- The summed counter is read per (respondent, form version).
  IF to_regclass('public.survey_attempts') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS "survey_attempts_respondent_id_form_version_id_idx"
      ON "survey_attempts"("respondent_id", "form_version_id");
  END IF;
END $$;
