-- CreateEnum
CREATE TYPE "AuthProvider" AS ENUM ('LOCAL', 'GOOGLE');

-- CreateEnum
CREATE TYPE "OAuthFlowType" AS ENUM ('LOGIN', 'LINK');

-- CreateTable
CREATE TABLE "auth_identities" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" "AuthProvider" NOT NULL,
    "provider_subject_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "session_version" INTEGER NOT NULL DEFAULT 1,
    "csrf_digest" TEXT NOT NULL,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_credentials" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "secret_digest" TEXT NOT NULL,
    "is_used" BOOLEAN NOT NULL DEFAULT false,
    "used_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_intents" (
    "id" UUID NOT NULL,
    "flow_type" "OAuthFlowType" NOT NULL,
    "target_user_id" UUID,
    "state_digest" TEXT NOT NULL,
    "nonce_digest" TEXT NOT NULL,
    "browser_binding_digest" TEXT NOT NULL,
    "pkce_verifier_encrypted" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_intents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity_audit_logs" (
    "id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "user_id" UUID,
    "target_user_id" UUID,
    "outcome" TEXT NOT NULL,
    "error_code" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "identity_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "auth_identities_provider_provider_subject_id_key" ON "auth_identities"("provider", "provider_subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_identities_user_id_provider_key" ON "auth_identities"("user_id", "provider");

-- CreateIndex
CREATE INDEX "auth_identities_user_id_idx" ON "auth_identities"("user_id");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "refresh_credentials_session_id_idx" ON "refresh_credentials"("session_id");

-- CreateIndex
CREATE INDEX "oauth_intents_target_user_id_idx" ON "oauth_intents"("target_user_id");

-- CreateIndex
CREATE INDEX "oauth_intents_browser_binding_digest_idx" ON "oauth_intents"("browser_binding_digest");

-- CreateIndex
CREATE INDEX "oauth_intents_expires_at_idx" ON "oauth_intents"("expires_at");

-- CreateIndex
CREATE INDEX "identity_audit_logs_user_id_idx" ON "identity_audit_logs"("user_id");

-- CreateIndex
CREATE INDEX "identity_audit_logs_action_idx" ON "identity_audit_logs"("action");

-- CreateIndex
CREATE INDEX "identity_audit_logs_created_at_idx" ON "identity_audit_logs"("created_at");

-- AddForeignKey
ALTER TABLE "auth_identities" ADD CONSTRAINT "auth_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_credentials" ADD CONSTRAINT "refresh_credentials_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Enforce Append-Only for IdentityAuditLog
CREATE OR REPLACE FUNCTION prevent_identity_audit_logs_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'identity_audit_logs table is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER enforce_identity_audit_logs_append_only
BEFORE UPDATE OR DELETE ON "identity_audit_logs"
FOR EACH ROW
EXECUTE FUNCTION prevent_identity_audit_logs_mutation();
