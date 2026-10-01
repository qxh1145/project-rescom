-- Plan 4.2 / 4.3: read indexes for the Admin fraud log and ledger journal
-- lists. Both lists are newest first with a keyset cursor
-- `before=<createdAt>:<id>`, i.e. WHERE (created_at, id) < ($1, $2)
-- ORDER BY created_at DESC, id DESC, which a (created_at, id) B-tree serves
-- in a backward scan. The fraud log also filters by account.
-- Neither table had an index on created_at before.
--
-- Expand-only and re-runnable; "fraud_logs" exists for certain after
-- 20260927040000_reconcile_db_push_tables and "ledger_journals" after
-- 20260917153000_double_entry_ledger.

-- CreateIndex
CREATE INDEX IF NOT EXISTS "fraud_logs_created_at_id_idx" ON "fraud_logs"("created_at", "id");
CREATE INDEX IF NOT EXISTS "fraud_logs_user_id_created_at_idx" ON "fraud_logs"("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "ledger_journals_created_at_id_idx" ON "ledger_journals"("created_at", "id");
