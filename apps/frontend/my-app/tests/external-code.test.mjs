import test from "node:test";
import assert from "node:assert/strict";

const {
  MAX_CODE_TRIES,
  barrierDeadlineMs,
  barrierRemainingSeconds,
  cancelFailureOf,
  canConfirmCode,
  formatCountdown,
  readGoogleFormDraft,
  remainingTriesFrom,
  remainingTriesFromCount,
  reportFailureMessage,
  reportReasonError,
  screenForAttempt,
  verifyFailureOf,
  writeGoogleFormDraft,
  clearGoogleFormDraft,
  googleFormDraftKey,
} = await import("../lib/participation/external-code.ts");
const { EXTERNAL_MESSAGES } = await import("../lib/participation/external-messages.ts");
const { newCancelIdempotencyKey } = await import("../lib/participation/external-service.ts");
const { randomUuid } = await import("../lib/random-uuid.ts");
const { idempotencyKeySchema } = await import("@rescom/schemas");
const { ApiError } = await import("../lib/api/api-error.ts");

const httpError = (status, code, details, extra = {}) =>
  new ApiError({ kind: "http", status, code, details, message: code, ...extra });

function memoryStorage() {
  const store = new Map();
  return {
    store,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
}

test("barrierDeadlineMs prefers the announced earliestSubmitAt", () => {
  const startedAt = "2026-09-27T10:00:00.000Z";
  assert.equal(
    barrierDeadlineMs({ startedAt, timeBarrier: { earliestSubmitAt: "2026-09-27T10:04:12.000Z" } }),
    Date.parse("2026-09-27T10:04:12.000Z"),
  );
});

test("barrierDeadlineMs falls back to the backend's 15 s External default", () => {
  const startedAt = "2026-09-27T10:00:00.000Z";
  assert.equal(barrierDeadlineMs({ startedAt }), Date.parse(startedAt) + 15_000);
  assert.equal(barrierDeadlineMs({ startedAt, timeBarrier: null }), Date.parse(startedAt) + 15_000);
  assert.equal(
    barrierDeadlineMs({ startedAt, timeBarrier: { earliestSubmitAt: "not a date" } }),
    Date.parse(startedAt) + 15_000,
  );
});

test("barrierRemainingSeconds rounds up and never goes negative", () => {
  const deadline = 1_000_000;
  assert.equal(barrierRemainingSeconds(deadline, deadline - 252_000), 252);
  assert.equal(barrierRemainingSeconds(deadline, deadline - 251_001), 252);
  assert.equal(barrierRemainingSeconds(deadline, deadline - 1), 1);
  assert.equal(barrierRemainingSeconds(deadline, deadline), 0);
  assert.equal(barrierRemainingSeconds(deadline, deadline + 5_000), 0);
  assert.equal(barrierRemainingSeconds(Number.NaN, 0), 0);
});

test("formatCountdown matches the Figma 04:12 format", () => {
  assert.equal(formatCountdown(252), "04:12");
  assert.equal(formatCountdown(59), "00:59");
  assert.equal(formatCountdown(0), "00:00");
  assert.equal(formatCountdown(-3), "00:00");
  assert.equal(formatCountdown(3600 + 252), "1:04:12");
});

test("canConfirmCode needs the barrier passed AND 6 digits", () => {
  assert.equal(canConfirmCode({ remainingSeconds: 0, code: "482917" }), true);
  assert.equal(canConfirmCode({ remainingSeconds: 12, code: "482917" }), false);
  assert.equal(canConfirmCode({ remainingSeconds: 0, code: "48291 " }), false);
  assert.equal(canConfirmCode({ remainingSeconds: 0, code: "48291" }), false);
  assert.equal(canConfirmCode({ remainingSeconds: 0, code: "482917", busy: true }), false);
});

test("screenForAttempt routes by backend AttemptStatus, expiry and the account budget", () => {
  const now = Date.parse("2026-09-27T10:00:00.000Z");
  const open = "2026-09-27T10:20:00.000Z";
  const past = "2026-09-27T09:59:00.000Z";
  const base = { attemptId: "a-1", type: "EXTERNAL", expiresAt: open };
  assert.deepEqual(screenForAttempt({ ...base, type: "INTERNAL", status: "IN_PROGRESS" }, now), {
    kind: "redirect",
    href: "/attempts/a-1",
  });
  assert.deepEqual(screenForAttempt({ ...base, status: "COMPLETED" }, now), {
    kind: "redirect",
    href: "/attempts/a-1/complete",
  });
  assert.deepEqual(screenForAttempt({ ...base, status: "LOCKED" }, now), { kind: "locked", reason: "attempt" });
  // Expired reservation: still IN_PROGRESS until the backend abandons it lazily.
  assert.deepEqual(screenForAttempt({ ...base, status: "IN_PROGRESS", expiresAt: past }, now), {
    kind: "closed",
    reason: "expired",
  });
  assert.deepEqual(screenForAttempt({ ...base, status: "ABANDONED", expiresAt: past }, now), {
    kind: "closed",
    reason: "expired",
  });
  assert.deepEqual(screenForAttempt({ ...base, status: "ABANDONED" }, now), { kind: "closed", reason: "cancelled" });
  assert.deepEqual(screenForAttempt({ ...base, status: "ABANDONED", closedReason: "CANCELLED", expiresAt: past }, now), {
    kind: "closed",
    reason: "cancelled",
  });
  assert.deepEqual(screenForAttempt({ ...base, status: "IN_PROGRESS" }, now), { kind: "form" });
  // Account+version budget used up (6 wrong codes): no code can be accepted on reload.
  assert.deepEqual(screenForAttempt({ ...base, status: "IN_PROGRESS", accountWrongCodeCount: 6 }, now), {
    kind: "locked",
    reason: "account-limit",
  });
  assert.deepEqual(screenForAttempt({ ...base, status: "IN_PROGRESS", accountWrongCodeCount: 5 }, now), { kind: "form" });
});

test("remaining tries come from details.remainingAttempts, clamped to the policy", () => {
  assert.equal(MAX_CODE_TRIES, 3);
  assert.equal(remainingTriesFrom({ remainingAttempts: 2 }), 2);
  assert.equal(remainingTriesFrom({ remainingAttempts: 9 }), 3);
  assert.equal(remainingTriesFrom({ remainingAttempts: -1 }), 0);
  // Without details: one try used on top of the known wrong codes.
  assert.equal(remainingTriesFrom(undefined, 0), 2);
  assert.equal(remainingTriesFrom(null, 1), 1);
  assert.equal(remainingTriesFrom({}, 5), 0);
  assert.equal(remainingTriesFromCount(0), 3);
  assert.equal(remainingTriesFromCount(1), 2);
  assert.equal(remainingTriesFromCount(4), 0);
  // With the account+version total (ASSUMED accountWrongCodeCount): the smaller budget wins.
  assert.equal(remainingTriesFromCount(1, 5), 1, "not 'còn 2 lần thử' when the account has 1 try left");
  assert.equal(remainingTriesFromCount(1, 6), 0);
  assert.equal(remainingTriesFromCount(1, 1), 2);
});

test("verifyFailureOf maps backend error codes to UI states", () => {
  assert.deepEqual(verifyFailureOf(httpError(400, "INVALID_COMPLETION_CODE", { remainingAttempts: 2 })), {
    kind: "wrong",
    remainingTries: 2,
  });
  // remainingAttempts 0 on this attempt's 3rd wrong code: the attempt limit.
  assert.deepEqual(verifyFailureOf(httpError(400, "INVALID_COMPLETION_CODE", { remainingAttempts: 0 }), 2), {
    kind: "locked",
    reason: "attempt",
  });
  // remainingAttempts 0 although this attempt had tries left: the account+version budget ran out.
  assert.deepEqual(verifyFailureOf(httpError(400, "INVALID_COMPLETION_CODE", { remainingAttempts: 0 })), {
    kind: "locked",
    reason: "account-limit",
  });
  assert.deepEqual(verifyFailureOf(httpError(400, "INVALID_COMPLETION_CODE", { remainingAttempts: 0 }), 1), {
    kind: "locked",
    reason: "account-limit",
  });
  assert.deepEqual(verifyFailureOf(httpError(409, "ATTEMPT_LOCKED")), { kind: "locked", reason: "attempt" });
  assert.deepEqual(verifyFailureOf(httpError(409, "COMPLETION_CODE_LIMIT_REACHED")), {
    kind: "locked",
    reason: "account-limit",
  });
  assert.deepEqual(verifyFailureOf(httpError(409, "ATTEMPT_EXPIRED")), { kind: "expired" });
  assert.deepEqual(verifyFailureOf(httpError(401, "AUTH_UNAUTHORIZED")), { kind: "session" });
  assert.deepEqual(verifyFailureOf(httpError(403, "AUTH_USER_LOCKED")), { kind: "session" });
  assert.deepEqual(verifyFailureOf(new ApiError({ kind: "network", message: "offline" })), {
    kind: "message",
    message: EXTERNAL_MESSAGES.network,
  });
  assert.deepEqual(verifyFailureOf(httpError(404, "SURVEY_NOT_AVAILABLE")), {
    kind: "message",
    message: EXTERNAL_MESSAGES.notAvailable,
  });
  assert.deepEqual(verifyFailureOf(httpError(500, "INTERNAL_SERVER_ERROR")), {
    kind: "message",
    message: EXTERNAL_MESSAGES.generic,
  });
  assert.deepEqual(verifyFailureOf(new Error("boom")), { kind: "message", message: EXTERNAL_MESSAGES.generic });
});

test("verifyFailureOf restarts the countdown from SUBMISSION_TOO_FAST details", () => {
  const details = {
    requiredSeconds: 252,
    elapsedSeconds: 200,
    remainingSeconds: 52,
    retryAfterSeconds: 52,
    earliestSubmitAt: "2026-09-27T10:04:12.000Z",
    questionCount: null,
    secondsPerQuestion: null,
    publisherMinimumSeconds: 252,
    policyVersion: "time-barrier-v1",
  };
  assert.deepEqual(verifyFailureOf(httpError(422, "SUBMISSION_TOO_FAST", details)), {
    kind: "too-fast",
    remainingSeconds: 52,
  });
  // Malformed details: Retry-After, else 1 s.
  assert.deepEqual(
    verifyFailureOf(httpError(422, "SUBMISSION_TOO_FAST", {}, { retryAfterSeconds: 7 })),
    { kind: "too-fast", remainingSeconds: 7 },
  );
  assert.deepEqual(verifyFailureOf(httpError(422, "SUBMISSION_TOO_FAST")), { kind: "too-fast", remainingSeconds: 1 });
});

test("report reason and report errors", () => {
  assert.equal(reportReasonError("   ab  "), EXTERNAL_MESSAGES.reportReasonTooShort);
  assert.equal(reportReasonError("Form không hiện mã"), null);
  assert.equal(reportFailureMessage(httpError(409, "ATTEMPT_LOCKED")), EXTERNAL_MESSAGES.reportLocked);
  assert.equal(reportFailureMessage(httpError(409, "SURVEY_ALREADY_COMPLETED")), EXTERNAL_MESSAGES.reportCompleted);
  assert.equal(reportFailureMessage(httpError(500, "X")), EXTERNAL_MESSAGES.reportFailed);
  assert.equal(
    reportFailureMessage(httpError(429, "RATE_LIMIT_EXCEEDED", undefined, { retryAfterSeconds: 30 })),
    EXTERNAL_MESSAGES.rateLimitedFor("30 giây"),
  );
});

test("verifyFailureOf: the global throttler's 429 reads like the participation limit", () => {
  // Global request throttler (`RATE_LIMIT_EXCEEDED` + Retry-After): rate-limit copy with the wait.
  assert.deepEqual(verifyFailureOf(httpError(429, "RATE_LIMIT_EXCEEDED", undefined, { retryAfterSeconds: 45 })), {
    kind: "message",
    message: EXTERNAL_MESSAGES.rateLimitedFor("45 giây"),
  });
  assert.deepEqual(verifyFailureOf(httpError(429, "RATE_LIMIT_EXCEEDED")), {
    kind: "message",
    message: EXTERNAL_MESSAGES.rateLimited,
  });
  // The participation burst limit gets the same copy.
  const burst = {
    scope: "COMPLETION_CODE",
    limit: 10,
    windowSeconds: 60,
    retryAfterSeconds: 120,
    retryAt: "2026-10-01T08:02:00.000Z",
    policyVersion: "participation-rate-limit-v1",
  };
  assert.deepEqual(verifyFailureOf(httpError(429, "PARTICIPATION_RATE_LIMITED", burst, { retryAfterSeconds: 120 })), {
    kind: "message",
    message: EXTERNAL_MESSAGES.rateLimitedFor("2 phút"),
  });
  // The completions window keeps its own copy with the numbers.
  const completions = { ...burst, scope: "COMPLETIONS", limit: 20, windowSeconds: 3600 };
  const limited = verifyFailureOf(httpError(429, "PARTICIPATION_RATE_LIMITED", completions, { retryAfterSeconds: 120 }));
  assert.equal(limited.kind, "message");
  assert.match(limited.message, /20/);
  // Any other 429 is still a rate limit, never the generic failure.
  assert.deepEqual(verifyFailureOf(httpError(429, null, undefined, { retryAfterSeconds: 5 })), {
    kind: "message",
    message: EXTERNAL_MESSAGES.rateLimitedFor("5 giây"),
  });
});

test("the typed code and 'opened' survive per attempt in storage", () => {
  const storage = memoryStorage();
  assert.deepEqual(readGoogleFormDraft(storage, "a-1"), { code: "", opened: false });
  writeGoogleFormDraft(storage, "a-1", { code: "48 917", opened: true });
  assert.deepEqual(readGoogleFormDraft(storage, "a-1"), { code: "48 917", opened: true });
  assert.deepEqual(readGoogleFormDraft(storage, "a-2"), { code: "", opened: false });
  // Nothing worth keeping → the key is removed.
  writeGoogleFormDraft(storage, "a-1", { code: "      ", opened: false });
  assert.equal(storage.store.has(googleFormDraftKey("a-1")), false);
  // Corrupt or tampered values are ignored.
  storage.setItem(googleFormDraftKey("a-3"), "{not json");
  assert.deepEqual(readGoogleFormDraft(storage, "a-3"), { code: "", opened: false });
  storage.setItem(googleFormDraftKey("a-4"), JSON.stringify({ code: "<script>", opened: "yes" }));
  assert.deepEqual(readGoogleFormDraft(storage, "a-4"), { code: "", opened: false });
  writeGoogleFormDraft(storage, "a-5", { code: "1", opened: false });
  clearGoogleFormDraft(storage, "a-5");
  assert.equal(storage.store.has(googleFormDraftKey("a-5")), false);
  assert.deepEqual(readGoogleFormDraft(null, "a-1"), { code: "", opened: false });
});

test("cancel: a fresh valid Idempotency-Key per confirmation", () => {
  const first = newCancelIdempotencyKey();
  assert.equal(idempotencyKeySchema.safeParse(first).success, true);
  assert.notEqual(newCancelIdempotencyKey(), first);
});

test("cancel keys fall back to getRandomValues where randomUUID is missing (http LAN origin)", () => {
  const key = randomUuid({
    getRandomValues(bytes) {
      bytes.fill(0xab);
      return bytes;
    },
  });
  assert.equal(key, "abababab-abab-4bab-abab-abababababab");
  assert.equal(idempotencyKeySchema.safeParse(key).success, true);
  assert.equal(idempotencyKeySchema.safeParse(randomUuid(null)).success, true);
  assert.equal(randomUuid({ randomUUID: () => "native", getRandomValues: () => null }), "native");
});

test("cancelFailureOf: a completed attempt opens its completion screen, a closed one leaves", () => {
  const notInProgress = (status, closedReason = null) =>
    httpError(409, "ATTEMPT_NOT_IN_PROGRESS", { status, closedReason });
  assert.deepEqual(cancelFailureOf(notInProgress("COMPLETED")), { kind: "completed" });
  assert.deepEqual(cancelFailureOf(notInProgress("ABANDONED", "CANCELLED")), { kind: "closed" });
  assert.deepEqual(cancelFailureOf(notInProgress("LOCKED")), { kind: "closed" });
  // Details that do not match the shared schema: still closed, never "completed".
  assert.deepEqual(cancelFailureOf(httpError(409, "ATTEMPT_NOT_IN_PROGRESS", { status: "COMPLETED", extra: 1 })), {
    kind: "closed",
  });
  assert.deepEqual(cancelFailureOf(httpError(409, "ATTEMPT_NOT_IN_PROGRESS")), { kind: "closed" });

  assert.deepEqual(cancelFailureOf(httpError(401, "AUTH_UNAUTHORIZED")), { kind: "session" });
  assert.deepEqual(cancelFailureOf(httpError(403, "AUTH_USER_LOCKED")), { kind: "session" });
  assert.deepEqual(cancelFailureOf(httpError(429, "RATE_LIMIT_EXCEEDED", undefined, { retryAfterSeconds: 45 })), {
    kind: "message",
    message: EXTERNAL_MESSAGES.rateLimitedFor("45 giây"),
  });
  assert.deepEqual(cancelFailureOf(httpError(429, "RATE_LIMIT_EXCEEDED")), {
    kind: "message",
    message: EXTERNAL_MESSAGES.rateLimited,
  });
  assert.deepEqual(cancelFailureOf(new ApiError({ kind: "network", message: "offline" })), {
    kind: "message",
    message: EXTERNAL_MESSAGES.network,
  });
  assert.deepEqual(cancelFailureOf(httpError(404, "ATTEMPT_NOT_FOUND")), {
    kind: "message",
    message: EXTERNAL_MESSAGES.cancelFailed,
  });
  assert.deepEqual(cancelFailureOf(new Error("boom")), { kind: "message", message: EXTERNAL_MESSAGES.cancelFailed });
});
