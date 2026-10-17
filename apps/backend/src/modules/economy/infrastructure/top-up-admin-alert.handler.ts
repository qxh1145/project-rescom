import { Logger } from '@nestjs/common';
import {
  TOP_UP_ADMIN_ALERT_EVENT_TYPE,
  TopUpAdminAlertCondition,
  topUpAdminAlertEventSchema,
} from '@rescom/schemas';
import {
  OutboxEnvelope,
  OutboxHandler,
  OutboxPayloadInvalidError,
} from '../../../common/scheduler/outbox/outbox-handler';
import { AdminCapabilityPort } from '../application/ports/admin-capability.port';
import { NotificationPublisherPort } from '../../notifications/application/ports/notification-publisher.port';
import { EmailSenderPort } from '../../notifications/application/ports/email-sender.port';

export const TOP_UP_ADMIN_ALERT_HANDLER = 'economy.top-up-admin-alert';

export class TopUpAdminAlertRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TopUpAdminAlertRetryableError';
  }
}

export interface TopUpAdminAlertLogger {
  log(message: string): void;
  warn(message: string): void;
  error(message: string, context?: unknown): void;
}

export class TopUpAdminAlertHandler implements OutboxHandler {
  readonly name = TOP_UP_ADMIN_ALERT_HANDLER;
  readonly eventType = TOP_UP_ADMIN_ALERT_EVENT_TYPE;
  readonly schemaVersions = [1];
  readonly runsOutsideTransaction = true;

  constructor(
    private readonly adminCapability: AdminCapabilityPort,
    private readonly notifications: NotificationPublisherPort,
    private readonly emailSender: EmailSenderPort,
    private readonly getRefundMailbox: () => string | null,
    private readonly logger: TopUpAdminAlertLogger = new Logger(
      TopUpAdminAlertHandler.name,
    ),
  ) {}

  private renderMessage(
    condition: TopUpAdminAlertCondition,
    orderCode?: number,
    requestId?: string,
  ): string {
    const codeStr = orderCode !== undefined ? `#${orderCode}` : '';
    switch (condition) {
      case 'UNCREDITED_AFTER_PAYMENT':
        return `Nạp Điểm ${codeStr} đã thanh toán nhưng chưa được cộng Điểm sau 30 phút. Kiểm tra lại với payOS.`;
      case 'MISMATCH_SLA_BREACHED':
        return `Nạp Điểm ${codeStr} lệch số tiền chưa được xử lý quá 3 ngày làm việc.`;
      case 'REFUND_SLA_BREACHED':
        return `Yêu cầu hoàn tiền ${codeStr} quá hạn 3 ngày làm việc — xử lý tại /admin/top-ups?tab=refunds${requestId ? `&request=${requestId}` : ''}.`;
      case 'PAID_ON_CLOSED_LINK':
        return `payOS báo đã nhận tiền cho Nạp Điểm ${codeStr} đã huỷ/hết hạn. Kiểm tra và hoàn tiền nếu cần.`;
      case 'PROVIDER_FAILURE':
        return 'Không kết nối được payOS trong nhiều lần đối soát liên tiếp.';
      default:
        return `Cảnh báo đối soát Nạp Điểm: ${condition} ${codeStr}`.trim();
    }
  }

  async handle(event: OutboxEnvelope): Promise<void> {
    const parsed = topUpAdminAlertEventSchema.safeParse(event.payload);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new OutboxPayloadInvalidError(
        event.eventType,
        issue ? `${issue.path.join('.')}: ${issue.message}` : 'invalid',
      );
    }

    const { condition, topUpId, orderCode, refundRequestId } = parsed.data;
    const message = this.renderMessage(condition, orderCode, refundRequestId);

    // Leg 1: In-app notification to active admins
    let leg1Failed = false;
    try {
      const adminIds = await this.adminCapability.listActiveAdminIds();
      await Promise.all(
        adminIds.map((userId) =>
          this.notifications
            .publish({
              userId,
              type: 'WARNING',
              message,
              dedupeKey: event.idempotencyKey,
            })
            .catch((err: unknown) => {
              leg1Failed = true;
              this.logger.warn(
                `Failed to send in-app alert to admin ${userId}: ${
                  err instanceof Error ? err.message : String(err)
                }`,
              );
            }),
        ),
      );
    } catch (err) {
      leg1Failed = true;
      this.logger.warn(
        `Failed to query active admin ids for alert: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    // Leg 2: Email to topUpRefundMailbox
    let emailRetryable: string | null = null;
    const mailbox = this.getRefundMailbox();
    if (!mailbox) {
      this.logger.warn(
        'TopUp admin alert email skipped: refund mailbox is not configured',
      );
    } else {
      const subject = `[Cảnh báo đối soát RESCOM] ${condition}${
        orderCode !== undefined ? ` #${orderCode}` : ''
      }`;
      const text = `${message}\nChi tiết: condition=${condition}, topUpId=${topUpId ?? 'N/A'}, orderCode=${orderCode ?? 'N/A'}`;
      const html = `<p>${message}</p><p><b>Chi tiết:</b><br/>Condition: ${condition}<br/>TopUp ID: ${topUpId ?? 'N/A'}<br/>Order Code: ${orderCode ?? 'N/A'}</p>`;

      const emailResult = await this.emailSender.send({
        to: mailbox,
        subject,
        text,
        html,
        idempotencyKey: event.idempotencyKey,
      });

      if (emailResult.outcome === 'RETRYABLE') {
        emailRetryable = `Refund mailbox email send retryable: ${emailResult.code}`;
      }
      if (
        emailResult.outcome === 'PERMANENT' ||
        emailResult.outcome === 'AMBIGUOUS'
      ) {
        this.logger.error(
          `Refund mailbox email failed permanently or ambiguously: ${emailResult.outcome} (${emailResult.code})`,
        );
      }
    }

    // Leg 3: Sentry log (ids only, no personal data / account numbers)
    this.logger.error('payos-admin-alert', {
      condition,
      topUpId,
      orderCode,
    });

    // Retry after all legs ran: email is idempotent via idempotencyKey, notifications dedupe on dedupeKey.
    if (emailRetryable) throw new TopUpAdminAlertRetryableError(emailRetryable);
    if (leg1Failed) {
      throw new TopUpAdminAlertRetryableError(
        'In-app admin notification leg failed',
      );
    }
  }
}
