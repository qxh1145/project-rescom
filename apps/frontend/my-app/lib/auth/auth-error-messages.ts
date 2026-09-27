import { isApiError } from "../api/api-error.ts";
import type { AuthErrorMessage, AuthMode, EmailAuthField, EmailAuthFieldErrors } from "./types.ts";

/**
 * Backend error codes → Vietnamese copy. Codes come from
 * `apps/backend/src/modules/auth/application/exceptions/auth.exceptions.ts`.
 */

const DEFAULT_RETRY_AFTER_SECONDS = 60;

/** ASSUMED: Rescom users are in Vietnam (same zone as `lib/feedback/error-pages.ts`). */
const APP_TIME_ZONE = "Asia/Ho_Chi_Minh";

export const AUTH_MESSAGES = {
  invalidCredentials: "Email hoặc mật khẩu không chính xác.",
  userLocked: "Tài khoản của bạn đang bị khóa. Vui lòng liên hệ quản trị viên.",
  /** Field message of the 15a state; the form renders "Đăng nhập / đặt lại mật khẩu" links after it. */
  emailTaken: "Email này đã có tài khoản.",
  registerEmailTaken: "Chưa tạo được tài khoản: email đã được dùng.",
  emailRequired: "Vui lòng nhập email.",
  emailInvalid: "Email không hợp lệ.",
  passwordRequired: "Vui lòng nhập mật khẩu.",
  passwordTooShort: "Mật khẩu cần tối thiểu 12 ký tự.",
  passwordTooLong: "Mật khẩu quá dài (tối đa 72 byte).",
  network: "Không thể kết nối máy chủ. Kiểm tra kết nối mạng và thử lại.",
  server: "Hệ thống đang gặp sự cố. Vui lòng thử lại sau.",
  sessionInvalid: "Phiên đăng nhập không hợp lệ. Vui lòng đăng nhập lại.",
  termsRequired: "Vui lòng đồng ý với Điều khoản và Chính sách quyền riêng tư.",
  linkPasswordWrong: "Mật khẩu không đúng.",
  googleIdentityConflict: "Tài khoản Google này đã được liên kết với một tài khoản Rescom khác.",
  googleAlreadyLinked: "Tài khoản này đã liên kết Google. Hãy đăng nhập bằng Google.",
  passwordResetResent: "Đã gửi lại. Hãy kiểm tra hộp thư của bạn.",
  /** ASSUMED `POST /auth/password/forgot` is not deployed yet (404/501). */
  passwordResetUnavailable:
    "Tính năng đặt lại mật khẩu chưa được hỗ trợ. Vui lòng liên hệ quản trị viên để được hỗ trợ.",
} as const;

export function rateLimitedMessage(retryAfterSeconds: number | null): string {
  const seconds = retryAfterSeconds ?? DEFAULT_RETRY_AFTER_SECONDS;
  return `Bạn đã thử quá nhiều lần. Vui lòng thử lại sau ${seconds} giây.`;
}

/** Field message for a failed credential rule, shared by client validation and 400 details. */
export function fieldMessage(field: EmailAuthField, value: string, mode: AuthMode): string {
  if (field === "email") {
    return value.trim() ? AUTH_MESSAGES.emailInvalid : AUTH_MESSAGES.emailRequired;
  }
  if (!value) return AUTH_MESSAGES.passwordRequired;
  if (new TextEncoder().encode(value).length > 72) return AUTH_MESSAGES.passwordTooLong;
  return mode === "register" ? AUTH_MESSAGES.passwordTooShort : AUTH_MESSAGES.passwordRequired;
}

function hasFormattedErrors(details: unknown, field: EmailAuthField): boolean {
  if (typeof details !== "object" || details === null) return false;
  const entry = (details as Record<string, unknown>)[field];
  if (typeof entry !== "object" || entry === null) return false;
  const errors = (entry as { _errors?: unknown })._errors;
  return Array.isArray(errors) && errors.length > 0;
}

/** Maps a zod `error.format()` payload (backend 400 `details`) to field messages. */
function validationFieldErrors(details: unknown, mode: AuthMode): EmailAuthFieldErrors {
  const fields: EmailAuthFieldErrors = {};
  if (hasFormattedErrors(details, "email")) fields.email = AUTH_MESSAGES.emailInvalid;
  if (hasFormattedErrors(details, "password")) {
    fields.password =
      mode === "register" ? AUTH_MESSAGES.passwordTooShort : AUTH_MESSAGES.passwordRequired;
  }
  return fields;
}

