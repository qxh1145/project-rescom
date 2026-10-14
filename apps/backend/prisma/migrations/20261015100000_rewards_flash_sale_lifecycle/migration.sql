-- AlterTable flash_sales
ALTER TABLE "flash_sales" ADD COLUMN "reserved_at" TIMESTAMP(3);

-- Invariants & CHECKs
ALTER TABLE "flash_sales" ADD CONSTRAINT "flash_sales_reserved_at_check" CHECK ("reserved_at" IS NULL OR "reserved_at" >= "starts_at");

-- Partial indexes for the job scans
CREATE INDEX "flash_sales_starts_at_due_idx" ON "flash_sales"("starts_at") WHERE "reserved_at" IS NULL AND "settled_at" IS NULL;
CREATE INDEX "flash_sales_ends_at_due_idx" ON "flash_sales"("ends_at") WHERE "reserved_at" IS NOT NULL AND "settled_at" IS NULL;

-- CreateTable flash_item_claims
CREATE TABLE "flash_item_claims" (
    "flash_sale_item_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "redemption_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flash_item_claims_pkey" PRIMARY KEY ("flash_sale_item_id", "user_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "flash_item_claims_redemption_id_key" ON "flash_item_claims"("redemption_id");

-- AddForeignKey
ALTER TABLE "flash_item_claims" ADD CONSTRAINT "flash_item_claims_flash_sale_item_id_fkey" FOREIGN KEY ("flash_sale_item_id") REFERENCES "flash_sale_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flash_item_claims" ADD CONSTRAINT "flash_item_claims_redemption_id_fkey" FOREIGN KEY ("redemption_id") REFERENCES "redemptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
