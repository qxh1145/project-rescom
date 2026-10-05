import test from "node:test";
import assert from "node:assert/strict";

const {
  SESSION_RATE_LIMIT_MAX_WAIT_MS,
  SESSION_RATE_LIMIT_RETRIES,
  isSessionLost,
  rateLimitRetryAfterSeconds,
  sessionGateRedirect,
  sessionRetryDelayMs,
  sessionStatusAfterFailure,
  sessionStatusFromError,
  withSessionRetry,
} = await import("../lib/session/session-status.ts");
const { ApiError } = await import("../lib/api/api-error.ts");
const { getOAuthErrorMessage, AUTH_MESSAGES } = await import("../lib/auth/auth-error-messages.ts");
const { parseRateLimitReason, parseRetryAfterSeconds, resolveReturnPath } = await import(
  "../lib/feedback/error-pages.ts"
);

const http = (status, code = null) => new ApiError({ kind: "http", status, code, message: "x" });
const network = new ApiError({ kind: "network", message: "offline" });
const malformed = new ApiError({ kind: "malformed", status: 200, message: "bad" });
const throttled = (retryAfterSeconds = null) =>
  new ApiError({ kind: "http", status: 429, code: "RATE_LIMIT_EXCEEDED", message: "x", retryAfterSeconds });

test("sessionStatusFromError routes by cause", () => {
  assert.equal(sessionStatusFromError(http(401, "AUTH_UNAUTHORIZED")), "unauthenticated");
  assert.equal(sessionStatusFromError(http(403, "AUTH_USER_LOCKED")), "locked");
  assert.equal(sessionStatusFromError(http(403, "AUTH_FORBIDDEN_ORIGIN")), "error");
  assert.equal(sessionStatusFromError(network), "offline");
  assert.equal(sessionStatusFromError(http(500)), "error");
  assert.equal(sessionStatusFromError(malformed), "error");
  assert.equal(sessionStatusFromError(new Error("boom")), "error");
  // A throttled session check is never a server error, with or without an envelope code.
  assert.equal(sessionStatusFromError(throttled(30)), "rate-limited");
  assert.equal(sessionStatusFromError(http(429)), "rate-limited");
});

test("only the initial load escalates transient failures", () => {
  for (const initial of ["loading", "unauthenticated", "error", "offline", "rate-limited"]) {
    assert.equal(sessionStatusAfterFailure(initial, network), "offline", initial);
    assert.equal(sessionStatusAfterFailure(initial, http(500)), "error", initial);
    assert.equal(sessionStatusAfterFailure(initial, throttled(30)), "rate-limited", initial);
  }
  assert.equal(sessionStatusAfterFailure("authenticated", network), "authenticated");
  assert.equal(sessionStatusAfterFailure("authenticated", http(502)), "authenticated");
  assert.equal(sessionStatusAfterFailure("authenticated", malformed), "authenticated");
  assert.equal(sessionStatusAfterFailure("authenticated", throttled(30)), "authenticated");
  assert.equal(sessionStatusAfterFailure("authenticated", http(401)), "unauthenticated");
  assert.equal(sessionStatusAfterFailure("authenticated", http(403, "AUTH_USER_LOCKED")), "locked");
});

test("sessionGateRedirect", () => {
  const here = "/wallet?tab=history";
  assert.equal(sessionGateRedirect("unauthenticated", here), "/login?returnTo=%2Fwallet%3Ftab%3Dhistory");
  assert.equal(sessionGateRedirect("locked", here), "/login?error=AUTH_USER_LOCKED");
  assert.equal(sessionGateRedirect("offline", here), "/offline?from=%2Fwallet%3Ftab%3Dhistory");
  assert.equal(sessionGateRedirect("error", here), "/server-error?from=%2Fwallet%3Ftab%3Dhistory");
  assert.equal(sessionGateRedirect("rate-limited", here), "/rate-limited?reason=session&from=%2Fwallet%3Ftab%3Dhistory");
  assert.equal(sessionGateRedirect("rate-limited", here, 0), "/rate-limited?reason=session&from=%2Fwallet%3Ftab%3Dhistory");
  assert.equal(sessionGateRedirect("loading", here), null);
  assert.equal(sessionGateRedirect("authenticated", here), null);
  // The login page has copy for the locked redirect.
  assert.equal(getOAuthErrorMessage("AUTH_USER_LOCKED"), AUTH_MESSAGES.userLocked);
});

test("the rate-limited redirect carries what /rate-limited reads", () => {
  const here = "/wallet?tab=history";
  const target = new URL(sessionGateRedirect("rate-limited", here, 25), "https://rescom.test");
  assert.equal(target.pathname, "/rate-limited");
  assert.equal(resolveReturnPath(target.searchParams.get("from")), here);
  assert.equal(parseRetryAfterSeconds(target.searchParams.get("retryAfter")), 25);
  // A throttled session check is not "too many surveys": /rate-limited shows the neutral copy.
  assert.equal(parseRateLimitReason(target.searchParams.get("reason")), "session");

  assert.equal(rateLimitRetryAfterSeconds(throttled(25)), 25);
  assert.equal(rateLimitRetryAfterSeconds(throttled()), null);
  assert.equal(rateLimitRetryAfterSeconds(http(500)), null);
  assert.equal(rateLimitRetryAfterSeconds(new Error("boom")), null);
});

