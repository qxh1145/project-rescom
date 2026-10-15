CREATE TYPE "TopUpChannel" AS ENUM ('MANUAL', 'PAYOS');
CREATE SEQUENCE "top_up_order_code_seq" START WITH 1000000000;

ALTER TABLE "top_up_requests"
  ADD COLUMN "channel" "TopUpChannel" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "order_code" INTEGER,
  ADD COLUMN "payment_link_id" TEXT,
  ADD COLUMN "expires_at" TIMESTAMP(3),
  ADD COLUMN "cancelled_at" TIMESTAMP(3),
  ADD COLUMN "points_credited" INTEGER,
  ADD COLUMN "amount_paid_vnd" INTEGER,
  ADD COLUMN "provider_reference" TEXT,
  ADD COLUMN "paid_at" TIMESTAMP(3),
  ADD COLUMN "counter_account_bank_id" TEXT,
  ADD COLUMN "counter_account_bank_name" TEXT,
  ADD COLUMN "counter_account_name" TEXT,
  ADD COLUMN "counter_account_number" TEXT;
ALTER TABLE "top_up_requests" ALTER COLUMN "transfer_reference" DROP NOT NULL;

ALTER TABLE "top_up_requests"
  ADD CONSTRAINT "top_up_requests_payos_amount_check" CHECK ("channel" <> 'PAYOS' OR ("amount_vnd" BETWEEN 10000 AND 5000000 AND "amount_vnd" % 200 = 0 AND "amount" * 200 = "amount_vnd")),
  ADD CONSTRAINT "top_up_requests_channel_status_check" CHECK (("channel" = 'MANUAL' AND "status" IN ('PENDING', 'APPROVED', 'REJECTED')) OR ("channel" = 'PAYOS' AND "status" IN ('PROCESSING', 'SUCCESSFUL', 'CANCELLED', 'EXPIRED', 'AMOUNT_MISMATCH', 'MANUAL_REFUNDED'))),
  ADD CONSTRAINT "top_up_requests_channel_shape_check" CHECK (("channel" = 'MANUAL' AND "transfer_reference" IS NOT NULL) OR ("channel" = 'PAYOS' AND "order_code" IS NOT NULL AND "expires_at" IS NOT NULL)),
  ADD CONSTRAINT "top_up_requests_points_credited_check" CHECK ("points_credited" IS NULL OR "points_credited" > 0),
  ADD CONSTRAINT "top_up_requests_amount_paid_check" CHECK ("amount_paid_vnd" IS NULL OR "amount_paid_vnd" >= 0);
CREATE UNIQUE INDEX IF NOT EXISTS "top_up_requests_order_code_key" ON "top_up_requests"("order_code");
CREATE UNIQUE INDEX IF NOT EXISTS "top_up_requests_payment_link_id_key" ON "top_up_requests"("payment_link_id");
CREATE UNIQUE INDEX IF NOT EXISTS "top_up_requests_one_processing_per_user" ON "top_up_requests"("user_id") WHERE "status" = 'PROCESSING';
CREATE INDEX IF NOT EXISTS "top_up_requests_channel_status_created_at_idx" ON "top_up_requests"("channel", "status", "created_at");
