import test from "node:test";
import assert from "node:assert/strict";

const { apiRequest } = await import("../lib/api/client.ts");
const { ApiError } = await import("../lib/api/api-error.ts");

const userSchema = {
  safeParse(value) {
    return value && typeof value.id === "string"
      ? { success: true, data: value }
      : { success: false };
  },
};

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}

test("apiRequest", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  await t.test("sends JSON to the /api base and returns validated data", async () => {
    let captured;
    globalThis.fetch = async (url, init) => {
      captured = { url, init };
      return jsonResponse({ data: { id: "u-1" }, error: null, meta: {} });
    };
    const data = await apiRequest("/auth/login", {
      method: "POST",
      csrf: false,
      body: { email: "minh.le@fpt.edu.vn", password: "Password123!" },
      schema: userSchema,
    });
    assert.deepEqual(data, { id: "u-1" });
    assert.equal(captured.url, "/api/auth/login");
    assert.equal(captured.init.method, "POST");
    assert.equal(captured.init.credentials, "same-origin");
    assert.equal(captured.init.headers["Content-Type"], "application/json");
    assert.equal(captured.init.headers.Accept, "application/json");
    assert.deepEqual(JSON.parse(captured.init.body), {
      email: "minh.le@fpt.edu.vn",
      password: "Password123!",
    });
  });

  await t.test("GET sends no body and no Content-Type", async () => {
    let captured;
    globalThis.fetch = async (url, init) => {
      captured = init;
      return jsonResponse({ data: { id: "u-1" }, error: null, meta: {} });
    };
    await apiRequest("/auth/me", { schema: userSchema });
    assert.equal(captured.method, "GET");
    assert.equal(captured.body, undefined);
    assert.equal(captured.headers["Content-Type"], undefined);
  });

  await t.test("malformed success data throws kind=malformed", async () => {
    globalThis.fetch = async () => jsonResponse({ data: { nope: true }, error: null, meta: {} });
    await assert.rejects(apiRequest("/auth/me", { schema: userSchema }), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.kind, "malformed");
      return true;
    });
  });

  await t.test("error envelope maps code, status and details", async () => {
    const details = { _errors: [], email: { _errors: ["Invalid email address format"] } };
    globalThis.fetch = async () =>
      jsonResponse(
        {
          data: null,
          error: { code: "AUTH_INVALID_LOGIN_INPUT", message: "Invalid email", details },
          meta: {},
        },
        { status: 400 },
      );
    await assert.rejects(apiRequest("/auth/login", { method: "POST", csrf: false, body: {} }), (error) => {
      assert.equal(error.kind, "http");
      assert.equal(error.status, 400);
      assert.equal(error.code, "AUTH_INVALID_LOGIN_INPUT");
      assert.equal(error.message, "Invalid email");
      assert.deepEqual(error.details, details);
      return true;
    });
  });

  await t.test("429 exposes Retry-After seconds", async () => {
    globalThis.fetch = async () =>
      jsonResponse(
        { data: null, error: { code: "RATE_LIMIT_EXCEEDED", message: "Too many" }, meta: {} },
        { status: 429, headers: { "Retry-After": "45" } },
      );
    await assert.rejects(apiRequest("/auth/login", { method: "POST", csrf: false, body: {} }), (error) => {
      assert.equal(error.code, "RATE_LIMIT_EXCEEDED");
      assert.equal(error.retryAfterSeconds, 45);
      return true;
    });
  });

  await t.test("non-JSON error body still yields an http ApiError", async () => {
    globalThis.fetch = async () => new Response("<html>Bad gateway</html>", { status: 502 });
    await assert.rejects(apiRequest("/auth/me", { schema: userSchema }), (error) => {
      assert.equal(error.kind, "http");
      assert.equal(error.status, 502);
      assert.equal(error.code, null);
      return true;
    });
  });

  await t.test("network failure throws kind=network", async () => {
    globalThis.fetch = async () => {
      throw new TypeError("Failed to fetch");
    };
    await assert.rejects(apiRequest("/auth/me", { schema: userSchema }), (error) => {
      assert.equal(error.kind, "network");
      assert.equal(error.status, null);
      return true;
    });
  });

  await t.test("abort is rethrown untouched", async () => {
    globalThis.fetch = async () => {
      throw new DOMException("The operation was aborted.", "AbortError");
    };
    await assert.rejects(apiRequest("/auth/me", { schema: userSchema }), (error) => {
      assert.equal(error.name, "AbortError");
      assert.ok(!(error instanceof ApiError));
      return true;
    });
  });

  await t.test("204 resolves to undefined", async () => {
    globalThis.fetch = async () => new Response(null, { status: 204 });
    const result = await apiRequest("/auth/logout", { method: "POST", csrf: false });
    assert.equal(result, undefined);
  });

  await t.test("non-GET sends X-CSRF-Token fetched once from /auth/csrf", async () => {
    const { resetCsrfToken } = await import("../lib/api/client.ts");
    resetCsrfToken();
    const calls = [];
    globalThis.fetch = async (url, init = {}) => {
      calls.push({ url, init });
      if (url === "/api/auth/csrf") return jsonResponse({ data: { csrfToken: "tok-1" }, error: null, meta: {} });
      return new Response(null, { status: 204 });
    };
    await apiRequest("/notifications/read-all", { method: "PATCH" });
    await apiRequest("/notifications/read-all", { method: "PATCH" });
    assert.equal(calls.filter((call) => call.url === "/api/auth/csrf").length, 1);
    const mutation = calls.find((call) => call.url === "/api/notifications/read-all");
    assert.equal(mutation.init.headers["X-CSRF-Token"], "tok-1");
  });

  await t.test("custom headers (Idempotency-Key) are sent, without overriding Accept or the CSRF token", async () => {
    const { resetCsrfToken } = await import("../lib/api/client.ts");
    resetCsrfToken();
    const calls = [];
    globalThis.fetch = async (url, init = {}) => {
      calls.push({ url, init });
      if (url === "/api/auth/csrf") return jsonResponse({ data: { csrfToken: "tok-h" }, error: null, meta: {} });
      return new Response(null, { status: 204 });
    };
    await apiRequest("/forms/external", {
      method: "POST",
      body: { a: 1 },
      headers: { "Idempotency-Key": "key-123", Accept: "text/html", "X-CSRF-Token": "forged" },
    });
    const mutation = calls.find((call) => call.url === "/api/forms/external");
    assert.equal(mutation.init.headers["Idempotency-Key"], "key-123");
    assert.equal(mutation.init.headers.Accept, "application/json");
    assert.equal(mutation.init.headers["X-CSRF-Token"], "tok-h");
    assert.equal(mutation.init.headers["Content-Type"], "application/json");
  });

  await t.test("AUTH_INVALID_CSRF_TOKEN refreshes the token and retries once", async () => {
    const { resetCsrfToken } = await import("../lib/api/client.ts");
    resetCsrfToken();
    let tokenCalls = 0;
    let mutationCalls = 0;
    globalThis.fetch = async (url, init = {}) => {
      if (url === "/api/auth/csrf") {
        tokenCalls += 1;
        return jsonResponse({ data: { csrfToken: `tok-${tokenCalls}` }, error: null, meta: {} });
      }
      mutationCalls += 1;
      if (init.headers["X-CSRF-Token"] === "tok-1") {
        return jsonResponse(
          { data: null, error: { code: "AUTH_INVALID_CSRF_TOKEN", message: "bad" }, meta: {} },
          { status: 403 },
        );
      }
      return new Response(null, { status: 204 });
    };
    await apiRequest("/auth/logout", { method: "POST" });
    assert.equal(tokenCalls, 2);
    assert.equal(mutationCalls, 2);
  });

  await t.test("concurrent CSRF rejections refetch the token only once", async () => {
    const { resetCsrfToken } = await import("../lib/api/client.ts");
    resetCsrfToken();
    let tokenCalls = 0;
    const sentTokens = [];
    let releaseFirstRejections;
    const bothRejected = new Promise((resolve) => {
      releaseFirstRejections = resolve;
    });
    let rejected = 0;
    globalThis.fetch = async (url, init = {}) => {
      if (url === "/api/auth/csrf") {
        tokenCalls += 1;
        return jsonResponse({ data: { csrfToken: `tok-${tokenCalls}` }, error: null, meta: {} });
      }
      sentTokens.push(init.headers["X-CSRF-Token"]);
      if (init.headers["X-CSRF-Token"] === "tok-1") {
        rejected += 1;
        if (rejected === 2) releaseFirstRejections();
        // Both requests hold tok-1 before either retries.
        await bothRejected;
        return jsonResponse(
          { data: null, error: { code: "AUTH_INVALID_CSRF_TOKEN", message: "bad" }, meta: {} },
          { status: 403 },
        );
      }
      return new Response(null, { status: 204 });
    };
    await Promise.all([
      apiRequest("/notifications/a", { method: "PATCH" }),
      apiRequest("/notifications/b", { method: "PATCH" }),
    ]);
    assert.equal(tokenCalls, 2, "the second 403 must not discard the fresh token");
    assert.deepEqual(sentTokens.sort(), ["tok-1", "tok-1", "tok-2", "tok-2"]);
  });

  await t.test("/auth/csrf network failure is an ApiError(kind=network) and is not cached", async () => {
    const { resetCsrfToken } = await import("../lib/api/client.ts");
    resetCsrfToken();
    let csrfCalls = 0;
    globalThis.fetch = async (url) => {
      if (url === "/api/auth/csrf") {
        csrfCalls += 1;
        if (csrfCalls === 1) throw new TypeError("Failed to fetch");
        return jsonResponse({ data: { csrfToken: "tok-ok" }, error: null, meta: {} });
      }
      return new Response(null, { status: 204 });
    };
    await assert.rejects(apiRequest("/auth/logout", { method: "POST" }), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.kind, "network");
      return true;
    });
    await apiRequest("/auth/logout", { method: "POST" });
    assert.equal(csrfCalls, 2);
  });

  await t.test("/auth/csrf HTTP failure keeps the backend code", async () => {
    const { resetCsrfToken } = await import("../lib/api/client.ts");
    resetCsrfToken();
    globalThis.fetch = async () =>
      jsonResponse(
        { data: null, error: { code: "AUTH_UNAUTHORIZED", message: "Session required" }, meta: {} },
        { status: 401 },
      );
    await assert.rejects(apiRequest("/auth/logout", { method: "POST" }), (error) => {
      assert.equal(error.kind, "http");
      assert.equal(error.status, 401);
      assert.equal(error.code, "AUTH_UNAUTHORIZED");
      return true;
    });
  });

  await t.test("aborting while waiting for the CSRF token rejects with AbortError", async () => {
    const { resetCsrfToken } = await import("../lib/api/client.ts");
    resetCsrfToken();
    let mutationCalls = 0;
    globalThis.fetch = async (url) => {
      if (url === "/api/auth/csrf") {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return jsonResponse({ data: { csrfToken: "tok-slow" }, error: null, meta: {} });
      }
      mutationCalls += 1;
      return new Response(null, { status: 204 });
    };
    const controller = new AbortController();
    const pending = apiRequest("/auth/logout", { method: "POST", signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, (error) => error.name === "AbortError");
    assert.equal(mutationCalls, 0);
    // The shared token request still completes for other callers.
    await apiRequest("/auth/logout", { method: "POST" });
    assert.equal(mutationCalls, 1);
  });

  await t.test("an abort while reading the body is rethrown", async () => {
    globalThis.fetch = async () => {
      const res = new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
      res.json = async () => {
        throw new DOMException("The operation was aborted.", "AbortError");
      };
      return res;
    };
    await assert.rejects(apiRequest("/auth/me", { schema: userSchema }), (error) => {
      assert.equal(error.name, "AbortError");
      assert.ok(!(error instanceof ApiError));
      return true;
    });
  });

  await t.test("setCsrfToken replaces the cached token (after /auth/refresh)", async () => {
    const { resetCsrfToken, setCsrfToken } = await import("../lib/api/client.ts");
    resetCsrfToken();
    setCsrfToken("tok-rotated");
    const sent = [];
    globalThis.fetch = async (url, init = {}) => {
      assert.notEqual(url, "/api/auth/csrf");
      sent.push(init.headers["X-CSRF-Token"]);
      return new Response(null, { status: 204 });
    };
    await apiRequest("/auth/logout", { method: "POST" });
    assert.deepEqual(sent, ["tok-rotated"]);
  });

  await t.test("forms-api helpers share the apiRequest token cache", async () => {
    const { resetCsrfToken } = await import("../lib/api/client.ts");
    const { formMutationFetch } = await import("../app/forms/forms-api.ts");
    resetCsrfToken();
    let csrfCalls = 0;
    const sent = [];
    globalThis.fetch = async (url, init = {}) => {
      if (String(url) === "/api/auth/csrf") {
        csrfCalls += 1;
        return jsonResponse({ data: { csrfToken: "tok-shared" }, error: null, meta: {} });
      }
      sent.push(new Headers(init.headers).get("X-CSRF-Token"));
      return new Response(null, { status: 204 });
    };
    await apiRequest("/auth/logout", { method: "POST" });
    await formMutationFetch("/api/forms/1", { method: "DELETE" });
    assert.equal(csrfCalls, 1);
    assert.deepEqual(sent, ["tok-shared", "tok-shared"]);
  });
});

