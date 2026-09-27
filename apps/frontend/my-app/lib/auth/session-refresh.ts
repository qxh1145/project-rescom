import { isApiError } from "../api/api-error.ts";
import { apiRequest, setCsrfToken, type ResponseSchema } from "../api/client.ts";

/**
 * Keeps the httpOnly access cookie alive while a signed-in screen is open.
 *
 * VERIFIED `POST /auth/refresh` (`auth.controller.ts`): needs the refresh
 * cookie, a same-origin `Origin` and `X-CSRF-Token` matching the session; it
 * rotates the access + refresh cookies AND the CSRF token, answering
 * 200 `{ csrfToken }`. The new token replaces the cached one in
 * `lib/api/client.ts`, otherwise every later mutation would 403 once.
 * Errors: 401 `AUTH_INVALID_REFRESH_TOKEN` / `AUTH_SESSION_EXPIRED` /
 * `AUTH_SESSION_REVOKED` (cookies cleared), 403 `AUTH_INVALID_CSRF_TOKEN`
 * (`apiRequest` refetches the token and retries once), 403 `AUTH_USER_LOCKED`.
 *
 * The access cookie lives exactly `JWT_ACCESS_TTL_SECONDS`; once it is gone
 * `SessionAuthGuard` answers 401 AND clears the refresh cookie, so the
 * refresh must happen before the TTL runs out.
 */

/**
 * ASSUMED: backend `JWT_ACCESS_TTL_SECONDS` default (900 s, also its maximum in
 * `env.schema.ts`). The API does not expose the TTL; update both together.
 */
export const ACCESS_TOKEN_TTL_SECONDS = 900;

/** Refresh at 80% of the TTL (12 min) so a slow request still lands before expiry. */
export const SESSION_REFRESH_INTERVAL_MS = Math.round(ACCESS_TOKEN_TTL_SECONDS * 0.8 * 1000);

/** Retry delay after a transient failure (network, 5xx). */
export const SESSION_REFRESH_RETRY_MS = 30_000;

/**
 * When this browser last got fresh cookies. Shared by every tab (cookies are),
 * so one tab refreshing spares the others. Only ever an upper bound on the
 * token age: a newer login makes the real token younger, never older.
 */
const LAST_REFRESH_KEY = "rescom:session-refreshed-at";
let lastRefreshInMemory: number | null = null;

function readLastRefresh(): number | null {
  try {
    const raw = globalThis.localStorage?.getItem(LAST_REFRESH_KEY);
    const value = raw ? Number(raw) : NaN;
    if (Number.isFinite(value)) return value;
  } catch {
    // Storage blocked: fall back to this tab's memory.
  }
  return lastRefreshInMemory;
}

function writeLastRefresh(value: number | null): void {
  lastRefreshInMemory = value;
  try {
    if (value === null) globalThis.localStorage?.removeItem(LAST_REFRESH_KEY);
    else globalThis.localStorage?.setItem(LAST_REFRESH_KEY, String(value));
  } catch {
    // ignore
  }
}

const refreshResponseSchema: ResponseSchema<{ csrfToken: string }> = {
  safeParse(value) {
    const token =
      typeof value === "object" && value !== null ? (value as { csrfToken?: unknown }).csrfToken : undefined;
    return typeof token === "string" && token.length > 0
      ? { success: true, data: { csrfToken: token } }
      : { success: false };
  },
};

let inFlight: Promise<void> | null = null;

/**
 * Single-flight `POST /auth/refresh`: concurrent callers share one request
 * (two rotations of the same refresh credential would look like a replay).
 * Not abortable on purpose — a caller going away must not cancel the rotation
 * the others wait for.
 */
export function refreshSession(now: () => number = Date.now): Promise<void> {
  inFlight ??= apiRequest("/auth/refresh", { method: "POST", schema: refreshResponseSchema })
    .then(({ csrfToken }) => {
      setCsrfToken(csrfToken);
      writeLastRefresh(now());
    })
    .catch((error: unknown) => {
      // The session is gone: forget the timestamp so the next load does not try again.
      if (isApiError(error) && error.status === 401) writeLastRefresh(null);
      throw error;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** True when the cookies may be stale enough that `GET /auth/me` could 401 (and drop the refresh cookie). */
export function shouldRefreshBeforeLoad(now: number = Date.now()): boolean {
  const last = readLastRefresh();
  return last !== null && now - last >= SESSION_REFRESH_INTERVAL_MS;
}

/** Milliseconds until the next refresh is due (0 = now). Unknown age → now. */
export function msUntilRefreshDue(last: number | null, now: number, intervalMs = SESSION_REFRESH_INTERVAL_MS): number {
  if (last === null) return 0;
  return Math.max(0, last + intervalMs - now);
}

export interface SessionRefreshSchedulerOptions {
  /** Called when the session is gone (401) or the account is locked; the scheduler has stopped. */
  onSessionEnded: (error: unknown) => void;
  /** Test seams. */
  refresh?: () => Promise<void>;
  now?: () => number;
  lastRefresh?: () => number | null;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
  /** Subscribes to "the page became visible"; returns the unsubscribe function. */
  onVisible?: (listener: () => void) => () => void;
  intervalMs?: number;
  retryMs?: number;
}

function subscribeVisible(listener: () => void): () => void {
  if (typeof document === "undefined") return () => {};
  const handler = () => {
    if (document.visibilityState === "visible") listener();
  };
  document.addEventListener("visibilitychange", handler);
  return () => document.removeEventListener("visibilitychange", handler);
}

export function isSessionEndedError(error: unknown): boolean {
  return (
    isApiError(error) &&
    error.kind === "http" &&
    (error.status === 401 || (error.status === 403 && error.code === "AUTH_USER_LOCKED"))
  );
}

/**
 * Refreshes when the last refresh is `intervalMs` old: on start, on a timer,
 * and when the tab becomes visible again (background tabs throttle timers).
 * Transient failures retry after `retryMs`. Returns `stop()`.
 */
export function startSessionRefreshScheduler(options: SessionRefreshSchedulerOptions): () => void {
  const {
    onSessionEnded,
    refresh = () => refreshSession(),
    now = Date.now,
    lastRefresh = readLastRefresh,
    setTimer = (callback, ms) => setTimeout(callback, ms),
    clearTimer = (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
    onVisible = subscribeVisible,
    intervalMs = SESSION_REFRESH_INTERVAL_MS,
    retryMs = SESSION_REFRESH_RETRY_MS,
  } = options;

  let stopped = false;
  let running = false;
  let timer: unknown = null;

  const schedule = (ms: number) => {
    if (timer !== null) clearTimer(timer);
    timer = setTimer(() => {
      timer = null;
      void check();
    }, ms);
  };

  async function check(): Promise<void> {
    if (stopped || running) return;
    const due = msUntilRefreshDue(lastRefresh(), now(), intervalMs);
    if (due > 0) {
      // Another tab refreshed meanwhile, or the tab woke up early.
      schedule(due);
      return;
    }
    running = true;
    try {
      await refresh();
      if (!stopped) schedule(intervalMs);
    } catch (error) {
      if (stopped) return;
      if (isSessionEndedError(error)) {
        stop();
        onSessionEnded(error);
        return;
      }
      schedule(retryMs);
    } finally {
      running = false;
    }
  }

  const unsubscribe = onVisible(() => void check());

  function stop() {
    if (stopped) return;
    stopped = true;
    unsubscribe();
    if (timer !== null) clearTimer(timer);
    timer = null;
  }

  void check();
  return stop;
}
