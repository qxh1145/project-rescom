import {
  MISSING_CODE_RESOLVED_EVENT_TYPE,
  NOTIFICATION_MESSAGE_MAX_LENGTH,
  missingCodeResolvedEventPayloadSchema,
} from '@rescom/schemas';
import {
  OutboxEnvelope,
  OutboxHandler,
  OutboxPayloadInvalidError,
} from '../../../common/scheduler/outbox/outbox-handler';
import { NotificationPublisherPort } from '../../notifications/application/ports/notification-publisher.port';

function truncateMessage(message: string): string {
  if (message.length <= NOTIFICATION_MESSAGE_MAX_LENGTH) {
    return message;
  }
  return message.slice(0, NOTIFICATION_MESSAGE_MAX_LENGTH - 1) + '…';
}

/**
 * Story 14.1 (AC 6): In-app notification dispatcher for resolved missing-code reports.
 * Emits notification to Respondent (CREDIT or DISMISSED) and Publisher (CREDIT only).
 */
export class MissingCodeResolvedNotificationHandler implements OutboxHandler {
  readonly name = 'participation.missing-code-resolved-notification';
  readonly eventType = MISSING_CODE_RESOLVED_EVENT_TYPE;
  readonly schemaVersions = [1];

  constructor(private readonly notifications: NotificationPublisherPort) {}

  async handle(event: OutboxEnvelope): Promise<void> {
    const parsed = missingCodeResolvedEventPayloadSchema.safeParse(event.payload);
    if (!parsed.success) {
      throw new OutboxPayloadInvalidError(
        event.eventType,
        parsed.error.issues[0]?.message ?? 'invalid',
      );
    }

    const {
      surveyTitle,
      respondentId,
      publisherId,
      outcome,
      rewardPoints,
      note,
    } = parsed.data;

    // 1. Notify Respondent if account exists
    if (respondentId) {
      const respondentMessage =
        outcome === 'CREDIT_RESPONDENT'
          ? `Admin đã xác nhận bạn hoàn thành khảo sát "${surveyTitle}". ${rewardPoints ?? 0} Điểm đang chờ, sẽ chuyển vào Khả dụng sau 48 giờ. Ghi chú: ${note}`
          : `Báo cáo thiếu mã cho khảo sát "${surveyTitle}" không được chấp nhận. Lý do: ${note}`;

      await this.notifications.publish({
        userId: respondentId,
        type: 'MISSING_CODE_REPORT_RESOLVED',
        message: truncateMessage(respondentMessage),
        dedupeKey: `${event.idempotencyKey}:respondent`,
      });
    }

    // 2. Notify Publisher on CREDIT only (Decision D6: no Respondent PII, no Admin note)
    if (outcome === 'CREDIT_RESPONDENT' && publisherId) {
      const publisherMessage = `Admin đã cộng Điểm cho một người trả lời khảo sát "${surveyTitle}" vì không tìm thấy mã hoàn thành. Hãy kiểm tra mã hoàn thành trên biểu mẫu bên ngoài.`;

      await this.notifications.publish({
        userId: publisherId,
        type: 'MISSING_CODE_REPORT_RESOLVED',
        message: truncateMessage(publisherMessage),
        dedupeKey: `${event.idempotencyKey}:publisher`,
      });
    }
  }
}
