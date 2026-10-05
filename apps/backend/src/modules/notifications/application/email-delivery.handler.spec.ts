import { notificationEmailKey } from '@rescom/schemas';
import {
  OutboxEnvelope,
  OutboxPayloadInvalidError,
} from '../../../common/scheduler/outbox/outbox-handler';
import { User } from '../../users/domain/user.entity';
import { CaptureEmailSender } from '../infrastructure/capture-email-sender';
import { InMemoryEmailDeliveryRepository } from '../infrastructure/in-memory-email-delivery.repository';
import {
  EMAIL_MAX_EVENT_AGE_MS,
  EmailDeliveryHandler,
  EmailSendRetryableError,
} from './email-delivery.handler';

describe('Story IR.4b B5/B6: EmailDeliveryHandler', () => {
  const userId = '22222222-2222-4222-8222-222222222222';
  const notificationId = '11111111-1111-4111-8111-111111111111';
  const key = notificationEmailKey(notificationId);
  const email = 'private.person@example.com';
  const now = new Date('2026-10-01T09:00:00.000Z');

  let deliveries: InMemoryEmailDeliveryRepository;
  let sender: CaptureEmailSender;
  let users: Map<string, User>;
  let lines: string[];
  let handler: EmailDeliveryHandler;

  function event(overrides: Partial<OutboxEnvelope> = {}): OutboxEnvelope {
    return {
      id: '33333333-3333-4333-8333-333333333333',
      idempotencyKey: key,
      eventType: 'NotificationEmailRequested',
      schemaVersion: 1,
      producer: 'notifications-service',
      aggregateType: 'Notification',
      aggregateId: notificationId,
      aggregateVersion: 1,
      orderingStream: null,
      streamSequence: null,
      correlationId: null,
      causationId: null,
      payload: {
        schemaVersion: 1,
        notificationId,
        userId,
        type: 'TOPUP_REJECTED',
      },
      attempts: 1,
      createdAt: new Date(now.getTime() - 60_000),
      ...overrides,
    };
  }

  function setUser(status: 'ACTIVE' | 'LOCKED' = 'ACTIVE') {
    users.set(
      userId,
      new User({
        id: userId,
        email,
        passwordHash: null,
        role: 'PUBLISHER',
        status,
      }),
    );
  }

  beforeEach(() => {
    deliveries = new InMemoryEmailDeliveryRepository();
    sender = new CaptureEmailSender();
    users = new Map();
    lines = [];
    setUser();
    handler = new EmailDeliveryHandler(
      deliveries,
      sender,
      { findById: async (id) => users.get(id) ?? null },
      {
        appBaseUrl: 'https://app.rescom.test',
        supportEmail: 'hotro@rescom.test',
        sendTimeoutMs: 10_000,
      },
      { log: (line) => lines.push(line), warn: (line) => lines.push(line) },
      () => now,
    );
  });

  it('sends once, records SENT with the provider id, and a replay sends nothing', async () => {
    await handler.handle(event());
    await handler.handle(event());
    await handler.handle(event({ attempts: 2 }));

    expect(sender.sent()).toHaveLength(1);
    expect(sender.sent()[0]).toMatchObject({
      to: email,
      subject: 'Rescom: Yêu cầu nạp điểm chưa được duyệt',
      idempotencyKey: key,
    });
    expect(deliveries.all()).toEqual([
      expect.objectContaining({
        idempotencyKey: key,
        status: 'SENT',
        attempts: 1,
        providerMessageId: 'capture-1',
        lastErrorCode: null,
      }),
    ]);
  });

  function seedSending(startedMsAgo: number) {
    deliveries.seed({
      idempotencyKey: key,
      notificationId,
      userId,
      notificationType: 'TOPUP_REJECTED',
      status: 'SENDING',
      attempts: 1,
      providerMessageId: null,
      lastErrorCode: null,
      sendingStartedAt: new Date(now.getTime() - startedMsAgo),
      sentAt: null,
    });
  }

  it('retries later, without touching it, a SENDING row that may still be in flight (M3)', async () => {
    seedSending(29_000); // < 3 × 10 s send deadline
    await expect(handler.handle(event())).rejects.toThrow(
      new EmailSendRetryableError('SEND_IN_PROGRESS'),
    );
    expect(sender.sent()).toHaveLength(0);
    expect(deliveries.all()[0]).toMatchObject({
      status: 'SENDING',
      attempts: 1,
    });
  });

  it('turns an abandoned SENDING row (crash) into UNCONFIRMED without sending', async () => {
    seedSending(31_000);

    await handler.handle(event());
    await handler.handle(event());

    expect(sender.sent()).toHaveLength(0);
    expect(deliveries.all()[0]).toMatchObject({
      status: 'UNCONFIRMED',
      lastErrorCode: 'AMBIGUOUS:INTERRUPTED_SEND',
    });
  });

  it('records a retryable failure as FAILED and rethrows; the retry sends once', async () => {
    sender.failNext({ outcome: 'RETRYABLE', code: 'SMTP_421' });
    await expect(handler.handle(event())).rejects.toThrow(
      EmailSendRetryableError,
    );
    expect(deliveries.all()[0]).toMatchObject({
      status: 'FAILED',
      attempts: 1,
      lastErrorCode: 'RETRYABLE:SMTP_421',
    });

    await handler.handle(event({ attempts: 2 }));
    expect(sender.sent()).toHaveLength(1);
    expect(deliveries.all()[0]).toMatchObject({ status: 'SENT', attempts: 2 });
  });

  it('records a permanent failure terminally and acknowledges', async () => {
    sender.failNext({ outcome: 'PERMANENT', code: 'SMTP_550' });
    await expect(handler.handle(event())).resolves.toBeUndefined();
    await handler.handle(event({ attempts: 2 }));

    expect(sender.sent()).toHaveLength(0);
    expect(deliveries.all()[0]).toMatchObject({
      status: 'FAILED',
      attempts: 1,
      lastErrorCode: 'PERMANENT:SMTP_550',
    });
  });

  it('records an ambiguous send as UNCONFIRMED and never resends it', async () => {
    sender.failNext({ outcome: 'AMBIGUOUS', code: 'TIMEOUT' });
    await handler.handle(event());
    await handler.handle(event({ attempts: 2 }));

    expect(sender.sent()).toHaveLength(0);
    expect(deliveries.all()[0]).toMatchObject({
      status: 'UNCONFIRMED',
      lastErrorCode: 'AMBIGUOUS:TIMEOUT',
    });
  });

  it('skips a missing recipient', async () => {
    users.clear();
    await handler.handle(event());
    expect(sender.sent()).toHaveLength(0);
    expect(deliveries.all()[0]).toMatchObject({
      status: 'SKIPPED',
      lastErrorCode: 'RECIPIENT_NOT_FOUND',
    });
  });

  it('skips an account notice whose status changed again before delivery', async () => {
    setUser('ACTIVE');
    await handler.handle(
      event({
        payload: {
          schemaVersion: 1,
          notificationId,
          userId,
          type: 'ACCOUNT_LOCKED',
        },
      }),
    );
    expect(sender.sent()).toHaveLength(0);
    expect(deliveries.all()[0]).toMatchObject({
      status: 'SKIPPED',
      lastErrorCode: 'STATUS_CHANGED',
    });
  });

  it('sends ACCOUNT_LOCKED to a locked user (no app link)', async () => {
    setUser('LOCKED');
    await handler.handle(
      event({
        payload: {
          schemaVersion: 1,
          notificationId,
          userId,
          type: 'ACCOUNT_LOCKED',
        },
      }),
    );
    expect(sender.sent()).toHaveLength(1);
    expect(sender.sent()[0].text).not.toContain('https://');
  });

  it('skips a request older than 24 hours (backlog safety)', async () => {
    await handler.handle(
      event({
        createdAt: new Date(now.getTime() - EMAIL_MAX_EVENT_AGE_MS - 1),
      }),
    );
    expect(sender.sent()).toHaveLength(0);
    expect(deliveries.all()[0]).toMatchObject({
      status: 'SKIPPED',
      lastErrorCode: 'STALE_EVENT',
    });
  });

  it('skips a stale retry of a FAILED delivery instead of resending', async () => {
    sender.failNext({ outcome: 'RETRYABLE', code: 'SMTP_421' });
    await expect(handler.handle(event())).rejects.toThrow(
      EmailSendRetryableError,
    );

    await handler.handle(
      event({
        attempts: 2,
        createdAt: new Date(now.getTime() - EMAIL_MAX_EVENT_AGE_MS - 1),
      }),
    );

    expect(sender.sent()).toHaveLength(0);
    expect(deliveries.all()[0]).toMatchObject({
      status: 'SKIPPED',
      lastErrorCode: 'STALE_EVENT',
    });
  });

  it('records SKIPPED when the sender is disabled', async () => {
    const disabled = new EmailDeliveryHandler(
      deliveries,
      {
        supportsIdempotentResend: false,
        send: async () => ({ outcome: 'SKIPPED' }),
      },
      { findById: async (id) => users.get(id) ?? null },
      {
        appBaseUrl: 'https://app.rescom.test',
        supportEmail: null,
        sendTimeoutMs: 10_000,
      },
      undefined,
      () => now,
    );
    await disabled.handle(event());
    expect(deliveries.all()[0]).toMatchObject({
      status: 'SKIPPED',
      lastErrorCode: 'SENDER_DISABLED',
    });
  });

  it.each([
    [
      'extra keys',
      {
        schemaVersion: 1,
        notificationId,
        userId,
        type: 'TOPUP_REJECTED',
        email,
      },
    ],
    [
      'a non-email type',
      { schemaVersion: 1, notificationId, userId, type: 'WARNING' },
    ],
    ['a missing id', { schemaVersion: 1, userId, type: 'TOPUP_REJECTED' }],
  ])(
    'rejects a payload with %s as invalid (dead letter)',
    async (_label, payload) => {
      await expect(handler.handle(event({ payload }))).rejects.toThrow(
        OutboxPayloadInvalidError,
      );
      expect(deliveries.all()).toEqual([]);
    },
  );

  it('rejects an idempotency key that does not belong to the notification', async () => {
    await expect(
      handler.handle(event({ idempotencyKey: 'notification-email:other' })),
    ).rejects.toThrow(OutboxPayloadInvalidError);
  });

  it('never logs the address, subject, body or link (B7)', async () => {
    sender.failNext({ outcome: 'RETRYABLE', code: 'SMTP_421' });
    await expect(handler.handle(event())).rejects.toThrow();
    await handler.handle(event({ attempts: 2 }));
    await handler.handle(event({ attempts: 3 }));

    expect(lines.length).toBeGreaterThanOrEqual(3);
    const sent = sender.sent()[0];
    for (const line of lines) {
      expect(line).toMatch(/^EMAIL_DELIVERY /);
      expect(line).toContain(notificationId);
      expect(line).not.toContain(email);
      expect(line).not.toContain(sent.subject);
      expect(line).not.toContain('https://');
      expect(line).not.toContain('Ví Rescom');
    }
    // The retry error that reaches `outbox_events.last_error` carries a code only.
    expect(new EmailSendRetryableError('SMTP_421').message).toBe(
      'email send retryable (SMTP_421)',
    );
  });
});
