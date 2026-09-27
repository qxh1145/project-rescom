import {
  DEMOGRAPHIC_PROFILE_REQUIRED_CODE,
  type DemographicOnboardingNextStep,
} from "@rescom/schemas";

/**
 * Routing rules for the Mandatory Demographic Survey (Story 7.1). Pure helpers
 * (no React/Next imports) so they are shared by pages, the guard hook and tests.
 */

export const ONBOARDING_PATH = "/onboarding";

/** Marketplace activation step (FR-7): complete one Marketplace survey. */
export const MARKETPLACE_ACTIVATION_PATH = "/marketplace?activation=1";

/** Where an already activated respondent lands after (re)submitting the survey. */
export const POST_ONBOARDING_DEFAULT_PATH = "/marketplace";

/** Placeholder origin used only to resolve a relative path and prove it stays same-origin. */
const RETURN_TO_BASE_ORIGIN = "http://rescom.invalid";

/** ASCII control characters (incl. tab/CR/LF, which the WHATWG URL parser silently strips). */
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/;

/**
 * Accepts only same-origin app paths, never the onboarding page itself.
 *
 * Control characters are rejected on the raw value: `"/\t/evil.example"` would
 * otherwise pass the prefix checks and resolve to `https://evil.example/`
 * because URL parsing strips tab/CR/LF. The value is then resolved against a
 * placeholder origin and must stay on it; the normalized
 * `pathname + search + hash` is returned unless it became protocol-relative
 * (`//host`) or holds a backslash.
 */
export function sanitizeReturnTo(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  if (CONTROL_CHARACTERS.test(value)) return null;
  const path = value.trim();
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(path, RETURN_TO_BASE_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== RETURN_TO_BASE_ORIGIN) return null;
  if (url.pathname === ONBOARDING_PATH || url.pathname.startsWith(`${ONBOARDING_PATH}/`)) {
    return null;
  }
  const normalized = `${url.pathname}${url.search}${url.hash}`;
  // Dot segments can collapse into a protocol-relative path after resolution:
  // `/.//evil.com`, `/a/..//evil.com`, `/%2e%2e//evil.com` → `//evil.com`.
  if (normalized.startsWith("//") || normalized.includes("\\")) return null;
  return normalized;
}

/** `/onboarding?required=1[&returnTo=…]` — the onboarding page explains why the user is there. */
export function buildOnboardingRedirect(returnTo?: string | null): string {
  const params = new URLSearchParams({ required: "1" });
  const safeReturnTo = sanitizeReturnTo(returnTo);
  if (safeReturnTo) params.set("returnTo", safeReturnTo);
  return `${ONBOARDING_PATH}?${params.toString()}`;
}

/**
 * After submission: new respondents always continue to the Marketplace
 * activation step; respondents who already finished activation may return to
 * the page that sent them to onboarding.
 */
export function resolvePostOnboardingPath(
  result: { nextStep: DemographicOnboardingNextStep; redirectUrl?: string },
  returnTo?: string | null,
): string {
  // The backend (`POST /demographics/survey`) only returns `nextStep`; the legacy mock also sent a URL.
  const fallback =
    result.nextStep === "COMPLETED" ? POST_ONBOARDING_DEFAULT_PATH : MARKETPLACE_ACTIVATION_PATH;
  const redirectUrl = result.redirectUrl ?? fallback;
  if (result.nextStep === "COMPLETED") {
    return sanitizeReturnTo(returnTo) ?? redirectUrl;
  }
  return redirectUrl;
}

/** True for the backend/mock `DEMOGRAPHIC_PROFILE_REQUIRED` domain error. */
export function isDemographicProfileRequiredError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === DEMOGRAPHIC_PROFILE_REQUIRED_CODE
  );
}
