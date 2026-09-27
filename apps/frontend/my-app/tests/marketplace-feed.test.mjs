import test from "node:test";
import assert from "node:assert/strict";

const query = await import("../lib/marketplace/marketplace-query.ts");
const starter = await import("../lib/economy/starter-points-service.ts");
const startFlow = await import("../lib/participation/start-flow.ts");
const { START_FLOW_MESSAGES } = await import("../lib/participation/start-flow-messages.ts");
const { ApiError } = await import("../lib/api/api-error.ts");
const { marketplaceFeedQuerySchema } = await import("@rescom/schemas");

const {
  DEFAULT_FILTERS,
  parseMarketplaceParams,
  serializeMarketplaceParams,
  toFeedQueryParams,
  matchesClientFilters,
  hasNarrowingFilters,
  activeFilterCount,
  toggleSurveyType,
  remainingSlots,
  effortMinutes,
  quickestSurveys,
} = query;

const params = (search) => new URLSearchParams(search);

test("Khám phá URL: an empty query is the Figma default", () => {
  assert.deepEqual(parseMarketplaceParams(params("")), DEFAULT_FILTERS);
  assert.equal(serializeMarketplaceParams(DEFAULT_FILTERS), "");
});

test("Khám phá URL: filters round-trip through the query string", () => {
  const filters = {
    search: "mua sắm",
    sort: "duration_asc",
    types: { internal: false, external: true },
    duration: "5to10",
    hideCompleted: true,
  };
  const serialized = serializeMarketplaceParams(filters);
  assert.equal(serialized, "q=mua+s%E1%BA%AFm&sort=duration_asc&type=external&duration=5to10&hideDone=1");
  assert.deepEqual(parseMarketplaceParams(params(serialized)), filters);
});

test("Khám phá URL: invalid values fall back and other parameters are kept", () => {
  const parsed = parseMarketplaceParams(params("sort=cheapest&type=both&duration=forever&hideDone=yes&q=%20%20"));
  assert.deepEqual(parsed, DEFAULT_FILTERS);

  const base = params("activation=1&msw=slow&sort=reward_desc");
  assert.equal(
    serializeMarketplaceParams({ ...DEFAULT_FILTERS, sort: "best_match", search: "  AI  " }, base),
    "activation=1&msw=slow&q=AI",
  );
});

test("Khám phá URL: the search is trimmed and capped at 100 characters", () => {
  const long = "a".repeat(140);
  assert.equal(parseMarketplaceParams(params(`q=${long}`)).search.length, 100);
});

test("feed query: defaults send hideCompleted=false explicitly (backend default is true)", () => {
  const feed = toFeedQueryParams(DEFAULT_FILTERS);
  assert.equal(feed.toString(), "sortBy=best_match&hideCompleted=false&type=ALL");
  const parsed = marketplaceFeedQuerySchema.parse(Object.fromEntries(feed));
  assert.equal(parsed.hideCompleted, false);
  assert.equal(parsed.type, "ALL");
  assert.equal(parsed.maxDuration, undefined);
});

test("feed query: sort, type, search and duration map to the backend contract", () => {
  const cases = [
    [{ sort: "reward_desc" }, { sortBy: "reward_desc" }],
    [{ sort: "duration_asc" }, { sortBy: "duration_asc" }],
    [{ types: { internal: true, external: false } }, { type: "INTERNAL" }],
    [{ types: { internal: false, external: true } }, { type: "EXTERNAL" }],
    [{ duration: "under5" }, { maxDuration: 299 }],
    [{ duration: "5to10" }, { maxDuration: 600 }],
    [{ hideCompleted: true }, { hideCompleted: true }],
    [{ search: " thư viện " }, { search: "thư viện" }],
  ];
  for (const [patch, expected] of cases) {
    const parsed = marketplaceFeedQuerySchema.parse(
      Object.fromEntries(toFeedQueryParams({ ...DEFAULT_FILTERS, ...patch })),
    );
    for (const [key, value] of Object.entries(expected)) {
      assert.deepEqual(parsed[key], value, `${JSON.stringify(patch)} → ${key}`);
    }
  }
});