test("plan 5.6: the first AUTH_SESSION_REPLACED answer is remembered for the session status", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const notice = await import("../lib/auth/session-notice.ts");
  const { sessionStatusFromError } = await import("../lib/session/session-status.ts");
  notice.clearSessionReplaced();

  const replaced = { data: null, error: { code: "AUTH_SESSION_REPLACED", message: "x" }, meta: {} };
  const plain = { data: null, error: { code: "AUTH_UNAUTHORIZED", message: "x" }, meta: {} };
  globalThis.fetch = async () => jsonResponse(replaced, { status: 401 });
  await assert.rejects(apiRequest("/notifications/unread-count"), (error) => error instanceof ApiError);
  assert.equal(notice.wasSessionReplaced(), true);

  // The cookies are gone now, so GET /auth/me only says AUTH_UNAUTHORIZED…
  globalThis.fetch = async () => jsonResponse(plain, { status: 401 });
  const later = await apiRequest("/auth/me").catch((error) => error);
  // …and the session still ends on the 15e notice.
  assert.equal(sessionStatusFromError(later), "replaced");

  notice.clearSessionReplaced();
  assert.equal(sessionStatusFromError(later), "unauthenticated");
});

test("plan 5.6 review L1: logout clears the session-replaced mark", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const notice = await import("../lib/auth/session-notice.ts");
  const { logout } = await import("../lib/auth/auth-service.ts");
  notice.markSessionReplaced();
  globalThis.fetch = async (url) =>
    String(url).endsWith("/auth/csrf")
      ? jsonResponse({ data: { csrfToken: "t" }, error: null, meta: {} })
      : new Response(null, { status: 204 });
  await logout();
  assert.equal(notice.wasSessionReplaced(), false);
});
