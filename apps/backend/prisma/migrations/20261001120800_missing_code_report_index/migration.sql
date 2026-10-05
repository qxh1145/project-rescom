-- Plan 4.1 follow-up: the Admin overview counts unresolved missing-code
-- reports (attempts with missing_code_reported_at set). Reports are rare, so
-- a partial index keeps the count independent of the attempts table size.
-- Prisma 6 cannot express WHERE, so the index is documented on the model.
--
-- Expand-only and re-runnable.

-- CreateIndex
CREATE INDEX IF NOT EXISTS "survey_attempts_missing_code_reported_idx" ON "survey_attempts"("missing_code_reported_at") WHERE "missing_code_reported_at" IS NOT NULL;
