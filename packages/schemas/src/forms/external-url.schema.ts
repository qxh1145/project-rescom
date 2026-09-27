import { z } from "zod";

export const EXTERNAL_SURVEY_URL_MAX_LENGTH = 2000;

/**
 * Phase 1 External-survey allowlist (decision E4-DN3, option A): only Google
 * Forms links are accepted — `docs.google.com/forms/…`, `forms.gle/…` and
 * `forms.google.com/…` (FR-12, UJ-2; the completion-code guide is written for
 * Google Forms). A configurable list of approved platforms (option C) is a
 * later extension.
 */
export const EXTERNAL_SURVEY_ALLOWED_URL_PATTERNS = [
  "https://docs.google.com/forms/…",
  "https://forms.gle/…",
  "https://forms.google.com/…",
] as const;

export const EXTERNAL_SURVEY_URL_NOT_ALLOWED_MESSAGE =
  "External survey URL must be a Google Forms link (docs.google.com/forms/…, forms.gle/… or forms.google.com/…)";

/**
 * True when `value` parses as an absolute URL whose scheme is `https:`.
 * `new URL()` lower-cases the scheme, so `HTTPS://…` is accepted while
 * `http:`, `javascript:` and `data:` URLs are rejected.
 */
export function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * True when the URL points at a Google Form (decision E4-DN3): the host is
 * `docs.google.com` with a `/forms/<id…>` path, or `forms.gle` /
 * `forms.google.com` with a non-empty path. Other `docs.google.com` paths
 * (Docs, Sheets, Drive, a bare `/forms`) are NOT Google Forms. Only the
 * `https:` scheme counts; URLs carrying credentials or an explicit
 * non-default port are rejected.
 */
export function isGoogleFormsUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  if (parsed.username || parsed.password || parsed.port) return false;
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname;
  if (host === "forms.gle" || host === "forms.google.com") {
    return path.length > 1;
  }
  return (
    host === "docs.google.com" &&
    path.startsWith("/forms/") &&
    path.length > "/forms/".length
  );
}

/**
 * Shared rule for every External survey URL (create, draft create/update,
 * publish): trimmed, at most 2000 characters, a valid URL, HTTPS only, and a
 * Google Forms link (Phase 1 allowlist, decision E4-DN3). A bare
 * `z.string().url()` accepts `javascript:`/`data:`/`http:` URLs and arbitrary
 * hosts, which are later handed to respondents, so every entry point must use
 * this schema.
 */
export const externalSurveyUrlSchema = z
  .string()
  .trim()
  .max(
    EXTERNAL_SURVEY_URL_MAX_LENGTH,
    `External survey URL cannot exceed ${EXTERNAL_SURVEY_URL_MAX_LENGTH} characters`,
  )
  .url("Invalid external survey URL")
  .refine(isHttpsUrl, "External survey URL must use HTTPS")
  .refine(isGoogleFormsUrl, EXTERNAL_SURVEY_URL_NOT_ALLOWED_MESSAGE);
