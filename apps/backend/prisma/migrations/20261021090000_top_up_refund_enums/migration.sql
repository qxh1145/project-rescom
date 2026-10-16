-- Story 13.10: Add refund hold ledger class and notification types
ALTER TYPE "LedgerAccountClass" ADD VALUE 'REFUND_HOLD';
ALTER TYPE "NotificationType" ADD VALUE 'TOPUP_REFUND_REQUESTED';
ALTER TYPE "NotificationType" ADD VALUE 'TOPUP_REFUND_WITHDRAWN';
