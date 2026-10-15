import { codeIssueResolvedEventSchema } from '@rescom/schemas';
import {
  OutboxEnvelope,
  OutboxHandler,
  OutboxPayloadInvalidError,
} from '../../../common/scheduler/outbox/outbox-handler';
import { NotificationPublisherPort } from '../../notifications/application/ports/notification-publisher.port';
import { VoucherRepositoryPort } from './ports/voucher-repository.port';
import { TicketWritePort } from './ports/ticket-write.port';

export const CODE_ISSUE_NOTIFICATION_HANDLER =
  'rewards.code-issue-notification';

export class CodeIssueNotificationHandler implements OutboxHandler {
  readonly name = CODE_ISSUE_NOTIFICATION_HANDLER;
  readonly eventType = 'REWARDS_CODE_ISSUE_RESOLVED';
  readonly schemaVersions = [1];

  constructor(
    private readonly notifications: NotificationPublisherPort,
    private readonly vouchers: Pick<VoucherRepositoryPort, 'findById'>,
    private readonly ticketWrite: Pick<
      TicketWritePort,
      'findReport' | 'findRefundPoints'
    >,
  ) {}

  async handle(event: OutboxEnvelope): Promise<void> {
    const parsed = codeIssueResolvedEventSchema.safeParse(event.payload);
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

    let message = '';
    if (payload.outcome === 'REPLACED') {
      message = `Mã voucher "${title}" đã được thay bằng mã mới.`;
    } else if (payload.outcome === 'REFUNDED') {
      const points = await this.ticketWrite.findRefundPoints(payload.reportId);
      const amount = points === null ? 'điểm' : `${points} điểm`;
      message = `Đã hoàn ${amount} cho voucher "${title}" (mã ${payload.refundReference ?? ''}).`;
    } else if (payload.outcome === 'REJECTED') {
      const report = await this.ticketWrite.findReport(payload.reportId);
      const note = report?.resolutionNote ?? '';
      message = `Báo cáo mã voucher "${title}" đã bị từ chối: ${note}`;
    }

    await this.notifications.publish({
      userId: payload.userId,
      type: 'CODE_ISSUE_RESOLVED',
      message: message.slice(0, 500),
      dedupeKey: event.idempotencyKey,
    });
  }
}
