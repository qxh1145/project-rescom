-- Story 13.12: Top-up refund resolution fields, constraints, relations
ALTER TABLE "top_up_refund_requests"
  ADD COLUMN "rejection_reason" VARCHAR(500),
  ADD COLUMN "manual_transfer_recorded" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "resolved_by_admin_id" UUID,
  ADD COLUMN "resolve_journal_id" UUID,
  ADD COLUMN "bank_transfer_reference" VARCHAR(100),
  ADD COLUMN "bank_transferred_at" TIMESTAMP(3),
  ADD COLUMN "bank_transfer_recorded_at" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "top_up_refund_requests_resolve_journal_id_key" ON "top_up_refund_requests"("resolve_journal_id");

-- AddForeignKey
ALTER TABLE "top_up_refund_requests" ADD CONSTRAINT "top_up_refund_requests_resolved_by_admin_id_fkey" FOREIGN KEY ("resolved_by_admin_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "top_up_refund_requests" ADD CONSTRAINT "top_up_refund_requests_resolve_journal_id_fkey" FOREIGN KEY ("resolve_journal_id") REFERENCES "ledger_journals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Constraints
ALTER TABLE "top_up_refund_requests"
  ADD CONSTRAINT "top_up_refund_requests_resolved_check" CHECK (
    ("status" IN ('REFUNDED', 'REJECTED')) = ("resolved_at" IS NOT NULL AND "resolved_by_admin_id" IS NOT NULL)
  ),
  ADD CONSTRAINT "top_up_refund_requests_refunded_check" CHECK (
    "status" <> 'REFUNDED' OR ("hold_journal_id" IS NOT NULL AND "resolve_journal_id" IS NOT NULL)
  ),
  ADD CONSTRAINT "top_up_refund_requests_rejected_check" CHECK (
    ("status" = 'REJECTED') = ("rejection_reason" IS NOT NULL)
    AND ("rejection_reason" IS NULL OR char_length(btrim("rejection_reason")) BETWEEN 1 AND 500)
  ),
  ADD CONSTRAINT "top_up_refund_requests_manual_transfer_check" CHECK (
    NOT "manual_transfer_recorded" OR ("status" = 'REJECTED' AND "hold_journal_id" IS NULL)
  ),
  ADD CONSTRAINT "top_up_refund_requests_bank_transfer_check" CHECK (
    (("bank_transfer_reference" IS NULL AND "bank_transferred_at" IS NULL) OR "status" = 'REFUNDED')
    AND (("bank_transfer_recorded_at" IS NULL) = ("bank_transfer_reference" IS NULL AND "bank_transferred_at" IS NULL))
  ),
  ADD CONSTRAINT "top_up_refund_requests_resolve_journal_check" CHECK (
    "resolve_journal_id" IS NULL OR "status" IN ('REFUNDED', 'REJECTED')
  ),
  ADD CONSTRAINT "top_up_refund_requests_journals_exclusive_check" CHECK (
    "release_journal_id" IS NULL OR "resolve_journal_id" IS NULL
  );