export function getAuthErrorMessage(error: unknown, mode: AuthMode): AuthErrorMessage {
  if (!isApiError(error)) return { form: AUTH_MESSAGES.server };
  if (error.kind === "network") return { form: AUTH_MESSAGES.network };
  if (error.kind === "malformed") return { form: AUTH_MESSAGES.server };

  switch (error.code) {
    case "AUTH_INVALID_CREDENTIALS":
      return { form: AUTH_MESSAGES.invalidCredentials };
    case "AUTH_USER_LOCKED":
      return { form: AUTH_MESSAGES.userLocked };
    case "AUTH_EMAIL_ALREADY_REGISTERED":
      return {
        form: AUTH_MESSAGES.registerEmailTaken,
        fields: { email: AUTH_MESSAGES.emailTaken },
      };
    case "AUTH_INVALID_LOGIN_INPUT":
    case "AUTH_INVALID_REGISTRATION_INPUT": {
      const fields = validationFieldErrors(error.details, mode);
      return Object.keys(fields).length > 0 ? { fields } : { form: AUTH_MESSAGES.emailInvalid };
    }
    case "RATE_LIMIT_EXCEEDED":
      return { form: rateLimitedMessage(error.retryAfterSeconds) };
    default:
      if (error.status === 429) return { form: rateLimitedMessage(error.retryAfterSeconds) };
      return { form: AUTH_MESSAGES.server };
  }
}

/** Codes the backend appends to `AUTH_FRONTEND_ERROR_URL?error=`, plus our own session code. */
export function getOAuthErrorMessage(code: string): string {
  switch (code) {
    case "GOOGLE_AUTH_CANCELLED":
      return "Bạn đã hủy đăng nhập Google.";
    case "AUTH_GOOGLE_LINK_REQUIRED":
      return "Email này đã có tài khoản. Hãy đăng nhập bằng email và mật khẩu, sau đó liên kết Google trong phần cài đặt.";
    case "AUTH_GOOGLE_PROVIDER_UNAVAILABLE":
      return "Google tạm thời không khả dụng. Vui lòng thử lại sau.";
    case "AUTH_GOOGLE_IDENTITY_CONFLICT":
      return AUTH_MESSAGES.googleIdentityConflict;
    case "AUTH_USER_LOCKED":
      return AUTH_MESSAGES.userLocked;
    case "AUTH_UNAUTHORIZED":
    case "AUTH_SESSION_EXPIRED":
    case "AUTH_SESSION_REVOKED":
      return AUTH_MESSAGES.sessionInvalid;
    default:
      return "Đăng nhập Google không thành công. Vui lòng thử lại.";
  }
}

/** Shared tail of the non-credential mappers below: transport, rate limit, server. */
function transportMessage(error: unknown): string | null {
  if (!isApiError(error) || error.kind === "malformed") return AUTH_MESSAGES.server;
  if (error.kind === "network") return AUTH_MESSAGES.network;
  if (error.code === "RATE_LIMIT_EXCEEDED" || error.status === 429) {
    return rateLimitedMessage(error.retryAfterSeconds);
  }
  return null;
}

/**
 * ASSUMED API CONTRACT `POST /auth/password/forgot` (15b/15c). The endpoint
 * answers 202 whether or not the account exists, so only input, rate-limit and
 * transport failures can surface here.
 */
export function getPasswordResetErrorMessage(error: unknown): AuthErrorMessage {
  const transport = transportMessage(error);
  if (transport) return { form: transport };
  if (isApiError(error) && error.status === 400) return { fields: { email: AUTH_MESSAGES.emailInvalid } };
  // The route is ASSUMED: until the backend ships it, say so instead of "system error".
  if (isApiError(error) && (error.status === 404 || error.status === 501)) {
    return { form: AUTH_MESSAGES.passwordResetUnavailable };
  }
  return { form: AUTH_MESSAGES.server };
}

/**
 * 15d: `POST /auth/login` then `POST /auth/google/link/start` (both VERIFIED).
 * A wrong password is reported on the password field, never as "account not found".
 */
export function getGoogleLinkErrorMessage(error: unknown): AuthErrorMessage {
  const transport = transportMessage(error);
  if (transport) return { form: transport };
  if (!isApiError(error)) return { form: AUTH_MESSAGES.server };
  switch (error.code) {
    case "AUTH_INVALID_CREDENTIALS":
      return { fields: { password: AUTH_MESSAGES.linkPasswordWrong } };
    case "AUTH_INVALID_LOGIN_INPUT":
    case "AUTH_INVALID_INPUT":
      return { fields: { email: AUTH_MESSAGES.emailInvalid } };
    case "AUTH_USER_LOCKED":
      return { form: AUTH_MESSAGES.userLocked };
    case "AUTH_GOOGLE_IDENTITY_CONFLICT":
      // Also thrown by link/start when this account already has a Google identity.
      return { form: AUTH_MESSAGES.googleAlreadyLinked };
    default:
      return { form: AUTH_MESSAGES.server };
  }
}

/**
 * 15e body copy. `at` is when the other device signed in (ASSUMED `?at=` signal,
 * see `readSessionReplacedNotice`); without it the time is left out.
 */
export function sessionReplacedMessage(at: Date | null): string {
  const time =
    at && !Number.isNaN(at.getTime())
      ? ` lúc ${at.toLocaleTimeString("vi-VN", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
          // Fixed zone: server and client render the same text (no hydration mismatch).
          timeZone: APP_TIME_ZONE,
        })}`
      : "";
  return `Tài khoản vừa đăng nhập trên một thiết bị khác${time}. Rescom chỉ cho mỗi tài khoản đăng nhập trên một thiết bị cùng lúc.`;
}
