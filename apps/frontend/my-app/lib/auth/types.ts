import type { ForgotPasswordDto, LoginDto, RegisterDto, ResetPasswordDto, SanitizedUser } from "@rescom/schemas";

/** `{ id, email, role, status }` — the backend never exposes more on auth routes. */
export type AuthUser = SanitizedUser;

export type AuthMode = "login" | "register";

/** Form model (UI). */
export interface EmailAuthFormValues {
  email: string;
  password: string;
}

export type EmailAuthField = keyof EmailAuthFormValues;

export type EmailAuthFieldErrors = Partial<Record<EmailAuthField, string>>;

/** API requests — the backend schemas are `.strict()`, so no extra keys. */
export type LoginRequest = LoginDto;
export type RegisterRequest = RegisterDto;

/** `data` of POST /auth/login and POST /auth/register. */
export interface AuthSessionResponse {
  user: AuthUser;
}

export type AuthSubmitStatus = "idle" | "submitting" | "redirecting";

/** UI-facing error: a form-level message and/or per-field messages. */
export interface AuthErrorMessage {
  form?: string;
  fields?: EmailAuthFieldErrors;
}

/** MOCK-ONLY: a demo persona served by MSW (`GET /mock/demo-accounts`). */
export interface DemoAccount {
  email: string;
  password: string;
  name: string;
  description: string;
}

/** VERIFIED (plan 5.4): body of POST /auth/password/forgot. */
export type PasswordResetRequest = ForgotPasswordDto;

/** VERIFIED (plan 5.4): body of POST /auth/password/reset. */
export type NewPasswordRequest = ResetPasswordDto;

/** VERIFIED: `data` of POST /auth/google/link/start with `Accept: application/json`. */
export interface GoogleLinkStartResponse {
  authorizationUrl: string;
}
