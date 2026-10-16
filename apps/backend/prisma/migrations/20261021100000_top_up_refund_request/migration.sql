-- Story 13.10: Top-up refund request table and ledger account class invariant update

-- Update ledger_accounts_owner_class_check to allow REFUND_HOLD for users
ALTER TABLE "ledger_accounts" DROP CONSTRAINT IF EXISTS "ledger_accounts_owner_class_check";
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_owner_class_check" CHECK (
  ("user_id" IS NULL AND "account_class" IN ('SYSTEM_ISSUANCE', 'SYSTEM_SINK', 'SYSTEM_CLEARING'))
  OR
  ("user_id" IS NOT NULL AND "account_class" IN ('USER_AVAILABLE', 'PENDING', 'FROZEN', 'ESCROW', 'INTEGRITY_HOLD', 'REFUND_HOLD'))
);

-- Create new refund enums
CREATE TYPE "TopUpRefundStatus" AS ENUM ('REQUESTED', 'WITHDRAWN', 'REFUNDED', 'REJECTED');
CREATE TYPE "TopUpRefundEligibility" AS ENUM ('ELIGIBLE', 'NOT_ELIGIBLE');
CREATE TYPE "TopUpRefundIneligibleReason" AS ENUM ('SPENT_SINCE_TOP_UP', 'INSUFFICIENT_AVAILABLE');
CREATE TYPE "TopUpRefundReason" AS ENUM ('WRONG_AMOUNT', 'WRONG_ACCOUNT', 'NO_LONGER_NEEDED', 'OTHER');

-- CreateTable
CREATE TABLE "top_up_refund_requests" (
    "id" UUID NOT NULL,
    "top_up_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "top_up_journal_id" UUID NOT NULL,
    "hold_journal_id" UUID,
    "release_journal_id" UUID,
    "status" "TopUpRefundStatus" NOT NULL,
    "eligibility" "TopUpRefundEligibility" NOT NULL,
    "ineligible_reason" "TopUpRefundIneligibleReason",
    "reason" "TopUpRefundReason" NOT NULL,
    "note" VARCHAR(300) NOT NULL,
    "points" INTEGER NOT NULL,
    "amount_vnd" INTEGER NOT NULL,
    "counter_account_bank_id" TEXT,
    "counter_account_bank_name" TEXT,
    "counter_account_name" TEXT,
    "counter_account_number" TEXT,
    "destination_verified" BOOLEAN NOT NULL,
    "withdrawn_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "correlation_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "top_up_refund_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "top_up_refund_requests_top_up_id_key" ON "top_up_refund_requests"("top_up_id");
CREATE UNIQUE INDEX "top_up_refund_requests_hold_journal_id_key" ON "top_up_refund_requests"("hold_journal_id");
CREATE UNIQUE INDEX "top_up_refund_requests_release_journal_id_key" ON "top_up_refund_requests"("release_journal_id");
CREATE INDEX "top_up_refund_requests_status_created_at_idx" ON "top_up_refund_requests"("status", "created_at");
CREATE INDEX "top_up_refund_requests_user_id_created_at_idx" ON "top_up_refund_requests"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "top_up_refund_requests" ADD CONSTRAINT "top_up_refund_requests_top_up_id_fkey" FOREIGN KEY ("top_up_id") REFERENCES "top_up_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "top_up_refund_requests" ADD CONSTRAINT "top_up_refund_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "top_up_refund_requests" ADD CONSTRAINT "top_up_refund_requests_top_up_journal_id_fkey" FOREIGN KEY ("top_up_journal_id") REFERENCES "ledger_journals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "top_up_refund_requests" ADD CONSTRAINT "top_up_refund_requests_hold_journal_id_fkey" FOREIGN KEY ("hold_journal_id") REFERENCES "ledger_journals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "top_up_refund_requests" ADD CONSTRAINT "top_up_refund_requests_release_journal_id_fkey" FOREIGN KEY ("release_journal_id") REFERENCES "ledger_journals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Constraints
ALTER TABLE "top_up_refund_requests"
  ADD CONSTRAINT "top_up_refund_requests_note_check" CHECK (char_length(btrim("note")) BETWEEN 1 AND 300),
  ADD CONSTRAINT "top_up_refund_requests_points_check" CHECK ("points" > 0),
  ADD CONSTRAINT "top_up_refund_requests_eligibility_check" CHECK (
    ("eligibility" = 'ELIGIBLE') = ("hold_journal_id" IS NOT NULL)
    AND ("eligibility" = 'NOT_ELIGIBLE') = ("ineligible_reason" IS NOT NULL)
  ),
  ADD CONSTRAINT "top_up_refund_requests_withdrawn_check" CHECK (
    ("status" = 'WITHDRAWN') = ("withdrawn_at" IS NOT NULL)
  ),
  ADD CONSTRAINT "top_up_refund_requests_release_check" CHECK ("release_journal_id" IS NULL OR "hold_journal_id" IS NOT NULL);
