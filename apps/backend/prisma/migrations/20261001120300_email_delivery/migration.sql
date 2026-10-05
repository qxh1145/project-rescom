-- Story IR.4b part B (B3, B5, B6): email for critical notifications.
--   * "NotificationType" gains TOPUP_REJECTED (a top-up rejection no longer
--     reuses WARNING), ACCOUNT_LOCKED and ACCOUNT_UNLOCKED (an Admin status
--     change). Appended at the end, in the order of NOTIFICATION_TYPES in
--     @rescom/schemas. No statement here uses the new values (same precedent
--     as 20260927030000_notification_reward_earned).
--   * "email_deliveries": the Notifications-owned channel delivery attempt.
--     One row per notification, keyed by the Outbox event idempotency key
--     (`notification-email:{notificationId}`), so at most one provider send
--     is accepted per notification (AD-10). No recipient address, subject or
--     body is stored (AD-21); "last_error_code" is a code, never provider
--     text. No foreign keys: the delivery record must never block a user
--     deletion and is read only by the delivery handler.
--
-- Expand-only and re-runnable: "NotificationType" exists for certain after
-- 20260926090000_event_notifications.

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TOPUP_REJECTED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ACCOUNT_LOCKED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ACCOUNT_UNLOCKED';

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "EmailDeliveryStatus" AS ENUM ('SENDING', 'SENT', 'FAILED', 'UNCONFIRMED', 'SKIPPED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "email_deliveries" (
    "id" UUID NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "notification_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "notification_type" "NotificationType" NOT NULL,
    "status" "EmailDeliveryStatus" NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "provider_message_id" TEXT,
    "last_error_code" TEXT,
    "sending_started_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "email_deliveries_idempotency_key_key" ON "email_deliveries"("idempotency_key");
CREATE UNIQUE INDEX IF NOT EXISTS "email_deliveries_notification_id_key" ON "email_deliveries"("notification_id");
CREATE INDEX IF NOT EXISTS "email_deliveries_status_updated_at_idx" ON "email_deliveries"("status", "updated_at");
