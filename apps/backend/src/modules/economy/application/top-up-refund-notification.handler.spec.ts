import { TOP_UP_REFUND_CHANGED_EVENT_TYPE } from '@rescom/schemas';
import { OutboxPayloadInvalidError } from '../../../common/scheduler/outbox/outbox-handler';
import { TopUpRefundNotificationHandler } from './top-up-refund-notification.handler';

const base = {
  schemaVersion: 1,
  requestId: '44444444-4444-4444-8444-444444444444',
  topUpId: '33333333-3333-4333-8333-333333333333',
  userId: '22222222-2222-4222-8222-222222222222',
  orderCode: 1234567,
  eligibility: 'ELIGIBLE',
  ineligibleReason: null,
  points: 250,
  amountVnd: 50_000,
  occurredAt: '2026-10-17T01:00:00.000Z',
};

describe('TopUpRefundNotificationHandler', () => {
  const run = async (payload: Record<string, unknown>) => {
    const publish = jest.fn().mockResolvedValue('CREATED');
    const handler = new TopUpRefundNotificationHandler({ publish });
    await handler.handle({
      id: 'e1',
      eventType: TOP_UP_REFUND_CHANGED_EVENT_TYPE,
      idempotencyKey: 'k1',
      payload: { ...base, ...payload },
    } as never);
    return publish.mock.calls[0][0] as { type: string; message: string };
  };

  it('REFUNDED copy follows Task 7', async () => {
    const n = await run({ status: 'REFUNDED' });
    expect(n.type).toBe('TOPUP_REFUNDED');
    expect(n.message).toBe(
      `Đã hoàn ${(50_000).toLocaleString('vi-VN')} VNĐ cho giao dịch nạp mã 1234567 về tài khoản đã thanh toán. 250 Điểm đang giữ đã bị trừ.`,
    );
  });

  it('REJECTED held: reason and Available suffix', async () => {
    const n = await run({
      status: 'REJECTED',
      rejectionReason: 'Sai thông tin',
      holdReleased: true,
    });
    expect(n.type).toBe('TOPUP_REFUND_REJECTED');
    expect(n.message).toBe(
      'Yêu cầu hoàn tiền cho giao dịch nạp mã 1234567 bị từ chối. Lý do: Sai thông tin. 250 Điểm đã trở lại Khả dụng.',
    );
  });

  it('REJECTED hold-less (holdReleased false or absent): no Available suffix', async () => {
    for (const extra of [{ holdReleased: false }, {}]) {
      const n = await run({
        status: 'REJECTED',
        rejectionReason: 'Sai thông tin',
        ...extra,
      });
      expect(n.message).not.toContain('Khả dụng');
    }
  });

  it('WITHDRAWN suffix keys on holdReleased, legacy events fall back to eligibility', async () => {
    expect(
      (await run({ status: 'WITHDRAWN', holdReleased: false })).message,
    ).not.toContain('Khả dụng');
    expect(
      (await run({ status: 'WITHDRAWN', holdReleased: true })).message,
    ).toContain('250 Điểm đã trở lại Khả dụng.');
    expect((await run({ status: 'WITHDRAWN' })).message).toContain('Khả dụng');
  });

  it('rejects an invalid payload', async () => {
    const handler = new TopUpRefundNotificationHandler({ publish: jest.fn() });
    await expect(
      handler.handle({
        eventType: TOP_UP_REFUND_CHANGED_EVENT_TYPE,
        payload: {},
      } as never),
    ).rejects.toBeInstanceOf(OutboxPayloadInvalidError);
  });
});
