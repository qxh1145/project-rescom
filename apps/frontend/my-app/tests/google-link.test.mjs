import test from "node:test";
import assert from "node:assert/strict";

const { signInAndStartGoogleLink } = await import("../lib/auth/auth-service.ts");
const { resetCsrfToken } = await import("../lib/api/client.ts");

const USER = {
  id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  email: "minh.le@fpt.edu.vn",
  role: "RESPONDENT",
  status: "ACTIVE",
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function run(t, { meStatus, meUser = USER }) {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  resetCsrfToken();
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    if (url === "/api/auth/me") {
      return meStatus === 200
        ? jsonResponse({ data: meUser, error: null, meta: {} })
        : jsonResponse({ data: null, error: { code: "AUTH_UNAUTHORIZED", message: "x" }, meta: {} }, meStatus);
    }
    if (url === "/api/auth/login") return jsonResponse({ data: { user: USER }, error: null, meta: {} });
    if (url === "/api/auth/csrf") return jsonResponse({ data: { csrfToken: "tok" }, error: null, meta: {} });
    if (url === "/api/auth/google/link/start") {
      return jsonResponse({ data: { authorizationUrl: "https://accounts.example/o" }, error: null, meta: {} });
    }
    throw new Error(`unexpected ${url}`);
  };
  const url = await signInAndStartGoogleLink({ email: USER.email, password: "Password123!" });
  assert.equal(url, "https://accounts.example/o");
  return calls;
}

test("signs in first when there is no session", async (t) => {
  const calls = await run(t, { meStatus: 401 });
  assert.ok(calls.includes("/api/auth/login"));
});

test("a retry reuses the session of the same account instead of logging in again", async (t) => {
  const calls = await run(t, { meStatus: 200 });
  assert.ok(!calls.includes("/api/auth/login"));
  assert.ok(calls.includes("/api/auth/google/link/start"));
});

test("a session of another account still signs in with the typed credentials", async (t) => {
  const calls = await run(t, { meStatus: 200, meUser: { ...USER, email: "other@fpt.edu.vn" } });
  assert.ok(calls.includes("/api/auth/login"));
});
