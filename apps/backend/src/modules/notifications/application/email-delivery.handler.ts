import {
  NOTIFICATION_EMAIL_REQUESTED_EVENT,
  NOTIFICATION_EMAIL_REQUESTED_SCHEMA_VERSION,
  NotificationEmailRequestedPayload,
  notificationEmailKey,
  notificationEmailRequestedPayloadSchema,
} from '@rescom/schemas';
import {
  OutboxEnvelope,
  OutboxHandler,
  OutboxPayloadInvalidError,
} from '../../../common/scheduler/outbox/outbox-handler';
import { User } from '../../users/domain/user.entity';
import { renderNotificationEmail } from './email-templates';
import {
  EmailDeliveryOutcome,
  EmailDeliveryRecord,
  EmailDeliveryRepositoryPort,
  NewEmailDelivery,
  RETRYABLE_ERROR_PREFIX,
} from './ports/email-delivery.repository.port';
import { EmailSenderPort } from './ports/email-sender.port';

export const EMAIL_DELIVERY_HANDLER = 'notifications.email-delivery';

/**
 * Seed/backlog safety: an email request older than this is recorded
 * `SKIPPED` (`STALE_EVENT`) instead of sent, so enabling the dispatcher after
 * a long pause never mails out days-old notices.
 */
export const EMAIL_MAX_EVENT_AGE_MS = 24 * 60 * 60 * 1000;

/** A definite, retryable send failure: the dispatcher retries with backoff. */
export class EmailSendRetryableError extends Error {
  constructor(readonly code: string) {
    // The dispatcher copies the message into `outbox_events.last_error`:
    // the code only, never provider text or an address.
    super(`email send retryable (${code})`);
    this.name = 'EmailSendRetryableError';
  }
}

export interface EmailDeliveryLogger {
  log(message: string): void;
  warn(message: string): void;
}

export interface EmailDeliveryHandlerConfig {
  appBaseUrl: string;
  supportEmail: string | null;
  /**
   * Hard deadline of one provider send (`EMAIL_SEND_TIMEOUT_MS`). A `SENDING`
   * row younger than 3× this may still be in flight (review M3).
   */
  sendTimeoutMs: number;
}

type RecipientLookup = {
  findById(id: string): Promise<User | null>;
};

/**
 * Story IR.4b B5/B6 (AD-10): the Outbox handler
 * `notifications.email-delivery` for `NotificationEmailRequested`.
 *
 * Kind (b), external effect. Before the provider call it commits a `SENDING`
 * attempt keyed by the event idempotency key; the outcome is committed right
 * after. At most one provider send per notification is accepted:
 * - `SENT`, `SKIPPED`, `UNCONFIRMED` and terminal `FAILED` acknowledge;
 * - a `SENDING` row still in flight (younger than 3× the send deadline, or a
 *   claim lost to a concurrent delivery) is retried later, not touched;
 * - a `SENDING` row older than that was abandoned (crash): it becomes
 *   `UNCONFIRMED` and is never resent (SMTP has no idempotency key);
 * - a retryable failure records `FAILED` and rethrows, so the dispatcher
 *   retries with backoff and dead-letters after its bound;
 * - a permanent failure records `FAILED` terminally and acknowledges.
 *
 * Logs carry the notification id, type, status and correlation id only:
 * never the address, subject, body or SMTP credentials (B7).
 */
export class EmailDeliveryHandler implements OutboxHandler {
  readonly name = EMAIL_DELIVERY_HANDLER;
  readonly eventType = NOTIFICATION_EMAIL_REQUESTED_EVENT;
  readonly schemaVersions = [NOTIFICATION_EMAIL_REQUESTED_SCHEMA_VERSION];
  /** Kind (b): the SMTP call never runs inside the dispatcher's transaction. */
  readonly runsOutsideTransaction = true;

