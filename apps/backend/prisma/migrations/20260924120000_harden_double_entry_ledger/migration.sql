-- Enforce one canonical balance projection per owner/class/currency.
DROP INDEX IF EXISTS "ledger_accounts_user_id_account_class_idx";
CREATE UNIQUE INDEX "ledger_accounts_user_id_account_class_currency_key"
  ON "ledger_accounts"("user_id", "account_class", "currency") NULLS NOT DISTINCT;

-- Account ownership determines whether overdraft is permitted.
ALTER TABLE "ledger_accounts"
  ADD CONSTRAINT "ledger_accounts_owner_class_check" CHECK (
    ("user_id" IS NULL AND "account_class" IN ('SYSTEM_ISSUANCE', 'SYSTEM_SINK', 'SYSTEM_CLEARING'))
    OR
    ("user_id" IS NOT NULL AND "account_class" IN ('USER_AVAILABLE', 'PENDING', 'FROZEN', 'ESCROW', 'INTEGRITY_HOLD'))
  );

-- Every persisted amount must remain exactly reversible inside INTEGER range.
ALTER TABLE "ledger_entries"
  ADD CONSTRAINT "ledger_entries_amount_reversible_check" CHECK (
    "amount" BETWEEN -2147483647 AND 2147483647 AND "amount" <> 0
  );

-- Financial history and account ownership cannot be detached by cascades.
ALTER TABLE "ledger_accounts"
  DROP CONSTRAINT "ledger_accounts_user_id_fkey";
ALTER TABLE "ledger_accounts"
  ADD CONSTRAINT "ledger_accounts_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "ledger_journals"
  DROP CONSTRAINT "ledger_journals_reverses_journal_id_fkey";
ALTER TABLE "ledger_journals"
  ADD CONSTRAINT "ledger_journals_reverses_journal_id_fkey"
  FOREIGN KEY ("reverses_journal_id") REFERENCES "ledger_journals"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Posted journals and entries are immutable financial authority. These
-- triggers protect the invariant from direct runtime SQL as well as ORM code.
CREATE OR REPLACE FUNCTION "prevent_posted_ledger_mutation"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'posted ledger rows are append-only'
    USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ledger_journals_append_only"
BEFORE UPDATE OR DELETE ON "ledger_journals"
FOR EACH ROW EXECUTE FUNCTION "prevent_posted_ledger_mutation"();

CREATE TRIGGER "ledger_entries_append_only"
BEFORE UPDATE OR DELETE ON "ledger_entries"
FOR EACH ROW EXECUTE FUNCTION "prevent_posted_ledger_mutation"();
