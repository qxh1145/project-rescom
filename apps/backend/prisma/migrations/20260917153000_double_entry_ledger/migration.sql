-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "LedgerAccountClass" AS ENUM (
    'USER_AVAILABLE',
    'PENDING',
    'FROZEN',
    'ESCROW',
    'INTEGRITY_HOLD',
    'SYSTEM_ISSUANCE',
    'SYSTEM_SINK',
    'SYSTEM_CLEARING'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "ledger_accounts" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "account_class" "LedgerAccountClass" NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'POINTS',
    "balance" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ledger_journals" (
    "id" UUID NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "description" TEXT,
    "reverses_journal_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_journals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ledger_entries" (
    "id" UUID NOT NULL,
    "journal_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndexes
CREATE UNIQUE INDEX IF NOT EXISTS "ledger_journals_idempotency_key_key" ON "ledger_journals"("idempotency_key");
CREATE UNIQUE INDEX IF NOT EXISTS "ledger_journals_reverses_journal_id_key" ON "ledger_journals"("reverses_journal_id");
CREATE INDEX IF NOT EXISTS "ledger_accounts_user_id_account_class_idx" ON "ledger_accounts"("user_id", "account_class");
CREATE INDEX IF NOT EXISTS "ledger_entries_journal_id_idx" ON "ledger_entries"("journal_id");
CREATE INDEX IF NOT EXISTS "ledger_entries_account_id_idx" ON "ledger_entries"("account_id");

-- AddForeignKey
ALTER TABLE "ledger_accounts" DROP CONSTRAINT IF EXISTS "ledger_accounts_user_id_fkey";
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ledger_journals" DROP CONSTRAINT IF EXISTS "ledger_journals_reverses_journal_id_fkey";
ALTER TABLE "ledger_journals" ADD CONSTRAINT "ledger_journals_reverses_journal_id_fkey" FOREIGN KEY ("reverses_journal_id") REFERENCES "ledger_journals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ledger_entries" DROP CONSTRAINT IF EXISTS "ledger_entries_journal_id_fkey";
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_journal_id_fkey" FOREIGN KEY ("journal_id") REFERENCES "ledger_journals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ledger_entries" DROP CONSTRAINT IF EXISTS "ledger_entries_account_id_fkey";
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
