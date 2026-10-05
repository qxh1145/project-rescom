-- Integrity telemetry notice (Figma 14, `GET|POST /integrity/consent`): one
-- acceptance per user, purpose and notice version. Accepting the same notice
-- again is idempotent even when two requests race: the write is
-- `INSERT … ON CONFLICT DO NOTHING` on this index, and the original
-- "granted_at" is kept.
--
-- Nothing wrote "integrity_consents" before these routes existed, so the
-- table holds no duplicate rows. The index also serves the status read (the
-- user's highest accepted version for a purpose).
--
-- "integrity_consents" exists for certain after
-- 20260927040000_reconcile_db_push_tables; the statement is re-runnable.

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "integrity_consents_user_id_purpose_notice_version_key"
  ON "integrity_consents"("user_id", "purpose", "notice_version");
