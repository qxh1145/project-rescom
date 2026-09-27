import test from "node:test";
import assert from "node:assert/strict";

const { sessionGateRedirect, sessionStatusAfterFailure, sessionStatusFromError } = await import(
  "../lib/session/session-status.ts"
);
const { ApiError } = await import("../lib/api/api-error.ts");
const { getOAuthErrorMessage, AUTH_MESSAGES } = await import("../lib/auth/auth-error-messages.ts");

const http = (status, code = null) => new ApiError({ kind: "http", status, code, message: "x" });
const network = new ApiError({ kind: "network", message: "offline" });
const malformed = new ApiError({ kind: "malformed", status: 200, message: "bad" });

test("sessionStatusFromError routes by cause", () => {
  assert.equal(sessionStatusFromError(http(401, "AUTH_UNAUTHORIZED")), "unauthenticated");
  assert.equal(sessionStatusFromError(http(403, "AUTH_USER_LOCKED")), "locked");
  assert.equal(sessionStatusFromError(http(403, "AUTH_FORBIDDEN_ORIGIN")), "error");
  assert.equal(sessionStatusFromError(network), "offline");
  assert.equal(sessionStatusFromError(http(500)), "error");
  assert.equal(sessionStatusFromError(malformed), "error");
  assert.equal(sessionStatusFromError(new Error("boom")), "error");
});

test("only the initial load escalates transient failures", () => {
  for (const initial of ["loading", "unauthenticated", "error", "offline"]) {
    assert.equal(sessionStatusAfterFailure(initial, network), "offline", initial);
    assert.equal(sessionStatusAfterFailure(initial, http(500)), "error", initial);
  }
  assert.equal(sessionStatusAfterFailure("authenticated", network), "authenticated");
  assert.equal(sessionStatusAfterFailure("authenticated", http(502)), "authenticated");
  assert.equal(sessionStatusAfterFailure("authenticated", malformed), "authenticated");
  assert.equal(sessionStatusAfterFailure("authenticated", http(401)), "unauthenticated");
  assert.equal(sessionStatusAfterFailure("authenticated", http(403, "AUTH_USER_LOCKED")), "locked");
});

test("sessionGateRedirect", () => {
  const here = "/wallet?tab=history";
  assert.equal(sessionGateRedirect("unauthenticated", here), "/login?returnTo=%2Fwallet%3Ftab%3Dhistory");
  assert.equal(sessionGateRedirect("locked", here), "/login?error=AUTH_USER_LOCKED");
  assert.equal(sessionGateRedirect("offline", here), "/offline?from=%2Fwallet%3Ftab%3Dhistory");
  assert.equal(sessionGateRedirect("error", here), "/server-error?from=%2Fwallet%3Ftab%3Dhistory");
  assert.equal(sessionGateRedirect("loading", here), null);
  assert.equal(sessionGateRedirect("authenticated", here), null);
  // The login page has copy for the locked redirect.
  assert.equal(getOAuthErrorMessage("AUTH_USER_LOCKED"), AUTH_MESSAGES.userLocked);
});
