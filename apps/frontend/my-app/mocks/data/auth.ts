import type { SanitizedUser } from "@rescom/schemas";
import type { DemoAccount } from "@/lib/auth/types";
import type { MockUser } from "@/lib/mock/types";

/**
 * Mock-only auth data. The users themselves live in the legacy demo store
 * (`lib/mock/fixtures.ts`) so every other page sees the same session.
 */

export const DEMO_PASSWORD = "Password123!";

export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  {
    email: "minh.le@fpt.edu.vn",
    password: DEMO_PASSWORD,
    name: "Lê Nhật Minh",
    description: "Đã kích hoạt · vào Chợ khảo sát",
  },
  {
    email: "student@fpt.edu.vn",
    password: DEMO_PASSWORD,
    name: "Nguyễn Văn Mới",
    description: "Tài khoản mới · cần hoàn tất hồ sơ",
  },
  {
    email: "linh.onboarding@fpt.edu.vn",
    password: DEMO_PASSWORD,
    name: "Trần Mai Linh",
    description: "Hồ sơ đang làm dở",
  },
];

/** localStorage key of passwords registered through MSW (cleared by `?msw-reset=1`). */
export const CREDENTIALS_KEY = "rescom:msw-credentials";

/** Passwords of accounts registered through MSW (the legacy store keeps none). */
function readCredentials(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(CREDENTIALS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function rememberPassword(email: string, password: string): void {
  try {
    const credentials = readCredentials();
    credentials[email] = password;
    window.localStorage.setItem(CREDENTIALS_KEY, JSON.stringify(credentials));
  } catch {
    // Storage unavailable: the account then accepts DEMO_PASSWORD only.
  }
}

export function expectedPassword(email: string): string {
  return readCredentials()[email] ?? DEMO_PASSWORD;
}

/** `an.nguyen22@fpt.edu.vn` → `An Nguyen22`; the backend has no name field. */
export function nameFromEmail(email: string): string {
  const words = email
    .split("@")[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));
  const name = words.join(" ");
  return name.length >= 2 ? name : "Sinh viên Rescom";
}

/**
 * Legacy ids (`user-active-002`) are not UUIDs, but the shared schemas require
 * one. Derive a stable UUID-shaped id so the same user always maps the same.
 */
export function toMockUuid(id: string): string {
  let hex = "";
  let seed = 0x811c9dc5;
  while (hex.length < 32) {
    for (let i = 0; i < id.length; i += 1) {
      seed ^= id.charCodeAt(i) + hex.length;
      seed = Math.imul(seed, 0x01000193) >>> 0;
    }
    hex += seed.toString(16).padStart(8, "0");
  }
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function toSanitizedUser(user: MockUser): SanitizedUser {
  return { id: toMockUuid(user.id), email: user.email, role: user.role, status: "ACTIVE" };
}