  constructor(
    private readonly deliveries: EmailDeliveryRepositoryPort,
    private readonly sender: EmailSenderPort,
    private readonly users: RecipientLookup,
    private readonly config: EmailDeliveryHandlerConfig,
    private readonly logger?: EmailDeliveryLogger,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async handle(event: OutboxEnvelope): Promise<void> {
    const payload = this.parse(event);
    const delivery: NewEmailDelivery = {
      idempotencyKey: event.idempotencyKey,
      notificationId: payload.notificationId,
      userId: payload.userId,
      notificationType: payload.type,
    };
    const correlationId = event.correlationId ?? event.id;
    const report = (status: string, extra: Record<string, unknown> = {}) =>
      this.report(payload, correlationId, status, extra);

    const existing = await this.deliveries.findByKey(delivery.idempotencyKey);
    if (existing && !this.mayAttempt(existing)) {
      if (existing.status === 'SENDING') {
        if (this.mayStillBeSending(existing)) {
          report('SENDING', { reason: 'SEND_IN_PROGRESS' });
          throw new EmailSendRetryableError('SEND_IN_PROGRESS');
        }
        await this.deliveries.markUnconfirmed(
          delivery.idempotencyKey,
          'AMBIGUOUS:INTERRUPTED_SEND',
        );
        report('UNCONFIRMED', { reason: 'INTERRUPTED_SEND' });
        return;
      }
      report(existing.status, { replay: true });
      return;
    }

    const now = this.clock();
    // A retry of a failed send is aged too (review 2026-10-01).
    if (
      (!existing || existing.status === 'FAILED') &&
      now.getTime() - event.createdAt.getTime() > EMAIL_MAX_EVENT_AGE_MS
    ) {
      await this.skip(delivery, existing, 'STALE_EVENT');
      report('SKIPPED', { reason: 'STALE_EVENT' });
      return;
    }

    const recipient = await this.users.findById(payload.userId);
    const skipReason = this.skipReason(payload, recipient);
    if (skipReason || !recipient) {
      const reason = skipReason ?? 'RECIPIENT_NOT_FOUND';
      await this.skip(delivery, existing, reason);
      report('SKIPPED', { reason });
      return;
    }

    const attempt = await this.deliveries.claimSending(
      delivery,
      now,
      this.sender.supportsIdempotentResend,
    );
    if (attempt === null) {
      // Another delivery claimed it between the read and the claim: come back
      // later and acknowledge once its outcome is recorded.
      report('SENDING', { reason: 'CLAIMED_ELSEWHERE' });
      throw new EmailSendRetryableError('SEND_IN_PROGRESS');
    }

    const email = renderNotificationEmail(payload.type, {
      appBaseUrl: this.config.appBaseUrl,
      supportEmail: this.config.supportEmail,
    });
    const result = await this.sender.send({
      to: recipient.email,
      subject: email.subject,
      text: email.text,
      html: email.html,
      idempotencyKey: delivery.idempotencyKey,
    });

    let outcome: EmailDeliveryOutcome;
    switch (result.outcome) {
      case 'ACCEPTED':
        outcome = {
          status: 'SENT',
          providerMessageId: result.providerMessageId,
          sentAt: this.clock(),
        };
        break;
      case 'SKIPPED':
        outcome = { status: 'SKIPPED', lastErrorCode: 'SENDER_DISABLED' };
        break;
      case 'PERMANENT':
        outcome = {
          status: 'FAILED',
          lastErrorCode: `PERMANENT:${result.code}`,
        };
        break;
      case 'AMBIGUOUS':
        outcome = {
          status: 'UNCONFIRMED',
          lastErrorCode: `AMBIGUOUS:${result.code}`,
        };
        break;
      case 'RETRYABLE':
        outcome = {
          status: 'FAILED',
          lastErrorCode: `${RETRYABLE_ERROR_PREFIX}${result.code}`,
        };
        break;
    }
    await this.deliveries.recordOutcome(
      delivery.idempotencyKey,
      attempt,
      outcome,
    );
    report(outcome.status, {
      attempt,
      ...(outcome.status === 'SENT' ? {} : { code: outcome.lastErrorCode }),
    });
    if (result.outcome === 'RETRYABLE') {
      throw new EmailSendRetryableError(result.code);
    }
  }

  private parse(event: OutboxEnvelope): NotificationEmailRequestedPayload {
    const parsed = notificationEmailRequestedPayloadSchema.safeParse(
      event.payload,
    );
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new OutboxPayloadInvalidError(
        event.eventType,
        issue ? `${issue.path.join('.')}: ${issue.message}` : 'invalid',
      );
    }
    if (
      event.idempotencyKey !== notificationEmailKey(parsed.data.notificationId)
    ) {
      throw new OutboxPayloadInvalidError(
        event.eventType,
        'idempotencyKey does not match notificationId',
      );
    }
    return parsed.data;
  }

  /** An existing row is attempted again only after a retryable failure. */
  private mayStillBeSending(existing: EmailDeliveryRecord): boolean {
    const startedAt = existing.sendingStartedAt?.getTime();
    return (
      startedAt !== undefined &&
      this.clock().getTime() - startedAt < 3 * this.config.sendTimeoutMs
    );
  }

  private mayAttempt(existing: EmailDeliveryRecord): boolean {
    if (existing.status === 'FAILED') {
      return (existing.lastErrorCode ?? '').startsWith(RETRYABLE_ERROR_PREFIX);
    }
    return (
      existing.status === 'SENDING' && this.sender.supportsIdempotentResend
    );
  }

  /** Account notices are not sent once the status changed again (stale and misleading). */
  private skipReason(
    payload: NotificationEmailRequestedPayload,
    recipient: User | null,
  ): string | null {
    if (!recipient) return 'RECIPIENT_NOT_FOUND';
    if (payload.type === 'ACCOUNT_LOCKED' && recipient.status !== 'LOCKED') {
      return 'STATUS_CHANGED';
    }
    if (payload.type === 'ACCOUNT_UNLOCKED' && recipient.status !== 'ACTIVE') {
      return 'STATUS_CHANGED';
    }
    return null;
  }

  private async skip(
    delivery: NewEmailDelivery,
    existing: EmailDeliveryRecord | null,
    reason: string,
  ): Promise<void> {
    if (existing) {
      await this.deliveries.recordOutcome(
        delivery.idempotencyKey,
        existing.attempts,
        { status: 'SKIPPED', lastErrorCode: reason },
      );
      return;
    }
    await this.deliveries.recordSkippedIfAbsent(delivery, reason);
  }

  private report(
    payload: NotificationEmailRequestedPayload,
    correlationId: string,
    status: string,
    extra: Record<string, unknown>,
  ): void {
    try {
      const line = `EMAIL_DELIVERY ${JSON.stringify({
        correlationId,
        notificationId: payload.notificationId,
        type: payload.type,
        status,
        ...extra,
      })}`;
      if (status === 'SENT' || status === 'SKIPPED') this.logger?.log(line);
      else this.logger?.warn(line);
    } catch {
      // Logging never changes the delivery outcome.
    }
  }
}
