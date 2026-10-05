/**
 * Story IR.4b B1 (AD-7, AD-23): the only way any context sends an email.
 * Framework-free; implementations live in `notifications/infrastructure`.
 *
 * Exported by the global NotificationsModule as `EMAIL_SENDER_PORT`, so the
 * Auth context can send its password-reset email directly (plan 5.4) without
 * going through a notification.
 */
export const EMAIL_SENDER_PORT = Symbol('EMAIL_SENDER_PORT');

export interface OutboundEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Stable identity of this send; carried as the `Message-ID` local part. */
  idempotencyKey: string;
  headers?: Record<string, string>;
}

/**
 * - `ACCEPTED`: the provider took the message (`providerMessageId`).
 * - `RETRYABLE`: definitely not sent (connection refused, SMTP 4xx, auth).
 * - `PERMANENT`: will never be accepted (SMTP 5xx, invalid recipient).
 * - `AMBIGUOUS`: may or may not have been sent (timeout after `DATA`);
 *   never resent automatically.
 * - `SKIPPED`: the sender is disabled.
 *
 * `code` is a short machine code, never provider text or personal data.
 */
export type EmailSendResult =
  | { outcome: 'ACCEPTED'; providerMessageId: string }
  | { outcome: 'RETRYABLE'; code: string }
  | { outcome: 'PERMANENT'; code: string }
  | { outcome: 'AMBIGUOUS'; code: string }
  | { outcome: 'SKIPPED' };

export interface EmailSenderPort {
  /**
   * True only for a provider that deduplicates on `idempotencyKey` (or can be
   * asked for the status of a send). SMTP cannot, so an interrupted send is
   * never repeated (AD-10).
   */
  readonly supportsIdempotentResend: boolean;
  /** Never throws: every failure resolves to an outcome. */
  send(message: OutboundEmail): Promise<EmailSendResult>;
}
