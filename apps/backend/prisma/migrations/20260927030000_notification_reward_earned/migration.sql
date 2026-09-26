-- Code-review decision E9-D2 (2026-09-26, option A): FR-57 "Points earned".
-- An Internal survey reward credited instantly to the Available balance now
-- notifies the respondent with the new "REWARD_EARNED" type (published after
-- the `internal-reward:{responseId}` journal commits, deduplicated on that
-- key).
--
-- Drift-tolerant and re-runnable like 20260926090000_event_notifications:
-- the type is created with its full target shape when it does not exist yet
-- (it may come from `prisma db push`), otherwise the value is added in place,
-- next to the other reward notices.

-- CreateEnum (full target shape when the type does not exist yet)
DO $$ BEGIN
  CREATE TYPE "NotificationType" AS ENUM (
    'SURVEY_APPROVED',
    'SURVEY_REJECTED',
    'ESCROW_RELEASED',
    'TOPUP_SUCCESS',
    'REWARD_EARNED',
    'REWARD_PENDING',
    'REWARD_RELEASED',
    'ACCOUNT_ACTIVATED',
    'WARNING'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AlterEnum (databases that already have the type)
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'REWARD_EARNED' BEFORE 'REWARD_PENDING';
