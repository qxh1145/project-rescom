-- Code-review decision E8-D1 (2026-09-26, option B): the Form lifecycle
-- transition table is signed off and Admin takedowns are final. Every close
-- records who closed the survey in "close_kind" (written by the same
-- conditional update as the CLOSED transition and "close_count"):
--   OWNER      — the Publisher closed their survey or withdrew it from the
--                moderation queue;
--   ADMIN      — an Admin took down someone else's survey;
--   MODERATION — an Admin rejected the queued version (Story 8.1).
-- Reopening (CLOSED -> PUBLISHED with additional quota) is allowed only after
-- an OWNER close; otherwise the API answers 409 FORM_NOT_REOPENABLE.
--
-- No backfill: rows closed before this column existed keep NULL, which is not
-- proven to be the owner's close and therefore is not reopenable (fail
-- closed; no production data exists yet).
--
-- "forms" is not created by an earlier migration (it may come from
-- `prisma db push`), so every statement is drift-tolerant and re-runnable.

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "FormCloseKind" AS ENUM ('OWNER', 'ADMIN', 'MODERATION');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  IF to_regclass('public.forms') IS NOT NULL THEN
    ALTER TABLE "forms" ADD COLUMN IF NOT EXISTS "close_kind" "FormCloseKind";
  END IF;
END $$;
