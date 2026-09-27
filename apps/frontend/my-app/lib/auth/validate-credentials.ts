import { loginSchema, registerSchema } from "@rescom/schemas";
import { fieldMessage } from "./auth-error-messages.ts";
import type {
  AuthMode,
  EmailAuthField,
  EmailAuthFieldErrors,
  EmailAuthFormValues,
  LoginRequest,
} from "./types.ts";

export type CredentialsValidation =
  | { ok: true; data: LoginRequest }
  | { ok: false; fields: EmailAuthFieldErrors };

function isField(value: unknown): value is EmailAuthField {
  return value === "email" || value === "password";
}

/**
 * Client-side check with the same shared zod schemas the backend uses, so the
 * rules never drift. Returns the normalized (trimmed, lower-cased) payload.
 */
export function validateCredentials(
  values: EmailAuthFormValues,
  mode: AuthMode,
): CredentialsValidation {
  const schema = mode === "register" ? registerSchema : loginSchema;
  const result = schema.safeParse(values);
  if (result.success) return { ok: true, data: result.data };

  const fields: EmailAuthFieldErrors = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0];
    if (isField(field) && !fields[field]) {
      fields[field] = fieldMessage(field, values[field], mode);
    }
  }
  return { ok: false, fields };
}

export type EmailValidation = { ok: true; email: string } | { ok: false; message: string };

/** Email-only screens (15b forgot password): same shared email rule as login/register. */
export function validateEmail(value: string): EmailValidation {
  const result = loginSchema.shape.email.safeParse(value);
  return result.success
    ? { ok: true, email: result.data }
    : { ok: false, message: fieldMessage("email", value, "login") };
}
