import {
  PASSWORD_RESET_MAX_TOKENS_PER_ACCOUNT_HOUR,
  PASSWORD_RESET_MAX_TOKENS_PER_HOUR,
  PASSWORD_RESET_TOKEN_TTL_MINUTES,
  forgotPasswordResultSchema,
  forgotPasswordSchema,
  resetPasswordResultSchema,
  resetPasswordSchema,
} from './password-reset.schema';
import * as rootExports from '../index';

describe('Password reset contracts (mock-off plan 5.4)', () => {
  const token = 'q'.repeat(43);

  it('normalizes the email like login and rejects extra keys', () => {
    expect(forgotPasswordSchema.parse({ email: ' User@Example.COM ' })).toEqual({
      email: 'user@example.com',
    });
    expect(forgotPasswordSchema.safeParse({ email: 'nope' }).success).toBe(false);
    expect(
      forgotPasswordSchema.safeParse({ email: 'a@b.co', extra: 1 }).success,
    ).toBe(false);
  });

  it('applies the registration password policy to the new password', () => {
    expect(
      resetPasswordSchema.safeParse({ token, newPassword: 'short' }).success,
    ).toBe(false);
    expect(
      resetPasswordSchema.safeParse({ token, newPassword: 'x'.repeat(73) })
        .success,
    ).toBe(false);
    expect(
      resetPasswordSchema.parse({ token, newPassword: 'mật khẩu đủ dài 12' }),
    ).toEqual({ token, newPassword: 'mật khẩu đủ dài 12' });
  });

  it('accepts any non-empty token shape (validity is decided by the server)', () => {
    expect(
      resetPasswordSchema.safeParse({
        token: 'not-base64url!',
        newPassword: 'long enough password',
      }).success,
    ).toBe(true);
    expect(
      resetPasswordSchema.safeParse({ token: '', newPassword: 'long enough password' })
        .success,
    ).toBe(false);
    expect(
      resetPasswordSchema.safeParse({
        token: 'a'.repeat(257),
        newPassword: 'long enough password',
      }).success,
    ).toBe(false);
  });

  it('has fixed response bodies and documented limits', () => {
    expect(forgotPasswordResultSchema.parse({ accepted: true })).toEqual({
      accepted: true,
    });
    expect(resetPasswordResultSchema.safeParse({ passwordReset: false }).success).toBe(
      false,
    );
    expect(PASSWORD_RESET_TOKEN_TTL_MINUTES).toBe(30);
    expect(PASSWORD_RESET_MAX_TOKENS_PER_HOUR).toBe(3);
    expect(PASSWORD_RESET_MAX_TOKENS_PER_ACCOUNT_HOUR).toBe(10);
    expect(rootExports.resetPasswordSchema).toBe(resetPasswordSchema);
  });
});
