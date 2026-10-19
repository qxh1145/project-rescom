import {
  ADMIN_POINTS_CREDITED_EVENT_TYPE,
  adminPointsCreditedPayloadSchema,
  NOTIFICATION_MESSAGE_MAX_LENGTH,
} from '@rescom/schemas';
import {
  OutboxEnvelope,
  OutboxHandler,
  OutboxPayloadInvalidError,
} from '../../../common/scheduler/outbox/outbox-handler';
import { NotificationPublisherPort } from '../../notifications/application/ports/notification-publisher.port';

export class AdminPointsCreditedNotificationHandler implements OutboxHandler {
  readonly name = 'economy.admin-points-credited-notification';
  readonly eventType = ADMIN_POINTS_CREDITED_EVENT_TYPE;
  readonly schemaVersions = [1];

  constructor(private readonly notifications: NotificationPublisherPort) {}

  async handle(event: OutboxEnvelope): Promise<void> {
    const parsed = adminPointsCreditedPayloadSchema.safeParse(event.payload);
    if (!parsed.success) {
      throw new OutboxPayloadInvalidError(
        event.eventType,
        parsed.error.issues[0]?.message ?? 'invalid',
      );
    }

    const { userId, amount, reason } = parsed.data;
    const formattedAmount = amount.toLocaleString('vi-VN');
    const rawMessage = `Bạn được Admin cộng ${formattedAmount} Điểm vào số dư Khả dụng. Lý do: ${reason}`;
    const message = rawMessage.slice(0, NOTIFICATION_MESSAGE_MAX_LENGTH);

    await this.notifications.publish({
      userId,
      type: 'ADMIN_POINTS_CREDITED',
      message,
      dedupeKey: event.idempotencyKey,
    });
  }
}