test("sessionRetryDelayMs waits Retry-After (capped) for at most two 429 retries", () => {
  assert.equal(SESSION_RATE_LIMIT_RETRIES, 2);
  assert.equal(SESSION_RATE_LIMIT_MAX_WAIT_MS, 10_000);
  assert.equal(sessionRetryDelayMs(throttled(3), 0), 3_000);
  assert.equal(sessionRetryDelayMs(throttled(45), 1), 10_000);
  assert.equal(sessionRetryDelayMs(throttled(0), 0), 0);
  // No Retry-After header: a short wait.
  assert.equal(sessionRetryDelayMs(throttled(), 0), 1_000);
  assert.equal(sessionRetryDelayMs(throttled(3), 2), null);
  // Only a 429 is retried.
  assert.equal(sessionRetryDelayMs(http(401), 0), null);
  assert.equal(sessionRetryDelayMs(http(500), 0), null);
  assert.equal(sessionRetryDelayMs(network, 0), null);
  assert.equal(sessionRetryDelayMs(new Error("boom"), 0), null);
});

/** Records the waits instead of sleeping. */
function fakeWait() {
  const waits = [];
  return { waits, wait: async (ms) => void waits.push(ms) };
}

test("withSessionRetry retries a 429 after Retry-After and returns the first success", async () => {
  const failures = [throttled(3), throttled(45)];
  let calls = 0;
  const { waits, wait } = fakeWait();
  const user = await withSessionRetry(
    async () => {
      calls += 1;
      if (failures.length) throw failures.shift();
      return { id: "u-1" };
    },
    new AbortController().signal,
    wait,
  );
  assert.deepEqual(user, { id: "u-1" });
  assert.equal(calls, 3);
  assert.deepEqual(waits, [3_000, 10_000]);
});

test("withSessionRetry rethrows a 429 that outlasts its retries, and anything else at once", async () => {
  let calls = 0;
  const { waits, wait } = fakeWait();
  await assert.rejects(
    withSessionRetry(
      async () => {
        calls += 1;
        throw throttled(5);
      },
      new AbortController().signal,
      wait,
    ),
    (error) => error.status === 429 && error.retryAfterSeconds === 5,
  );
  assert.equal(calls, 3);
  assert.deepEqual(waits, [5_000, 5_000]);

  calls = 0;
  const other = fakeWait();
  await assert.rejects(
    withSessionRetry(
      async () => {
        calls += 1;
        throw http(401, "AUTH_UNAUTHORIZED");
      },
      new AbortController().signal,
      other.wait,
    ),
    (error) => error.status === 401,
  );
  assert.equal(calls, 1);
  assert.deepEqual(other.waits, []);
});

test("withSessionRetry stops waiting as soon as the load is aborted", async () => {
  const controller = new AbortController();
  let calls = 0;
  const pending = withSessionRetry(async () => {
    calls += 1;
    throw throttled(10);
  }, controller.signal);
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  await assert.rejects(pending, (error) => error.name === "AbortError");
  assert.equal(calls, 1);

  // Already aborted: no wait at all.
  await assert.rejects(
    withSessionRetry(async () => {
      throw throttled(10);
    }, controller.signal),
    (error) => error.name === "AbortError",
  );
});

test("plan 5.6: AUTH_SESSION_REPLACED (now or earlier) sends to the 15e notice", async () => {
  const notice = await import("../lib/auth/session-notice.ts");
  notice.clearSessionReplaced();
  assert.equal(sessionStatusFromError(http(401, "AUTH_SESSION_REPLACED")), "replaced");
  assert.equal(sessionStatusFromError(http(401, "AUTH_SESSION_REVOKED")), "unauthenticated");
  // The backend cleared the cookies on the first answer: later 401s are plain.
  assert.equal(sessionStatusFromError(http(401, "AUTH_UNAUTHORIZED"), () => true), "replaced");
  // The mark only explains the generic code (review L1).
  assert.equal(sessionStatusFromError(http(401, "AUTH_SESSION_REVOKED"), () => true), "unauthenticated");
  assert.equal(sessionStatusFromError(http(401, "AUTH_INVALID_REFRESH_TOKEN"), () => true), "unauthenticated");
  notice.markSessionReplaced(1_000);
  assert.equal(notice.wasSessionReplaced(1_000 + 60_000), true);
  assert.equal(notice.wasSessionReplaced(1_000 + notice.SESSION_REPLACED_MARK_TTL_MS), false);
  notice.clearSessionReplaced();
  assert.equal(notice.wasSessionReplaced(), false);
  assert.equal(
    sessionGateRedirect("replaced", "/wallet?tab=history"),
    "/login?reason=session-replaced&returnTo=%2Fwallet%3Ftab%3Dhistory",
  );
  assert.equal(isSessionLost(http(401, "AUTH_SESSION_REPLACED")), true);
});
