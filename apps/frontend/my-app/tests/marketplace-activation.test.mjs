import test from "node:test";
import assert from "node:assert/strict";

function createMockStorage() {
  const store = new Map();
  return {
    getItem(key) {
      return store.get(key) ?? null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
  };
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const COMPLETE_SURVEY = {
  age: 21,
  gender: "FEMALE",
  location: "Đà Nẵng",
  occupation: "Sinh viên đại học",
  fieldOfStudy: "Công nghệ thông tin",
  householdIncome: "Dưới 5 triệu VNĐ/tháng",
  specificInterests: ["Trí tuệ nhân tạo (AI)"],
};

test("Story 7.2: Marketplace survey activation step (mock repository)", async (t) => {
  const { mockRepository } = await import("../lib/mock/repository.ts");
  const store = await import("../lib/mock/store.ts");

  let emailSeed = 0;

  t.beforeEach(() => {
    store.setMockStorage(createMockStorage());
    mockRepository.setLatency(0);
    mockRepository.setSimulateError(false);
  });

  async function onboardedRespondent() {
    emailSeed += 1;
    const { user } = await mockRepository.register({
      email: `activation${emailSeed}@fpt.edu.vn`,
      password: "Password123!",
      name: "Sinh Viên Kích Hoạt",
    });
    await mockRepository.submitDemographicSurvey(COMPLETE_SURVEY);
    return user;
  }

  async function completeInternal(surveyId) {
    const attempt = await mockRepository.startSurveyAttempt(surveyId);
    // Story 8.2: pass the Time Barrier (questions × 2 s) without sleeping.
    store.saveAttempt({
      ...attempt,
      startedAt: new Date(Date.now() - (attempt.minTimeBarrierSeconds + 5) * 1000).toISOString(),
    });
    return mockRepository.submitInternalSurvey(attempt.attemptId, {});
  }

  async function completeExternal(surveyId) {
    const survey = await mockRepository.getSurveyById(surveyId);
    const attempt = await mockRepository.startSurveyAttempt(surveyId);
    store.saveAttempt({
      ...attempt,
      startedAt: new Date(Date.now() - (survey.minTimeBarrierSeconds + 5) * 1000).toISOString(),
    });
    const result = await mockRepository.submitExternalSurvey(
      attempt.attemptId,
      survey.completionCode,
    );
    return { attemptId: attempt.attemptId, result };
  }

  /** Seeds a COMPLETED attempt directly (e.g. a path the repository refuses). */
  function seedCompletedAttempt(userId, surveyId, type = "INTERNAL") {
    const attemptId = `att-seeded-${surveyId}-${userId}`;
    const now = new Date().toISOString();
    store.saveAttempt({
      attemptId,
      surveyId,
      formVersionId: `ver-${surveyId}`,
      userId,
      type,
      status: "COMPLETED",
      startedAt: now,
      completedAt: now,
      expiresAt: now,
      rewardPerResponse: 10,
      minTimeBarrierSeconds: 0,
      responseId: null,
      externalUrl: null,
      reportedMissingCode: null,
    });
    return attemptId;
  }

  function ageAttempt(attemptId, hours) {
    const attempt = store.getAttempt(attemptId);
    store.saveAttempt({
      ...attempt,
      completedAt: new Date(Date.now() - hours * HOUR).toISOString(),
    });
  }

  function registerUserAt(userId, date) {
    store.updateUser(userId, (u) => ({ ...u, createdAt: date.toISOString() }));
  }

  async function activationNotifications() {
    const list = await mockRepository.getNotifications();
    return list.items.filter((n) => n.type === "ACCOUNT_ACTIVATED");
  }

  await t.test("prompts an onboarded respondent to complete one eligible survey (FR-7)", async () => {
    const user = await onboardedRespondent();

    const { status, recommendedSurveys } = await mockRepository.getActivationStatus();

    assert.equal(status.activationState, "SURVEY_REQUIRED");
    assert.equal(status.userId, user.id);
    assert.equal(status.frozenBalance, 100);
    assert.equal(status.isDemographicComplete, true);
    assert.equal(status.isUnlocked, false);
    assert.equal(status.daysRemaining, 30);
    assert.equal(status.activatedAt, null);
    assert.deepEqual(status.unlockEligibility.missingSteps, ["Complete 1 Marketplace Survey"]);

    assert.ok(recommendedSurveys.length > 0 && recommendedSurveys.length <= 3);
    assert.equal(recommendedSurveys[0].type, "INTERNAL", "Internal surveys unlock instantly, so they come first");
    const firstExternal = recommendedSurveys.findIndex((s) => s.type === "EXTERNAL");
    if (firstExternal !== -1) {
      assert.ok(recommendedSurveys.slice(firstExternal).every((s) => s.type === "EXTERNAL"));
    }
  });

  await t.test("an Internal survey unlocks 100 Frozen points exactly once (FR-8)", async () => {
    await onboardedRespondent();
    const [first] = (await mockRepository.getActivationStatus()).recommendedSurveys;

    const result = await completeInternal(first.id);

    assert.equal(result.unlockedStarterPoints, true);
    assert.equal(result.activation.state, "ACTIVATED");
    let wallet = await mockRepository.getWalletDetails();
    assert.equal(wallet.balance.frozen, 0);
    assert.equal(wallet.balance.available, 100 + first.rewardPerResponse);

    const { status, recommendedSurveys } = await mockRepository.getActivationStatus();
    assert.equal(status.activationState, "ACTIVATED");
    assert.equal(status.isUnlocked, true);
    assert.ok(status.activatedAt);
    assert.equal(status.activationSurvey.formId, first.id);
    assert.equal(status.activationSurvey.status, "CONFIRMED");
    assert.deepEqual(recommendedSurveys, []);
    assert.equal((await mockRepository.getCurrentUser()).isActivated, true);
    assert.equal((await activationNotifications()).length, 1);

    // A second survey never unlocks again.
    const feed = await mockRepository.getMarketplaceFeed({ type: "INTERNAL", hideCompleted: true });
    const second = feed.surveys[0];
    const again = await completeInternal(second.id);
    assert.equal(again.unlockedStarterPoints, false);
    wallet = await mockRepository.getWalletDetails();
    assert.equal(wallet.balance.available, 100 + first.rewardPerResponse + second.rewardPerResponse);
    const unlockJournals = new Set(
      wallet.transactions
        .filter((tx) => tx.idempotencyKey === `starter-unlock:${status.userId}`)
        .map((tx) => tx.journalId),
    );
    assert.equal(unlockJournals.size, 1);
    assert.equal((await activationNotifications()).length, 1);
  });

  await t.test("an External survey unlocks only after its 48-hour review window (FR-24)", async () => {
    await onboardedRespondent();
    const external = (await mockRepository.getMarketplaceFeed({ type: "EXTERNAL" })).surveys[0];

    const { attemptId, result } = await completeExternal(external.id);

    assert.equal(result.unlockedStarterPoints, false);
    assert.equal(result.activation.state, "PENDING_CONFIRMATION");
    const attempt = store.getAttempt(attemptId);
    assert.equal(
      new Date(result.activation.confirmsAt).getTime() - new Date(attempt.completedAt).getTime(),
      48 * HOUR,
    );
    assert.match(result.message, /48 giờ/);

    let activation = await mockRepository.getActivationStatus();
    assert.equal(activation.status.activationState, "PENDING_CONFIRMATION");
    assert.equal(activation.status.activationSurvey.status, "PENDING_REVIEW");
    assert.ok(activation.recommendedSurveys.length > 0);
    assert.ok(
      activation.recommendedSurveys.every((s) => s.type === "INTERNAL"),
      "while an External survey is under review only instant (Internal) surveys are suggested",
    );
    assert.equal((await mockRepository.getWalletDetails()).balance.frozen, 100);
    assert.equal((await activationNotifications()).length, 0);

    // The review window closes without a dispute.
    ageAttempt(attemptId, 49);
    activation = await mockRepository.getActivationStatus();
    assert.equal(activation.status.activationState, "ACTIVATED");
    const wallet = await mockRepository.getWalletDetails();
    assert.equal(wallet.balance.frozen, 0);
    assert.equal(wallet.balance.available, 100);
    assert.equal((await activationNotifications()).length, 1);

    // Reading the status again never unlocks twice.
    await mockRepository.getActivationStatus();
    assert.equal((await mockRepository.getWalletDetails()).balance.available, 100);
  });

  await t.test("an Internal survey unlocks immediately even while an External one is under review", async () => {
    await onboardedRespondent();
    const external = (await mockRepository.getMarketplaceFeed({ type: "EXTERNAL" })).surveys[0];
    await completeExternal(external.id);

    const internal = (await mockRepository.getActivationStatus()).recommendedSurveys[0];
    const result = await completeInternal(internal.id);

    assert.equal(result.unlockedStarterPoints, true);
    const { status } = await mockRepository.getActivationStatus();
    assert.equal(status.activationState, "ACTIVATED");
    assert.equal(status.activationSurvey.source, "INTERNAL");
  });

  await t.test("the respondent's own survey is hidden, cannot be started, never counts and is never recommended (E4-DN2)", async () => {
    const user = await onboardedRespondent();
    const state = store.loadStore();
    const template = state.surveys["survey-int-002"];
    state.surveys["survey-own-001"] = {
      ...template,
      id: "survey-own-001",
      publisherId: user.id,
      title: "Khảo sát của chính tôi",
      targetingJson: null,
      hasTargeting: false,
    };
    store.saveStore(state);

    const before = await mockRepository.getActivationStatus();
    assert.equal(before.recommendedSurveys.some((s) => s.id === "survey-own-001"), false);

    // Decision E4-DN2: hidden from the feed (even with completed surveys shown) ...
    const feed = await mockRepository.getMarketplaceFeed({ hideCompleted: false });
    assert.equal(feed.surveys.some((s) => s.id === "survey-own-001"), false);
    assert.ok(feed.surveys.some((s) => s.id === "survey-int-002"), "others' surveys stay visible");
    // ... and starting it is refused like the backend's 403.
    await assert.rejects(
      () => mockRepository.startSurveyAttempt("survey-own-001"),
      (error) =>
        error.code === "SELF_PARTICIPATION_FORBIDDEN" && /chính mình đăng/.test(error.message),
    );
    assert.equal(
      Object.values(store.loadStore().attempts).some((a) => a.surveyId === "survey-own-001"),
      false,
    );

    // A (legacy) completion of one's own survey still never activates.
    seedCompletedAttempt(user.id, "survey-own-001");
    const { status } = await mockRepository.getActivationStatus();
    assert.equal(status.activationState, "SURVEY_REQUIRED");
    assert.equal(status.isVerifiedMember, false);
    assert.equal((await mockRepository.getWalletDetails()).balance.frozen, 100);
  });

  await t.test("another user still sees and can start that survey (E4-DN2)", async () => {
    const owner = await onboardedRespondent();
    const state = store.loadStore();
    state.surveys["survey-int-002"] = { ...state.surveys["survey-int-002"], publisherId: owner.id };
    store.saveStore(state);

    await onboardedRespondent();
    const feed = await mockRepository.getMarketplaceFeed({});
    assert.ok(feed.surveys.some((s) => s.id === "survey-int-002"));
    const attempt = await mockRepository.startSurveyAttempt("survey-int-002");
    assert.equal(attempt.status, "IN_PROGRESS");
  });

  await t.test("a zero-reward survey never counts toward activation and is never recommended (E7-DN2)", async () => {
    const user = await onboardedRespondent();
    const state = store.loadStore();
    state.surveys["survey-free-001"] = {
      ...state.surveys["survey-int-002"],
      id: "survey-free-001",
      title: "Khảo sát miễn phí",
      rewardPerResponse: 0,
      targetingJson: null,
      hasTargeting: false,
    };
    store.saveStore(state);

    const before = await mockRepository.getActivationStatus();
    assert.equal(before.recommendedSurveys.some((s) => s.id === "survey-free-001"), false);

    const result = await completeInternal("survey-free-001");
    assert.equal(result.unlockedStarterPoints, false);
    const { status } = await mockRepository.getActivationStatus();
    assert.equal(status.activationState, "SURVEY_REQUIRED");
    assert.equal(status.hasCompletedMarketplaceSurvey, false);
    assert.equal(status.isVerifiedMember, false);
    assert.equal((await mockRepository.getWalletDetails()).balance.frozen, 100);
    assert.ok(user.id);

    // A 1-point survey qualifies.
    const latest = store.loadStore();
    latest.surveys["survey-one-001"] = { ...latest.surveys["survey-free-001"], id: "survey-one-001", rewardPerResponse: 1 };
    store.saveStore(latest);
    const paid = await completeInternal("survey-one-001");
    assert.equal(paid.unlockedStarterPoints, true);
  });

  await t.test("isVerifiedMember follows both onboarding steps, not the starter points (E7-DN3)", async () => {
    const user = await onboardedRespondent();
    assert.equal((await mockRepository.getActivationStatus()).status.isVerifiedMember, false);

    // Expired without a survey: not verified yet.
    registerUserAt(user.id, new Date(Date.now() - 31 * DAY));
    let { status } = await mockRepository.getActivationStatus();
    assert.equal(status.activationState, "EXPIRED");
    assert.equal(status.isVerifiedMember, false);

    // A survey completed after the deadline cannot unlock the points, but
    // it completes the second step: the respondent becomes a Verified Member.
    const survey = (await mockRepository.getMarketplaceFeed({ type: "INTERNAL" })).surveys[0];
    const result = await completeInternal(survey.id);
    assert.equal(result.unlockedStarterPoints, false);
    ({ status } = await mockRepository.getActivationStatus());
    assert.equal(status.activationState, "EXPIRED");
    assert.equal(status.isVerifiedMember, true);
    assert.equal((await mockRepository.getWalletDetails()).balance.frozen, 0);

    // An activated demo user is verified too.
    await mockRepository.switchDemoUser("user-active-002");
    assert.equal((await mockRepository.getActivationStatus()).status.isVerifiedMember, true);
  });

  await t.test("30 days without activation expires the starter points once (FR-5)", async () => {
    const user = await onboardedRespondent();
    registerUserAt(user.id, new Date(Date.now() - 31 * DAY));

    const { status, recommendedSurveys } = await mockRepository.getActivationStatus();

    assert.equal(status.activationState, "EXPIRED");
    assert.equal(status.isExpired, true);
    assert.equal(status.daysRemaining, 0);
    assert.deepEqual(recommendedSurveys, []);
    let wallet = await mockRepository.getWalletDetails();
    assert.equal(wallet.balance.frozen, 0);
    assert.equal(wallet.balance.available, 0);
    let warnings = (await mockRepository.getNotifications()).items.filter((n) => n.type === "WARNING");
    assert.equal(warnings.length, 1);

    // Completing a survey afterwards cannot activate the expired points.
    const survey = (await mockRepository.getMarketplaceFeed({ type: "INTERNAL" })).surveys[0];
    const result = await completeInternal(survey.id);
    assert.equal(result.unlockedStarterPoints, false);
    wallet = await mockRepository.getWalletDetails();
    assert.equal(wallet.balance.available, survey.rewardPerResponse);
    await mockRepository.getActivationStatus();
    warnings = (await mockRepository.getNotifications()).items.filter((n) => n.type === "WARNING");
    assert.equal(warnings.length, 1);
    assert.equal((await activationNotifications()).length, 0);
  });

  await t.test("an External survey verified inside the window still activates after the deadline", async () => {
    const user = await onboardedRespondent();
    const external = (await mockRepository.getMarketplaceFeed({ type: "EXTERNAL" })).surveys[0];
    const { attemptId } = await completeExternal(external.id);
    // Registered 30 days and 12 hours ago; verified 13 hours ago (day 29.98).
    registerUserAt(user.id, new Date(Date.now() - 30 * DAY - 12 * HOUR));
    ageAttempt(attemptId, 13);

    let activation = await mockRepository.getActivationStatus();
    assert.equal(activation.status.activationState, "PENDING_CONFIRMATION");
    assert.equal((await mockRepository.getWalletDetails()).balance.frozen, 100);

    ageAttempt(attemptId, 49);
    registerUserAt(user.id, new Date(Date.now() - 31 * DAY - 12 * HOUR));
    activation = await mockRepository.getActivationStatus();
    assert.equal(activation.status.activationState, "ACTIVATED");
    assert.equal((await mockRepository.getWalletDetails()).balance.available, 100);
  });

  await t.test("past the deadline an in-window survey no longer activates once the profile is incomplete (code review P2, 7.2 AC4)", async () => {
    const user = await onboardedRespondent();
    const external = (await mockRepository.getMarketplaceFeed({ type: "EXTERNAL" })).surveys[0];
    const { attemptId } = await completeExternal(external.id);
    // The respondent later clears a field (FR-9 partial edit) ...
    await mockRepository.saveDemographicProfile({ householdIncome: "" });
    // ... and the 30-day window and the 48 h review both pass.
    registerUserAt(user.id, new Date(Date.now() - 31 * DAY));
    ageAttempt(attemptId, 24 * 20);

    const { status } = await mockRepository.getActivationStatus();

    // A completion never stands in for the demographic profile: the unlock
    // needs a complete profile, so past the deadline this is expiry.
    assert.equal(status.isDemographicComplete, false);
    assert.equal(status.activationState, "EXPIRED");
    const wallet = await mockRepository.getWalletDetails();
    assert.equal(wallet.balance.available, 0);
    assert.equal(wallet.balance.frozen, 0);
  });

  await t.test("code review P4: re-submitting the profile while an External completion is under review does not send the user back to activation", async () => {
    await onboardedRespondent();
    const external = (await mockRepository.getMarketplaceFeed({ type: "EXTERNAL" })).surveys[0];
    await completeExternal(external.id);
    assert.equal(
      (await mockRepository.getActivationStatus()).status.activationState,
      "PENDING_CONFIRMATION",
    );

    const result = await mockRepository.submitDemographicSurvey({ ...COMPLETE_SURVEY, location: "Huế" });

    assert.equal(result.nextStep, "COMPLETED");
    assert.equal(result.redirectUrl, "/marketplace");
  });

  await t.test("code review P4: an expired respondent has nothing to activate", async () => {
    const user = await onboardedRespondent();
    registerUserAt(user.id, new Date(Date.now() - 31 * DAY));
    assert.equal((await mockRepository.getActivationStatus()).status.activationState, "EXPIRED");

    const result = await mockRepository.submitDemographicSurvey(COMPLETE_SURVEY);

    assert.equal(result.nextStep, "COMPLETED");
    assert.equal(result.redirectUrl, "/marketplace");
  });

  await t.test("code review P7: past the deadline a pending External review gets no recommendations", async () => {
    const user = await onboardedRespondent();
    const external = (await mockRepository.getMarketplaceFeed({ type: "EXTERNAL" })).surveys[0];
    const { attemptId, result } = await completeExternal(external.id);
    assert.equal(result.activation.state, "PENDING_CONFIRMATION");
    assert.equal(typeof result.activation.expiresAt, "string");

    // Inside the window the Internal fast path is still suggested ...
    const inWindow = await mockRepository.getActivationStatus();
    assert.ok(inWindow.recommendedSurveys.length > 0);
    assert.ok(inWindow.recommendedSurveys.every((s) => s.type === "INTERNAL"));

    // ... but once the 30-day window closed a new completion can never count.
    registerUserAt(user.id, new Date(Date.now() - 30 * DAY - 12 * HOUR));
    ageAttempt(attemptId, 13);
    const { status, recommendedSurveys } = await mockRepository.getActivationStatus();
    assert.equal(status.activationState, "PENDING_CONFIRMATION");
    assert.deepEqual(recommendedSurveys, []);
  });

  await t.test("code review P3/P10: the Sidebar block and the reopened receipt follow the activation state", async () => {
    const helpers = await import("../lib/activation.ts");
    const user = await onboardedRespondent();
    const state = store.loadStore();
    state.surveys["survey-own-002"] = {
      ...state.surveys["survey-int-002"],
      id: "survey-own-002",
      publisherId: user.id,
      title: "Khảo sát của chính tôi",
      targetingJson: null,
      hasTargeting: false,
    };
    store.saveStore(state);

    // A completion of one's own survey (which the repository now refuses to
    // start, decision E4-DN2) does not tick step 2.
    seedCompletedAttempt(user.id, "survey-own-002");
    let view = helpers.sidebarActivationView((await mockRepository.getActivationStatus()).status);
    assert.deepEqual(view.steps.map((step) => step.status), ["done", "todo"]);
    assert.match(view.steps[1].label, /do người khác đăng/);
    assert.match(view.description, /100 điểm khóa/);

    // A pending External completion shows "waiting", and the reopened
    // receipt of that survey keeps the 48 h notice.
    const external = (await mockRepository.getMarketplaceFeed({ type: "EXTERNAL" })).surveys[0];
    await completeExternal(external.id);
    const { status } = await mockRepository.getActivationStatus();
    view = helpers.sidebarActivationView(status);
    assert.deepEqual(view.steps.map((step) => step.status), ["done", "pending"]);
    assert.match(view.steps[1].label, /chờ đối soát 48 giờ/);
    const notice = helpers.receiptActivationNotice(status, external.id);
    assert.equal(notice.state, "PENDING_CONFIRMATION");
    assert.equal(notice.confirmsAt, status.activationSurvey.confirmsAt);
    assert.equal(notice.expiresAt, status.expiresAt);
    assert.equal(helpers.receiptActivationNotice(status, "survey-int-002"), undefined);

    // EXPIRED explains the forfeiture instead of "awaiting unlock".
    const expiredUser = await onboardedRespondent();
    registerUserAt(expiredUser.id, new Date(Date.now() - 31 * DAY));
    view = helpers.sidebarActivationView((await mockRepository.getActivationStatus()).status);
    assert.equal(view.badge, "Đã hết hạn");
    assert.equal(view.tone, "expired");
    assert.equal(view.steps, null);
    assert.match(view.description, /hết hạn/);
  });

  await t.test("E7-DN1 demo control: simulating the end of the 48 h review releases Pending and unlocks the External-only path", async () => {
    await onboardedRespondent();
    const external = (await mockRepository.getMarketplaceFeed({ type: "EXTERNAL" })).surveys[0];
    const { attemptId } = await completeExternal(external.id);
    const originalCompletedAt = store.getAttempt(attemptId).completedAt;
    assert.equal(
      (await mockRepository.getActivationStatus()).status.activationState,
      "PENDING_CONFIRMATION",
    );
    let wallet = await mockRepository.getWalletDetails();
    assert.equal(wallet.balance.pending, external.rewardPerResponse);

    const result = await mockRepository.simulateExternalReviewElapsed();

    assert.equal(result.maturedCount, 1);
    assert.equal(result.releasedPoints, external.rewardPerResponse);
    assert.equal(result.unlockedStarterPoints, true);
    assert.match(result.message, /48 giờ/);
    // The review is closed early; completedAt (30-day window, rate limits) is untouched.
    const matured = store.getAttempt(attemptId);
    assert.equal(matured.completedAt, originalCompletedAt);
    assert.equal(typeof matured.reviewClosedAt, "string");
    const { status } = await mockRepository.getActivationStatus();
    assert.equal(status.activationState, "ACTIVATED");
    assert.equal(status.activationSurvey.source, "EXTERNAL");
    assert.equal(status.activationSurvey.status, "CONFIRMED");
    assert.equal(status.activationSurvey.completedAt, originalCompletedAt);
    assert.equal(status.activationSurvey.confirmsAt, matured.reviewClosedAt);
    assert.equal(status.isVerifiedMember, true);
    wallet = await mockRepository.getWalletDetails();
    assert.equal(wallet.balance.pending, 0);
    assert.equal(wallet.balance.frozen, 0);
    assert.equal(wallet.balance.available, 100 + external.rewardPerResponse);
    const releaseRows = wallet.transactions.filter(
      (tx) => tx.idempotencyKey === `release-pending:${attemptId}`,
    );
    assert.deepEqual(
      releaseRows.map((tx) => [tx.accountClass, tx.amount]).sort(),
      [
        ["PENDING", -external.rewardPerResponse],
        ["USER_AVAILABLE", external.rewardPerResponse],
      ],
    );
    const notifications = (await mockRepository.getNotifications({ limit: 50 })).items;
    assert.equal(notifications.filter((n) => n.type === "REWARD_RELEASED").length, 1);
    assert.equal((await activationNotifications()).length, 1);

    // Idempotent: nothing is under review any more.
    const again = await mockRepository.simulateExternalReviewElapsed();
    assert.equal(again.maturedCount, 0);
    assert.equal(again.releasedPoints, 0);
    assert.match(again.message, /Không có khảo sát Google Forms nào đang chờ đối soát/);
    wallet = await mockRepository.getWalletDetails();
    assert.equal(wallet.balance.available, 100 + external.rewardPerResponse);
    assert.equal(
      (await mockRepository.getNotifications({ limit: 50 })).items.filter((n) => n.type === "REWARD_RELEASED").length,
      1,
    );
  });

  await t.test("E7-DN1 demo control: Internal completions and other users are untouched; a signed-in user is required", async () => {
    const other = await onboardedRespondent();
    const external = (await mockRepository.getMarketplaceFeed({ type: "EXTERNAL" })).surveys[0];
    const { attemptId: otherAttempt } = await completeExternal(external.id);
    const otherCompletedAt = store.getAttempt(otherAttempt).completedAt;

    await onboardedRespondent();
    const nothing = await mockRepository.simulateExternalReviewElapsed();
    assert.equal(nothing.maturedCount, 0);
    assert.equal(nothing.unlockedStarterPoints, false);
    assert.equal(store.getAttempt(otherAttempt).completedAt, otherCompletedAt);
    assert.ok(other.id);

    await mockRepository.logout();
    await assert.rejects(
      () => mockRepository.simulateExternalReviewElapsed(),
      (error) => error.code === "AUTH_REQUIRED",
    );
  });

  await t.test("E7-DN1 demo control never moves a completion made after the 30-day deadline back into the window", async () => {
    const user = await onboardedRespondent();
    const external = (await mockRepository.getMarketplaceFeed({ type: "EXTERNAL" })).surveys[0];
    const { attemptId } = await completeExternal(external.id);
    const completedAt = store.getAttempt(attemptId).completedAt;
    // Registered 30 days and 1 hour ago: the completion (now) is past the deadline.
    registerUserAt(user.id, new Date(Date.now() - 30 * DAY - HOUR));

    const first = await mockRepository.simulateExternalReviewElapsed();

    assert.equal(first.maturedCount, 1);
    assert.equal(first.releasedPoints, external.rewardPerResponse);
    assert.equal(first.unlockedStarterPoints, false);
    assert.equal(store.getAttempt(attemptId).completedAt, completedAt);
    const { status } = await mockRepository.getActivationStatus();
    // The late completion cannot unlock the points, but it completes the
    // second step: a Verified Member (E7-DN3).
    assert.equal(status.activationState, "EXPIRED");
    assert.equal(status.isVerifiedMember, true);
    const wallet = await mockRepository.getWalletDetails();
    assert.equal(wallet.balance.frozen, 0);
    assert.equal(wallet.balance.pending, 0);

    // Nothing is left to mature on a second run.
    const second = await mockRepository.simulateExternalReviewElapsed();
    assert.equal(second.maturedCount, 0);
    assert.equal(second.releasedPoints, 0);
  });

  await t.test("E7-DN1 demo control also releases Pending whose 48 h already passed in real time", async () => {
    await onboardedRespondent();
    const external = (await mockRepository.getMarketplaceFeed({ type: "EXTERNAL" })).surveys[0];
    const { attemptId } = await completeExternal(external.id);
    ageAttempt(attemptId, 49);
    // The completion already counts (confirmed), but the mock has no background release.
    assert.equal((await mockRepository.getActivationStatus()).status.activationState, "ACTIVATED");
    assert.equal((await mockRepository.getWalletDetails()).balance.pending, external.rewardPerResponse);

    const result = await mockRepository.simulateExternalReviewElapsed();

    assert.equal(result.maturedCount, 1);
    assert.equal(result.releasedPoints, external.rewardPerResponse);
    assert.equal(store.getAttempt(attemptId).reviewClosedAt ?? null, null);
    const wallet = await mockRepository.getWalletDetails();
    assert.equal(wallet.balance.pending, 0);
    assert.equal(wallet.balance.available, 100 + external.rewardPerResponse);
    assert.equal((await mockRepository.simulateExternalReviewElapsed()).maturedCount, 0);
  });

  await t.test("the activation status requires a signed-in user", async () => {
    await mockRepository.logout();
    await assert.rejects(
      () => mockRepository.getActivationStatus(),
      (error) => error.code === "AUTH_REQUIRED",
    );
  });

  await t.test("an already activated demo user reports ACTIVATED without recommendations", async () => {
    await mockRepository.switchDemoUser("user-active-002");

    const { status, recommendedSurveys } = await mockRepository.getActivationStatus();

    assert.equal(status.activationState, "ACTIVATED");
    assert.equal(status.activatedAt, "2026-09-15T11:00:00.000Z");
    assert.deepEqual(recommendedSurveys, []);
  });
});

test("Story 7.2: activation presentation helpers", async (t) => {
  const helpers = await import("../lib/activation.ts");

  await t.test("progress reflects the activation step", () => {
    assert.equal(helpers.activationProgressPercent("SURVEY_REQUIRED"), 50);
    assert.equal(helpers.activationProgressPercent("PENDING_CONFIRMATION"), 75);
    assert.equal(helpers.activationProgressPercent("READY_TO_UNLOCK"), 100);
    assert.equal(helpers.activationProgressPercent("ACTIVATED"), 100);
    assert.equal(helpers.activationProgressPercent("DEMOGRAPHICS_REQUIRED"), 0);
  });

  await t.test("the success state is only shown for a recent activation", () => {
    const now = new Date("2026-09-26T12:00:00.000Z");
    assert.equal(helpers.isRecentActivation("2026-09-25T12:00:00.000Z", now), true);
    assert.equal(helpers.isRecentActivation("2026-09-18T12:00:00.000Z", now), false);
    assert.equal(helpers.isRecentActivation(null, now), false);
    assert.equal(helpers.isRecentActivation("not-a-date", now), false);
  });

  await t.test("the countdown turns urgent in the last 3 days", () => {
    assert.equal(helpers.isExpiryUrgent(3), true);
    assert.equal(helpers.isExpiryUrgent(4), false);
  });

  await t.test("dismissal is a per-user preference that survives missing storage", () => {
    const key = helpers.activationDismissKey("user-1", "success");
    assert.equal(key, "rescom:activation-success-dismissed:user-1");
    const original = globalThis.localStorage;
    try {
      const values = new Map();
      globalThis.localStorage = {
        getItem: (k) => values.get(k) ?? null,
        setItem: (k, v) => values.set(k, v),
      };
      assert.equal(helpers.readActivationDismissed(key), false);
      helpers.writeActivationDismissed(key);
      assert.equal(helpers.readActivationDismissed(key), true);

      globalThis.localStorage = {
        getItem() {
          throw new Error("blocked");
        },
        setItem() {
          throw new Error("blocked");
        },
      };
      assert.equal(helpers.readActivationDismissed(key), false);
      assert.doesNotThrow(() => helpers.writeActivationDismissed(key));
    } finally {
      globalThis.localStorage = original;
    }
  });

  await t.test("code review P7: the activation window is open up to and including the deadline", () => {
    const expiresAt = "2026-10-01T00:00:00.000Z";
    const at = (iso) => new Date(iso);
    assert.equal(helpers.isActivationWindowOpen({ expiresAt }, at("2026-09-30T23:59:59.999Z")), true);
    assert.equal(helpers.isActivationWindowOpen({ expiresAt }, at(expiresAt)), true);
    assert.equal(helpers.isActivationWindowOpen({ expiresAt }, at("2026-10-01T00:00:00.001Z")), false);
    assert.equal(helpers.isActivationWindowOpen({ expiresAt: null }), false);
    assert.equal(helpers.isActivationWindowOpen({ expiresAt: "not-a-date" }), false);
    assert.equal(helpers.isActivationWindowOpen(null), false);
  });

  await t.test("E7-DN3: the member badge and the expired Sidebar block follow isVerifiedMember", () => {
    const base = {
      userId: "u-1",
      isGranted: true,
      frozenBalance: 0,
      isDemographicComplete: true,
      hasCompletedMarketplaceSurvey: false,
      isUnlocked: false,
      isExpired: true,
      registeredAt: "2026-08-01T00:00:00.000Z",
      expiresAt: "2026-08-31T00:00:00.000Z",
      daysRemaining: 0,
      unlockEligibility: { eligible: false, missingSteps: [] },
      activationState: "EXPIRED",
      activatedAt: null,
      activationSurvey: null,
      isVerifiedMember: false,
    };

    assert.deepEqual(helpers.memberStatusBadge({ ...base, isVerifiedMember: true }), {
      verified: true,
      label: "Thành viên Đã Xác Thực ✓",
    });
    assert.deepEqual(helpers.memberStatusBadge(base), {
      verified: false,
      label: "Thành viên Mới (Chưa Xác Thực)",
    });
    assert.deepEqual(
      helpers.memberStatusBadge({ ...base, activationState: "SURVEY_REQUIRED", isExpired: false }),
      { verified: false, label: "Thành viên Mới (Chờ Kích Hoạt)" },
    );
    // Before the status loads, the persisted activation is the fallback.
    assert.equal(helpers.memberStatusBadge(null, true).verified, true);
    assert.equal(helpers.memberStatusBadge(undefined).verified, false);

    const verifiedExpired = helpers.sidebarActivationView({ ...base, isVerifiedMember: true });
    assert.equal(verifiedExpired.title, "Thành viên Đã Xác Thực");
    assert.equal(verifiedExpired.badge, "Đã hết hạn");
    assert.match(verifiedExpired.description, /Thành viên Đã Xác Thực/);
    assert.match(verifiedExpired.description, /hết hạn/);
    const plainExpired = helpers.sidebarActivationView(base);
    assert.equal(plainExpired.title, "Trạng thái Kích hoạt");
    assert.match(plainExpired.description, /hết hạn/);
  });

  await t.test("code review P3: one Sidebar view per activation state", () => {
    const status = (activationState, overrides = {}) => ({
      userId: "u-1",
      isGranted: true,
      frozenBalance: 100,
      isDemographicComplete: true,
      hasCompletedMarketplaceSurvey: false,
      isUnlocked: false,
      isExpired: false,
      registeredAt: "2026-09-01T00:00:00.000Z",
      expiresAt: "2026-10-01T00:00:00.000Z",
      daysRemaining: 5,
      unlockEligibility: { eligible: false, missingSteps: [] },
      activationState,
      activatedAt: null,
      activationSurvey: null,
      isVerifiedMember: false,
      ...overrides,
    });
    const steps = (state) =>
      helpers.sidebarActivationView(status(state)).steps?.map((step) => step.status) ?? null;

    assert.equal(helpers.sidebarActivationView(null), null);
    assert.equal(helpers.sidebarActivationView(status("NOT_GRANTED", { frozenBalance: 0 })), null);
    assert.deepEqual(steps("DEMOGRAPHICS_REQUIRED"), ["todo", "todo"]);
    assert.deepEqual(steps("SURVEY_REQUIRED"), ["done", "todo"]);
    assert.deepEqual(steps("PENDING_CONFIRMATION"), ["done", "pending"]);
    assert.deepEqual(steps("READY_TO_UNLOCK"), ["done", "done"]);
    assert.equal(steps("ACTIVATED"), null);
    assert.equal(steps("EXPIRED"), null);
    assert.equal(helpers.sidebarActivationView(status("ACTIVATED")).badge, "Hoàn tất ✓");
    assert.equal(helpers.sidebarActivationView(status("EXPIRED", { frozenBalance: 0 })).badge, "Đã hết hạn");
    // The Frozen amount comes from the status, never a hard-coded fallback.
    assert.match(
      helpers.sidebarActivationView(status("SURVEY_REQUIRED", { frozenBalance: 60 })).description,
      /60 điểm khóa/,
    );
  });

  await t.test("code review P10: the receipt notice only applies to the survey under review", () => {
    const pending = {
      activationState: "PENDING_CONFIRMATION",
      expiresAt: "2026-10-01T00:00:00.000Z",
      activationSurvey: {
        source: "EXTERNAL",
        formId: "survey-ext-001",
        completedAt: "2026-09-20T00:00:00.000Z",
        confirmsAt: "2026-09-22T00:00:00.000Z",
        status: "PENDING_REVIEW",
      },
    };
    assert.deepEqual(helpers.receiptActivationNotice(pending, "survey-ext-001"), {
      state: "PENDING_CONFIRMATION",
      confirmsAt: "2026-09-22T00:00:00.000Z",
      expiresAt: "2026-10-01T00:00:00.000Z",
    });
    assert.equal(helpers.receiptActivationNotice(pending, "survey-ext-999"), undefined);
    assert.equal(
      helpers.receiptActivationNotice({ ...pending, activationState: "ACTIVATED" }, "survey-ext-001"),
      undefined,
    );
    assert.equal(helpers.receiptActivationNotice(null, "survey-ext-001"), undefined);
  });

  await t.test("started attempts continue on the right page", () => {
    assert.equal(
      helpers.attemptPath({ id: "survey-int-001", type: "INTERNAL" }, { attemptId: "att-1", responseId: "resp-1" }),
      "/forms/survey-int-001/respond?attemptId=att-1&responseId=resp-1",
    );
    assert.equal(
      helpers.attemptPath({ id: "survey-ext-001", type: "EXTERNAL" }, { attemptId: "att-2" }),
      "/attempts/att-2",
    );
  });
});
