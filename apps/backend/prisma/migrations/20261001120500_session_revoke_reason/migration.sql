-- Plan 5.6: record when and why a session was revoked, so the API can answer
-- a request on a session replaced by a newer login with its own code
-- (AUTH_SESSION_REPLACED) instead of the generic AUTH_SESSION_REVOKED.
-- One value per place that revokes sessions today, plus the planned reset:
--   LOGOUT         POST /auth/logout;
--   REPLACED       a new login revokes the account's other active sessions
--                  (single active session);
--   REFRESH_REUSE  a used refresh credential was replayed;
--   ADMIN_LOCK     an Admin locked the account;
--   ROLE_CHANGED   an Admin changed the account role;
--   PASSWORD_RESET a password reset revokes every session (plan 5.4).
-- An expired session is not revoked (its expires_at decides), so there is no
-- expiry value.
--
-- Expand-only: both columns are nullable and there is no backfill. Rows
-- revoked before this migration keep NULL and read as a generic revocation.
-- No index: the columns are only read with their session row.
--
-- Re-runnable; "sessions" is created by 20260912100000_google_identity_session.

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "SessionRevokeReason" AS ENUM ('LOGOUT', 'REPLACED', 'REFRESH_REUSE', 'ADMIN_LOCK', 'ROLE_CHANGED', 'PASSWORD_RESET');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "revoked_at" TIMESTAMP(3);
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "revoked_reason" "SessionRevokeReason";
