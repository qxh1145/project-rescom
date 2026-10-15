import {
  TOP_UP_STATUS_CHANGED_EVENT_TYPE,
  topUpStatusChangedEventSchema,
} from '@rescom/schemas';
import {
  OutboxEnvelope,
  OutboxHandler,
  OutboxPayloadInvalidError,
} from '../../../common/scheduler/outbox/outbox-handler';
import { NotificationPublisherPort } from '../../notifications/application/ports/notification-publisher.port';

export class TopUpNotificationHandler implements OutboxHandler {
  readonly name = 'economy.top-up-notification';
  readonly eventType = TOP_UP_STATUS_CHANGED_EVENT_TYPE;
  readonly schemaVersions = [1];
  constructor(private readonly notifications: NotificationPublisherPort) {}
  async handle(event: OutboxEnvelope): Promise<void> {
    const parsed = topUpStatusChangedEventSchema.safeParse(event.payload);
    if (!parsed.success)
      throw new OutboxPayloadInvalidError(
        event.eventType,
        parsed.error.issues[0]?.message ?? 'invalid',
      );
    const { userId, amountVnd, orderCode, status, points, amountPaidVnd } =
      parsed.data;
    const formatted = amountVnd.toLocaleString('vi-VN');
    const type =
      status === 'SUCCESSFUL'
        ? 'TOPUP_SUCCESS'
        : status === 'AMOUNT_MISMATCH'
          ? 'TOPUP_AMOUNT_MISMATCH'
          : 'TOPUP_CANCELLED';
    const message =
      status === 'SUCCESSFUL'
        ? `Nạp ${formatted} VNĐ thành công: ${points} Điểm đã được cộng vào số dư Khả dụng.`
        : status === 'AMOUNT_MISMATCH'
          ? `Giao dịch nạp ${formatted} VNĐ (mã ${orderCode}) nhận ${(amountPaidVnd ?? 0).toLocaleString('vi-VN')} VNĐ, khác số tiền yêu cầu. Chưa có Điểm nào được cộng; Admin sẽ xem xét trong 3 ngày làm việc.`
          : `Giao dịch nạp ${formatted} VNĐ (mã ${orderCode}) đã được huỷ. Không có Điểm nào thay đổi.`;
    await this.notifications.publish({
      userId,
      type,
      message,
      dedupeKey: event.idempotencyKey,
    });
  }
}
