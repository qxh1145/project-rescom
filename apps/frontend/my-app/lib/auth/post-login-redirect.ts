import {
  POST_ONBOARDING_DEFAULT_PATH,
  buildOnboardingRedirect,
  sanitizeReturnTo,
} from "../onboarding.ts";
import { ERROR_PAGE_PATTERN } from "../feedback/error-pages.ts";

const AUTH_PATH_PATTERN = /^\/(login|register|forgot-password|auth)(?:[/?#]|$)/;

/**
 * A post-login target must not be an auth page (it would loop back to the
 * form) nor a system error page (`/server-error`, `/offline`…).
 */
function safeDestination(returnTo: string | null): string | null {
  const path = sanitizeReturnTo(returnTo);
  return path && !AUTH_PATH_PATTERN.test(path) && !ERROR_PAGE_PATTERN.test(path) ? path : null;
}

/**
 * Where a freshly signed-in user goes. The auth API does not return
 * onboarding state, so the caller supplies it from `GET /demographics`.
 */
export const ADMIN_HOME_PATH = "/admin";

/**
 * Admins land on the console (a `returnTo` inside `/admin` is kept); they have
 * no respondent profile to complete, so `/demographics` is not consulted.
 */
export function resolveAdminPostLoginPath(returnTo: string | null): string {
  const path = safeDestination(returnTo);
  return path && /^\/admin(?:[/?#]|$)/.test(path) ? path : ADMIN_HOME_PATH;
}

export function resolvePostLoginPath(input: {
  isProfileComplete: boolean;
  returnTo: string | null;
}): string {
  const returnTo = safeDestination(input.returnTo);
  if (!input.isProfileComplete) return buildOnboardingRedirect(returnTo);
  return returnTo ?? POST_ONBOARDING_DEFAULT_PATH;
}
