import {
  TOP_UP_REFUND_CHANGED_EVENT_TYPE,
  topUpRefundChangedPayloadSchema,
} from '@rescom/schemas';
import {
  OutboxEnvelope,
  OutboxHandler,
  OutboxPayloadInvalidError,
} from '../../../common/scheduler/outbox/outbox-handler';
import { NotificationPublisherPort } from '../../notifications/application/ports/notification-publisher.port';

export class TopUpRefundNotificationHandler implements OutboxHandler {
  readonly name = 'economy.top-up-refund-notification';
  readonly eventType = TOP_UP_REFUND_CHANGED_EVENT_TYPE;
  readonly schemaVersions = [1];

  constructor(private readonly notifications: NotificationPublisherPort) {}

  async handle(event: OutboxEnvelope): Promise<void> {
    const parsed = topUpRefundChangedPayloadSchema.safeParse(event.payload);
    if (!parsed.success) {
      throw new OutboxPayloadInvalidError(
        event.eventType,
        parsed.error.issues[0]?.message ?? 'invalid',
      );
    }

    const { userId, orderCode, status, eligibility, points } = parsed.data;

    if (status === 'REQUESTED') {
      const message =
        eligibility === 'ELIGIBLE'
          ? `Đã gửi yêu cầu hoàn tiền cho giao dịch nạp mã ${orderCode}. ${points} Điểm đang được giữ chờ hoàn tiền; Admin xử lý trong 3 ngày làm việc.`
          : `Đã ghi nhận yêu cầu hoàn tiền cho giao dịch nạp mã ${orderCode}, nhưng yêu cầu không đủ điều kiện vì Điểm đã được sử dụng sau khi nạp. Không có Điểm nào bị giữ.`;

      await this.notifications.publish({
        userId,
        type: 'TOPUP_REFUND_REQUESTED',
        message,
        dedupeKey: event.idempotencyKey,
      });
    } else if (status === 'WITHDRAWN') {
      // Absent on Outbox events queued before holdReleased existed: keep old rule.
      const released =
        parsed.data.holdReleased ?? (eligibility === 'ELIGIBLE' && points > 0);
      const holdSuffix =
        released && points > 0 ? ` ${points} Điểm đã trở lại Khả dụng.` : '';
      const message = `Bạn đã rút yêu cầu hoàn tiền cho giao dịch nạp mã ${orderCode}.${holdSuffix}`;

      await this.notifications.publish({
        userId,
        type: 'TOPUP_REFUND_WITHDRAWN',
        message,
        dedupeKey: event.idempotencyKey,
      });
    } else if (status === 'REFUNDED') {
      const message = `Đã hoàn ${parsed.data.amountVnd.toLocaleString('vi-VN')} VNĐ cho giao dịch nạp mã ${orderCode} về tài khoản đã thanh toán. ${points} Điểm đang giữ đã bị trừ.`;

      await this.notifications.publish({
        userId,
        type: 'TOPUP_REFUNDED',
        message,
        dedupeKey: event.idempotencyKey,
      });
    } else if (status === 'REJECTED') {
      const reasonPart = parsed.data.rejectionReason
        ? ` Lý do: ${parsed.data.rejectionReason}.`
        : '';
      const holdSuffix =
        parsed.data.holdReleased === true && points > 0
          ? ` ${points} Điểm đã trở lại Khả dụng.`
          : '';
      const message = `Yêu cầu hoàn tiền cho giao dịch nạp mã ${orderCode} bị từ chối.${reasonPart}${holdSuffix}`;

      await this.notifications.publish({
        userId,
        type: 'TOPUP_REFUND_REJECTED',
        message,
        dedupeKey: event.idempotencyKey,
      });
    }
  }
}
