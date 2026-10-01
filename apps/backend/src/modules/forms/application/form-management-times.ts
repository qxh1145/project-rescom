import { FormEntity } from '../domain/form.entity';

/**
 * Mock-off plan Phase 3: when a survey entered the moderation queue and when
 * it closed, for `GET /forms/:id` and the `GET /forms` rows. There is no
 * `queued_at` / `closed_at` column, so both come from `updatedAt`:
 * - queue entry and `FormEntity.close` write `updatedAt` with the transition;
 * - no command updates a MODERATION_QUEUE or CLOSED row without changing its
 *   status (pinned by `form-management-times.spec.ts`).
 * RISK: a future command that touches such a row in place would move these
 * dates. Dedicated `queued_at` / `closed_at` columns are the proper
 * follow-up (schema change, owned by the migration chain).
 */
export function formManagementTimes(form: FormEntity): {
  submittedAt: string | null;
  closedAt: string | null;
} {
  return {
    submittedAt:
      form.status === 'MODERATION_QUEUE' ? form.updatedAt.toISOString() : null,
    closedAt: form.isClosed() ? form.updatedAt.toISOString() : null,
  };
}
