import { isApiError } from "../api/api-error.ts";

/**
 * Pure session-state rules shared by `SessionProvider` and `SessionGate`
 * (unit-tested in `tests/session-status.test.mjs`).
 */

export type SessionStatus =
  | "loading"
  | "authenticated"
  | "unauthenticated"
  /** 403 `AUTH_USER_LOCKED`: the account is locked by an admin. */
  | "locked"
  /** No response from the API (offline, DNS, proxy down). */
  | "offline"
  /** 5xx, malformed response or anything else unexpected. */
  | "error";

/** What a failed `GET /auth/me` (or refresh) means for the session. */
export function sessionStatusFromError(error: unknown): Exclude<SessionStatus, "loading" | "authenticated"> {
  if (!isApiError(error)) return "error";
  if (error.kind === "network") return "offline";
  if (error.kind === "http" && error.status === 401) return "unauthenticated";
  if (error.kind === "http" && error.status === 403 && error.code === "AUTH_USER_LOCKED") return "locked";
  return "error";
}

/**
 * Only the initial load escalates every failure. Once authenticated, a
 * background `refresh()` that fails for a transient reason (network, 5xx,
 * malformed) keeps the current user on screen; a 401 or a locked account
 * still ends the session.
 */
export function sessionStatusAfterFailure(current: SessionStatus, error: unknown): SessionStatus {
  const next = sessionStatusFromError(error);
  if (current === "authenticated" && (next === "offline" || next === "error")) return current;
  return next;
}

/**
 * Where `SessionGate` sends the visitor for a settled non-authenticated
 * status; `currentPath` is pathname + search of the guarded page.
 */
export function sessionGateRedirect(status: SessionStatus, currentPath: string): string | null {
  const here = encodeURIComponent(currentPath);
  switch (status) {
    case "unauthenticated":
      return `/login?returnTo=${here}`;
    case "locked":
      // The login page shows the locked-account message for this code.
      return "/login?error=AUTH_USER_LOCKED";
    case "offline":
      return `/offline?from=${here}`;
    case "error":
      return `/server-error?from=${here}`;
    default:
      return null;
  }
}

/**
 * A data request failed because the session ended (401) or the account was
 * locked: screens then call `useSession().refresh()` so `SessionGate`
 * redirects, instead of showing a retry that cannot succeed.
 */
export function isSessionLost(error: unknown): boolean {
  const status = sessionStatusFromError(error);
  return status === "unauthenticated" || status === "locked";
}
