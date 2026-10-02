-- Backfill: Responses whose attempt was already cancelled or expired before
-- 20261002090000 move to ABANDONED. Separate migration because a new enum
-- value cannot be used in the transaction that adds it.
UPDATE "responses" r
SET "status" = 'ABANDONED'
FROM "survey_attempts" a
WHERE r."attempt_id" = a."id"
  AND r."status" = 'IN_PROGRESS'
  AND a."status" = 'ABANDONED';
