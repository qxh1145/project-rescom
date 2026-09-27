import test from "node:test";
import assert from "node:assert/strict";

// Phase 3 review fixes: start outcomes, attempt status mapping, draft privacy,
// invalid-block handling, the shared minute formatter and the mock economy rules.
const { ApiError } = await import("../lib/api/api-error.ts");
const startFlow = await import("../lib/participation/start-flow.ts");
const { START_FLOW_MESSAGES } = await import("../lib/participation/start-flow-messages.ts");
const { attemptPhase, attemptDetailsSchema } = await import("../lib/participation/attempts-service.ts");
const draft = await import("../lib/participation/answer-draft.ts");
const { clearParticipationStorage } = await import("../lib/participation/clear-participation-storage.ts");
const messages = await import("../lib/participation/participation-messages.ts");
const { effortMinutes, formatEffortMinutes } = await import("../lib/participation/effort-minutes.ts");
const { DEFAULT_FILTERS, matchesClientFilters, toFeedQueryParams } = await import("../lib/marketplace/marketplace-query.ts");
const economy = await import("../mocks/data/economy-rules.ts");
const { RESERVATION_EXPIRY_MS } = await import("@rescom/schemas");

const httpError = (status, code, details, extra = {}) =>
  new ApiError({ kind: "http", status, code, details, message: code, ...extra });

