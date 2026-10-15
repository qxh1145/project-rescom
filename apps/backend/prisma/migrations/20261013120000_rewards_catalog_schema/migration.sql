-- CreateEnum
CREATE TYPE "VoucherCategory" AS ENUM ('COFFEE', 'TEA', 'CHICKEN_BURGER', 'BAKERY_DESSERT');

-- CreateEnum
CREATE TYPE "VoucherState" AS ENUM ('ACTIVE', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "RedemptionStatus" AS ENUM ('SUCCEEDED', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "CodeIssueStatus" AS ENUM ('OPEN', 'REPLACED', 'REFUNDED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CodeIssueReason" AS ENUM ('CODE_INVALID', 'CODE_ALREADY_USED', 'STORE_REFUSED', 'OTHER');

-- CreateEnum
CREATE TYPE "VoucherPriceSource" AS ENUM ('BASE', 'PROMO', 'FLASH');

-- CreateTable
CREATE TABLE "voucher_brands" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "voucher_brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vouchers" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "brand_id" TEXT NOT NULL,
    "category" "VoucherCategory" NOT NULL,
    "value_vnd" INTEGER NOT NULL,
    "base_points" INTEGER NOT NULL,
    "promo_points" INTEGER,
    "price_version" INTEGER NOT NULL DEFAULT 1,
    "stock_total" INTEGER NOT NULL DEFAULT 0,
    "stock_remaining" INTEGER NOT NULL DEFAULT 0,
    "state" "VoucherState" NOT NULL DEFAULT 'ACTIVE',
    "is_visible" BOOLEAN NOT NULL DEFAULT true,
    "is_shared_code" BOOLEAN NOT NULL DEFAULT false,
    "shared_code" TEXT,
    "redeem_starts_at" TIMESTAMP(3) NOT NULL,
    "redeem_ends_at" TIMESTAMP(3) NOT NULL,
    "code_expires_at" TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    "where_to_use" TEXT,
    "terms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "how_to_use" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "image_url" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vouchers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voucher_price_versions" (
    "id" UUID NOT NULL,
    "voucher_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "base_points" INTEGER NOT NULL,
    "promo_points" INTEGER,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "changed_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voucher_price_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voucher_codes" (
    "id" UUID NOT NULL,
    "voucher_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "redemption_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voucher_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flash_sales" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "ended_early_at" TIMESTAMP(3),
    "end_reason" TEXT,
    "rules" JSONB NOT NULL,
    "created_by_id" UUID NOT NULL,
    "settled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "flash_sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flash_sale_items" (
    "id" UUID NOT NULL,
    "flash_sale_id" UUID NOT NULL,
    "voucher_id" UUID NOT NULL,
    "flash_points" INTEGER NOT NULL,
    "quota" INTEGER NOT NULL,
    "sold" INTEGER NOT NULL DEFAULT 0,
    "per_user_cap" INTEGER NOT NULL,
    "sold_out_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "flash_sale_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "redemption_quotes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "voucher_id" UUID NOT NULL,
    "flash_sale_item_id" UUID,
    "price_version" INTEGER NOT NULL,
    "price_points" INTEGER NOT NULL,
    "price_source" "VoucherPriceSource" NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "redemption_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "redemptions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "voucher_id" UUID NOT NULL,
    "voucher_code_id" UUID,
    "flash_sale_item_id" UUID,
    "quote_id" UUID,
    "idempotency_key" TEXT NOT NULL,
    "status" "RedemptionStatus" NOT NULL,
    "price_points" INTEGER NOT NULL,
    "price_source" "VoucherPriceSource" NOT NULL,
    "price_version" INTEGER NOT NULL,
    "journal_id" UUID,
    "failure_code" TEXT,
    "reference" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "code_issue_reports" (
    "id" UUID NOT NULL,
    "redemption_id" UUID NOT NULL,
    "reason" "CodeIssueReason" NOT NULL,
    "note" TEXT,
    "status" "CodeIssueStatus" NOT NULL DEFAULT 'OPEN',
    "replacement_code_id" UUID,
    "refund_journal_id" UUID,
    "resolved_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "code_issue_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vouchers_state_is_visible_idx" ON "vouchers"("state", "is_visible");

-- CreateIndex
CREATE INDEX "vouchers_brand_id_idx" ON "vouchers"("brand_id");

-- CreateIndex
CREATE INDEX "vouchers_category_idx" ON "vouchers"("category");

-- CreateIndex
CREATE UNIQUE INDEX "voucher_price_versions_voucher_id_version_key" ON "voucher_price_versions"("voucher_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "voucher_codes_redemption_id_key" ON "voucher_codes"("redemption_id");

-- CreateIndex
CREATE UNIQUE INDEX "voucher_codes_voucher_id_code_key" ON "voucher_codes"("voucher_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "flash_sales_code_key" ON "flash_sales"("code");

-- CreateIndex
CREATE INDEX "flash_sale_items_voucher_id_idx" ON "flash_sale_items"("voucher_id");

-- CreateIndex
CREATE UNIQUE INDEX "flash_sale_items_flash_sale_id_voucher_id_key" ON "flash_sale_items"("flash_sale_id", "voucher_id");

-- CreateIndex
CREATE INDEX "redemption_quotes_user_id_voucher_id_idx" ON "redemption_quotes"("user_id", "voucher_id");

-- CreateIndex
CREATE INDEX "redemption_quotes_expires_at_idx" ON "redemption_quotes"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "redemptions_reference_key" ON "redemptions"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "redemptions_user_id_idempotency_key_key" ON "redemptions"("user_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "voucher_brands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voucher_price_versions" ADD CONSTRAINT "voucher_price_versions_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "vouchers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voucher_codes" ADD CONSTRAINT "voucher_codes_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "vouchers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voucher_codes" ADD CONSTRAINT "voucher_codes_redemption_id_fkey" FOREIGN KEY ("redemption_id") REFERENCES "redemptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flash_sale_items" ADD CONSTRAINT "flash_sale_items_flash_sale_id_fkey" FOREIGN KEY ("flash_sale_id") REFERENCES "flash_sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flash_sale_items" ADD CONSTRAINT "flash_sale_items_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "vouchers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "redemption_quotes" ADD CONSTRAINT "redemption_quotes_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "vouchers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "redemption_quotes" ADD CONSTRAINT "redemption_quotes_flash_sale_item_id_fkey" FOREIGN KEY ("flash_sale_item_id") REFERENCES "flash_sale_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "vouchers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_voucher_code_id_fkey" FOREIGN KEY ("voucher_code_id") REFERENCES "voucher_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_flash_sale_item_id_fkey" FOREIGN KEY ("flash_sale_item_id") REFERENCES "flash_sale_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "redemption_quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_issue_reports" ADD CONSTRAINT "code_issue_reports_redemption_id_fkey" FOREIGN KEY ("redemption_id") REFERENCES "redemptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_issue_reports" ADD CONSTRAINT "code_issue_reports_replacement_code_id_fkey" FOREIGN KEY ("replacement_code_id") REFERENCES "voucher_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



INSERT INTO "voucher_brands" ("id", "name") VALUES
  ('highlands', 'Highlands Coffee'), ('lotteria', 'Lotteria'),
  ('phuc-long', 'Phúc Long'), ('kfc', 'KFC'),
  ('gong-cha', 'Gong Cha'), ('the-coffee-house', 'The Coffee House')
ON CONFLICT DO NOTHING;

ALTER TABLE "voucher_brands" ADD CONSTRAINT "voucher_brands_slug_check" CHECK ("id" ~ '^[a-z0-9-]{2,40}$');
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_values_check" CHECK (
  "value_vnd" > 0 AND "base_points" > 0 AND
  ("promo_points" IS NULL OR ("promo_points" > 0 AND "promo_points" < "base_points")) AND
  "price_version" >= 1 AND "stock_total" >= 0 AND
  "stock_remaining" BETWEEN 0 AND "stock_total" AND
  "redeem_ends_at" > "redeem_starts_at" AND
  "code_expires_at" >= "redeem_ends_at" + INTERVAL '7 days'
);
ALTER TABLE "voucher_price_versions" ADD CONSTRAINT "voucher_price_versions_values_check" CHECK (
  "version" >= 1 AND "base_points" > 0 AND
  ("promo_points" IS NULL OR ("promo_points" > 0 AND "promo_points" < "base_points"))
);
ALTER TABLE "flash_sales" ADD CONSTRAINT "flash_sales_window_check" CHECK ("ends_at" > "starts_at");
ALTER TABLE "flash_sale_items" ADD CONSTRAINT "flash_sale_items_values_check" CHECK (
  "flash_points" > 0 AND "quota" > 0 AND "sold" BETWEEN 0 AND "quota" AND "per_user_cap" >= 1
);
ALTER TABLE "redemption_quotes" ADD CONSTRAINT "redemption_quotes_price_check" CHECK ("price_version" >= 1 AND "price_points" > 0);
ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_price_check" CHECK ("price_version" >= 1 AND "price_points" > 0);
CREATE INDEX "voucher_codes_unissued_idx" ON "voucher_codes"("voucher_id") WHERE "redemption_id" IS NULL;
CREATE INDEX "redemptions_voucher_id_created_at_idx" ON "redemptions"("voucher_id", "created_at" DESC);
CREATE UNIQUE INDEX "code_issue_reports_open_redemption_key" ON "code_issue_reports"("redemption_id") WHERE "status" = 'OPEN';

CREATE FUNCTION "prevent_rewards_history_mutation"() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'rewards history is append-only' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "voucher_price_versions_append_only" BEFORE UPDATE OR DELETE ON "voucher_price_versions"
  FOR EACH ROW EXECUTE FUNCTION "prevent_rewards_history_mutation"();
CREATE TRIGGER "voucher_price_versions_no_truncate" BEFORE TRUNCATE ON "voucher_price_versions"
  FOR EACH STATEMENT EXECUTE FUNCTION "prevent_rewards_history_mutation"();
CREATE TRIGGER "redemptions_append_only" BEFORE UPDATE OR DELETE ON "redemptions"
  FOR EACH ROW EXECUTE FUNCTION "prevent_rewards_history_mutation"();
CREATE TRIGGER "redemptions_no_truncate" BEFORE TRUNCATE ON "redemptions"
  FOR EACH STATEMENT EXECUTE FUNCTION "prevent_rewards_history_mutation"();
