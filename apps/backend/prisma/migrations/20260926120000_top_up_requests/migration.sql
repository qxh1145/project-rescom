-- Story 6.6: Point Top-Up Request & Admin Approval (FR-34, FR-35, AD-16).
-- No earlier migration creates "TopUpStatus" / "top_up_requests" (they may
-- exist from `prisma db push` with the original six columns), so every
-- statement is drift-tolerant and re-runnable.

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "TopUpStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateTable (full target shape when the table does not exist yet)
CREATE TABLE IF NOT EXISTS "top_up_requests" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "amount_vnd" INTEGER NOT NULL,
    "transfer_reference" TEXT NOT NULL,
    "status" "TopUpStatus" NOT NULL DEFAULT 'PENDING',
    "admin_id" UUID,
    "journal_id" UUID,
    "rejection_reason" TEXT,
    "correlation_id" UUID,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "top_up_requests_pkey" PRIMARY KEY ("id")
);

-- AlterTable (tables created before this story with the original columns)
ALTER TABLE "top_up_requests" ADD COLUMN IF NOT EXISTS "amount_vnd" INTEGER;
UPDATE "top_up_requests" SET "amount_vnd" = "amount" * 200 WHERE "amount_vnd" IS NULL;
ALTER TABLE "top_up_requests" ALTER COLUMN "amount_vnd" SET NOT NULL;

ALTER TABLE "top_up_requests" ADD COLUMN IF NOT EXISTS "transfer_reference" TEXT;
-- Legacy rows get a deterministic reference inside the unambiguous alphabet.
UPDATE "top_up_requests"
SET "transfer_reference" = 'RESCOM' || translate(substr(md5("id"::text), 1, 8), '0123456789abcdef', 'ABCDEFGHJKLMNPQR')
WHERE "transfer_reference" IS NULL;
ALTER TABLE "top_up_requests" ALTER COLUMN "transfer_reference" SET NOT NULL;

ALTER TABLE "top_up_requests" ADD COLUMN IF NOT EXISTS "journal_id" UUID;
ALTER TABLE "top_up_requests" ADD COLUMN IF NOT EXISTS "rejection_reason" TEXT;
ALTER TABLE "top_up_requests" ADD COLUMN IF NOT EXISTS "correlation_id" UUID;
ALTER TABLE "top_up_requests" ADD COLUMN IF NOT EXISTS "reviewed_at" TIMESTAMP(3);

ALTER TABLE "top_up_requests" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
-- Prisma maintains @updatedAt itself; keep the column shape identical to the schema.
ALTER TABLE "top_up_requests" ALTER COLUMN "updated_at" DROP DEFAULT;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "top_up_requests_transfer_reference_key" ON "top_up_requests"("transfer_reference");
CREATE UNIQUE INDEX IF NOT EXISTS "top_up_requests_journal_id_key" ON "top_up_requests"("journal_id");
CREATE INDEX IF NOT EXISTS "top_up_requests_status_created_at_idx" ON "top_up_requests"("status", "created_at");
CREATE INDEX IF NOT EXISTS "top_up_requests_user_id_created_at_idx" ON "top_up_requests"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "top_up_requests" DROP CONSTRAINT IF EXISTS "top_up_requests_user_id_fkey";
ALTER TABLE "top_up_requests" ADD CONSTRAINT "top_up_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
