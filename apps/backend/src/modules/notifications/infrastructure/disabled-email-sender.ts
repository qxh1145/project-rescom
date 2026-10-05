import {
  EmailSendResult,
  EmailSenderPort,
} from '../application/ports/email-sender.port';

/** Story IR.4b B1: `EMAIL_DELIVERY_MODE=disabled`; every send is `SKIPPED`. */
export class DisabledEmailSender implements EmailSenderPort {
  readonly supportsIdempotentResend = false;

  async send(): Promise<EmailSendResult> {
    return { outcome: 'SKIPPED' };
  }
}
