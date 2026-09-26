-- Epic 5 code review (P1 + P2): survey-attempt concurrency guards and
-- server-owned completion-code security state.
--
-- P2: the 3-strike completion-code counter and the missing-code marker used to
--     live in the client-writable `client_context` JSON. They move to
--     server-owned columns; the old keys are backfilled (trustworthy sources
--     only) and stripped from `client_context`.
-- P1: partial unique indexes back the `forms` row lock taken at attempt
--     start: one IN_PROGRESS attempt and one COMPLETED attempt per account
--     and logical Form. Prisma 6 cannot model partial indexes (see the `///`
--     comment on `model SurveyAttempt`); environments built with
--     `prisma db push` must also apply this SQL.
--
-- "survey_attempts" and "outbox_events" are not created by an earlier
-- migration (they may come from `prisma db push`), so every statement is
-- drift-tolerant and re-runnable.

DO $$
DECLARE
  duplicate_completions INTEGER;
BEGIN
  IF to_regclass('public.survey_attempts') IS NOT NULL THEN
    -- P2 step 1: server-owned security columns.
    ALTER TABLE "survey_attempts" ADD COLUMN IF NOT EXISTS "failed_code_verifications" INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE "survey_attempts" ADD COLUMN IF NOT EXISTS "last_failed_verification_at" TIMESTAMP(3);
    ALTER TABLE "survey_attempts" ADD COLUMN IF NOT EXISTS "missing_code_reported_at" TIMESTAMP(3);
    ALTER TABLE "survey_attempts" ADD COLUMN IF NOT EXISTS "missing_code_reason" TEXT;

    -- Backfill the strike counter from numeric JSON values only, clamped to
    -- 0..3 (a client could have seeded any value).
    UPDATE "survey_attempts"
    SET "failed_code_verifications" =
      LEAST(3, GREATEST(0, FLOOR(("client_context"->>'failedVerifications')::numeric)))::INTEGER
    WHERE "client_context" IS NOT NULL
      AND jsonb_typeof("client_context") = 'object'
      AND jsonb_typeof("client_context"->'failedVerifications') = 'number'
      AND "failed_code_verifications" = 0;

    -- Backfill the missing-code marker from the Outbox rows only (the JSON
    -- marker could have been pre-seeded by the client).
    IF to_regclass('public.outbox_events') IS NOT NULL THEN
      UPDATE "survey_attempts" AS sa
      SET "missing_code_reported_at" = oe."created_at",
          "missing_code_reason" = COALESCE(sa."missing_code_reason", oe."payload"->>'reason')
      FROM "outbox_events" AS oe
      WHERE oe."idempotency_key" = 'missing-code-report:' || sa."id"::TEXT
        AND sa."missing_code_reported_at" IS NULL;
    END IF;

    -- Strip the legacy server keys from the client-owned JSON.
    UPDATE "survey_attempts"
    SET "client_context" = "client_context" - 'failedVerifications' - 'lastFailedAt' - 'reportedMissingCode'
    WHERE "client_context" IS NOT NULL
      AND jsonb_typeof("client_context") = 'object'
      AND "client_context" ?| ARRAY['failedVerifications', 'lastFailedAt', 'reportedMissingCode'];

    -- P1: normalize existing duplicates — keep only the newest IN_PROGRESS
    -- attempt per (respondent, logical Form); older ones become ABANDONED.
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

    -- Completed duplicates cannot be normalized automatically (rewards may
    -- have been paid): create the index only when none exist.
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
      RAISE WARNING 'survey_attempts_one_completion_per_account not created: % (respondent_id, survey_id) pairs have more than one COMPLETED attempt. Resolve them manually, then create the index.', duplicate_completions;
    END IF;
  END IF;
END $$;
