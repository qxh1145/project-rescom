-- Story IR.2b Task 1 (AC1, AC4, AC5, AC6): schema for the in-process
-- scheduler and the Outbox dispatcher.
--   * "scheduler_job_leases": one row per job. A run claims the row with an
--     owner, a lease expiry and a monotonically increasing BIGINT fencing
--     token (AD-10, AD-17). A plain column, not a SEQUENCE, so
--     `prisma db push` reproduces it.
--   * "outbox_events": stream-gap check and per-type backlog indexes. The
--     statuses stay PENDING | PROCESSED | FAILED | DEAD_LETTER; "claimed"
--     means claim_expires_at > now, not a new status.
--   * "forms"."deadline_at" + (status, deadline_at): the deadline-close and
--     Escrow refund job.
--   * "survey_attempts" (status, started_at): the reservation-expiry sweep.
--     The close-reason columns come from 20261001100000_survey_attempt_close_reason
--     (IR.2a) and are not re-declared here.
--   * "FormCloseKind" gains DEADLINE (system close when deadline_at passes)
--     and QUOTA (system close in the same transaction as the last accepted
--     submission once the sample target is met; plan 2.3 option A). Like
--     20260927030000_notification_reward_earned, no statement here uses the
--     new values.
--
-- Expand-only and re-runnable: every table it touches exists for certain
-- after 20260927040000_reconcile_db_push_tables (and "FormCloseKind" after
-- 20260927020000_form_close_kind), so no to_regclass guard is needed.

-- AlterEnum
ALTER TYPE "FormCloseKind" ADD VALUE IF NOT EXISTS 'DEADLINE';
ALTER TYPE "FormCloseKind" ADD VALUE IF NOT EXISTS 'QUOTA';

-- CreateTable
CREATE TABLE IF NOT EXISTS "scheduler_job_leases" (
    "job_name" TEXT NOT NULL,
    "lease_owner" TEXT,
    "fencing_token" BIGINT NOT NULL DEFAULT 0,
    "lease_expires_at" TIMESTAMP(3),
    "next_run_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_started_at" TIMESTAMP(3),
    "last_finished_at" TIMESTAMP(3),
    "last_status" TEXT,
    "last_summary" JSONB,
    "last_error" TEXT,
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduler_job_leases_pkey" PRIMARY KEY ("job_name")
);

-- AlterTable
ALTER TABLE "forms" ADD COLUMN IF NOT EXISTS "deadline_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "forms_status_deadline_at_idx" ON "forms"("status", "deadline_at");
CREATE INDEX IF NOT EXISTS "survey_attempts_status_started_at_idx" ON "survey_attempts"("status", "started_at");
CREATE INDEX IF NOT EXISTS "outbox_events_ordering_stream_stream_sequence_idx" ON "outbox_events"("ordering_stream", "stream_sequence");
CREATE INDEX IF NOT EXISTS "outbox_events_event_type_status_idx" ON "outbox_events"("event_type", "status");
