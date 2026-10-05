import { EMAIL_NOTIFICATION_TYPES } from '@rescom/schemas';
import {
  escapeHtml,
  renderNotificationEmail,
  renderPasswordResetEmail,
} from './email-templates';

describe('Email templates (Story IR.4b B7, plan 5.4)', () => {
  const context = {
    appBaseUrl: 'https://app.rescom.test',
    supportEmail: 'hotro@rescom.test',
  };

  it('escapes HTML special characters', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    );
  });

  it.each(EMAIL_NOTIFICATION_TYPES)(
    '%s renders a Vietnamese subject, text and HTML body',
    (type) => {
      const email = renderNotificationEmail(type, context);
      expect(email.subject).toMatch(/^Rescom: /);
      expect(email.text).toMatch(/[ăâđêôơư]/);
      expect(email.html).toContain('<html lang="vi">');
      expect(email.html).toContain(escapeHtml(email.subject));
    },
  );

  it('links top-ups to the wallet and never repeats a reason or an amount', () => {
    const rejected = renderNotificationEmail('TOPUP_REJECTED', context);
    expect(rejected.text).toContain('https://app.rescom.test/wallet');
    expect(rejected.text).toContain('Lý do được ghi trong Ví Rescom');
    expect(rejected.text).not.toMatch(/\d+ điểm|VND/);
  });

  it('gives a locked account no app link, only support', () => {
    const locked = renderNotificationEmail('ACCOUNT_LOCKED', context);
    expect(locked.text).not.toContain('https://');
    expect(locked.text).toContain('hotro@rescom.test');
    const withoutSupport = renderNotificationEmail('ACCOUNT_LOCKED', {
      ...context,
      supportEmail: null,
    });
    expect(withoutSupport.text).toContain('trả lời email này');
  });

  it('puts the reset link (escaped in HTML) and the 30-minute validity in the reset email', () => {
    const url = 'https://app.rescom.test/reset-password?token=a-b_c&x=<y>';
    const email = renderPasswordResetEmail({ resetUrl: url, ttlMinutes: 30 });
    expect(email.subject).toBe('Rescom: Đặt lại mật khẩu');
    expect(email.text).toContain(url);
    expect(email.text).toContain('30 phút');
    expect(email.html).toContain(escapeHtml(url));
    expect(email.html).not.toContain('<y>');
  });
});
