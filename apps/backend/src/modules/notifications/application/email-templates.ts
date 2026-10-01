import { EmailNotificationType } from '@rescom/schemas';

/**
 * Story IR.4b B7 / plan 5.4: Vietnamese email bodies, rendered from the type
 * (never from the English in-app `Notification.message`). Pure functions, no
 * templating engine. Personal data is kept to what the recipient needs: no
 * names, amounts or reasons ("see the reason in Rescom" instead). Every
 * interpolated value is HTML-escaped.
 */

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

export interface EmailTemplateContext {
  /** Frontend base URL without a trailing slash (`EMAIL_APP_BASE_URL`). */
  appBaseUrl: string;
  /** Support address (`EMAIL_REPLY_TO`), when configured. */
  supportEmail: string | null;
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

interface EmailBody {
  subject: string;
  heading: string;
  paragraphs: string[];
  link?: { label: string; url: string };
  /** Shown after the link (plain text, escaped like the rest). */
  footnote?: string;
}

function supportSentence(supportEmail: string | null): string {
  return supportEmail
    ? `Nếu cần hỗ trợ, hãy trả lời email này hoặc liên hệ ${supportEmail}.`
    : 'Nếu cần hỗ trợ, hãy trả lời email này.';
}

function render(body: EmailBody): RenderedEmail {
  const textParts = [body.heading, '', ...body.paragraphs];
  if (body.link) textParts.push('', `${body.link.label}: ${body.link.url}`);
  if (body.footnote) textParts.push('', body.footnote);
  textParts.push('', '— Rescom');

  const paragraphs = body.paragraphs
    .map(
      (paragraph) => `<p style="margin:0 0 12px">${escapeHtml(paragraph)}</p>`,
    )
    .join('');
  const link = body.link
    ? `<p style="margin:20px 0"><a href="${escapeHtml(body.link.url)}" style="display:inline-block;padding:10px 18px;border-radius:8px;background:#0f766e;color:#ffffff;text-decoration:none;font-weight:bold">${escapeHtml(body.link.label)}</a></p>` +
      `<p style="margin:0 0 12px;font-size:12px;color:#555555">Nếu nút không mở được, hãy dán liên kết này vào trình duyệt: ${escapeHtml(body.link.url)}</p>`
    : '';
  const footnote = body.footnote
    ? `<p style="margin:12px 0 0;font-size:13px;color:#555555">${escapeHtml(body.footnote)}</p>`
    : '';
  const html =
    '<!doctype html><html lang="vi"><head><meta charset="utf-8">' +
    `<title>${escapeHtml(body.subject)}</title></head>` +
    '<body style="margin:0;padding:24px;background:#f5f5f4;font-family:Arial,Helvetica,sans-serif;color:#1c1917;line-height:1.5">' +
    '<div style="max-width:520px;margin:0 auto;padding:24px;background:#ffffff;border-radius:12px">' +
    `<h1 style="margin:0 0 16px;font-size:20px">${escapeHtml(body.heading)}</h1>` +
    paragraphs +
    link +
    footnote +
    '<p style="margin:24px 0 0;font-size:12px;color:#78716c">Rescom</p>' +
    '</div></body></html>';

  return { subject: body.subject, text: textParts.join('\n'), html };
}

/** Email for a critical notification (B2); one fixed body per type. */
export function renderNotificationEmail(
  type: EmailNotificationType,
  context: EmailTemplateContext,
): RenderedEmail {
  const walletUrl = `${context.appBaseUrl}/wallet`;
  switch (type) {
    case 'TOPUP_SUCCESS':
      return render({
        subject: 'Rescom: Nạp điểm thành công',
        heading: 'Nạp điểm thành công',
        paragraphs: [
          'Yêu cầu nạp điểm của bạn đã được duyệt và điểm đã được cộng vào số dư Khả dụng.',
          'Bạn có thể xem chi tiết giao dịch trong Ví Rescom.',
        ],
        link: { label: 'Mở Ví Rescom', url: walletUrl },
      });
    case 'TOPUP_REJECTED':
      return render({
        subject: 'Rescom: Yêu cầu nạp điểm chưa được duyệt',
        heading: 'Yêu cầu nạp điểm chưa được duyệt',
        paragraphs: [
          'Yêu cầu nạp điểm gần đây của bạn chưa được duyệt, nên chưa có điểm nào được cộng.',
          'Lý do được ghi trong Ví Rescom.',
          supportSentence(context.supportEmail),
        ],
        link: { label: 'Xem lý do trong Ví Rescom', url: walletUrl },
      });
    case 'ACCOUNT_LOCKED':
      // The user cannot sign in, so there is no app link: support only.
      return render({
        subject: 'Rescom: Tài khoản của bạn đã bị tạm khoá',
        heading: 'Tài khoản của bạn đã bị tạm khoá',
        paragraphs: [
          'Quản trị viên Rescom đã tạm khoá tài khoản của bạn. Trong thời gian này bạn không thể đăng nhập.',
          'Câu trả lời đã nộp và điểm của bạn vẫn được giữ nguyên.',
          supportSentence(context.supportEmail),
        ],
      });
    case 'ACCOUNT_UNLOCKED':
      return render({
        subject: 'Rescom: Tài khoản của bạn đã được mở khoá',
        heading: 'Tài khoản của bạn đã được mở khoá',
        paragraphs: ['Bạn có thể đăng nhập và dùng Rescom như bình thường.'],
        link: { label: 'Đăng nhập Rescom', url: `${context.appBaseUrl}/login` },
      });
  }
}

/**
 * Plan 5.4: the reset link email. `resetUrl` carries the raw token; it exists
 * only in this message (never stored, never logged).
 */
export function renderPasswordResetEmail(params: {
  resetUrl: string;
  ttlMinutes: number;
}): RenderedEmail {
  return render({
    subject: 'Rescom: Đặt lại mật khẩu',
    heading: 'Đặt lại mật khẩu Rescom',
    paragraphs: [
      'Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản Rescom dùng địa chỉ email này.',
      `Mở liên kết dưới đây trong vòng ${params.ttlMinutes} phút để đặt mật khẩu mới. Liên kết chỉ dùng được một lần.`,
    ],
    link: { label: 'Đặt mật khẩu mới', url: params.resetUrl },
    footnote:
      'Nếu bạn không yêu cầu, hãy bỏ qua email này: mật khẩu hiện tại vẫn giữ nguyên. Sau khi đặt lại, mọi thiết bị đang đăng nhập sẽ bị đăng xuất.',
  });
}
