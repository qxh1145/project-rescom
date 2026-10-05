import { isApiError, type ApiError } from "../api/api-error.ts";
import { SESSION_REPLACED_CODE, SESSION_REPLACED_REASON, wasSessionReplaced } from "../auth/session-notice.ts";

/**
 * Pure session-state rules shared by `SessionProvider` and `SessionGate`
 * (unit-tested in `tests/session-status.test.mjs`).
 */

export type SessionStatus =
  | "loading"
  | "authenticated"
  | "unauthenticated"
  /** 401 because a newer login replaced this session (plan 5.6, notice 15e). */
  | "replaced"
  /** 403 `AUTH_USER_LOCKED`: the account is locked by an admin. */
  | "locked"
  /** No response from the API (offline, DNS, proxy down). */
  | "offline"
  /** 429 still answered after the retries of `withSessionRetry`. */
  | "rate-limited"
  /** 5xx, malformed response or anything else unexpected. */
  | "error";

function isRateLimited(error: unknown): error is ApiError {
  return isApiError(error) && error.kind === "http" && error.status === 429;
}

/**
 * What a failed `GET /auth/me` (or refresh) means for the session. A 401 is
 * "replaced" when it says `AUTH_SESSION_REPLACED`, or when it is the generic
 * `AUTH_UNAUTHORIZED` and an earlier request already said so
 * (`replacedEarlier`): the backend clears the cookies on that first answer,
 * so the request that decides is usually a plain 401.
 */
export function sessionStatusFromError(
  error: unknown,
  replacedEarlier: () => boolean = wasSessionReplaced,
): Exclude<SessionStatus, "loading" | "authenticated"> {
  if (!isApiError(error)) return "error";
  if (error.kind === "network") return "offline";
  if (error.kind === "http" && error.status === 401) {
    // An earlier mark only explains the generic code the cleared cookies produce.
    const replaced =
      error.code === SESSION_REPLACED_CODE || (error.code === "AUTH_UNAUTHORIZED" && replacedEarlier());
    return replaced ? "replaced" : "unauthenticated";
  }
  if (error.kind === "http" && error.status === 403 && error.code === "AUTH_USER_LOCKED") return "locked";
  if (isRateLimited(error)) return "rate-limited";
  return "error";
}

/**
 * Only the initial load escalates every failure. Once authenticated, a
 * background `refresh()` that fails for a transient reason (network, 429,
 * 5xx, malformed) keeps the current user on screen; a 401 or a locked
 * account still ends the session.
 */
export function sessionStatusAfterFailure(current: SessionStatus, error: unknown): SessionStatus {
  const next = sessionStatusFromError(error);
  if (current === "authenticated" && (next === "offline" || next === "rate-limited" || next === "error")) {
    return current;
  }
  return next;
}

/** `Retry-After` of a 429, for the `/rate-limited` countdown; null otherwise. */
export function rateLimitRetryAfterSeconds(error: unknown): number | null {
  return isRateLimited(error) ? error.retryAfterSeconds : null;
}

/** Retries of a 429 on a session request before it counts as "rate-limited". */
export const SESSION_RATE_LIMIT_RETRIES = 2;

/** Longest wait before one of those retries, whatever `Retry-After` says. */
export const SESSION_RATE_LIMIT_MAX_WAIT_MS = 10_000;

/**
 * Milliseconds to wait before retrying a session request that failed with
 * `error` after `retries` retries, or null when it must not be retried (not
 * a 429, or no retry left). Waits `Retry-After` (1 s when absent), capped.
 */
export function sessionRetryDelayMs(error: unknown, retries: number): number | null {
  if (!isRateLimited(error) || retries >= SESSION_RATE_LIMIT_RETRIES) return null;
  return Math.min((error.retryAfterSeconds ?? 1) * 1000, SESSION_RATE_LIMIT_MAX_WAIT_MS);
}

/** Resolves after `ms`, or rejects with `AbortError` as soon as `signal` aborts. */
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("The operation was aborted.", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Runs a session request (`GET /auth/me`, the refresh before it) and retries
 * it after a 429 as `sessionRetryDelayMs` allows; the last error is rethrown.
 * A wait rejects with `AbortError` as soon as `signal` aborts.
 */
export async function withSessionRetry<T>(
  request: () => Promise<T>,
  signal: AbortSignal,
  wait: (ms: number, signal: AbortSignal) => Promise<void> = delay,
): Promise<T> {
  for (let retries = 0; ; retries += 1) {
    try {
      return await request();
    } catch (error) {
      const ms = sessionRetryDelayMs(error, retries);
      if (ms === null) throw error;
      await wait(ms, signal);
    }
  }
}

/**
 * Where `SessionGate` sends the visitor for a settled non-authenticated
 * status; `currentPath` is pathname + search of the guarded page.
 * `retryAfterSeconds` (from `rateLimitRetryAfterSeconds`) sets the
 * `/rate-limited` countdown, which defaults to 60 s without it; `reason=session`
 * makes that page show the neutral "too many requests" copy.
 */
export function sessionGateRedirect(
  status: SessionStatus,
  currentPath: string,
  retryAfterSeconds: number | null = null,
): string | null {
  const here = encodeURIComponent(currentPath);
  switch (status) {
    case "unauthenticated":
      return `/login?returnTo=${here}`;
    case "replaced":
      // 15e: the login page shows "Bạn đã được đăng xuất" for this reason.
      return `/login?reason=${SESSION_REPLACED_REASON}&returnTo=${here}`;
    case "locked":
      // The login page shows the locked-account message for this code.
      return "/login?error=AUTH_USER_LOCKED";
    case "offline":
      return `/offline?from=${here}`;
    case "rate-limited":
      // `reason=session`: the session check itself was throttled, not the participation limits.
      return retryAfterSeconds
        ? `/rate-limited?reason=session&from=${here}&retryAfter=${retryAfterSeconds}`
        : `/rate-limited?reason=session&from=${here}`;
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
  return status === "unauthenticated" || status === "replaced" || status === "locked";
}
