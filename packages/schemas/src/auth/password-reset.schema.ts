import { z } from "zod";
import { emailSchema, registerPasswordSchema } from "./credentials.schema";

/**
 * Mock-off plan 5.4: forgot / reset password.
 *
 * `POST /auth/password/forgot` answers 202 with the same body whether or not
 * an account exists (no enumeration). The emailed link is
 * `{app}/reset-password?token=<32 random bytes, base64url>`; only the SHA-256
 * of the token is stored, valid for 30 minutes, single use.
 * `POST /auth/password/reset` applies the registration password policy.
 * Invalid, expired and used tokens answer the same error code.
 */
export const PASSWORD_RESET_TOKEN_TTL_MINUTES = 30;
/**
 * Reset links per hour for one (account, client IP); more requests are
 * silently dropped. Per IP so a third party cannot use up the owner's links.
 */
export const PASSWORD_RESET_MAX_TOKENS_PER_HOUR = 3;
/** Reset links per hour for one account across all IPs (mail-bomb ceiling). */
export const PASSWORD_RESET_MAX_TOKENS_PER_ACCOUNT_HOUR = 10;
/** Frontend page of the emailed link. */
export const PASSWORD_RESET_PAGE_PATH = "/reset-password";
export const PASSWORD_RESET_TOKEN_INVALID = "PASSWORD_RESET_TOKEN_INVALID";

/**
 * Deliberately loose: a malformed token is reported exactly like an unknown,
 * expired or used one (`PASSWORD_RESET_TOKEN_INVALID`), not as a 400.
 */
export const passwordResetTokenSchema = z.string().min(1).max(256);

export const forgotPasswordSchema = z
  .object({
    email: emailSchema,
  })
  .strict();

export type ForgotPasswordDto = z.infer<typeof forgotPasswordSchema>;

export const forgotPasswordResultSchema = z
  .object({
    accepted: z.literal(true),
  })
  .strict();

export type ForgotPasswordResultDto = z.infer<typeof forgotPasswordResultSchema>;

export const resetPasswordSchema = z
  .object({
    token: passwordResetTokenSchema,
    newPassword: registerPasswordSchema,
  })
  .strict();

export type ResetPasswordDto = z.infer<typeof resetPasswordSchema>;

export const resetPasswordResultSchema = z
  .object({
    passwordReset: z.literal(true),
  })
  .strict();

export type ResetPasswordResultDto = z.infer<typeof resetPasswordResultSchema>;
