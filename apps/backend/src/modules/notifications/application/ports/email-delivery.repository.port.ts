import { EmailDeliveryStatus, EmailNotificationType } from '@rescom/schemas';

/**
 * Story IR.4b B5/B6: the Notifications-owned email delivery attempt
 * (`email_deliveries`), one row per notification, keyed by the Outbox event
 * idempotency key. No recipient address, subject or body is stored.
 *
 * Every write commits on its own (never inside the dispatcher's ambient
 * transaction): the `SENDING` claim must be durable before the provider call
 * (AD-10), and an outcome must survive a rollback of the dispatcher's
 * transaction, so a replay sees it and never sends twice.
 *
 * `lastErrorCode` is `<OUTCOME>:<code>`; only `RETRYABLE:` failures are tried
 * again, every other `FAILED` row is terminal.
 */
export const EMAIL_DELIVERY_REPOSITORY_PORT = Symbol(
  'EMAIL_DELIVERY_REPOSITORY_PORT',
);

export const RETRYABLE_ERROR_PREFIX = 'RETRYABLE:';

export interface EmailDeliveryRecord {
  idempotencyKey: string;
  notificationId: string;
  userId: string;
  notificationType: EmailNotificationType;
  status: EmailDeliveryStatus;
  attempts: number;
  providerMessageId: string | null;
  lastErrorCode: string | null;
  sendingStartedAt: Date | null;
  sentAt: Date | null;
}

export interface NewEmailDelivery {
  idempotencyKey: string;
  notificationId: string;
  userId: string;
  notificationType: EmailNotificationType;
}

export type EmailDeliveryOutcome =
  | { status: 'SENT'; providerMessageId: string; sentAt: Date }
  | {
      status: 'FAILED' | 'UNCONFIRMED' | 'SKIPPED';
      lastErrorCode: string;
    };

export interface EmailDeliveryRepositoryPort {
  findByKey(idempotencyKey: string): Promise<EmailDeliveryRecord | null>;

  /** Inserts a `SKIPPED` row unless one exists. True when inserted. */
  recordSkippedIfAbsent(
    delivery: NewEmailDelivery,
    lastErrorCode: string,
  ): Promise<boolean>;

  /**
   * Claims the one send attempt, atomically: inserts `SENDING` (attempt 1)
   * when no row exists, or moves a `RETRYABLE:` `FAILED` row (and, with
   * `resumeSending`, a `SENDING` row: only for a provider that deduplicates
   * on the key) to `SENDING` with `attempts + 1`. Returns the claimed attempt
   * number, or null when the row is in any other state.
   */
  claimSending(
    delivery: NewEmailDelivery,
    now: Date,
    resumeSending: boolean,
  ): Promise<number | null>;

  /** `SENDING` → `UNCONFIRMED` (a crash or a concurrent claim left it). */
  markUnconfirmed(idempotencyKey: string, code: string): Promise<boolean>;

  /**
   * Records the outcome of `attempt` while the row still carries that attempt
   * number and is `SENDING`, `UNCONFIRMED` (a concurrent delivery marked the
   * in-flight attempt; its owner knows better) or a `RETRYABLE:` `FAILED`
   * (a retry that ends up skipped). A no-op otherwise.
   */
  recordOutcome(
    idempotencyKey: string,
    attempt: number,
    outcome: EmailDeliveryOutcome,
  ): Promise<void>;
}
