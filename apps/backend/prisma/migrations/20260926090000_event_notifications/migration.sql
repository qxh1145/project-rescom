-- Story 9.6: Event Notification System (FR-57).
-- No earlier migration creates "NotificationType" / "notifications" (they may
-- exist from `prisma db push`), so every statement is drift-tolerant and
-- re-runnable.

-- CreateEnum (full target shape when the type does not exist yet)
DO $$ BEGIN
  CREATE TYPE "NotificationType" AS ENUM (
    'SURVEY_APPROVED',
    'SURVEY_REJECTED',
    'ESCROW_RELEASED',
    'TOPUP_SUCCESS',
    'REWARD_PENDING',
    'REWARD_RELEASED',
    'ACCOUNT_ACTIVATED',
    'WARNING'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AlterEnum (databases that already have the original four values)
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'SURVEY_REJECTED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'REWARD_PENDING';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'REWARD_RELEASED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ACCOUNT_ACTIVATED';

-- CreateTable
CREATE TABLE IF NOT EXISTS "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "message" TEXT NOT NULL,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "dedupe_key" TEXT,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- AlterTable (tables created before this story)
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "dedupe_key" TEXT;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "read_at" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "notifications_user_id_dedupe_key_key" ON "notifications"("user_id", "dedupe_key");
CREATE INDEX IF NOT EXISTS "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "notifications_user_id_is_read_idx" ON "notifications"("user_id", "is_read");

-- AddForeignKey
ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS "notifications_user_id_fkey";
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
