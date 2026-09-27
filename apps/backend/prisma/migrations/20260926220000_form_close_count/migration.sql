-- Epic 6 code review (P3): every close/reopen cycle of a survey needs its own
-- Escrow journal. "close_count" counts how many times the form entered
-- CLOSED and is the close identity of the idempotency keys
-- `close-refund:{formId}:c{closeCount}` and `reopen-escrow:{formId}:c{closeCount}`
-- (the `c` prefix never collides with the legacy `{versionNumber}` keys).
-- "forms" is not created by an earlier migration (it may come from
-- `prisma db push`), so the statement is drift-tolerant and re-runnable.
-- Existing rows start at 0: their next close uses `c1`.

DO $$ BEGIN
  IF to_regclass('public.forms') IS NOT NULL THEN
    ALTER TABLE "forms" ADD COLUMN IF NOT EXISTS "close_count" INTEGER NOT NULL DEFAULT 0;
  END IF;
END $$;
