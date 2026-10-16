import { InMemoryNotificationRepository } from '../../notifications/infrastructure/in-memory-notification.repository';
import { NotificationsService } from '../../notifications/application/notifications.service';
import { TopUpNotificationHandler } from './top-up-notification.handler';
import {
  OutboxEnvelope,
  OutboxPayloadInvalidError,
} from '../../../common/scheduler/outbox/outbox-handler';
import { NotificationPublisherPort } from '../../notifications/application/ports/notification-publisher.port';

describe('TopUpNotificationHandler', () => {
  it('dispatches success to one notification and one email request; mismatch has no email', async () => {
    const repository = new InMemoryNotificationRepository();
    const publisher = new NotificationsService(
      repository,
      undefined,
      undefined,
      { emailRequests: true },
    );
    const handler = new TopUpNotificationHandler(publisher);
    const payload = {
      schemaVersion: 1,
      topUpId: '2fb40564-05e2-4496-a043-bb3036001ad1',
      userId: '2fb40564-05e2-4496-a043-bb3036001ad1',
      orderCode: 1000000000,
      amountVnd: 10000,
      points: 50,
      status: 'SUCCESSFUL',
      occurredAt: '2026-10-15T00:00:00.000Z',
    };
    const event = {
      eventType: handler.eventType,
      idempotencyKey: `topup-credit:${payload.topUpId}`,
      payload,
    } as OutboxEnvelope;
    await handler.handle(event);
    await handler.handle(event);
    expect(
      await repository.countForUser(payload.userId, { unreadOnly: false }),
    ).toBe(1);
    expect(repository.outboxEvents).toHaveLength(1);
    await handler.handle({
      ...event,
      idempotencyKey: `topup-mismatch-notice:${payload.topUpId}:5000`,
      payload: { ...payload, status: 'AMOUNT_MISMATCH', amountPaidVnd: 5000 },
    });
    expect(
      await repository.countForUser(payload.userId, { unreadOnly: false }),
    ).toBe(2);
    expect(repository.outboxEvents).toHaveLength(1);
  });
  it('sends mismatch credit and refund messages without exposing resolution note', async () => {
    const publish = jest.fn();
    const handler = new TopUpNotificationHandler({
      publish,
    } as unknown as NotificationPublisherPort);
    const payload = {
      schemaVersion: 1,
      topUpId: '2fb40564-05e2-4496-a043-bb3036001ad1',
      userId: '2fb40564-05e2-4496-a043-bb3036001ad1',
      orderCode: 1000000000,
      amountVnd: 100000,
      points: 490,
      amountPaidVnd: 98100,
      status: 'SUCCESSFUL',
      resolution: 'ADMIN_CREDIT',
      remainderVnd: 100,
      occurredAt: '2026-10-15T00:00:00.000Z',
    };
    await handler.handle({
      eventType: handler.eventType,
      idempotencyKey: 'topup-mismatch:x',
      payload,
    } as OutboxEnvelope);
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'TOPUP_SUCCESS',
        message: expect.stringContaining(
          '100 VNĐ lẻ dưới 200 VNĐ không được quy đổi',
        ),
      }),
    );
    await handler.handle({
      eventType: handler.eventType,
      idempotencyKey: 'topup-mismatch:y',
      payload: {
        ...payload,
        status: 'MANUAL_REFUNDED',
        points: 0,
        resolution: 'ADMIN_REFUND',
      },
    } as OutboxEnvelope);
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'TOPUP_REFUNDED',
        message: expect.stringContaining('98.100 VNĐ'),
      }),
    );
  });

  it('publishes cancellation using event dedupe key; rejects invalid payload', async () => {
    const publish = jest.fn();
    const handler = new TopUpNotificationHandler({
      publish,
    } as unknown as NotificationPublisherPort);
    const event = {
      eventType: handler.eventType,
      idempotencyKey: 'topup-cancel:x',
      payload: {
        schemaVersion: 1,
        topUpId: '2fb40564-05e2-4496-a043-bb3036001ad1',
        userId: '2fb40564-05e2-4496-a043-bb3036001ad1',
        orderCode: 1000000000,
        amountVnd: 10000,
        points: 50,
        status: 'CANCELLED',
        occurredAt: '2026-10-15T00:00:00.000Z',
      },
    } as OutboxEnvelope;
    await handler.handle(event);
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'TOPUP_CANCELLED',
        dedupeKey: 'topup-cancel:x',
        message: expect.stringContaining('10.000 VNĐ'),
      }),
    );
    expect(publish).toHaveBeenLastCalledWith(
      expect.objectContaining({
        message:
          'Giao dịch nạp 10.000 VNĐ (mã 1000000000) đã được huỷ. Không có Điểm nào thay đổi.',
      }),
    );
    // Pre-13.9 copy stays byte-identical.
    for (const [status, type, message] of [
      [
        'SUCCESSFUL',
        'TOPUP_SUCCESS',
        'Nạp 10.000 VNĐ thành công: 50 Điểm đã được cộng vào số dư Khả dụng.',
      ],
      [
        'AMOUNT_MISMATCH',
        'TOPUP_AMOUNT_MISMATCH',
        'Giao dịch nạp 10.000 VNĐ (mã 1000000000) nhận 5.000 VNĐ, khác số tiền yêu cầu. Chưa có Điểm nào được cộng; Admin sẽ xem xét trong 3 ngày làm việc.',
      ],
    ] as const) {
      await handler.handle({
        ...event,
        idempotencyKey: status,
        payload: { ...(event.payload as object), status, amountPaidVnd: 5000 },
      });
      expect(publish).toHaveBeenCalledWith(
        expect.objectContaining({ type, dedupeKey: status, message }),
      );
    }

    await handler.handle({
      ...event,
      idempotencyKey: 'topup-expire:x',
      payload: { ...(event.payload as object), status: 'EXPIRED' },
    });
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'TOPUP_CANCELLED',
        dedupeKey: 'topup-expire:x',
        message:
          'Yêu cầu nạp 10.000 VNĐ đã hết hạn thanh toán. Nếu bạn đã thanh toán, Điểm vẫn sẽ được cộng.',
      }),
    );

    await expect(
      handler.handle({ ...event, payload: {} }),
    ).rejects.toBeInstanceOf(OutboxPayloadInvalidError);
  });
});