test("feed query: '5 – 10 phút' keeps a client-side lower bound; other buckets do not", () => {
  const five = { estimatedEffortSeconds: 300 };
  const three = { estimatedEffortSeconds: 180 };
  assert.equal(matchesClientFilters(three, { ...DEFAULT_FILTERS, duration: "5to10" }), false);
  assert.equal(matchesClientFilters(five, { ...DEFAULT_FILTERS, duration: "5to10" }), true);
  assert.equal(matchesClientFilters(three, { ...DEFAULT_FILTERS, duration: "under5" }), true);
  assert.equal(matchesClientFilters(three, DEFAULT_FILTERS), true);
});

test("filters: narrowing vs sheet badge count, last survey type cannot be unchecked", () => {
  assert.equal(hasNarrowingFilters(DEFAULT_FILTERS), false);
  assert.equal(hasNarrowingFilters({ ...DEFAULT_FILTERS, sort: "reward_desc", hideCompleted: true }), false);
  assert.equal(hasNarrowingFilters({ ...DEFAULT_FILTERS, search: "AI" }), true);
  assert.equal(activeFilterCount({ ...DEFAULT_FILTERS, duration: "under5", hideCompleted: true }), 2);

  const onlyInternal = toggleSurveyType(DEFAULT_FILTERS.types, "external");
  assert.deepEqual(onlyInternal, { internal: true, external: false });
  assert.equal(toggleSurveyType(onlyInternal, "internal"), onlyInternal);
});

test("card helpers: remaining slots, minutes and the 15f quick list", () => {
  assert.equal(remainingSlots({ expectedCompletions: 100, completedCompletions: 62 }), 38);
  assert.equal(remainingSlots({ expectedCompletions: 20, completedCompletions: 25 }), 0);
  assert.equal(effortMinutes(300), 5);
  assert.equal(effortMinutes(20), 1);

  const card = (id, seconds, reward, done = false) => ({
    id,
    estimatedEffortSeconds: seconds,
    rewardPerResponse: reward,
    isCompletedByCurrentUser: done,
  });
  const input = [card("a", 300, 12), card("b", 180, 8), card("c", 360, 10), card("d", 120, 5, true), card("e", 360, 20)];
  assert.deepEqual(quickestSurveys(input).map((survey) => survey.id), ["b", "a", "e"]);
  assert.deepEqual(input.map((survey) => survey.id), ["a", "b", "c", "d", "e"], "input is not reordered");
});

function starterStatus(overrides = {}) {
  return {
    userId: "8d7b6a5c-4e3f-4a2b-9c1d-0e1f2a3b4c5d",
    isGranted: true,
    frozenBalance: 100,
    isDemographicComplete: true,
    hasCompletedMarketplaceSurvey: false,
    isUnlocked: false,
    isExpired: false,
    registeredAt: "2026-09-01T00:00:00.000Z",
    expiresAt: "2026-10-01T00:00:00.000Z",
    daysRemaining: 10,
    unlockEligibility: { eligible: false, missingSteps: [] },
    activationState: "SURVEY_REQUIRED",
    activatedAt: null,
    isVerifiedMember: false,
    activationSurvey: null,
    ...overrides,
  };
}

test("activation card: step 2/2 half done, hidden once activated, 15f when ≤ 3 days remain", () => {
  const banner = starter.activationViewOf(starterStatus());
  assert.equal(banner.kind, "banner");
  assert.equal(banner.completedSteps, 1);
  assert.equal(banner.totalSteps, 2);
  assert.equal(banner.amount, 100);

  assert.equal(starter.activationViewOf(starterStatus({ daysRemaining: 3 })).kind, "expiring");
  assert.equal(starter.activationViewOf(starterStatus({ daysRemaining: 0 })).kind, "expiring");
  assert.equal(starter.activationViewOf(starterStatus({ daysRemaining: 4 })).kind, "banner");

  for (const activationState of ["ACTIVATED", "EXPIRED", "NOT_GRANTED", "DEMOGRAPHICS_REQUIRED"]) {
    assert.equal(starter.activationViewOf(starterStatus({ activationState })).kind, "hidden", activationState);
  }

  const pending = starter.activationViewOf(starterStatus({ activationState: "PENDING_CONFIRMATION", daysRemaining: 1 }));
  assert.equal(pending.kind, "banner", "a survey under review never shows the expiry warning");
  assert.equal(pending.awaitingConfirmation, true);
  assert.equal(pending.completedSteps, 2);
});

