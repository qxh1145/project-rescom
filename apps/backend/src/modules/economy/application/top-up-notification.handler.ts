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
    const { userId, amountVnd, orderCode } = parsed.data;
    await this.notifications.publish({
      userId,
      type: 'TOPUP_CANCELLED',
      message: `Giao dịch nạp ${amountVnd.toLocaleString('vi-VN')} VNĐ (mã ${orderCode}) đã được huỷ. Không có Điểm nào thay đổi.`,
      dedupeKey: event.idempotencyKey,
    });
  }
}
