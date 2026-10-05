-- Plan 5.4: forgot / reset password. One row per issued reset link. Only the
-- SHA-256 hex digest of the random token is stored ("token_hash", unique);
-- the raw token exists only in the emailed link. A token is usable while
-- "used_at" IS NULL and "expires_at" > now; redeeming it sets "used_at".
-- (user_id, created_at) serves the per-account issue throttle and "latest
-- token" lookups. Rows go with their user (ON DELETE CASCADE), like
-- "sessions" and "auth_identities".
--
-- Expand-only and re-runnable like 20261001110000_user_profiles.

-- CreateTable
CREATE TABLE IF NOT EXISTS "password_reset_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");
CREATE INDEX IF NOT EXISTS "password_reset_tokens_user_id_created_at_idx" ON "password_reset_tokens"("user_id", "created_at");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "password_reset_tokens"
    ADD CONSTRAINT "password_reset_tokens_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