test("activation card: the deadline is shown as dd/MM in Vietnam time", () => {
  assert.equal(starter.formatDeadline("2026-09-28T18:00:00.000Z"), "29/09");
});

const SURVEY_ID = "5a0c1f7e-2b4d-4c6a-8e1f-0a1b2c3d4e02";
const ATTEMPT_ID = "0b9a8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d";
const httpError = (status, code, details) =>
  new ApiError({ kind: "http", status, code, details, message: code ?? "error" });

test("start flow: INTERNAL goes to consent without creating an attempt", async () => {
  let calls = 0;
  const decision = await startFlow.startOrResumeSurvey(
    { id: SURVEY_ID, type: "INTERNAL" },
    { start: async () => (calls += 1, { attemptId: ATTEMPT_ID, type: "INTERNAL" }) },
  );
  assert.deepEqual(decision, { kind: "navigate", href: `/surveys/${SURVEY_ID}/start` });
  assert.equal(calls, 0);
});

test("start flow: EXTERNAL starts the attempt and opens the Google Forms flow", async () => {
  const decision = await startFlow.startOrResumeSurvey(
    { id: SURVEY_ID, type: "EXTERNAL" },
    { start: async (id) => (assert.equal(id, SURVEY_ID), { attemptId: ATTEMPT_ID, type: "EXTERNAL" }) },
  );
  assert.deepEqual(decision, { kind: "navigate", href: `/attempts/${ATTEMPT_ID}/google-form` });
});

test("start flow: CONFLICTING_ACTIVE_ATTEMPT resumes the attempt by its own type", async () => {
  const conflict = (type) =>
    httpError(409, "CONFLICTING_ACTIVE_ATTEMPT", {
      attemptId: ATTEMPT_ID,
      responseId: null,
      formVersionId: "6b1d2e3f-4a5b-4c6d-9e7f-000000000002",
      type,
      expiresAt: "2026-09-27T12:00:00.000Z",
    });
  for (const [type, href] of [
    ["EXTERNAL", `/attempts/${ATTEMPT_ID}/google-form`],
    ["INTERNAL", `/attempts/${ATTEMPT_ID}`],
  ]) {
    const decision = await startFlow.startAttemptDecision(SURVEY_ID, {
      start: async () => {
        throw conflict(type);
      },
    });
    assert.deepEqual(decision, { kind: "navigate", href });
  }
});

test("start flow: error codes map to the full screen, onboarding or an inline message", () => {
  const decide = (error) => startFlow.decisionForStartError(SURVEY_ID, error);
  assert.deepEqual(decide(httpError(409, "SURVEY_QUOTA_FULL")), { kind: "navigate", href: `/surveys/${SURVEY_ID}/full` });
  assert.deepEqual(decide(httpError(409, "SURVEY_ALREADY_COMPLETED")), {
    kind: "message",
    tone: "info",
    message: START_FLOW_MESSAGES.alreadyCompleted,
  });
  assert.deepEqual(decide(httpError(403, "DEMOGRAPHIC_PROFILE_REQUIRED")), {
    kind: "navigate",
    href: "/onboarding?required=1&returnTo=%2Fmarketplace",
  });
  assert.equal(decide(httpError(409, "SURVEY_NOT_AVAILABLE")).message, START_FLOW_MESSAGES.notAvailable);
  assert.equal(decide(httpError(403, "SELF_PARTICIPATION_FORBIDDEN")).message, START_FLOW_MESSAGES.ownSurvey);
  assert.equal(decide(httpError(403, "PARTICIPANT_NOT_ELIGIBLE")).message, START_FLOW_MESSAGES.notEligible);
  assert.equal(decide(httpError(429, "PARTICIPATION_RATE_LIMITED")).message, START_FLOW_MESSAGES.rateLimited);
  assert.equal(decide(new ApiError({ kind: "network", message: "offline" })).message, START_FLOW_MESSAGES.network);
  assert.equal(decide(httpError(500, "INTERNAL_SERVER_ERROR")).message, START_FLOW_MESSAGES.generic);
  assert.equal(decide(new Error("boom")).message, START_FLOW_MESSAGES.generic);
  // A conflict without resumable details is not a resume.
  assert.equal(decide(httpError(409, "CONFLICTING_ACTIVE_ATTEMPT", {})).kind, "message");
});
