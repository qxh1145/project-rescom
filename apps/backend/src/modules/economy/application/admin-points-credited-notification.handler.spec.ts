import { ADMIN_POINTS_CREDITED_EVENT_TYPE } from '@rescom/schemas';
import { OutboxPayloadInvalidError } from '../../../common/scheduler/outbox/outbox-handler';
import { AdminPointsCreditedNotificationHandler } from './admin-points-credited-notification.handler';

describe('AdminPointsCreditedNotificationHandler', () => {
  const validPayload = {
    journalId: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    amount: 10_000,
    reason: 'Đền bù sự cố mạng',
    actorId: '33333333-3333-4333-8333-333333333333',
  };

  it('publishes ADMIN_POINTS_CREDITED notification with formatted amount and reason', async () => {
    const publish = jest.fn().mockResolvedValue('CREATED');
    const handler = new AdminPointsCreditedNotificationHandler({ publish });

    await handler.handle({
      id: 'e1',
      eventType: ADMIN_POINTS_CREDITED_EVENT_TYPE,
      idempotencyKey: 'k1',
      payload: validPayload,
    } as never);

    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith({
      userId: validPayload.userId,
      type: 'ADMIN_POINTS_CREDITED',
      message:
        'Bạn được Admin cộng 10.000 Điểm vào số dư Khả dụng. Lý do: Đền bù sự cố mạng',
      dedupeKey: 'k1',
    });
  });

  it('throws OutboxPayloadInvalidError when payload fails validation', async () => {
    const publish = jest.fn();
    const handler = new AdminPointsCreditedNotificationHandler({ publish });

    await expect(
      handler.handle({
        id: 'e1',
        eventType: ADMIN_POINTS_CREDITED_EVENT_TYPE,
        idempotencyKey: 'k1',
        payload: { invalid: true },
      } as never),
    ).rejects.toBeInstanceOf(OutboxPayloadInvalidError);
  });
});
