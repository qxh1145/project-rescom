import { http } from "msw";
import {
  PASSWORD_RESET_PAGE_PATH,
  PASSWORD_RESET_TOKEN_INVALID,
  PASSWORD_RESET_TOKEN_TTL_MINUTES,
  forgotPasswordSchema,
  resetPasswordSchema,
} from "@rescom/schemas";
import { apiUrl } from "@/lib/api/config";
import { rememberPassword } from "../data/auth";
import { mockRepository } from "../legacy/repository";
import { fail, ok } from "../envelope";
import { applyScenario } from "../scenarios";

/**
 * Mirrors plan 5.4 (`auth.controller.ts` `password/forgot` + `password/reset`),
 * parsing with the same shared schemas. MOCK-ONLY: there is no mailbox, so the
 * reset link is printed to the browser console; tokens live in localStorage
 * (30 minutes, single use; redeeming one cancels the account's other links).
 */

const TOKENS_KEY = "rescom:msw-reset-tokens";

interface StoredToken {
  email: string;
  expiresAt: number;
  used: boolean;
}

let memoryTokens: Record<string, StoredToken> = {};

function readTokens(): Record<string, StoredToken> {
  try {
    const raw = globalThis.localStorage?.getItem(TOKENS_KEY);
    if (raw) return JSON.parse(raw) as Record<string, StoredToken>;
  } catch {
    // Storage blocked: this page load's memory only.
  }
  return memoryTokens;
}

function writeTokens(tokens: Record<string, StoredToken>): void {
  memoryTokens = tokens;
  try {
    globalThis.localStorage?.setItem(TOKENS_KEY, JSON.stringify(tokens));
  } catch {
    // ignore
  }
}

function newToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function invalidInput(error: { errors: { message: string }[]; format(): unknown }) {
  return fail(400, "AUTH_INVALID_INPUT", error.errors[0]?.message ?? "Validation failed", {
    details: error.format(),
  });
}

export const passwordResetHandlers = [
  /** 202 `{ accepted: true }` whatever the address (no enumeration). Guest route, JSON only, no CSRF. */
  http.post(apiUrl("/auth/password/forgot"), async ({ request }) => {
    const forced = await applyScenario("password-forgot");
    if (forced) return forced;

    const parsed = forgotPasswordSchema.safeParse(await readJson(request));
    if (!parsed.success) return invalidInput(parsed.error);

    const tokens = readTokens();
    const token = newToken();
    tokens[token] = {
      email: parsed.data.email,
      expiresAt: Date.now() + PASSWORD_RESET_TOKEN_TTL_MINUTES * 60_000,
      used: false,
    };
    writeTokens(tokens);
    console.info(`[MSW] Link đặt lại mật khẩu (chỉ ở chế độ mock): ${PASSWORD_RESET_PAGE_PATH}?token=${token}`);
    return ok({ accepted: true }, 202);
  }),

  /** 200 `{ passwordReset: true }`; 400 PASSWORD_RESET_TOKEN_INVALID for unknown, used or expired tokens. */
  http.post(apiUrl("/auth/password/reset"), async ({ request }) => {
    const forced = await applyScenario("password-reset");
    if (forced) return forced;

    const parsed = resetPasswordSchema.safeParse(await readJson(request));
    if (!parsed.success) return invalidInput(parsed.error);

    const tokens = readTokens();
    const stored = tokens[parsed.data.token];
    if (!stored || stored.used || stored.expiresAt <= Date.now()) {
      return fail(400, PASSWORD_RESET_TOKEN_INVALID, "This password reset link is invalid or has expired.");
    }
    for (const other of Object.values(tokens)) {
      if (other.email === stored.email) other.used = true;
    }
    writeTokens(tokens);
    rememberPassword(stored.email, parsed.data.newPassword);
    // Every session of the account ends (the backend revokes them as PASSWORD_RESET).
    const current = await mockRepository.getCurrentUser();
    if (current?.email.toLowerCase() === stored.email) await mockRepository.logout();
    return ok({ passwordReset: true });
  }),
];
