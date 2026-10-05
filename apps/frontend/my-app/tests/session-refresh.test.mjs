import test from "node:test";
import assert from "node:assert/strict";

const {
  ACCESS_TOKEN_TTL_SECONDS,
  SESSION_REFRESH_INTERVAL_MS,
  accessCookieMayBeExpired,
  msUntilRefreshDue,
  refreshSession,
  shouldRefreshBeforeLoad,
  startSessionRefreshScheduler,
} = await import("../lib/auth/session-refresh.ts");
const { apiRequest, resetCsrfToken, setCsrfToken } = await import("../lib/api/client.ts");
const { ApiError } = await import("../lib/api/api-error.ts");

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

test("refresh interval is 80% of the ASSUMED 900 s access TTL", () => {
  assert.equal(SESSION_REFRESH_INTERVAL_MS, 720_000);
  assert.equal(msUntilRefreshDue(null, 1_000), 0);
  assert.equal(msUntilRefreshDue(1_000, 1_000), 720_000);
  assert.equal(msUntilRefreshDue(1_000, 1_000 + 700_000), 20_000);
  assert.equal(msUntilRefreshDue(1_000, 1_000 + 900_000), 0);
});

test("refreshSession is single-flight, sends CSRF and stores the rotated token", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  resetCsrfToken();
  setCsrfToken("tok-old");
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, token: init.headers?.["X-CSRF-Token"] });
    await new Promise((resolve) => setTimeout(resolve, 5));
    if (url === "/api/auth/refresh") return jsonResponse({ data: { csrfToken: "tok-new" }, error: null, meta: {} });
    return new Response(null, { status: 204 });
  };

  await Promise.all([refreshSession(() => 5_000), refreshSession(() => 5_000)]);
  assert.deepEqual(calls, [{ url: "/api/auth/refresh", token: "tok-old" }]);
  assert.equal(shouldRefreshBeforeLoad(5_000 + SESSION_REFRESH_INTERVAL_MS - 1), false);
  assert.equal(shouldRefreshBeforeLoad(5_000 + SESSION_REFRESH_INTERVAL_MS), true);

  await apiRequest("/auth/logout", { method: "POST" });
  assert.equal(calls.at(-1).token, "tok-new");

  // A new call after settling starts a new request.
  await refreshSession(() => 6_000);
  assert.equal(calls.filter((call) => call.url === "/api/auth/refresh").length, 2);
});

test("refreshSession 401 forgets the refresh timestamp", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  setCsrfToken("tok");
  globalThis.fetch = async () =>
    jsonResponse({ data: null, error: { code: "AUTH_INVALID_REFRESH_TOKEN", message: "x" }, meta: {} }, 401);
  await assert.rejects(refreshSession(), (error) => error.status === 401);
  assert.equal(shouldRefreshBeforeLoad(Number.MAX_SAFE_INTEGER), false);
});

test("a throttled refresh before load escalates only once the access cookie must have expired", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  setCsrfToken("tok");
  globalThis.fetch = async () => jsonResponse({ data: { csrfToken: "tok-2" }, error: null, meta: {} });
  await refreshSession(() => 10_000);

  // A 429 keeps the timestamp: the cookie age stays known.
  globalThis.fetch = async () =>
    jsonResponse({ data: null, error: { code: "RATE_LIMIT_EXCEEDED", message: "x" }, meta: {} }, 429);
  await assert.rejects(refreshSession(() => 20_000), (error) => error.status === 429);

  const ttlMs = ACCESS_TOKEN_TTL_SECONDS * 1000;
  // Refresh is due (80% of the TTL) but the cookie is still valid: GET /auth/me may go ahead.
  assert.equal(shouldRefreshBeforeLoad(10_000 + SESSION_REFRESH_INTERVAL_MS), true);
  assert.equal(accessCookieMayBeExpired(10_000 + SESSION_REFRESH_INTERVAL_MS), false);
  assert.equal(accessCookieMayBeExpired(10_000 + ttlMs - 1), false);
  // A full TTL later the cookie must be gone: /auth/me would 401 and drop the refresh cookie.
  assert.equal(accessCookieMayBeExpired(10_000 + ttlMs), true);
});

