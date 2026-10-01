-- Plan 2.2: the wizard's "Chủ đề" (topic) is persisted instead of dropped.
-- Nullable free text: the allowed values are validated in the application
-- layer against the shared topic list in @rescom/schemas, so adding a topic
-- needs no migration. A survey created before this column reads as NULL.
--
-- No index: the Explore feed searches topic together with the title as text,
-- and no query filters on topic equality yet.
--
-- Expand-only and re-runnable; "forms" exists for certain after
-- 20260927040000_reconcile_db_push_tables.

-- AlterTable
ALTER TABLE "forms" ADD COLUMN IF NOT EXISTS "topic" TEXT;
