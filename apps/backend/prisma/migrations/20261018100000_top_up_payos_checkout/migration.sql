ALTER TABLE "top_up_requests" ADD COLUMN "checkout_url" TEXT;
ALTER TYPE "NotificationType" ADD VALUE 'TOPUP_CANCELLED';
