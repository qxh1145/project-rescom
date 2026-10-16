ALTER TYPE "NotificationType" ADD VALUE 'TOPUP_REFUNDED';
ALTER TABLE "top_up_requests" ADD COLUMN "resolution_note" VARCHAR(500);
