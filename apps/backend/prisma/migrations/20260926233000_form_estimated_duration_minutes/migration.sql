-- Code-review decision E6-D2 (2026-09-26): the FR-14 reward pricing band is
-- chosen from the Publisher's estimated completion time and enforced when a
-- survey is published (drafts stay editable). "estimated_duration_minutes"
-- is optional (NULL on drafts and on existing rows); publishing a rewarded
-- survey requires it. Whole minutes, 1..1440 (enforced by the shared Zod
-- schemas on every write path; the CHECK constraint is defense in depth).
-- "forms" is not created by an earlier migration (it may come from
-- `prisma db push`), so every statement is drift-tolerant and re-runnable.

DO $$ BEGIN
  IF to_regclass('public.forms') IS NOT NULL THEN
    ALTER TABLE "forms" ADD COLUMN IF NOT EXISTS "estimated_duration_minutes" INTEGER;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'forms_estimated_duration_minutes_range'
    ) THEN
      ALTER TABLE "forms"
        ADD CONSTRAINT "forms_estimated_duration_minutes_range"
        CHECK (
          "estimated_duration_minutes" IS NULL
          OR "estimated_duration_minutes" BETWEEN 1 AND 1440
        );
    END IF;
  END IF;
END $$;
