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

-- Rewards 12.7: same checks, partial indexes, and immutability triggers as migration.
INSERT INTO "voucher_brands" ("id", "name") VALUES
  ('highlands', 'Highlands Coffee'), ('lotteria', 'Lotteria'),
  ('phuc-long', 'Phúc Long'), ('kfc', 'KFC'),
  ('gong-cha', 'Gong Cha'), ('the-coffee-house', 'The Coffee House')
ON CONFLICT DO NOTHING;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'voucher_brands_slug_check' AND conrelid = '"voucher_brands"'::regclass) THEN
    ALTER TABLE "voucher_brands" ADD CONSTRAINT "voucher_brands_slug_check" CHECK ("id" ~ '^[a-z0-9-]{2,40}$');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vouchers_values_check' AND conrelid = '"vouchers"'::regclass) THEN
    ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_values_check" CHECK (
  "value_vnd" > 0 AND "base_points" > 0 AND
  ("promo_points" IS NULL OR ("promo_points" > 0 AND "promo_points" < "base_points")) AND
  "price_version" >= 1 AND "stock_total" >= 0 AND
  "stock_remaining" BETWEEN 0 AND "stock_total" AND
  "redeem_ends_at" > "redeem_starts_at" AND
  "code_expires_at" >= "redeem_ends_at" + INTERVAL '7 days'
);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'voucher_price_versions_values_check' AND conrelid = '"voucher_price_versions"'::regclass) THEN
    ALTER TABLE "voucher_price_versions" ADD CONSTRAINT "voucher_price_versions_values_check" CHECK (
  "version" >= 1 AND "base_points" > 0 AND
  ("promo_points" IS NULL OR ("promo_points" > 0 AND "promo_points" < "base_points"))
);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'flash_sales_window_check' AND conrelid = '"flash_sales"'::regclass) THEN
    ALTER TABLE "flash_sales" ADD CONSTRAINT "flash_sales_window_check" CHECK ("ends_at" > "starts_at");
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'flash_sale_items_values_check' AND conrelid = '"flash_sale_items"'::regclass) THEN
    ALTER TABLE "flash_sale_items" ADD CONSTRAINT "flash_sale_items_values_check" CHECK (
  "flash_points" > 0 AND "quota" > 0 AND "sold" BETWEEN 0 AND "quota" AND "per_user_cap" >= 1
);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'redemption_quotes_price_check' AND conrelid = '"redemption_quotes"'::regclass) THEN
    ALTER TABLE "redemption_quotes" ADD CONSTRAINT "redemption_quotes_price_check" CHECK ("price_version" >= 1 AND "price_points" > 0);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'redemptions_price_check' AND conrelid = '"redemptions"'::regclass) THEN
    ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_price_check" CHECK ("price_version" >= 1 AND "price_points" > 0);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "voucher_codes_unissued_idx" ON "voucher_codes"("voucher_id") WHERE "redemption_id" IS NULL;
CREATE INDEX IF NOT EXISTS "redemptions_voucher_id_created_at_idx" ON "redemptions"("voucher_id", "created_at" DESC);
CREATE UNIQUE INDEX IF NOT EXISTS "code_issue_reports_open_redemption_key" ON "code_issue_reports"("redemption_id") WHERE "status" = 'OPEN';

CREATE OR REPLACE FUNCTION "prevent_rewards_history_mutation"() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'rewards history is append-only' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "voucher_price_versions_append_only" ON "voucher_price_versions";
CREATE TRIGGER "voucher_price_versions_append_only" BEFORE UPDATE OR DELETE ON "voucher_price_versions"
  FOR EACH ROW EXECUTE FUNCTION "prevent_rewards_history_mutation"();
DROP TRIGGER IF EXISTS "voucher_price_versions_no_truncate" ON "voucher_price_versions";
CREATE TRIGGER "voucher_price_versions_no_truncate" BEFORE TRUNCATE ON "voucher_price_versions"
  FOR EACH STATEMENT EXECUTE FUNCTION "prevent_rewards_history_mutation"();
DROP TRIGGER IF EXISTS "redemptions_append_only" ON "redemptions";
CREATE TRIGGER "redemptions_append_only" BEFORE UPDATE OR DELETE ON "redemptions"
  FOR EACH ROW EXECUTE FUNCTION "prevent_rewards_history_mutation"();
DROP TRIGGER IF EXISTS "redemptions_no_truncate" ON "redemptions";
CREATE TRIGGER "redemptions_no_truncate" BEFORE TRUNCATE ON "redemptions"
  FOR EACH STATEMENT EXECUTE FUNCTION "prevent_rewards_history_mutation"();

-- Rewards 12.8: rewards_settings, redemption status invariants, partial quote index
INSERT INTO "rewards_settings" ("id", "daily_points_limit", "updated_at")
VALUES (1, 500, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rewards_settings_id_check' AND conrelid = '"rewards_settings"'::regclass) THEN
    ALTER TABLE "rewards_settings" ADD CONSTRAINT "rewards_settings_id_check" CHECK ("id" = 1);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rewards_settings_daily_limit_check' AND conrelid = '"rewards_settings"'::regclass) THEN
    ALTER TABLE "rewards_settings" ADD CONSTRAINT "rewards_settings_daily_limit_check" CHECK ("daily_points_limit" > 0);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'redemptions_status_succeeded_check' AND conrelid = '"redemptions"'::regclass) THEN
    ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_status_succeeded_check" CHECK (
      "status" != 'SUCCEEDED' OR (
        "journal_id" IS NOT NULL AND
        "balance_after" IS NOT NULL
      )
    ) NOT VALID;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'redemptions_status_failed_check' AND conrelid = '"redemptions"'::regclass) THEN
    ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_status_failed_check" CHECK (
      "status" != 'FAILED' OR (
        "journal_id" IS NULL AND
        "failure_code" IS NOT NULL
      )
    ) NOT VALID;
  END IF;
