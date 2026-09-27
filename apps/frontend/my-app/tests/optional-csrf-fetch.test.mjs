import test from "node:test";
import assert from "node:assert/strict";

const { resetCsrfToken } = await import("../lib/api/client.ts");

// Epic 5 review P12: survey-attachment mutations send X-CSRF-Token when the
// visitor has a session and fall back to a token-less request for guests.

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    clone() {
      return jsonResponse(status, body);
    },
  };
}

let moduleInstance = 0;

async function withFetch(handler, run) {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init, calls);
  };
  try {
    // The CSRF token cache lives in lib/api/client.ts (shared with apiRequest).
    resetCsrfToken();
    moduleInstance += 1;
    const api = await import(`../app/forms/forms-api.ts?case=${moduleInstance}`);
    await run(api, calls);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function csrfHeader(call) {
  return new Headers(call.init.headers).get("X-CSRF-Token");
}

test("attaches the CSRF token and keeps other headers when a session exists", async () => {
  await withFetch(
    (url) =>
      url === "/api/auth/csrf"
        ? jsonResponse(200, { data: { csrfToken: "csrf-1" } })
        : jsonResponse(201, { data: { objectId: "obj-1" } }),
    async (api, calls) => {
      const res = await api.optionalCsrfMutationFetch("/api/storage/uploads/initiate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-storage-capability": "cap-123",
        },
        body: JSON.stringify({ fileName: "a.pdf" }),
      });

      assert.equal(res.status, 201);
      const mutation = calls.find((call) => call.url === "/api/storage/uploads/initiate");
      assert.equal(csrfHeader(mutation), "csrf-1");
      const headers = new Headers(mutation.init.headers);
      assert.equal(headers.get("Content-Type"), "application/json");
      assert.equal(headers.get("x-storage-capability"), "cap-123");
      assert.equal(mutation.init.credentials, "same-origin");
    },
  );
});

test("sends guest requests without a CSRF token when /api/auth/csrf returns 401", async () => {
  await withFetch(
    (url) =>
      url === "/api/auth/csrf"
        ? jsonResponse(401, { error: { code: "AUTH_UNAUTHORIZED", message: "Session required" } })
        : jsonResponse(200, { data: { status: "CLEAN" } }),
    async (api, calls) => {
      const res = await api.optionalCsrfMutationFetch("/api/storage/uploads/obj-1/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-storage-capability": "cap-9" },
        body: JSON.stringify({}),
      });

      assert.equal(res.status, 200);
      const mutations = calls.filter((call) => call.url !== "/api/auth/csrf");
      assert.equal(mutations.length, 1);
      assert.equal(csrfHeader(mutations[0]), null);
      assert.equal(new Headers(mutations[0].init.headers).get("x-storage-capability"), "cap-9");
    },
  );
});

test("retries once with a fresh token after AUTH_INVALID_CSRF_TOKEN", async () => {
  let tokenCounter = 0;
  let deleteAttempts = 0;
  await withFetch(
    (url) => {
      if (url === "/api/auth/csrf") {
        tokenCounter += 1;
        return jsonResponse(200, { data: { csrfToken: `csrf-${tokenCounter}` } });
      }
      deleteAttempts += 1;
      return deleteAttempts === 1
        ? jsonResponse(403, { error: { code: "AUTH_INVALID_CSRF_TOKEN" } })
        : jsonResponse(204, {});
    },
    async (api, calls) => {
      const res = await api.optionalCsrfMutationFetch("/api/storage/objects/obj-1", {
        method: "DELETE",
      });

      assert.equal(res.status, 204);
      const mutations = calls.filter((call) => call.url === "/api/storage/objects/obj-1");
      assert.deepEqual(mutations.map(csrfHeader), ["csrf-1", "csrf-2"]);
    },
  );
});

test("returns the original 403 when a fresh token cannot be obtained", async () => {
  let csrfCalls = 0;
  await withFetch(
    (url) => {
      if (url === "/api/auth/csrf") {
        csrfCalls += 1;
        return csrfCalls === 1
          ? jsonResponse(200, { data: { csrfToken: "csrf-1" } })
          : jsonResponse(401, { error: { code: "AUTH_UNAUTHORIZED" } });
      }
      return jsonResponse(403, { error: { code: "AUTH_INVALID_CSRF_TOKEN" } });
    },
    async (api, calls) => {
      const res = await api.optionalCsrfMutationFetch("/api/storage/objects/obj-2", {
        method: "DELETE",
      });

      assert.equal(res.status, 403);
      assert.equal(calls.filter((call) => call.url === "/api/storage/objects/obj-2").length, 1);
    },
  );
});
