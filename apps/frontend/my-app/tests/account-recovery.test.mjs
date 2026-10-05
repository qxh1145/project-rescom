import test from "node:test";
import assert from "node:assert/strict";

const { ApiError } = await import("../lib/api/api-error.ts");
const {
  AUTH_MESSAGES,
  getGoogleLinkErrorMessage,
  getOAuthErrorMessage,
  getPasswordResetErrorMessage,
  getResetPasswordErrorMessage,
  sessionReplacedMessage,
} = await import("../lib/auth/auth-error-messages.ts");
const { describePasswordStrength, scorePassword, PASSWORD_GUIDANCE } = await import(
  "../lib/auth/password-strength.ts"
);
const { readPasswordResetNotice, readSessionReplacedNotice } = await import("../lib/auth/session-notice.ts");
const { validateEmail, validateNewPassword } = await import("../lib/auth/validate-credentials.ts");

const httpError = (status, code, extra = {}) =>
  new ApiError({ kind: "http", status, code, message: code ?? "error", ...extra });

test("scorePassword: empty, too short, then length and variety", () => {
  assert.equal(scorePassword("").level, 0);
  assert.equal(scorePassword("Ngan123!").level, 1);
  assert.equal(scorePassword("matkhaumoi12").level, 2);
  // Figma sample: a 16-character lower-case passphrase is "Khá mạnh".
  assert.deepEqual(scorePassword("mauxanhtrenmayy1"), { level: 3, length: 16, label: "Khá mạnh" });
  assert.equal(scorePassword("MatKhau-2026!abc").level, 4);
  assert.equal(scorePassword("mot cum tu rat dai de nho").level, 4);
  // Long but trivially repetitive stays "Tạm được".
  assert.equal(scorePassword("aaaaaaaaaaaaaaaaaaaaaaaa").level, 2);
});

test("scorePassword counts graphemes like the backend (Vietnamese, emoji)", () => {
  assert.equal(scorePassword("mậtkhẩuđẹp").length, 10);
  assert.equal(scorePassword("👍🏽".repeat(12)).length, 12);
});

test("describePasswordStrength formats the helper line", () => {
  assert.deepEqual(describePasswordStrength(scorePassword("")), { label: "", detail: PASSWORD_GUIDANCE });
  assert.deepEqual(describePasswordStrength(scorePassword("mauxanhtrenmayy1")), {
    label: "Khá mạnh",
    detail: ` · 16 ký tự. ${PASSWORD_GUIDANCE}`,
  });
});

test("validateEmail uses the shared email rule", () => {
  assert.deepEqual(validateEmail("  Linh.NT@fpt.edu.vn "), { ok: true, email: "linh.nt@fpt.edu.vn" });
  assert.deepEqual(validateEmail(""), { ok: false, message: AUTH_MESSAGES.emailRequired });
  assert.deepEqual(validateEmail("linh"), { ok: false, message: AUTH_MESSAGES.emailInvalid });
});

test("getPasswordResetErrorMessage never reveals account existence", () => {
  assert.deepEqual(getPasswordResetErrorMessage(httpError(400, "AUTH_INVALID_INPUT")), {
    fields: { email: AUTH_MESSAGES.emailInvalid },
  });
  assert.match(
    getPasswordResetErrorMessage(httpError(429, "RATE_LIMIT_EXCEEDED", { retryAfterSeconds: 30 })).form,
    /30 giây/,
  );
  assert.deepEqual(getPasswordResetErrorMessage(new ApiError({ kind: "network", message: "x" })), {
    form: AUTH_MESSAGES.network,
  });
  assert.deepEqual(getPasswordResetErrorMessage(httpError(500, "INTERNAL_SERVER_ERROR")), {
    form: AUTH_MESSAGES.server,
  });
});

