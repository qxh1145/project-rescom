import { createTransport } from 'nodemailer';
import {
  EmailSendResult,
  EmailSenderPort,
  OutboundEmail,
} from '../application/ports/email-sender.port';

export interface SmtpEmailSenderConfig {
  host: string;
  port: number;
  /** Implicit TLS (465). */
  secure: boolean;
  /** STARTTLS required when not `secure` (false only for local Mailpit). */
  requireTls: boolean;
  username: string | null;
  password: string | null;
  from: string;
  replyTo: string | null;
  messageIdDomain: string;
  timeoutMs: number;
}

/** The part of a nodemailer transporter this adapter uses (a seam for tests). */
export interface SmtpTransport {
  sendMail(message: Record<string, unknown>): Promise<{ messageId?: string }>;
}

/**
 * `Message-ID` from the idempotency key (AD-10): `<key@domain>`, with every
 * character that is not allowed in a dot-atom replaced by `.`.
 */
export function messageIdFor(idempotencyKey: string, domain: string): string {
  const local = idempotencyKey.replace(
    /[^A-Za-z0-9!#$%&'*+\-/=?^_`{|}~.]/g,
    '.',
  );
  return `<${local}@${domain}>`;
}

interface SmtpLikeError {
  code?: unknown;
  responseCode?: unknown;
  syscall?: unknown;
  message?: unknown;
}

const RETRYABLE_CODES: Record<string, string> = {
  EAUTH: 'AUTH_FAILED',
  ENOAUTH: 'AUTH_FAILED',
  ETLS: 'TLS_FAILED',
  EREQUIRETLS: 'TLS_FAILED',
  EDNS: 'DNS_FAILED',
  ECONFIG: 'CONFIG_INVALID',
  EPROXY: 'PROXY_FAILED',
};

/**
 * Story IR.4b B-T3: maps a nodemailer failure to an outcome. Only failures
 * that prove nothing was handed over are retryable; a timeout or a dropped
 * connection mid-conversation may follow an accepted `DATA`, so it is
 * `AMBIGUOUS` and never resent. Codes only, never the server's text.
 */
export function classifySmtpError(error: unknown): EmailSendResult {
  const err = (
    typeof error === 'object' && error !== null ? error : {}
  ) as SmtpLikeError;
  const code = typeof err.code === 'string' ? err.code : '';
  const responseCode =
    typeof err.responseCode === 'number' ? err.responseCode : null;
  const message = typeof err.message === 'string' ? err.message : '';

  if (RETRYABLE_CODES[code]) {
    return { outcome: 'RETRYABLE', code: RETRYABLE_CODES[code] };
  }
  if (responseCode !== null && responseCode >= 500) {
    return { outcome: 'PERMANENT', code: `SMTP_${responseCode}` };
  }
  if (responseCode !== null && responseCode >= 400) {
    return { outcome: 'RETRYABLE', code: `SMTP_${responseCode}` };
  }
  // The socket never connected (ECONNREFUSED, EHOSTUNREACH, ENOTFOUND, …).
  if (err.syscall === 'connect' || err.syscall === 'getaddrinfo') {
    return { outcome: 'RETRYABLE', code: 'CONNECTION_FAILED' };
  }
  if (
    code === 'ETIMEDOUT' &&
    /^(Connection timeout|Greeting never received)/.test(message)
  ) {
    return { outcome: 'RETRYABLE', code: 'CONNECTION_TIMEOUT' };
  }
  if (code === 'EENVELOPE' || code === 'EMESSAGE' || code === 'ESTREAM') {
    return { outcome: 'PERMANENT', code: 'INVALID_MESSAGE' };
  }
  if (code === 'ETIMEDOUT') return { outcome: 'AMBIGUOUS', code: 'TIMEOUT' };
  return {
    outcome: 'AMBIGUOUS',
    code: code ? `CONNECTION_${code}` : 'UNKNOWN',
  };
}

/**
 * Story IR.4b B1 (AD-23): portable SMTP through nodemailer (Mailpit locally,
 * any SMTP provider later). SMTP has no idempotency key or status lookup, so
 * `supportsIdempotentResend` is false: an ambiguous send is never repeated.
 * nodemailer's own logger stays off (it would print recipients).
 */
export class SmtpEmailSender implements EmailSenderPort {
  readonly supportsIdempotentResend = false;
  private readonly transport: SmtpTransport;

  constructor(
    private readonly config: SmtpEmailSenderConfig,
    transport?: SmtpTransport,
  ) {
    this.transport =
      transport ??
      createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        requireTLS: !config.secure && config.requireTls,
        ignoreTLS: !config.secure && !config.requireTls,
        auth:
          config.username && config.password
            ? { user: config.username, pass: config.password }
            : undefined,
        // Connect + greeting together stay under the send deadline, so a
        // host that never answers fails as retryable CONNECTION_TIMEOUT
        // (nothing handed over) instead of AMBIGUOUS:DEADLINE (review
        // 2026-10-01).
        connectionTimeout: Math.floor(config.timeoutMs / 3),
        greetingTimeout: Math.floor(config.timeoutMs / 3),
        socketTimeout: config.timeoutMs,
        logger: false,
        debug: false,
      });
  }

  async send(message: OutboundEmail): Promise<EmailSendResult> {
    const messageId = messageIdFor(
      message.idempotencyKey,
      this.config.messageIdDomain,
    );
    // Review M3: one hard deadline for the whole send. nodemailer's
    // connection, greeting and socket timeouts would otherwise stack.
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<EmailSendResult>((resolve) => {
      timer = setTimeout(
        () => resolve({ outcome: 'AMBIGUOUS', code: 'DEADLINE' }),
        this.config.timeoutMs,
      );
    });
    try {
      return await Promise.race([this.deliver(message, messageId), deadline]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async deliver(
    message: OutboundEmail,
    messageId: string,
  ): Promise<EmailSendResult> {
    try {
      await this.transport.sendMail({
        from: this.config.from,
        to: message.to,
        replyTo: this.config.replyTo ?? undefined,
        subject: message.subject,
        text: message.text,
        html: message.html,
        messageId,
        headers: message.headers,
      });
      return { outcome: 'ACCEPTED', providerMessageId: messageId };
    } catch (error) {
      return classifySmtpError(error);
    }
  }
}
