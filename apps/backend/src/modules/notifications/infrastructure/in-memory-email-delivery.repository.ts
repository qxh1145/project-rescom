import {
  EmailDeliveryOutcome,
  EmailDeliveryRecord,
  EmailDeliveryRepositoryPort,
  NewEmailDelivery,
  RETRYABLE_ERROR_PREFIX,
} from '../application/ports/email-delivery.repository.port';

/** In-memory twin of `PrismaEmailDeliveryRepository` (unit tests). */
export class InMemoryEmailDeliveryRepository implements EmailDeliveryRepositoryPort {
  private readonly rows = new Map<string, EmailDeliveryRecord>();

  async findByKey(idempotencyKey: string): Promise<EmailDeliveryRecord | null> {
    const row = this.rows.get(idempotencyKey);
    return row ? { ...row } : null;
  }

  async recordSkippedIfAbsent(
    delivery: NewEmailDelivery,
    lastErrorCode: string,
  ): Promise<boolean> {
    if (this.rows.has(delivery.idempotencyKey)) return false;
    this.rows.set(delivery.idempotencyKey, {
      ...delivery,
      status: 'SKIPPED',
      attempts: 0,
      providerMessageId: null,
      lastErrorCode,
      sendingStartedAt: null,
      sentAt: null,
    });
    return true;
  }

  async claimSending(
    delivery: NewEmailDelivery,
    now: Date,
    resumeSending: boolean,
  ): Promise<number | null> {
    const row = this.rows.get(delivery.idempotencyKey);
    if (!row) {
      this.rows.set(delivery.idempotencyKey, {
        ...delivery,
        status: 'SENDING',
        attempts: 1,
        providerMessageId: null,
        lastErrorCode: null,
        sendingStartedAt: now,
        sentAt: null,
      });
      return 1;
    }
    const retryable =
      row.status === 'FAILED' &&
      (row.lastErrorCode ?? '').startsWith(RETRYABLE_ERROR_PREFIX);
    if (!retryable && !(resumeSending && row.status === 'SENDING')) return null;
    row.status = 'SENDING';
    row.attempts += 1;
    row.sendingStartedAt = now;
    return row.attempts;
  }

  async markUnconfirmed(
    idempotencyKey: string,
    code: string,
  ): Promise<boolean> {
    const row = this.rows.get(idempotencyKey);
    if (!row || row.status !== 'SENDING') return false;
    row.status = 'UNCONFIRMED';
    row.lastErrorCode = code;
    return true;
  }

  async recordOutcome(
    idempotencyKey: string,
    attempt: number,
    outcome: EmailDeliveryOutcome,
  ): Promise<void> {
    const row = this.rows.get(idempotencyKey);
    if (!row || row.attempts !== attempt) return;
    const open =
      row.status === 'SENDING' ||
      row.status === 'UNCONFIRMED' ||
      (row.status === 'FAILED' &&
        (row.lastErrorCode ?? '').startsWith(RETRYABLE_ERROR_PREFIX));
    if (!open) return;
    if (outcome.status === 'SENT') {
      row.status = 'SENT';
      row.providerMessageId = outcome.providerMessageId;
      row.sentAt = outcome.sentAt;
      row.lastErrorCode = null;
    } else {
      row.status = outcome.status;
      row.lastErrorCode = outcome.lastErrorCode;
    }
  }

  /** Test helper: every row. */
  all(): EmailDeliveryRecord[] {
    return Array.from(this.rows.values(), (row) => ({ ...row }));
  }

  /** Test helper: plant a row (e.g. a `SENDING` left by a crash). */
  seed(row: EmailDeliveryRecord): void {
    this.rows.set(row.idempotencyKey, { ...row });
  }
}
