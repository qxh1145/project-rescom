import { Logger } from '@nestjs/common';
import {
  TOP_UP_REFUND_ADMIN_NOTICE_EVENT_TYPE,
  topUpRefundAdminNoticePayloadSchema,
} from '@rescom/schemas';
import {
  OutboxEnvelope,
  OutboxHandler,
  OutboxPayloadInvalidError,
} from '../../../common/scheduler/outbox/outbox-handler';
import { AdminCapabilityPort } from '../application/ports/admin-capability.port';
import { NotificationPublisherPort } from '../../notifications/application/ports/notification-publisher.port';
import { escapeHtml } from '../../notifications/application/email-templates';
import { EmailSenderPort } from '../../notifications/application/ports/email-sender.port';

const REASON_LABELS: Record<string, string> = {
  WRONG_AMOUNT: 'Nạp nhầm số tiền',
  WRONG_ACCOUNT: 'Nạp nhầm tài khoản Rescom',
  NO_LONGER_NEEDED: 'Không còn nhu cầu dùng Điểm',
  OTHER: 'Lý do khác',
};
const INELIGIBLE_LABELS: Record<string, string> = {
  SPENT_SINCE_TOP_UP: 'Đã dùng Điểm sau khi nạp',
  INSUFFICIENT_AVAILABLE: 'Không đủ Điểm khả dụng',
};

export const TOP_UP_REFUND_ADMIN_NOTICE_HANDLER =
  'economy.top-up-refund-admin-notice';

export class TopUpRefundAdminNoticeRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TopUpRefundAdminNoticeRetryableError';
  }
}

export interface TopUpRefundAdminNoticeLogger {
  log(message: string): void;
  warn(message: string): void;
  error(message: string, context?: unknown): void;
}

export class TopUpRefundAdminNoticeHandler implements OutboxHandler {
  readonly name = TOP_UP_REFUND_ADMIN_NOTICE_HANDLER;
  readonly eventType = TOP_UP_REFUND_ADMIN_NOTICE_EVENT_TYPE;
  readonly schemaVersions = [1];
  readonly runsOutsideTransaction = true;

  constructor(
    private readonly adminCapability: AdminCapabilityPort,
    private readonly notifications: NotificationPublisherPort,
    private readonly emailSender: EmailSenderPort,
    private readonly getRefundMailbox: () => string | null,
    private readonly emailAppBaseUrl: string,
    private readonly logger: TopUpRefundAdminNoticeLogger = new Logger(
      TopUpRefundAdminNoticeHandler.name,
    ),
  ) {}

  async handle(event: OutboxEnvelope): Promise<void> {
    const parsed = topUpRefundAdminNoticePayloadSchema.safeParse(event.payload);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new OutboxPayloadInvalidError(
        event.eventType,
        issue ? `${issue.path.join('.')}: ${issue.message}` : 'invalid',
      );
    }

    const {
      requestId,
      orderCode,
      status,
      eligibility,
      ineligibleReason,
      points,
      amountVnd,
      userEmail,
      reason,
      note,
      destination,
      occurredAt,
    } = parsed.data;

    const inAppMessage =
      status === 'REQUESTED'
        ? `Yêu cầu hoàn tiền mới cho Nạp Điểm #${orderCode} (${amountVnd.toLocaleString('vi-VN')} VNĐ).`
        : `Người dùng đã rút yêu cầu hoàn tiền cho Nạp Điểm #${orderCode}.`;

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
              message: inAppMessage,
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
        `Failed to query active admin ids for refund notice: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    // Leg 2: Email to getRefundMailbox()
    let emailRetryable: string | null = null;
    const mailbox = this.getRefundMailbox();
    if (!mailbox) {
      this.logger.warn(
        'TopUp refund admin email skipped: refund mailbox is not configured',
      );
    } else {
      const subject =
        status === 'REQUESTED'
          ? `Rescom: Yêu cầu hoàn tiền #${orderCode}`
          : `Rescom: Đã rút yêu cầu hoàn tiền #${orderCode}`;

      const vnTime = new Date(occurredAt).toLocaleString('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh',
      });
      const destBank = destination.bankName ?? destination.bankId ?? 'N/A';
      const destHolder = destination.holderName ?? 'Chưa có tên chủ tài khoản';
      const destLast4 = destination.last4 ? `•••• ${destination.last4}` : 'N/A';
      const unverifiedWarning = !destination.verified
        ? '\n(Chưa xác minh — xác nhận với người dùng qua email trước khi chuyển)'
        : '';
      const verdictStr =
        status === 'WITHDRAWN'
          ? eligibility === 'ELIGIBLE'
            ? 'Đã rút yêu cầu (Điểm đã hoàn lại về Khả dụng)'
            : 'Đã rút yêu cầu (không có Điểm bị giữ)'
          : eligibility === 'ELIGIBLE'
            ? 'Đủ điều kiện (đã giữ Điểm)'
            : `Không đủ điều kiện (${ineligibleReason ? (INELIGIBLE_LABELS[ineligibleReason] ?? ineligibleReason) : 'không giữ Điểm'})`;
      const adminLink = `${this.emailAppBaseUrl.replace(/\/$/, '')}/admin/top-ups?tab=refunds&request=${requestId}`;

      const reasonLabel = REASON_LABELS[reason] ?? reason;
      const e = escapeHtml;
      const text = [
        subject,
        `Mã nạp: #${orderCode}`,
        `Email người dùng: ${userEmail ?? 'N/A'}`,
        `Số tiền: ${amountVnd.toLocaleString('vi-VN')} VNĐ`,
        `Số Điểm: ${points}`,
        `Kết quả xét duyệt tự động: ${verdictStr}`,
        `Lý do người dùng: ${reasonLabel}`,
        `Ghi chú người dùng: ${note}`,
        `Tài khoản nhận hoàn tiền: ${destBank} · ${destHolder} · ${destLast4}${unverifiedWarning}`,
        `Thời gian: ${vnTime}`,
        `Xem trong Admin Panel: ${adminLink}`,
      ].join('\n');

      const html = `
        <h3>${e(subject)}</h3>
        <ul>
          <li><b>Mã nạp:</b> #${e(String(orderCode))}</li>
          <li><b>Email người dùng:</b> ${e(userEmail ?? 'N/A')}</li>
          <li><b>Số tiền:</b> ${amountVnd.toLocaleString('vi-VN')} VNĐ</li>
          <li><b>Số Điểm:</b> ${points}</li>
          <li><b>Kết quả xét duyệt tự động:</b> ${e(verdictStr)}</li>
          <li><b>Lý do người dùng:</b> ${e(reasonLabel)}</li>
          <li><b>Ghi chú người dùng:</b> ${e(String(note ?? ''))}</li>
          <li><b>Tài khoản nhận hoàn tiền:</b> ${e(destBank)} · ${e(destHolder)} · ${e(destLast4)} ${
            !destination.verified
              ? '<span style="color:orange;">(Chưa xác minh — xác nhận với người dùng qua email trước khi chuyển)</span>'
              : ''
          }</li>
          <li><b>Thời gian:</b> ${e(vnTime)}</li>
        </ul>
        <p><a href="${e(adminLink)}">Xem trong Admin Panel</a></p>
      `;

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
          `Refund mailbox email failed: ${emailResult.outcome} (${emailResult.code})`,
        );
      }
    }

    if (emailRetryable) {
      throw new TopUpRefundAdminNoticeRetryableError(emailRetryable);
    }
    if (leg1Failed) {
      throw new TopUpRefundAdminNoticeRetryableError(
        'In-app admin notification leg failed',
      );
    }
  }
}
