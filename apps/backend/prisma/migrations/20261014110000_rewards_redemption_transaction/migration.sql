-- AlterTable redemptions
ALTER TABLE "redemptions" ADD COLUMN "balance_after" INTEGER;
ALTER TABLE "redemptions" ADD COLUMN "failure_details" JSONB;

-- CreateTable rewards_settings
CREATE TABLE "rewards_settings" (
    "id" SMALLINT NOT NULL DEFAULT 1,
    "daily_points_limit" INTEGER NOT NULL DEFAULT 500,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rewards_settings_pkey" PRIMARY KEY ("id")
);

-- Seed rewards_settings
INSERT INTO "rewards_settings" ("id", "daily_points_limit", "updated_at")
VALUES (1, 500, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- Invariants & CHECKs
ALTER TABLE "rewards_settings" ADD CONSTRAINT "rewards_settings_id_check" CHECK ("id" = 1);
ALTER TABLE "rewards_settings" ADD CONSTRAINT "rewards_settings_daily_limit_check" CHECK ("daily_points_limit" > 0);

ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_status_succeeded_check" CHECK (
  "status" != 'SUCCEEDED' OR (
    "journal_id" IS NOT NULL AND
    "balance_after" IS NOT NULL
  )
) NOT VALID;

ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_status_failed_check" CHECK (
  "status" != 'FAILED' OR (
    "journal_id" IS NULL AND
    "failure_code" IS NOT NULL
  )
) NOT VALID;
-- NOT VALID: enforced for every new row without scanning (or failing on) rows
-- written before 12.8; redemptions is append-only, so old rows can never be fixed.

-- A SUCCEEDED redemption carries its own code row, unless the voucher uses one
-- shared code. A CHECK cannot read vouchers, so a BEFORE INSERT trigger does it
-- (redemptions is append-only, so insert time is the only time that matters).
CREATE OR REPLACE FUNCTION "redemptions_succeeded_code_check"() RETURNS TRIGGER AS $$
BEGIN
  IF NEW."status" = 'SUCCEEDED' AND NEW."voucher_code_id" IS NULL AND NOT EXISTS (
    SELECT 1 FROM "vouchers" WHERE "id" = NEW."voucher_id" AND "is_shared_code"
  ) THEN
    RAISE EXCEPTION 'SUCCEEDED redemption needs a voucher code or a shared-code voucher' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "redemptions_succeeded_code_check" BEFORE INSERT ON "redemptions"
  FOR EACH ROW EXECUTE FUNCTION "redemptions_succeeded_code_check"();

-- Partial Unique Index: one successful redemption per quote
CREATE UNIQUE INDEX "redemptions_quote_id_succeeded_key" ON "redemptions"("quote_id") WHERE "status" = 'SUCCEEDED';

-- Limit count index on redemptions(user_id, created_at)
CREATE INDEX "redemptions_user_id_created_at_idx" ON "redemptions"("user_id", "created_at" DESC);
