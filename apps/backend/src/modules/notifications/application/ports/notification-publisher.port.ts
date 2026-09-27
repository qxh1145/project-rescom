import { PublishNotificationCommand } from '@rescom/schemas';

export const NOTIFICATION_PUBLISHER_PORT = Symbol(
  'NOTIFICATION_PUBLISHER_PORT',
);

export type NotificationPublishResult = 'CREATED' | 'DUPLICATE' | 'FAILED';

/**
 * The only Notifications dependency other bounded contexts may take (AD-7).
 *
 * Contract:
 * - Idempotent by `(userId, dedupeKey)`: replaying the same source event never
 *   creates a second notification (AD-10, NFR-25).
 * - Never throws: a notification failure cannot fail or roll back the source
 *   workflow (Notifications context rule). Failures resolve to `FAILED`.
 * - Call it only AFTER the source transaction has committed.
 *
 * Delivery guarantee (decision E9-D3, signed off 2026-09-26): best-effort,
 * at-most-once in Phase 1 — a crash between the source commit and `publish`
 * loses that notice (the Ledger / wallet history stays authoritative). Once
 * the AD-5 worker and AD-10 claim/lease infrastructure exist, producers move
 * to an Outbox subscription (`deferred-work.md`, Story 9.6 dev entry).
 */
export interface NotificationPublisherPort {
  publish(
    command: PublishNotificationCommand,
  ): Promise<NotificationPublishResult>;
}
