-- Plan 4.1 / 4.6 follow-up: read indexes for the Admin overview and the
-- admin user lock reason.
-- - forms (status, updated_at): moderation queue count and oldest queued
--   form (IR.4b C5) filter by status and order by updated_at.
-- - identity_audit_logs (target_user_id, created_at): the latest effective
--   USER_STATUS_CHANGED row per locked user (DISTINCT ON target_user_id
--   ORDER BY created_at DESC), which otherwise scans via the action index.
--
-- Expand-only and re-runnable.

-- CreateIndex
CREATE INDEX IF NOT EXISTS "forms_status_updated_at_idx" ON "forms"("status", "updated_at");
CREATE INDEX IF NOT EXISTS "identity_audit_logs_target_user_id_created_at_idx" ON "identity_audit_logs"("target_user_id", "created_at");
