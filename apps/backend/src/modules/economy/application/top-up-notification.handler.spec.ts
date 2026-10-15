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
    for (const [status, type] of [
      ['SUCCESSFUL', 'TOPUP_SUCCESS'],
      ['AMOUNT_MISMATCH', 'TOPUP_AMOUNT_MISMATCH'],
    ] as const) {
      await handler.handle({
        ...event,
        idempotencyKey: status,
        payload: { ...(event.payload as object), status, amountPaidVnd: 5000 },
      });
      expect(publish).toHaveBeenCalledWith(
        expect.objectContaining({ type, dedupeKey: status }),
      );
    }
    await expect(
      handler.handle({ ...event, payload: {} }),
    ).rejects.toBeInstanceOf(OutboxPayloadInvalidError);
  });
});
