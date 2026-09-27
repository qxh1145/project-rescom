import test from "node:test";
import assert from "node:assert/strict";

const { ApiError } = await import("../lib/api/api-error.ts");
const { AUTH_MESSAGES, getAuthErrorMessage, getOAuthErrorMessage } = await import(
  "../lib/auth/auth-error-messages.ts"
);

const httpError = (status, code, extra = {}) =>
  new ApiError({ kind: "http", status, code, message: code ?? "error", ...extra });

test("getAuthErrorMessage maps backend codes to Vietnamese copy", () => {
  assert.deepEqual(getAuthErrorMessage(httpError(401, "AUTH_INVALID_CREDENTIALS"), "login"), {
    form: AUTH_MESSAGES.invalidCredentials,
  });
  assert.deepEqual(getAuthErrorMessage(httpError(403, "AUTH_USER_LOCKED"), "login"), {
    form: AUTH_MESSAGES.userLocked,
  });
  assert.deepEqual(
    getAuthErrorMessage(httpError(409, "AUTH_EMAIL_ALREADY_REGISTERED"), "register"),
    // 15a: top alert + field message (the form adds the recovery links).
    { form: AUTH_MESSAGES.registerEmailTaken, fields: { email: AUTH_MESSAGES.emailTaken } },
  );
});

test("400 zod details become field errors per mode", () => {
  const details = {
    _errors: [],
    email: { _errors: ["Invalid email address format"] },
    password: { _errors: ["Password must be at least 12 characters"] },
  };
  assert.deepEqual(
    getAuthErrorMessage(httpError(400, "AUTH_INVALID_REGISTRATION_INPUT", { details }), "register"),
    { fields: { email: AUTH_MESSAGES.emailInvalid, password: AUTH_MESSAGES.passwordTooShort } },
  );
  assert.deepEqual(
    getAuthErrorMessage(
      httpError(400, "AUTH_INVALID_LOGIN_INPUT", { details: { _errors: [], password: { _errors: ["x"] } } }),
      "login",
    ),
    { fields: { password: AUTH_MESSAGES.passwordRequired } },
  );
});

test("rate limit uses Retry-After, falling back to 60 seconds", () => {
  assert.match(
    getAuthErrorMessage(httpError(429, "RATE_LIMIT_EXCEEDED", { retryAfterSeconds: 45 }), "login").form,
    /45 giây/,
  );
  assert.match(getAuthErrorMessage(httpError(429, null), "login").form, /60 giây/);
});

test("network, malformed, 5xx and unknown errors", () => {
  assert.deepEqual(
    getAuthErrorMessage(new ApiError({ kind: "network", message: "x" }), "login"),
    { form: AUTH_MESSAGES.network },
  );
  assert.deepEqual(
    getAuthErrorMessage(new ApiError({ kind: "malformed", status: 200, message: "x" }), "login"),
    { form: AUTH_MESSAGES.server },
  );
  assert.deepEqual(getAuthErrorMessage(httpError(500, "INTERNAL_SERVER_ERROR"), "login"), {
    form: AUTH_MESSAGES.server,
  });
  assert.deepEqual(getAuthErrorMessage(new Error("boom"), "register"), {
    form: AUTH_MESSAGES.server,
  });
});

test("getOAuthErrorMessage", () => {
  assert.equal(getOAuthErrorMessage("GOOGLE_AUTH_CANCELLED"), "Bạn đã hủy đăng nhập Google.");
  assert.match(getOAuthErrorMessage("AUTH_GOOGLE_LINK_REQUIRED"), /liên kết Google/);
  assert.equal(getOAuthErrorMessage("AUTH_UNAUTHORIZED"), AUTH_MESSAGES.sessionInvalid);
  assert.match(getOAuthErrorMessage("SOMETHING_ELSE"), /không thành công/);
});