/** Fake clock + timers + visibility for the scheduler. */
function harness({ last = null, refresh } = {}) {
  const state = { now: 0, last, timers: [], visible: null, refreshes: 0, ended: [] };
  const stop = startSessionRefreshScheduler({
    onSessionEnded: (error) => state.ended.push(error),
    refresh:
      refresh ??
      (async () => {
        state.refreshes += 1;
        state.last = state.now;
      }),
    now: () => state.now,
    lastRefresh: () => state.last,
    setTimer: (callback, ms) => {
      const timer = { callback, at: state.now + ms };
      state.timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => {
      state.timers = state.timers.filter((entry) => entry !== timer);
    },
    onVisible: (listener) => {
      state.visible = listener;
      return () => {
        state.visible = null;
      };
    },
  });
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  const advance = async (ms) => {
    state.now += ms;
    const due = state.timers.filter((timer) => timer.at <= state.now);
    state.timers = state.timers.filter((timer) => timer.at > state.now);
    for (const timer of due) timer.callback();
    await flush();
  };
  return { state, stop, flush, advance };
}

test("scheduler refreshes immediately when the token age is unknown, then every interval", async () => {
  const { state, stop, flush, advance } = harness();
  await flush();
  assert.equal(state.refreshes, 1);
  assert.equal(state.timers.length, 1);
  await advance(SESSION_REFRESH_INTERVAL_MS - 1);
  assert.equal(state.refreshes, 1);
  await advance(1);
  assert.equal(state.refreshes, 2);
  stop();
  assert.equal(state.timers.length, 0);
  assert.equal(state.visible, null);
});

test("scheduler waits for the remaining time when a recent refresh exists", async () => {
  const { state, stop, flush, advance } = harness({ last: -100_000 });
  await flush();
  assert.equal(state.refreshes, 0);
  assert.equal(state.timers[0].at, SESSION_REFRESH_INTERVAL_MS - 100_000);
  // Another tab refreshed meanwhile: the timer only reschedules.
  state.last = 50_000;
  await advance(SESSION_REFRESH_INTERVAL_MS - 100_000);
  assert.equal(state.refreshes, 0);
  assert.equal(state.timers[0].at, 50_000 + SESSION_REFRESH_INTERVAL_MS);
  stop();
});

test("becoming visible refreshes only when the last refresh is older than the interval", async () => {
  const { state, stop, flush } = harness({ last: 0 });
  await flush();
  state.now = 60_000;
  state.visible();
  await flush();
  assert.equal(state.refreshes, 0);
  state.now = SESSION_REFRESH_INTERVAL_MS + 5;
  state.visible();
  await flush();
  assert.equal(state.refreshes, 1);
  stop();
});

test("transient failures retry; 401 and AUTH_USER_LOCKED end the session and stop", async () => {
  let attempt = 0;
  const failures = [
    new ApiError({ kind: "network", message: "offline" }),
    new ApiError({ kind: "http", status: 500, code: "INTERNAL_SERVER_ERROR", message: "x" }),
    new ApiError({ kind: "http", status: 401, code: "AUTH_SESSION_EXPIRED", message: "x" }),
  ];
  const { state, flush, advance } = harness({
    refresh: async () => {
      throw failures[attempt++];
    },
  });
  await flush();
  assert.equal(attempt, 1);
  assert.equal(state.ended.length, 0);
  await advance(30_000);
  assert.equal(attempt, 2);
  await advance(30_000);
  assert.equal(attempt, 3);
  assert.equal(state.ended.length, 1);
  assert.equal(state.ended[0].code, "AUTH_SESSION_EXPIRED");
  assert.equal(state.timers.length, 0);
  assert.equal(state.visible, null);

  const locked = harness({
    refresh: async () => {
      throw new ApiError({ kind: "http", status: 403, code: "AUTH_USER_LOCKED", message: "x" });
    },
  });
  await locked.flush();
  assert.equal(locked.state.ended[0].code, "AUTH_USER_LOCKED");
});

test("a throttled refresh (429) is transient: the session stays and the scheduler retries", async () => {
  let attempt = 0;
  const { state, stop, flush, advance } = harness({
    refresh: async () => {
      attempt += 1;
      throw new ApiError({ kind: "http", status: 429, code: "RATE_LIMIT_EXCEEDED", message: "x", retryAfterSeconds: 20 });
    },
  });
  await flush();
  assert.equal(attempt, 1);
  await advance(30_000);
  assert.equal(attempt, 2);
  assert.equal(state.ended.length, 0);
  assert.equal(state.timers.length, 1);
  stop();
});

test("stop() during an in-flight refresh schedules nothing", async () => {
  let release;
  const { state, stop, flush } = harness({
    refresh: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  await flush();
  stop();
  release();
  await flush();
  assert.equal(state.timers.length, 0);
});
