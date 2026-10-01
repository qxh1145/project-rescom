import {
  EmailSendResult,
  EmailSenderPort,
  OutboundEmail,
} from '../application/ports/email-sender.port';

export const CAPTURE_MAX_MESSAGES = 200;

/**
 * Story IR.4b B8: in-memory sender for local runs and tests. The latest
 * accepted mail is kept in `sent()` (process memory only, at most
 * `CAPTURE_MAX_MESSAGES`, never written anywhere); tests can queue the
 * outcome of the next sends with `failNext`.
 */
export class CaptureEmailSender implements EmailSenderPort {
  readonly supportsIdempotentResend = false;
  private readonly accepted: OutboundEmail[] = [];
  private readonly queued: Exclude<EmailSendResult, { outcome: 'ACCEPTED' }>[] =
    [];
  private sequence = 0;

  async send(message: OutboundEmail): Promise<EmailSendResult> {
    const forced = this.queued.shift();
    if (forced) return forced;
    this.accepted.push({ ...message });
    if (this.accepted.length > CAPTURE_MAX_MESSAGES) this.accepted.shift();
    this.sequence += 1;
    return {
      outcome: 'ACCEPTED',
      providerMessageId: `capture-${this.sequence}`,
    };
  }

  /** Every accepted message, oldest first. */
  sent(): OutboundEmail[] {
    return this.accepted.map((message) => ({ ...message }));
  }

  /** The next send resolves to `result` instead of being accepted. */
  failNext(result: Exclude<EmailSendResult, { outcome: 'ACCEPTED' }>): void {
    this.queued.push(result);
  }

  clear(): void {
    this.accepted.length = 0;
    this.queued.length = 0;
  }
}
