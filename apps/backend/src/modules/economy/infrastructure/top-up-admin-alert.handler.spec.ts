import {
  TopUpAdminAlertHandler,
  TopUpAdminAlertRetryableError,
} from './top-up-admin-alert.handler';
import {
  OutboxEnvelope,
  OutboxPayloadInvalidError,
} from '../../../common/scheduler/outbox/outbox-handler';
import { AdminCapabilityPort } from '../application/ports/admin-capability.port';
import { NotificationPublisherPort } from '../../notifications/application/ports/notification-publisher.port';
import { EmailSenderPort } from '../../notifications/application/ports/email-sender.port';

describe('TopUpAdminAlertHandler', () => {
  const sampleEvent: OutboxEnvelope = {
    id: 'outbox-1',
    idempotencyKey: 'topup-alert:UNCREDITED_AFTER_PAYMENT:topup-1',
    eventType: 'ECONOMY_TOPUP_ADMIN_ALERT',
    schemaVersion: 1,
    producer: 'economy-service',
    aggregateType: 'TopUpAdminAlert',
    aggregateId: 'topup-1',
    aggregateVersion: 1,
    orderingStream: null,
    streamSequence: null,
    correlationId: null,
    causationId: null,
    payload: {
      schemaVersion: 1,
      condition: 'UNCREDITED_AFTER_PAYMENT',
      topUpId: '2fb40564-05e2-4496-a043-bb3036001ad1',
      orderCode: 12345,
      amountVnd: 50000,
      occurredAt: '2026-10-15T12:00:00.000Z',
    },
    attempts: 1,
    createdAt: new Date('2026-10-15T12:00:00.000Z'),
  };

  it('fans out in-app notifications to all active admins with same dedupeKey', async () => {
    const adminCapability: AdminCapabilityPort = {
      findCurrentCapability: jest.fn(),
      listActiveAdminIds: jest.fn().mockResolvedValue(['admin-1', 'admin-2']),
    };
    const notifications: NotificationPublisherPort = {
      publish: jest.fn().mockResolvedValue('CREATED'),
    };
    const emailSender: EmailSenderPort = {
      supportsIdempotentResend: true,
      send: jest
        .fn()
        .mockResolvedValue({ outcome: 'ACCEPTED', providerMessageId: 'msg-1' }),
    };
    const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };

    const handler = new TopUpAdminAlertHandler(
      adminCapability,
      notifications,
      emailSender,
      () => 'refunds@rescom.vn',
      logger,
    );

    await handler.handle(sampleEvent);

    expect(notifications.publish).toHaveBeenCalledTimes(2);
    expect(notifications.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'admin-1',
        type: 'WARNING',
        dedupeKey: sampleEvent.idempotencyKey,
      }),
    );
    expect(notifications.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'admin-2',
        type: 'WARNING',
        dedupeKey: sampleEvent.idempotencyKey,
      }),
    );
  });

  it('one admin publish failure does not stop others, still runs email + sentry legs, then retries', async () => {
    const adminCapability: AdminCapabilityPort = {
      findCurrentCapability: jest.fn(),
      listActiveAdminIds: jest
        .fn()
        .mockResolvedValue(['admin-fail', 'admin-ok']),
    };
    const notifications: NotificationPublisherPort = {
      publish: jest.fn().mockImplementation(async ({ userId }) => {
        if (userId === 'admin-fail') throw new Error('network down');
        return 'CREATED';
      }),
    };
    const emailSender: EmailSenderPort = {
      supportsIdempotentResend: true,
      send: jest
        .fn()
        .mockResolvedValue({ outcome: 'ACCEPTED', providerMessageId: 'msg-1' }),
    };
    const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };

    const handler = new TopUpAdminAlertHandler(
      adminCapability,
      notifications,
      emailSender,
      () => 'refunds@rescom.vn',
      logger,
    );

    await expect(handler.handle(sampleEvent)).rejects.toBeInstanceOf(
      TopUpAdminAlertRetryableError,
    );
    expect(notifications.publish).toHaveBeenCalledTimes(2);
    expect(emailSender.send).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      'payos-admin-alert',
      expect.anything(),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('admin-fail'),
    );
  });

  it('retries when listing active admins throws, after email and sentry legs', async () => {
    const adminCapability: AdminCapabilityPort = {
      findCurrentCapability: jest.fn(),
      listActiveAdminIds: jest.fn().mockRejectedValue(new Error('db down')),
    };
    const notifications: NotificationPublisherPort = {
      publish: jest.fn(),
    };
    const emailSender: EmailSenderPort = {
      supportsIdempotentResend: true,
      send: jest
        .fn()
        .mockResolvedValue({ outcome: 'ACCEPTED', providerMessageId: 'msg-1' }),
    };
    const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const handler = new TopUpAdminAlertHandler(
      adminCapability,
      notifications,
      emailSender,
      () => 'refunds@rescom.vn',
      logger,
    );

    await expect(handler.handle(sampleEvent)).rejects.toBeInstanceOf(
      TopUpAdminAlertRetryableError,
    );
    expect(emailSender.send).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      'payos-admin-alert',
      expect.anything(),
    );
  });

  it('throws TopUpAdminAlertRetryableError when email send is RETRYABLE', async () => {
    const adminCapability: AdminCapabilityPort = {
      findCurrentCapability: jest.fn(),
      listActiveAdminIds: jest.fn().mockResolvedValue([]),
    };
    const notifications: NotificationPublisherPort = {
      publish: jest.fn().mockResolvedValue('CREATED'),
    };
    const emailSender: EmailSenderPort = {
      supportsIdempotentResend: true,
      send: jest
        .fn()
        .mockResolvedValue({ outcome: 'RETRYABLE', code: 'SMTP_TIMEOUT' }),
    };
    const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };

    const handler = new TopUpAdminAlertHandler(
      adminCapability,
      notifications,
      emailSender,
      () => 'refunds@rescom.vn',
      logger,
    );

    await expect(handler.handle(sampleEvent)).rejects.toBeInstanceOf(
      TopUpAdminAlertRetryableError,
    );
  });

  it('does not throw on PERMANENT or AMBIGUOUS email failure, logs error instead', async () => {
    const adminCapability: AdminCapabilityPort = {
      findCurrentCapability: jest.fn(),
      listActiveAdminIds: jest.fn().mockResolvedValue([]),
    };
    const notifications: NotificationPublisherPort = {
      publish: jest.fn().mockResolvedValue('CREATED'),
    };
    const emailSender: EmailSenderPort = {
      supportsIdempotentResend: true,
      send: jest
        .fn()
        .mockResolvedValue({ outcome: 'PERMANENT', code: 'MAILBOX_NOT_FOUND' }),
    };
    const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };

    const handler = new TopUpAdminAlertHandler(
      adminCapability,
      notifications,
      emailSender,
      () => 'refunds@rescom.vn',
      logger,
    );

    await expect(handler.handle(sampleEvent)).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining(
        'Refund mailbox email failed permanently or ambiguously: PERMANENT (MAILBOX_NOT_FOUND)',
      ),
    );
  });

  it('skips email leg when mailbox is null', async () => {
    const adminCapability: AdminCapabilityPort = {
      findCurrentCapability: jest.fn(),
      listActiveAdminIds: jest.fn().mockResolvedValue([]),
    };
    const notifications: NotificationPublisherPort = {
      publish: jest.fn().mockResolvedValue('CREATED'),
    };
    const emailSender: EmailSenderPort = {
      supportsIdempotentResend: true,
      send: jest.fn(),
    };
    const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };

    const handler = new TopUpAdminAlertHandler(
      adminCapability,
      notifications,
      emailSender,
      () => null,
      logger,
    );

    await handler.handle(sampleEvent);
    expect(emailSender.send).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'TopUp admin alert email skipped: refund mailbox is not configured',
      ),
    );
  });

  it('logs sentry alert with ids only (no PII, account numbers or email addresses)', async () => {
    const adminCapability: AdminCapabilityPort = {
      findCurrentCapability: jest.fn(),
      listActiveAdminIds: jest.fn().mockResolvedValue([]),
    };
    const notifications: NotificationPublisherPort = {
      publish: jest.fn(),
    };
    const emailSender: EmailSenderPort = {
      supportsIdempotentResend: true,
      send: jest
        .fn()
        .mockResolvedValue({ outcome: 'ACCEPTED', providerMessageId: 'id-1' }),
    };
    const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };

    const handler = new TopUpAdminAlertHandler(
      adminCapability,
      notifications,
      emailSender,
      () => 'refunds@rescom.vn',
      logger,
    );

    await handler.handle(sampleEvent);
    expect(logger.error).toHaveBeenCalledWith('payos-admin-alert', {
      condition: 'UNCREDITED_AFTER_PAYMENT',
      topUpId: '2fb40564-05e2-4496-a043-bb3036001ad1',
      orderCode: 12345,
    });
  });

  it('rejects invalid payload immediately with OutboxPayloadInvalidError', async () => {
    const adminCapability: AdminCapabilityPort = {
      findCurrentCapability: jest.fn(),
      listActiveAdminIds: jest.fn(),
    };
    const notifications: NotificationPublisherPort = {
      publish: jest.fn(),
    };
    const emailSender: EmailSenderPort = {
      supportsIdempotentResend: true,
      send: jest.fn(),
    };

    const handler = new TopUpAdminAlertHandler(
      adminCapability,
      notifications,
      emailSender,
      () => null,
    );

    await expect(
      handler.handle({ ...sampleEvent, payload: { bad: 'payload' } }),
    ).rejects.toBeInstanceOf(OutboxPayloadInvalidError);
  });

  it('renders and publishes REFUND_SLA_BREACHED message', async () => {
    const adminCapability: AdminCapabilityPort = {
      findCurrentCapability: jest.fn(),
      listActiveAdminIds: jest.fn().mockResolvedValue(['admin-1']),
    };
    const notifications: NotificationPublisherPort = {
      publish: jest.fn().mockResolvedValue('CREATED'),
    };
    const emailSender: EmailSenderPort = {
      supportsIdempotentResend: true,
      send: jest
        .fn()
        .mockResolvedValue({ outcome: 'ACCEPTED', providerMessageId: 'msg-1' }),
    };

    const handler = new TopUpAdminAlertHandler(
      adminCapability,
      notifications,
      emailSender,
      () => 'refunds@rescom.vn',
    );

    await handler.handle({
      ...sampleEvent,
      payload: {
        schemaVersion: 1,
        condition: 'REFUND_SLA_BREACHED',
        topUpId: '00000000-0000-4000-8000-000000000001',
        orderCode: 9999,
        refundRequestId: '00000000-0000-4000-8000-000000000002',
        occurredAt: new Date().toISOString(),
      },
    });

    expect(notifications.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'admin-1',
        type: 'WARNING',
        message: expect.stringContaining(
          'Yêu cầu hoàn tiền #9999 quá hạn 3 ngày làm việc — xử lý tại /admin/top-ups?tab=refunds&request=00000000-0000-4000-8000-000000000002.',
        ),
      }),
    );
    expect(emailSender.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'refunds@rescom.vn',
        subject: '[Cảnh báo đối soát RESCOM] REFUND_SLA_BREACHED #9999',
      }),
    );
  });
  it('REFUND_SLA_BREACHED omits &request= when refundRequestId is absent', async () => {
    const notifications: NotificationPublisherPort = {
      publish: jest.fn().mockResolvedValue('CREATED'),
    };
    const handler = new TopUpAdminAlertHandler(
      {
        findCurrentCapability: jest.fn(),
        listActiveAdminIds: jest.fn().mockResolvedValue(['admin-1']),
      },
      notifications,
      {
        supportsIdempotentResend: true,
        send: jest.fn().mockResolvedValue({
          outcome: 'ACCEPTED',
          providerMessageId: 'msg-1',
        }),
      },
      () => null,
    );

    await handler.handle({
      ...sampleEvent,
      payload: {
        schemaVersion: 1,
        condition: 'REFUND_SLA_BREACHED',
        topUpId: '00000000-0000-4000-8000-000000000001',
        orderCode: 9999,
        occurredAt: new Date().toISOString(),
      },
    });

    const message = (notifications.publish as jest.Mock).mock.calls[0][0]
      .message as string;
    expect(message).toContain('/admin/top-ups?tab=refunds.');
    expect(message).not.toContain('request=');
  });
});
