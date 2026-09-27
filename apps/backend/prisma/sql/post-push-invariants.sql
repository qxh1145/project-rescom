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
