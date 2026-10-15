import { TopUpNotificationHandler } from './top-up-notification.handler';
import {
  OutboxEnvelope,
  OutboxPayloadInvalidError,
} from '../../../common/scheduler/outbox/outbox-handler';
import { NotificationPublisherPort } from '../../notifications/application/ports/notification-publisher.port';

describe('TopUpNotificationHandler', () => {
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
    await expect(
      handler.handle({ ...event, payload: {} }),
    ).rejects.toBeInstanceOf(OutboxPayloadInvalidError);
  });
});
