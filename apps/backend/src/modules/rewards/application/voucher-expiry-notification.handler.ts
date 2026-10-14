import { voucherExpiryReminderEventSchema } from '@rescom/schemas';
import {
  OutboxEnvelope,
  OutboxHandler,
  OutboxPayloadInvalidError,
} from '../../../common/scheduler/outbox/outbox-handler';
import { NotificationPublisherPort } from '../../notifications/application/ports/notification-publisher.port';
import { VoucherRepositoryPort } from './ports/voucher-repository.port';

export const VOUCHER_EXPIRY_NOTIFICATION_HANDLER =
  'rewards.voucher-expiry-notification';

export class VoucherExpiryNotificationHandler implements OutboxHandler {
  readonly name = VOUCHER_EXPIRY_NOTIFICATION_HANDLER;
  readonly eventType = 'REWARDS_VOUCHER_EXPIRY_REMINDER';
  readonly schemaVersions = [1];

  constructor(
    private readonly notifications: NotificationPublisherPort,
    private readonly vouchers: Pick<VoucherRepositoryPort, 'findById'>,
  ) {}

  async handle(event: OutboxEnvelope): Promise<void> {
    const parsed = voucherExpiryReminderEventSchema.safeParse(event.payload);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new OutboxPayloadInvalidError(
        event.eventType,
        issue ? `${issue.path.join('.')}: ${issue.message}` : 'invalid',
      );
    }

    const payload = parsed.data;
    const voucher = await this.vouchers.findById(payload.voucherId);
    const title = voucher?.title ?? 'Voucher';

    const message =
      payload.window === '7D'
        ? `Voucher "${title}" sẽ hết hạn sau 7 ngày. Dùng ngay trong Voucher của tôi.`
        : `Voucher "${title}" sẽ hết hạn vào ngày mai. Dùng ngay trong Voucher của tôi.`;

    await this.notifications.publish({
      userId: payload.userId,
      type: 'VOUCHER_EXPIRING',
      message: message.slice(0, 500),
      dedupeKey: event.idempotencyKey,
    });
  }
}
