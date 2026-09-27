-- Phase 5 C6 (decision Q6, option a): `POST /forms/external` honours an
-- `Idempotency-Key` header. The key is stored on the survey it created
-- (unique per Publisher) together with the SHA-256 fingerprint of the
-- request body, so a retry after a lost response replays that survey instead
-- of creating a second one and locking its Escrow twice. The insert runs in
-- the same Unit of Work as the Escrow reservation: a concurrent duplicate hits
-- the unique index and rolls back its reservation.
--
-- "forms" exists for certain after 20260927040000_reconcile_db_push_tables,
-- so no to_regclass guard is needed; every statement is re-runnable.
-- PostgreSQL unique indexes treat NULLs as distinct: surveys created without a
-- key never collide.

ALTER TABLE "forms" ADD COLUMN IF NOT EXISTS "creation_idempotency_key" TEXT;
ALTER TABLE "forms" ADD COLUMN IF NOT EXISTS "creation_request_hash" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "forms_publisher_id_creation_idempotency_key_key"
  ON "forms"("publisher_id", "creation_idempotency_key");