END $$;
CREATE OR REPLACE FUNCTION "redemptions_succeeded_code_check"() RETURNS TRIGGER AS $$
BEGIN
  IF NEW."status" = 'SUCCEEDED' AND NEW."voucher_code_id" IS NULL AND NOT EXISTS (
    SELECT 1 FROM "vouchers" WHERE "id" = NEW."voucher_id" AND "is_shared_code"
  ) THEN
    RAISE EXCEPTION 'SUCCEEDED redemption needs a voucher code or a shared-code voucher' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "redemptions_succeeded_code_check" ON "redemptions";
CREATE TRIGGER "redemptions_succeeded_code_check" BEFORE INSERT ON "redemptions"
  FOR EACH ROW EXECUTE FUNCTION "redemptions_succeeded_code_check"();
CREATE UNIQUE INDEX IF NOT EXISTS "redemptions_quote_id_succeeded_key" ON "redemptions"("quote_id") WHERE "status" = 'SUCCEEDED';
CREATE INDEX IF NOT EXISTS "redemptions_user_id_created_at_idx" ON "redemptions"("user_id", "created_at" DESC);

-- Rewards 12.9: flash_sales reserved_at check, partial indexes
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'flash_sales_reserved_at_check' AND conrelid = '"flash_sales"'::regclass) THEN
    ALTER TABLE "flash_sales" ADD CONSTRAINT "flash_sales_reserved_at_check" CHECK ("reserved_at" IS NULL OR "reserved_at" >= "starts_at");
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "flash_sales_starts_at_due_idx" ON "flash_sales"("starts_at") WHERE "reserved_at" IS NULL AND "settled_at" IS NULL;
CREATE INDEX IF NOT EXISTS "flash_sales_ends_at_due_idx" ON "flash_sales"("ends_at") WHERE "reserved_at" IS NOT NULL AND "settled_at" IS NULL;

-- Rewards 12.10: my vouchers, reminders & faulty-code resolution
DROP INDEX IF EXISTS "voucher_codes_unissued_idx";
CREATE INDEX IF NOT EXISTS "voucher_codes_unissued_idx" ON "voucher_codes"("voucher_id") WHERE "redemption_id" IS NULL AND "issue_report_id" IS NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'voucher_codes_assignment_mutual_exclusion' AND conrelid = '"voucher_codes"'::regclass) THEN
    ALTER TABLE "voucher_codes" ADD CONSTRAINT "voucher_codes_assignment_mutual_exclusion" CHECK (
      NOT ("redemption_id" IS NOT NULL AND "issue_report_id" IS NOT NULL)
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'code_issue_reports_resolution_note_length_check' AND conrelid = '"code_issue_reports"'::regclass) THEN
    ALTER TABLE "code_issue_reports" ADD CONSTRAINT "code_issue_reports_resolution_note_length_check" CHECK (
      "resolution_note" IS NULL OR char_length("resolution_note") <= 500
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'code_issue_reports_outcome_shape_check' AND conrelid = '"code_issue_reports"'::regclass) THEN
    ALTER TABLE "code_issue_reports" ADD CONSTRAINT "code_issue_reports_outcome_shape_check" CHECK (
      (
        "status" = 'OPEN' AND
        "replacement_code_id" IS NULL AND
        "refund_journal_id" IS NULL AND
        "resolved_by_id" IS NULL AND
        "resolved_at" IS NULL
      ) OR (
        "status" = 'REPLACED' AND
        "replacement_code_id" IS NOT NULL AND
        "refund_journal_id" IS NULL AND
        "resolved_by_id" IS NOT NULL AND
        "resolved_at" IS NOT NULL
      ) OR (
        "status" = 'REFUNDED' AND
        "replacement_code_id" IS NULL AND
        "refund_journal_id" IS NOT NULL AND
        "resolved_by_id" IS NOT NULL AND
        "resolved_at" IS NOT NULL
      ) OR (
        "status" = 'REJECTED' AND
        "replacement_code_id" IS NULL AND
        "refund_journal_id" IS NULL AND
        "resolved_at" IS NOT NULL
      )
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'redemption_usages_undo_until_check' AND conrelid = '"redemption_usages"'::regclass) THEN
    ALTER TABLE "redemption_usages" ADD CONSTRAINT "redemption_usages_undo_until_check" CHECK (
      "undo_until" = "used_at" + INTERVAL '24 hours'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'redemption_refunds_points_positive_check' AND conrelid = '"redemption_refunds"'::regclass) THEN
    ALTER TABLE "redemption_refunds" ADD CONSTRAINT "redemption_refunds_points_positive_check" CHECK ("points" > 0);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'redemption_reminders_window_check' AND conrelid = '"redemption_reminders"'::regclass) THEN
    ALTER TABLE "redemption_reminders" ADD CONSTRAINT "redemption_reminders_window_check" CHECK (
      "window" IN ('7D', '1D')
    );
  END IF;
END $$;

DROP TRIGGER IF EXISTS "redemption_refunds_append_only" ON "redemption_refunds";
CREATE TRIGGER "redemption_refunds_append_only" BEFORE UPDATE OR DELETE ON "redemption_refunds"
  FOR EACH ROW EXECUTE FUNCTION "prevent_rewards_history_mutation"();

DROP TRIGGER IF EXISTS "redemption_refunds_no_truncate" ON "redemption_refunds";
CREATE TRIGGER "redemption_refunds_no_truncate" BEFORE TRUNCATE ON "redemption_refunds"
  FOR EACH STATEMENT EXECUTE FUNCTION "prevent_rewards_history_mutation"();

