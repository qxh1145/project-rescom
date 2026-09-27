import { sanitizeReturnTo } from "../onboarding.ts";

/**
 * Pure helpers for the system error pages (Figma page 18). No React/Next
 * imports so they are unit-tested in `tests/error-pages.test.mjs`.
 */

/** ASSUMED: no support address exists yet — replace when the product defines one. */
export const SUPPORT_EMAIL = "support@rescom.vn";
export const SUPPORT_MAILTO = `mailto:${SUPPORT_EMAIL}`;

export const DEFAULT_RETRY_AFTER_SECONDS = 60;
/** Longer values are treated as bogus input (a rate-limit window is at most a day). */
const MAX_RETRY_AFTER_SECONDS = 24 * 60 * 60;

/** ASSUMED: Rescom users are in Vietnam, so server and client format in the same zone. */
const APP_TIME_ZONE = "Asia/Ho_Chi_Minh";

/**
 * `error.digest` → "A7F3-2109" style: upper-case alphanumerics in groups of 4.
 * The whole digest is kept so support can match it with the server log.
 */
export function formatIncidentCode(digest: string | null | undefined): string | null {
  const clean = (digest ?? "").replace(/[^a-z0-9]/gi, "").toUpperCase();
  if (!clean) return null;
  return clean.match(/.{1,4}/g)!.join("-");
}

/** Fallback when there is no digest (client-side error, `/server-error`): 8 hex chars. */
export function randomIncidentCode(random: () => number = Math.random): string {
  let hex = "";
  for (let i = 0; i < 8; i += 1) hex += Math.floor(random() * 16).toString(16);
  return formatIncidentCode(hex)!;
}

/** `?retryAfter=` in seconds; anything that is not a positive integer falls back to 60 s. */
export function parseRetryAfterSeconds(raw: string | null | undefined): number {
  if (typeof raw !== "string" || !/^\d+$/.test(raw.trim())) return DEFAULT_RETRY_AFTER_SECONDS;
  const seconds = Number(raw.trim());
  if (seconds < 1 || seconds > MAX_RETRY_AFTER_SECONDS) return DEFAULT_RETRY_AFTER_SECONDS;
  return seconds;
}

/** 1104 → "18:24"; one hour or more → "1:05:00". */
export function formatCountdown(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const mmss = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return hours > 0 ? `${hours}:${mmss}` : mmss;
}

/** Screen-reader copy for the countdown; changes only once per minute. */
export function countdownAnnouncement(totalSeconds: number): string {
  if (totalSeconds <= 0) return "Bạn có thể nhận khảo sát mới ngay bây giờ.";
  return `Còn khoảng ${Math.ceil(totalSeconds / 60)} phút nữa.`;
}

/** `?until=<ISO>` → "14:30" (vi-VN, 24h); invalid or missing → null. */
export function formatMaintenanceEnd(raw: string | null | undefined): string | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: APP_TIME_ZONE,
  }).format(date);
}

/** System error pages: never a return target (they would loop or strand the user). */
export const ERROR_PAGE_PATTERN = /^\/(offline|server-error|rate-limited|maintenance|forbidden)(?:[/?#]|$)/;

/**
 * `?from=` on `/offline` (and `/rate-limited`): a same-origin app path to
 * return to, never another error page (it would loop).
 */
export function resolveReturnPath(raw: string | null | undefined): string | null {
  const path = sanitizeReturnTo(raw);
  return path && !ERROR_PAGE_PATTERN.test(path) ? path : null;
}

/**
 * True when the previous history entry is (most likely) a page of this site,
 * so "back" cannot leave Rescom. Uses the Navigation API when available
 * (`navigation.canGoBack` only counts same-origin entries), else
 * `document.referrer`, which is set for full loads coming from another page.
 */
export function canGoBackWithinSite(input: {
  navigationCanGoBack?: boolean;
  referrer: string;
  origin: string;
  historyLength: number;
}): boolean {
  if (typeof input.navigationCanGoBack === "boolean") return input.navigationCanGoBack;
  if (input.historyLength < 2 || !input.referrer) return false;
  try {
    return new URL(input.referrer).origin === input.origin;
  } catch {
    return false;
  }
}

/** Fallback destination of "back"/retry actions that have nowhere safe to go. */
export const ERROR_FALLBACK_PATH = "/marketplace";

/** First value of a Next `searchParams` entry. */
export function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
