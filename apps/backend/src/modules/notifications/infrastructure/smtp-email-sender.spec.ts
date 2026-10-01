import {
  SmtpEmailSender,
  SmtpEmailSenderConfig,
  SmtpTransport,
  classifySmtpError,
  messageIdFor,
} from './smtp-email-sender';
import { describeEmailSenderContract } from './email-sender.contract-spec';

const config: SmtpEmailSenderConfig = {
  host: 'smtp.example.com',
  port: 587,
  secure: false,
  requireTls: true,
  username: 'user',
  password: 'super-secret-smtp-password',
  from: 'Rescom <no-reply@rescom.test>',
  replyTo: 'support@rescom.test',
  messageIdDomain: 'rescom.test',
  timeoutMs: 1000,
};

/** Errors shaped like nodemailer's (`code`, `responseCode`, `command`). */
function smtpError(fields: Record<string, unknown>): Error {
  return Object.assign(
    new Error(String(fields.message ?? 'smtp error')),
    fields,
  );
}

class StubTransport implements SmtpTransport {
  readonly mails: Record<string, unknown>[] = [];
  readonly failures: Error[] = [];

  async sendMail(
    mail: Record<string, unknown>,
  ): Promise<{ messageId?: string }> {
    const failure = this.failures.shift();
    if (failure) throw failure;
    this.mails.push(mail);
    return { messageId: String(mail.messageId) };
  }
}

describeEmailSenderContract('SmtpEmailSender (stub transport)', () => {
  const transport = new StubTransport();
  const sender = new SmtpEmailSender(config, transport);
  const failures = {
    RETRYABLE: smtpError({
      code: 'EENVELOPE',
      responseCode: 451,
      command: 'RCPT TO',
    }),
    PERMANENT: smtpError({
      code: 'EENVELOPE',
      responseCode: 550,
      command: 'RCPT TO',
    }),
    AMBIGUOUS: smtpError({
      code: 'ETIMEDOUT',
      message: 'Timeout',
      command: 'CONN',
    }),
  };
  return {
    sender,
    failNext: (kind) => transport.failures.push(failures[kind]),
    carried: (key) =>
      transport.mails.some(
        (mail) => mail.messageId === messageIdFor(key, config.messageIdDomain),
      ),
    acceptedCount: () => transport.mails.length,
  };
});

describe('SmtpEmailSender', () => {
  it('sends from the configured sender with a deterministic Message-ID', async () => {
    const transport = new StubTransport();
    const result = await new SmtpEmailSender(config, transport).send({
      to: 'someone@example.com',
      subject: 'Chủ đề',
      text: 'văn bản',
      html: '<p>văn bản</p>',
      idempotencyKey: 'notification-email:11111111-1111-4111-8111-111111111111',
    });
    expect(result).toEqual({
      outcome: 'ACCEPTED',
      providerMessageId:
        '<notification-email.11111111-1111-4111-8111-111111111111@rescom.test>',
    });
    expect(transport.mails[0]).toMatchObject({
      from: config.from,
      replyTo: config.replyTo,
      to: 'someone@example.com',
      subject: 'Chủ đề',
    });
  });

  it('builds a valid Message-ID from any key', () => {
    expect(messageIdFor('password-reset:abc def<x>', 'd.test')).toBe(
      '<password-reset.abc.def.x.@d.test>',
    );
  });
});

describe('SmtpEmailSender hard deadline (review M3)', () => {
  it('reports a send that outlives timeoutMs as AMBIGUOUS DEADLINE', async () => {
    jest.useFakeTimers();
    try {
      const hanging: SmtpTransport = { sendMail: () => new Promise(() => {}) };
      const pending = new SmtpEmailSender(
        { ...config, timeoutMs: 5_000 },
        hanging,
      ).send({
        to: 'a@example.com',
        subject: 's',
        text: 't',
        html: 'h',
        idempotencyKey: 'k',
      });
      await jest.advanceTimersByTimeAsync(5_000);
      await expect(pending).resolves.toEqual({
        outcome: 'AMBIGUOUS',
        code: 'DEADLINE',
      });
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('classifySmtpError (B5)', () => {
  it.each([
    [
      { code: 'ESOCKET', syscall: 'connect', errno: -61 },
      'RETRYABLE',
      'CONNECTION_FAILED',
    ],
    [{ code: 'EDNS' }, 'RETRYABLE', 'DNS_FAILED'],
    [{ code: 'EAUTH', responseCode: 535 }, 'RETRYABLE', 'AUTH_FAILED'],
    [{ code: 'ETLS' }, 'RETRYABLE', 'TLS_FAILED'],
    [
      { code: 'ETIMEDOUT', message: 'Connection timeout' },
      'RETRYABLE',
      'CONNECTION_TIMEOUT',
    ],
    [
      { code: 'ETIMEDOUT', message: 'Greeting never received' },
      'RETRYABLE',
      'CONNECTION_TIMEOUT',
    ],
    [{ code: 'EENVELOPE', responseCode: 421 }, 'RETRYABLE', 'SMTP_421'],
    [
      { code: 'EMESSAGE', responseCode: 452, command: 'DATA' },
      'RETRYABLE',
      'SMTP_452',
    ],
    [{ code: 'EENVELOPE', responseCode: 550 }, 'PERMANENT', 'SMTP_550'],
    [
      { code: 'EMESSAGE', responseCode: 554, command: 'DATA' },
      'PERMANENT',
      'SMTP_554',
    ],
    [
      { code: 'EENVELOPE', message: 'No recipients defined' },
      'PERMANENT',
      'INVALID_MESSAGE',
    ],
    [{ code: 'ETIMEDOUT', message: 'Timeout' }, 'AMBIGUOUS', 'TIMEOUT'],
    [
      { code: 'ECONNECTION', message: 'Connection closed unexpectedly' },
      'AMBIGUOUS',
      'CONNECTION_ECONNECTION',
    ],
    [
      { code: 'ESOCKET', message: 'read ECONNRESET' },
      'AMBIGUOUS',
      'CONNECTION_ESOCKET',
    ],
    [{}, 'AMBIGUOUS', 'UNKNOWN'],
  ])('%j → %s %s', (fields, outcome, code) => {
    expect(classifySmtpError(smtpError(fields))).toEqual({ outcome, code });
  });

  it('never copies server text into the code', () => {
    const result = classifySmtpError(
      smtpError({
        code: 'EENVELOPE',
        responseCode: 550,
        response: '550 5.1.1 <victim@example.com>: Recipient address rejected',
      }),
    );
    expect(JSON.stringify(result)).not.toContain('example.com');
  });
});
