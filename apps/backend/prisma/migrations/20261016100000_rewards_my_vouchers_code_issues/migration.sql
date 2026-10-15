-- AlterEnum NotificationType (append at the end)
ALTER TYPE "NotificationType" ADD VALUE 'VOUCHER_EXPIRING';
ALTER TYPE "NotificationType" ADD VALUE 'CODE_ISSUE_RESOLVED';

-- AlterTable voucher_codes: add issue_report_id
ALTER TABLE "voucher_codes" ADD COLUMN "issue_report_id" UUID;
CREATE UNIQUE INDEX "voucher_codes_issue_report_id_key" ON "voucher_codes"("issue_report_id");
ALTER TABLE "voucher_codes" ADD CONSTRAINT "voucher_codes_issue_report_id_fkey" FOREIGN KEY ("issue_report_id") REFERENCES "code_issue_reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Recreate voucher_codes_unissued_idx and CHECK constraint
DROP INDEX IF EXISTS "voucher_codes_unissued_idx";
CREATE INDEX "voucher_codes_unissued_idx" ON "voucher_codes"("voucher_id") WHERE "redemption_id" IS NULL AND "issue_report_id" IS NULL;
ALTER TABLE "voucher_codes" ADD CONSTRAINT "voucher_codes_assignment_mutual_exclusion" CHECK (
  NOT ("redemption_id" IS NOT NULL AND "issue_report_id" IS NOT NULL)
);

-- AlterTable code_issue_reports: resolution_note, unique indexes, indexes, and CHECK constraints
ALTER TABLE "code_issue_reports" ADD COLUMN "resolution_note" TEXT;
CREATE UNIQUE INDEX "code_issue_reports_replacement_code_id_key" ON "code_issue_reports"("replacement_code_id");
CREATE UNIQUE INDEX "code_issue_reports_refund_journal_id_key" ON "code_issue_reports"("refund_journal_id");
CREATE INDEX "code_issue_reports_status_created_at_idx" ON "code_issue_reports"("status", "created_at");
CREATE INDEX "code_issue_reports_redemption_id_created_at_idx" ON "code_issue_reports"("redemption_id", "created_at" DESC);

ALTER TABLE "code_issue_reports" ADD CONSTRAINT "code_issue_reports_resolution_note_length_check" CHECK (
  "resolution_note" IS NULL OR char_length("resolution_note") <= 500
);

ALTER TABLE "code_issue_reports" ADD CONSTRAINT "code_issue_reports_outcome_shape_check" CHECK (
  (
    "status" = 'OPEN' AND
    "replacement_code_id" IS NULL AND
    "refund_journal_id" IS NULL AND
    "resolved_by_id" IS NULL AND
    "resolved_at" IS NULL
  ) OR (
    "status" = 'REPLACED' AND
    "replacement_code_id" IS NOT NULL AND
    "refund_journal_id" IS NULL AND
    "resolved_by_id" IS NOT NULL AND
    "resolved_at" IS NOT NULL
  ) OR (
    "status" = 'REFUNDED' AND
    "replacement_code_id" IS NULL AND
    "refund_journal_id" IS NOT NULL AND
    "resolved_by_id" IS NOT NULL AND
    "resolved_at" IS NOT NULL
  ) OR (
    "status" = 'REJECTED' AND
    "replacement_code_id" IS NULL AND
    "refund_journal_id" IS NULL AND
    "resolved_at" IS NOT NULL
  )
);

-- CreateTable redemption_usages
CREATE TABLE "redemption_usages" (
  "redemption_id" UUID NOT NULL,
  "used_at" TIMESTAMP(3) NOT NULL,
  "undo_until" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "redemption_usages_pkey" PRIMARY KEY ("redemption_id")
);

ALTER TABLE "redemption_usages" ADD CONSTRAINT "redemption_usages_redemption_id_fkey" FOREIGN KEY ("redemption_id") REFERENCES "redemptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "redemption_usages" ADD CONSTRAINT "redemption_usages_undo_until_check" CHECK (
  "undo_until" = "used_at" + INTERVAL '24 hours'
);

-- CreateTable redemption_refunds
CREATE TABLE "redemption_refunds" (
  "id" UUID NOT NULL,
  "redemption_id" UUID NOT NULL,
  "report_id" UUID NOT NULL,
  "journal_id" UUID NOT NULL,
  "reference" TEXT NOT NULL,
  "points" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "redemption_refunds_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "redemption_refunds_redemption_id_key" ON "redemption_refunds"("redemption_id");
CREATE UNIQUE INDEX "redemption_refunds_report_id_key" ON "redemption_refunds"("report_id");
CREATE UNIQUE INDEX "redemption_refunds_journal_id_key" ON "redemption_refunds"("journal_id");
CREATE UNIQUE INDEX "redemption_refunds_reference_key" ON "redemption_refunds"("reference");

ALTER TABLE "redemption_refunds" ADD CONSTRAINT "redemption_refunds_points_positive_check" CHECK ("points" > 0);
ALTER TABLE "redemption_refunds" ADD CONSTRAINT "redemption_refunds_redemption_id_fkey" FOREIGN KEY ("redemption_id") REFERENCES "redemptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "redemption_refunds" ADD CONSTRAINT "redemption_refunds_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "code_issue_reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Append-only trigger for redemption_refunds
CREATE TRIGGER "redemption_refunds_append_only" BEFORE UPDATE OR DELETE ON "redemption_refunds"
  FOR EACH ROW EXECUTE FUNCTION "prevent_rewards_history_mutation"();
CREATE TRIGGER "redemption_refunds_no_truncate" BEFORE TRUNCATE ON "redemption_refunds"
  FOR EACH STATEMENT EXECUTE FUNCTION "prevent_rewards_history_mutation"();

-- CreateTable redemption_reminders
CREATE TABLE "redemption_reminders" (
  "redemption_id" UUID NOT NULL,
  "window" VARCHAR(10) NOT NULL,
  "emitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "redemption_reminders_pkey" PRIMARY KEY ("redemption_id", "window")
);

ALTER TABLE "redemption_reminders" ADD CONSTRAINT "redemption_reminders_redemption_id_fkey" FOREIGN KEY ("redemption_id") REFERENCES "redemptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "redemption_reminders" ADD CONSTRAINT "redemption_reminders_window_check" CHECK (
  "window" IN ('7D', '1D')
);
