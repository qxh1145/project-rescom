import type { SanitizedUser } from "@rescom/schemas";
import { ADMIN_HOME_PATH } from "../auth/post-login-redirect.ts";
import { buildOnboardingRedirect, ONBOARDING_PATH, POST_ONBOARDING_DEFAULT_PATH } from "../onboarding.ts";

/**
 * Onboarding routing rules for signed-in pages, shared by `SessionGate` and
 * `/onboarding` (unit-tested in `tests/onboarding-route-gate.test.mjs`).
 */

/**
 * Whether the signed-in respondent finished the Mandatory Demographic Survey
 * (`GET /demographics` → `isComplete`). `unknown`: admins, or the check
 * failed — the gate then fails open; the backend still answers earning calls
 * with `DEMOGRAPHIC_PROFILE_REQUIRED`.
 */
export type OnboardingStatus = "complete" | "incomplete" | "unknown";

type Role = SanitizedUser["role"] | undefined;

export function onboardingStatusOf(role: Role, profile: { isComplete: boolean } | null): OnboardingStatus {
  if (role === "ADMIN" || profile === null) return "unknown";
  return profile.isComplete ? "complete" : "incomplete";
}

function isOnboardingPath(pathname: string): boolean {
  return pathname === ONBOARDING_PATH || pathname.startsWith(`${ONBOARDING_PATH}/`);
}

/**
 * A respondent without a complete profile sees nothing but `/onboarding`;
 * `currentPath` (pathname + search) becomes its `returnTo`.
 */
export function onboardingGateRedirect(input: {
  role: Role;
  onboarding: OnboardingStatus;
  pathname: string;
  currentPath: string;
}): string | null {
  if (input.role === "ADMIN" || input.onboarding !== "incomplete" || isOnboardingPath(input.pathname)) {
    return null;
  }
  return buildOnboardingRedirect(input.currentPath);
}

/**
 * Decided once when `/onboarding` opens. Admins have no profile to fill in. A
 * respondent who already finished goes to the Marketplace, except:
 * - the done screen of a submit made in this tab (a refresh of it keeps the
 *   activation step);
 * - a question opened by "Sửa" on `/account/profile` (`edit=1`, see
 *   `profileEditHref`) — the profile editor reuses these screens.
 * Deciding only on entry keeps the done screen and its "Sửa" working after
 * the submit itself turns the status to `complete`.
 */
export function onboardingEntryRedirect(input: {
  role: Role;
  onboarding: OnboardingStatus;
  requestedStep: string;
  submittedInThisTab: boolean;
  editing: boolean;
}): string | null {
  if (input.role === "ADMIN") return ADMIN_HOME_PATH;
  if (input.onboarding !== "complete") return null;
  if (input.requestedStep === "done" && input.submittedInThisTab) return null;
  if (input.editing && input.requestedStep !== "welcome") return null;
  return POST_ONBOARDING_DEFAULT_PATH;
}