function keyedStorage(entries = {}) {
  const map = new Map(Object.entries(entries));
  return {
    map,
    get length() {
      return map.size;
    },
    key: (index) => [...map.keys()][index] ?? null,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

// ── 1 / 19 / 21 / session: start outcomes ─────────────────────────────────

test("start: COMPLETION_CODE_LIMIT_REACHED is a final info answer with the support hint", () => {
  const decision = startFlow.decisionForStartError(
    "s-1",
    httpError(409, "COMPLETION_CODE_LIMIT_REACHED", {
      formVersionId: "v-1",
      failedVerifications: 6,
      limit: 6,
      policyVersion: "completion-code-policy-v1",
    }),
  );
  assert.deepEqual(decision, {
    kind: "message",
    tone: "info",
    message: START_FLOW_MESSAGES.codeLimitReached,
    support: true,
  });
});

test("start: final answers are info (no retry); failures worth retrying are danger", () => {
  for (const code of ["SURVEY_ALREADY_COMPLETED", "SURVEY_NOT_AVAILABLE", "PARTICIPANT_NOT_ELIGIBLE"]) {
    assert.equal(startFlow.decisionForStartError("s-1", httpError(409, code)).tone, "info", code);
  }
  assert.equal(startFlow.decisionForStartError("s-1", new ApiError({ kind: "network", message: "x" })).tone, "danger");
  assert.equal(startFlow.decisionForStartError("s-1", httpError(500, "INTERNAL_SERVER_ERROR")).tone, "danger");
});

test("start: a lost session is handed to SessionGate", () => {
  assert.deepEqual(startFlow.decisionForStartError("s-1", httpError(401, "AUTH_UNAUTHORIZED")), { kind: "session" });
  assert.deepEqual(startFlow.decisionForStartError("s-1", httpError(403, "AUTH_USER_LOCKED")), { kind: "session" });
});

test("start: PARTICIPATION_RATE_LIMITED scope COMPLETIONS names the window and the wait", () => {
  const details = {
    scope: "COMPLETIONS",
    limit: 5,
    windowSeconds: 3600,
    retryAfterSeconds: 125,
    retryAt: "2026-09-27T10:02:05.000Z",
    policyVersion: "participation-rate-limit-v1",
    completionsInWindow: 3,
    inProgressAttempts: 2,
  };
  const decision = startFlow.decisionForStartError(
    "s-1",
    httpError(429, "PARTICIPATION_RATE_LIMITED", details, { retryAfterSeconds: 125 }),
  );
  assert.equal(decision.tone, "danger");
  assert.match(decision.message, /5 khảo sát trong 60 phút/);
  assert.match(decision.message, /2 khảo sát đang làm dở/);
  assert.match(decision.message, /3 phút/);

  const burst = startFlow.decisionForStartError(
    "s-1",
    httpError(429, "PARTICIPATION_RATE_LIMITED", { ...details, scope: "ATTEMPT_START" }),
  );
  assert.equal(burst.message, START_FLOW_MESSAGES.rateLimited);
  assert.equal(startFlow.formatRetryAfter(45), "45 giây");
});

// ── Status mapping (backend AttemptStatus) ────────────────────────────────

test("attempt status: backend AttemptStatus values + time → screen phase", () => {
  const now = Date.parse("2026-09-27T10:00:00.000Z");
  const future = "2026-09-27T10:10:00.000Z";
  const past = "2026-09-27T09:00:00.000Z";
  assert.equal(attemptPhase({ status: "IN_PROGRESS", expiresAt: future }, now), "open");
  assert.equal(attemptPhase({ status: "IN_PROGRESS", expiresAt: past }, now), "expired");
  assert.equal(attemptPhase({ status: "COMPLETED", expiresAt: past }, now), "completed");
  assert.equal(attemptPhase({ status: "LOCKED", expiresAt: future }, now), "locked");
  assert.equal(attemptPhase({ status: "ABANDONED", expiresAt: future }, now), "cancelled");
  assert.equal(attemptPhase({ status: "ABANDONED", expiresAt: past }, now), "expired");
  assert.equal(attemptPhase({ status: "ABANDONED", expiresAt: future, closedReason: "EXPIRED" }, now), "expired");

  const base = {
    attemptId: "4c9b7a1e-0d2f-4c1b-9a8e-1f2e3d4c5b6a",
    responseId: null,
    formId: "5a0c1f7e-2b4d-4c6a-8e1f-0a1b2c3d4e02",
    formVersionId: "6b1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f",
    type: "EXTERNAL",
    startedAt: "2026-09-27T09:30:00.000Z",
    expiresAt: future,
    submittedAt: null,
    wrongCodeCount: 0,
    survey: { title: "T", rewardPerResponse: 18, estimatedEffortSeconds: 480, publisherName: "P", externalUrl: null },
  };
  assert.equal(attemptDetailsSchema.safeParse({ ...base, status: "COMPLETED", rewardStatus: "PENDING" }).success, true);
  for (const legacy of ["PENDING_REVIEW", "SUBMITTED", "EXPIRED", "CANCELLED"]) {
    assert.equal(attemptDetailsSchema.safeParse({ ...base, status: legacy }).success, false, legacy);
  }
});

// ── 5: draft privacy ──────────────────────────────────────────────────────

test("drafts older than the reservation window are ignored and deleted", () => {
  const storage = keyedStorage();
  const savedAt = new Date("2026-09-27T08:00:00.000Z");
  draft.saveAnswerDraft(storage, { attemptId: "a-1", answers: { q1: 1 }, pageIndex: 0, now: savedAt });
  const inWindow = savedAt.getTime() + RESERVATION_EXPIRY_MS - 1000;
  const afterWindow = savedAt.getTime() + RESERVATION_EXPIRY_MS + 1000;
  assert.deepEqual(draft.loadAnswerDraft(storage, "a-1", inWindow)?.answers, { q1: 1 });
  assert.equal(draft.loadAnswerDraft(storage, "a-1", afterWindow), null);
  assert.equal(storage.map.size, 0, "expired draft removed");

  draft.saveAnswerDraft(storage, { attemptId: "old", answers: {}, pageIndex: 0, now: savedAt });
  draft.saveAnswerDraft(storage, { attemptId: "new", answers: {}, pageIndex: 0, now: new Date(afterWindow) });
  storage.setItem("rescom:other", "keep");
  draft.pruneExpiredAnswerDrafts(storage, afterWindow);
  assert.deepEqual([...storage.map.keys()].sort(), [draft.draftKey("new"), "rescom:other"].sort());
});

test("logout clears every participation key from both stores", () => {
  const local = keyedStorage({
    "rescom:survey-draft:a-1": "{}",
    "rescom:builder-draft:f-1": "{}",
    "rescom:mockdb:attempts": "{}",
  });
  const session = keyedStorage({
    "rescom:google-form-draft:a-2": "{}",
    "rescom:survey-submission:a-1": "{}",
    "rescom:onboarding-draft:x": "{}",
  });
  clearParticipationStorage(local, session, null);
  assert.deepEqual([...local.map.keys()], ["rescom:mockdb:attempts"]);
  assert.deepEqual([...session.map.keys()], ["rescom:onboarding-draft:x"]);
});

// ── 14: invalid blocks ────────────────────────────────────────────────────

test("INVALID_FORM_SUBMISSION details are limited to the form's block ids", () => {
  const error = httpError(400, "INVALID_FORM_SUBMISSION", { q1: "required", _errors: [], ghost: "x" });
  assert.deepEqual(messages.invalidBlockIds(error, new Set(["q1", "q2"])), ["q1"]);
  assert.deepEqual(messages.invalidBlockIds(error).sort(), ["_errors", "ghost", "q1"]);
});

// ── 22: one minute formatter ──────────────────────────────────────────────

test("minutes round up everywhere and the duration filter follows the displayed minutes", () => {
  assert.equal(effortMinutes(0), 1);
  assert.equal(effortMinutes(240), 4);
  assert.equal(effortMinutes(250), 5);
  assert.equal(formatEffortMinutes(601), "11 phút");

  const under5 = { ...DEFAULT_FILTERS, duration: "under5" };
  const fiveTo10 = { ...DEFAULT_FILTERS, duration: "5to10" };
  const maxUnder5 = Number(toFeedQueryParams(under5).get("maxDuration"));
  const maxFiveTo10 = Number(toFeedQueryParams(fiveTo10).get("maxDuration"));
  for (const seconds of [1, 60, 239, 240, 241, 299, 300, 599, 600, 601]) {
    const shown = effortMinutes(seconds);
    assert.equal(seconds <= maxUnder5, shown < 5, `${seconds}s shown ${shown} phút: under5`);
    const inFiveTo10 = seconds <= maxFiveTo10 && matchesClientFilters({ estimatedEffortSeconds: seconds }, fiveTo10);
    assert.equal(inFiveTo10, shown >= 5 && shown <= 10, `${seconds}s shown ${shown} phút: 5to10`);
  }
});

// ── 9: mock economy rules ─────────────────────────────────────────────────

function newAccount() {
  return {
    wallet: { available: 0, pending: 0, escrow: 0, frozen: 100, integrityHold: 0 },
    rows: [
      {
        id: "grant",
        kind: "STARTER_GRANT",
        amount: 100,
        status: "FROZEN",
        note: "Tài khoản mới",
        surveyId: null,
        attemptId: null,
        createdAt: "2026-09-20T00:00:00.000Z",
        releasesAt: null,
      },
    ],
  };
}

function context(now) {
  let id = 0;
  return { now, newId: () => `id-${++id}` };
}

const reward = (pending) => ({ amount: 18, pending, surveyId: "s-ext", attemptId: "a-ext", title: "Google Form" });

test("mock economy: a pending Google Forms reward unlocks nothing until its 48h review ends", () => {
  const start = Date.parse("2026-09-27T10:00:00.000Z");
  const state = newAccount();
  assert.deepEqual(economy.creditReward(state, context(start), reward(true)), { activated: false });
  assert.equal(state.wallet.frozen, 100);
  assert.equal(state.wallet.pending, 18);
  assert.equal(state.rows.some((row) => row.kind === "STARTER_UNLOCK"), false);
  assert.equal(economy.hasConfirmedReward(state.rows), false);
  assert.equal(economy.pendingActivationReward(state.rows)?.attemptId, "a-ext", "→ PENDING_CONFIRMATION");

  // Not due yet.
  assert.deepEqual(economy.releaseDueRewards(state, context(start + 47 * 3_600_000)), { released: 0, activated: false });
  // 48h later: Chờ duyệt → Khả dụng, then the starter points unlock.
  assert.deepEqual(economy.releaseDueRewards(state, context(start + economy.PENDING_REVIEW_MS)), {
    released: 1,
    activated: true,
  });
  assert.deepEqual(state.wallet, { available: 118, pending: 0, escrow: 0, frozen: 0, integrityHold: 0 });
  const unlock = state.rows.find((row) => row.kind === "STARTER_UNLOCK");
  assert.equal(unlock.amount, 100);
  assert.equal(unlock.attemptId, "a-ext");
  assert.equal(economy.pendingActivationReward(state.rows), null);
});

test("mock economy: MOCK-ONLY release-all, and the unlock moves exactly the frozen amount", () => {
  const now = Date.parse("2026-09-27T10:00:00.000Z");
  const state = newAccount();
  state.wallet.frozen = 60; // e.g. partly expired starter grant
  economy.creditReward(state, context(now), reward(true));
  assert.deepEqual(economy.releaseDueRewards(state, context(now), true), { released: 1, activated: true });
  assert.equal(state.rows.find((row) => row.kind === "STARTER_UNLOCK").amount, 60);
  assert.equal(state.wallet.available, 78);
});

test("mock economy: an in-Rescom reward is confirmed at once and unlocks the starter points once", () => {
  const now = Date.parse("2026-09-27T10:00:00.000Z");
  const state = newAccount();
  assert.deepEqual(economy.creditReward(state, context(now), { ...reward(false), attemptId: "a-int" }), {
    activated: true,
  });
  assert.equal(state.wallet.available, 118);
  assert.deepEqual(economy.creditReward(state, context(now), { ...reward(false), attemptId: "a-int-2" }), {
    activated: false,
  });
  assert.equal(state.rows.filter((row) => row.kind === "STARTER_UNLOCK").length, 1);
});