test("reset password (plan 5.4): dead link, policy and transport errors", () => {
  assert.deepEqual(getResetPasswordErrorMessage(httpError(400, "PASSWORD_RESET_TOKEN_INVALID")), {
    form: AUTH_MESSAGES.resetLinkInvalid,
    linkInvalid: true,
  });
  assert.deepEqual(
    getResetPasswordErrorMessage(
      httpError(400, "AUTH_INVALID_INPUT", { details: { newPassword: { _errors: ["too short"] } } }),
    ),
    { password: AUTH_MESSAGES.passwordPolicy },
  );
  assert.match(getResetPasswordErrorMessage(httpError(429, "RATE_LIMIT_EXCEEDED")).form, /giây/);
  assert.deepEqual(getResetPasswordErrorMessage(httpError(500, "INTERNAL_SERVER_ERROR")), {
    form: AUTH_MESSAGES.server,
  });
  // The forgot route exists now: a 404 is just a server problem.
  assert.deepEqual(getPasswordResetErrorMessage(httpError(404, null)), { form: AUTH_MESSAGES.server });
});

test("validateNewPassword: registration policy and a matching confirmation", () => {
  assert.deepEqual(validateNewPassword("mật khẩu mới đủ dài", "mật khẩu mới đủ dài"), {
    ok: true,
    password: "mật khẩu mới đủ dài",
  });
  assert.deepEqual(validateNewPassword("ngan", "ngan"), {
    ok: false,
    password: AUTH_MESSAGES.passwordTooShort,
    confirm: undefined,
  });
  assert.deepEqual(validateNewPassword("mật khẩu mới đủ dài", ""), {
    ok: false,
    password: undefined,
    confirm: AUTH_MESSAGES.passwordConfirmRequired,
  });
  assert.equal(validateNewPassword("mật khẩu mới đủ dài", "khác hẳn luôn nhé").confirm, AUTH_MESSAGES.passwordMismatch);
  assert.equal(validateNewPassword("x".repeat(73), "x".repeat(73)).password, AUTH_MESSAGES.passwordTooLong);
});

test("password-reset notice on the login page", () => {
  const params = (query) => new URLSearchParams(query);
  assert.equal(readPasswordResetNotice(params("reason=password-reset")), true);
  assert.equal(readPasswordResetNotice(params("reason=session-replaced")), false);
  assert.equal(getOAuthErrorMessage("AUTH_SESSION_REPLACED"), AUTH_MESSAGES.sessionInvalid);
});

test("getGoogleLinkErrorMessage", () => {
  assert.deepEqual(getGoogleLinkErrorMessage(httpError(401, "AUTH_INVALID_CREDENTIALS")), {
    fields: { password: AUTH_MESSAGES.linkPasswordWrong },
  });
  assert.deepEqual(getGoogleLinkErrorMessage(httpError(409, "AUTH_GOOGLE_IDENTITY_CONFLICT")), {
    form: AUTH_MESSAGES.googleAlreadyLinked,
  });
  assert.deepEqual(getGoogleLinkErrorMessage(httpError(403, "AUTH_USER_LOCKED")), {
    form: AUTH_MESSAGES.userLocked,
  });
  assert.equal(getOAuthErrorMessage("AUTH_GOOGLE_IDENTITY_CONFLICT"), AUTH_MESSAGES.googleIdentityConflict);
});

test("session-replaced signal and copy (15e)", () => {
  const params = (query) => new URLSearchParams(query);
  assert.equal(readSessionReplacedNotice(params("")), null);
  assert.equal(readSessionReplacedNotice(params("reason=expired")), null);
  assert.deepEqual(readSessionReplacedNotice(params("reason=session-replaced")), { at: null });
  assert.deepEqual(readSessionReplacedNotice(params("reason=session-replaced&at=nope")), { at: null });
  const notice = readSessionReplacedNotice(params("reason=session-replaced&at=2026-09-27T14:50:00Z"));
  assert.equal(notice.at.toISOString(), "2026-09-27T14:50:00.000Z");

  // Always Vietnam time (Asia/Ho_Chi_Minh, UTC+7), whatever the runtime zone.
  assert.match(sessionReplacedMessage(new Date("2026-09-27T14:50:00Z")), /thiết bị khác lúc 21:50\. Rescom/);
  assert.match(sessionReplacedMessage(null), /thiết bị khác\. Rescom chỉ cho/);
});
