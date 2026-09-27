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
    _rawMap: store,
  };
}

test("Mock Repository Unit Tests", async (t) => {
  const { mockRepository } = await import("./repository.ts");
  const { setMockStorage, updateUser } = await import("./store.ts");

  let storage;

  t.beforeEach(() => {
    storage = createMockStorage();
    setMockStorage(storage);
    mockRepository.setLatency(0);
    mockRepository.setSimulateError(false);
  });

  await t.test("I/O Matrix: New account registration", async () => {
    const res = await mockRepository.register({
      email: "newstudent@fpt.edu.vn",
      password: "Password123!",
      name: "Tran Van Moi",
    });

    assert.equal(res.user.email, "newstudent@fpt.edu.vn");
    assert.equal(res.user.isOnboarded, false);
    assert.equal(res.user.isActivated, false);
    assert.equal(res.user.hasUnlockedFrozenPoints, false);
    assert.equal(res.redirectUrl, "/onboarding");

    // Verify 100 Frozen Points
    const wallet = await mockRepository.getWalletDetails();
    assert.equal(wallet.balance.frozen, 100);
    assert.equal(wallet.balance.available, 0);
    assert.equal(wallet.balance.total, 100);

    // Duplicate email rejected
    await assert.rejects(
      async () =>
        mockRepository.register({
          email: "newstudent@fpt.edu.vn",
          password: "Password123!",
          name: "Another Name",
        }),
      /Email này đã được sử dụng/,
    );
  });

  await t.test("I/O Matrix: Returning account login routing", async () => {
    // 1. Incomplete onboarding account routes to /onboarding
    const incompleteRes = await mockRepository.login({
      email: "linh.onboarding@fpt.edu.vn",
    });
    assert.equal(incompleteRes.redirectUrl, "/onboarding");
    assert.equal(incompleteRes.user.isOnboarded, false);

    // 2. Activated account routes to /dashboard
    const activeRes = await mockRepository.login({
      email: "minh.le@fpt.edu.vn",
    });
    assert.equal(activeRes.redirectUrl, "/dashboard");
    assert.equal(activeRes.user.isOnboarded, true);
    assert.equal(activeRes.user.isActivated, true);

    // 3. Invalid credentials show non-destructive error
    await assert.rejects(
      async () =>
        mockRepository.login({
          email: "nonexistent@fpt.edu.vn",
        }),
      /Email hoặc mật khẩu không chính xác/,
    );
  });

  await t.test("I/O Matrix: Interrupted onboarding restoration and draft save", async () => {
    await mockRepository.switchDemoUser("user-onboarding-003");

    // Load existing draft
    const draft = await mockRepository.getOnboardingDraft();
    assert.ok(draft);
    assert.equal(draft.step, 2);
    assert.equal(draft.answers.age, 20);

    // Update draft with step 3
    await mockRepository.saveOnboardingDraft({
      step: 3,
      answers: {
        age: 20,
        gender: "FEMALE",
        location: "Hà Nội",
        occupation: "Sinh viên",
      },
    });

    const updatedDraft = await mockRepository.getOnboardingDraft();
    assert.equal(updatedDraft.step, 3);
    assert.equal(updatedDraft.answers.occupation, "Sinh viên");
  });

  await t.test("I/O Matrix: Corrupted storage recovery", async () => {
    // Inject corrupt JSON into storage
    storage.setItem("rescom_demo_v1_store", "{ corrupted json here !!! ");

    // Calling repository should not throw unhandled syntax error, but restore defaults
    const user = await mockRepository.getCurrentUser();
    assert.ok(user);
    assert.equal(user.id, "user-new-001");
  });

  await t.test("I/O Matrix: Demographic profile save and complete status", async () => {
    await mockRepository.switchDemoUser("user-new-001");

    const profile = await mockRepository.saveDemographicProfile({
      age: 21,
      gender: "MALE",
      location: "Đà Nẵng",
      occupation: "Sinh viên",
      fieldOfStudy: "Công nghệ thông tin",
      householdIncome: "Dưới 10 triệu",
      specificInterests: ["AI"],
    });

    assert.equal(profile.age, 21);
    const user = await mockRepository.getCurrentUser();
    assert.equal(user.isOnboarded, true);
    // Still not activated because 0 surveys completed
    assert.equal(user.isActivated, false);
    assert.equal(user.hasUnlockedFrozenPoints, false);
  });

  await t.test("I/O Matrix: Personalized feed matching, filtering, and sort", async () => {
    // 1. Un-onboarded user cannot open the Marketplace (Story 7.1, FR-6)
    await mockRepository.switchDemoUser("user-new-001");
    await assert.rejects(
      async () => mockRepository.getMarketplaceFeed({ hideCompleted: true }),
      (error) => error.code === "DEMOGRAPHIC_PROFILE_REQUIRED",
    );
    let feed;

    // 2. Activated user with IT & Da Nang profile matches targeted surveys
    await mockRepository.switchDemoUser("user-active-002");
    feed = await mockRepository.getMarketplaceFeed({ hideCompleted: false });
    const surveyInt1 = feed.surveys.find((s) => s.id === "survey-int-001");
    assert.ok(surveyInt1);
    assert.equal(surveyInt1.isCompletedByCurrentUser, true);

    // 3. hideCompleted = true hides completed survey
    feed = await mockRepository.getMarketplaceFeed({ hideCompleted: true });
    assert.equal(
      feed.surveys.some((s) => s.id === "survey-int-001"),
      false,
    );

    // 4. Filtering by type
    const internalFeed = await mockRepository.getMarketplaceFeed({
      type: "INTERNAL",
    });
    assert.ok(internalFeed.surveys.every((s) => s.type === "INTERNAL"));

    const externalFeed = await mockRepository.getMarketplaceFeed({
      type: "EXTERNAL",
    });
    assert.ok(externalFeed.surveys.every((s) => s.type === "EXTERNAL"));

    // 5. Simulated failure and retry
    mockRepository.setSimulateError(true);
    await assert.rejects(
      async () => mockRepository.getMarketplaceFeed(),
      /Simulated network failure/,
    );
    mockRepository.setSimulateError(false);
  });

  await t.test("I/O Matrix: Internal completion & activation reward unlock", async () => {
    // Register fresh user
    await mockRepository.register({
      email: "fresh@fpt.edu.vn",
      password: "Password123!",
      name: "Fresh Student",
    });

    // Save demographics
    await mockRepository.saveDemographicProfile({
      age: 20,
      gender: "MALE",
      location: "Đà Nẵng",
      occupation: "Sinh viên",
      fieldOfStudy: "Công nghệ thông tin",
      householdIncome: "Dưới 10 triệu",
      specificInterests: ["AI"],
    });

    // Start internal survey
    const attempt = await mockRepository.startSurveyAttempt("survey-int-001");
    assert.equal(attempt.type, "INTERNAL");
    // Story 8.2: pass the Time Barrier (questions × 2 s) without sleeping.
    const { saveAttempt: backdate } = await import("./store.ts");
    backdate({
      ...attempt,
      startedAt: new Date(Date.now() - (attempt.minTimeBarrierSeconds + 5) * 1000).toISOString(),
    });

    // Submit internal survey
    const result = await mockRepository.submitInternalSurvey(
      attempt.attemptId,
      {
        "b-int1-1": "nam_2",
        "b-int1-2": ["chatgpt"],
        "b-int1-3": 5,
      },
    );

    assert.equal(result.success, true);
    assert.equal(result.rewardType, "AVAILABLE");
    assert.equal(result.rewardEarned, 15);
    // Unlocked 100 starter points because demographics + 1 survey is met!
    assert.equal(result.unlockedStarterPoints, true);

    // Balance should be: 0 frozen + (100 unlocked + 15 reward) = 115 Available!
    const wallet = await mockRepository.getWalletDetails();
    assert.equal(wallet.balance.frozen, 0);
    assert.equal(wallet.balance.available, 115);
    assert.equal(wallet.balance.total, 115);

    // Duplicate submission prevention on same attempt
    await assert.rejects(
      async () =>
        mockRepository.submitInternalSurvey(attempt.attemptId, {}),
      /Lượt khảo sát này đã được hoàn thành trước đó/,
    );

    // Duplicate start prevention on same survey
    await assert.rejects(
      async () => mockRepository.startSurveyAttempt("survey-int-001"),
      /Bạn đã hoàn thành khảo sát này rồi/,
    );
  });

  await t.test("I/O Matrix: External completion, time barrier, code validation, and pending balance", async () => {
    await mockRepository.switchDemoUser("user-active-002");

    const attempt = await mockRepository.startSurveyAttempt("survey-ext-001");
    assert.equal(attempt.type, "EXTERNAL");

    // 1. Time barrier rejection if too fast
    await assert.rejects(
      async () =>
        mockRepository.submitExternalSurvey(attempt.attemptId, "689201"),
      /Thời gian làm bài quá ngắn/,
    );

    // Simulate waiting past time barrier
    attempt.startedAt = new Date(Date.now() - 15000).toISOString();
    const { saveAttempt } = await import("./store.ts");
    saveAttempt(attempt);

    // 2. Malformed code is rejected without consuming an attempt
    await assert.rejects(
      async () =>
        mockRepository.submitExternalSurvey(attempt.attemptId, "WRONG99"),
      (err) => err.code === "VALIDATION_ERROR",
    );

    // 3. Wrong code rejection reports remaining attempts
    await assert.rejects(
      async () =>
        mockRepository.submitExternalSurvey(attempt.attemptId, "000000"),
      (err) =>
        err.code === "INVALID_COMPLETION_CODE" &&
        err.details.remainingAttempts === 2,
    );

    // 3. Valid code submission
    const result = await mockRepository.submitExternalSurvey(
      attempt.attemptId,
      "689201",
    );
    assert.equal(result.success, true);
    assert.equal(result.rewardType, "PENDING");
    assert.equal(result.pendingHours, 48);
    assert.equal(result.rewardEarned, 20);

    // Verify wallet has pending increase
    const wallet = await mockRepository.getWalletDetails();
    assert.equal(wallet.balance.pending, 40); // 20 previous + 20 new
  });

  await t.test("I/O Matrix: External attempt locks after 3 wrong codes", async () => {
    await mockRepository.switchDemoUser("user-active-002");
    const attempt = await mockRepository.startSurveyAttempt("survey-ext-002");

    // Time-barrier rejections never count toward the 3-strike limit
    await assert.rejects(
      async () =>
        mockRepository.submitExternalSurvey(attempt.attemptId, "000000"),
      /Thời gian làm bài quá ngắn/,
    );

    attempt.startedAt = new Date(Date.now() - 60000).toISOString();
    const { saveAttempt, getAttempt } = await import("./store.ts");
    saveAttempt(attempt);

    for (const remaining of [2, 1]) {
      await assert.rejects(
        async () =>
          mockRepository.submitExternalSurvey(attempt.attemptId, "111111"),
        (err) =>
          err.code === "INVALID_COMPLETION_CODE" &&
          err.details.remainingAttempts === remaining,
      );
    }
    await assert.rejects(
      async () =>
        mockRepository.submitExternalSurvey(attempt.attemptId, "111111"),
      (err) => err.code === "ATTEMPT_LOCKED",
    );
    assert.equal(getAttempt(attempt.attemptId).status, "LOCKED");

    // Even the correct code is refused once the attempt is locked
    await assert.rejects(
      async () =>
        mockRepository.submitExternalSurvey(attempt.attemptId, "202614"),
      (err) => err.code === "ATTEMPT_LOCKED",
    );
  });

  await t.test("Decision E5-D1: 6 wrong codes per account and survey version refuse further attempts", async () => {
    await mockRepository.switchDemoUser("user-active-002");
    const { saveAttempt, getAttempt } = await import("./store.ts");

    async function startPastBarrier() {
      const attempt = await mockRepository.startSurveyAttempt("survey-ext-002");
      attempt.startedAt = new Date(Date.now() - 60000).toISOString();
      saveAttempt(attempt);
      return attempt;
    }
    async function mistype(attemptId) {
      return mockRepository
        .submitExternalSurvey(attemptId, "111111")
        .catch((err) => err);
    }

    // An abandoned attempt with 2 wrong codes still counts.
    const first = await startPastBarrier();
    await mistype(first.attemptId);
    await mistype(first.attemptId);

    const second = await startPastBarrier();
    assert.equal(
      await mockRepository.getRemainingCompletionCodeTries(second.attemptId),
      3,
    );
    const secondErrors = [
      await mistype(second.attemptId),
      await mistype(second.attemptId),
      await mistype(second.attemptId),
    ];
    assert.equal(secondErrors[0].details.remainingAttempts, 2);
    assert.equal(secondErrors[2].code, "ATTEMPT_LOCKED");

    // 5 counted: a fresh attempt gets a single try, then locks.
    const third = await startPastBarrier();
    assert.equal(
      await mockRepository.getRemainingCompletionCodeTries(third.attemptId),
      1,
    );
    const thirdError = await mistype(third.attemptId);
    assert.equal(thirdError.code, "ATTEMPT_LOCKED");
    assert.match(thirdError.message, /6 lần/);
    assert.equal(getAttempt(third.attemptId).status, "LOCKED");

    await assert.rejects(
      () => mockRepository.startSurveyAttempt("survey-ext-002"),
      (err) =>
        err.code === "COMPLETION_CODE_LIMIT_REACHED" &&
        err.details.failedVerifications === 6 &&
        err.details.limit === 6 &&
        err.details.policyVersion === "completion-code-policy-v1" &&
        /Admin/.test(err.message),
    );
  });

  await t.test("I/O Matrix: Report missing completion code", async () => {
    await mockRepository.switchDemoUser("user-active-002");
    const attempt = await mockRepository.startSurveyAttempt("survey-ext-002");

    const reportRes = await mockRepository.reportMissingCode(
      attempt.attemptId,
      "Google form không hiển thị mã xác nhận ở trang cảm ơn",
    );
    assert.equal(reportRes.success, true);
    assert.ok(reportRes.message.includes("ghi nhận thành công"));

    const stored = await mockRepository.getAttempt(attempt.attemptId);
    assert.ok(stored?.attempt.reportedMissingCode);
    assert.equal(
      stored?.attempt.reportedMissingCode?.reason,
      "Google form không hiển thị mã xác nhận ở trang cảm ơn",
    );
  });

  await t.test("I/O Matrix: Demo reset functionality", async () => {
    await mockRepository.register({
      email: "temp@fpt.edu.vn",
      password: "Password123!",
      name: "Temporary",
    });

    await mockRepository.resetDemo();

    // Verify default active user restored
    const user = await mockRepository.getCurrentUser();
    assert.equal(user.id, "user-new-001");
  });
  await t.test("code review P8: a stale persisted isOnboarded flag is re-derived from the profile", async () => {
    const user = await mockRepository.switchDemoUser("user-onboarding-003");
    // A store saved under an older rule (or edited) claims onboarding done.
    updateUser(user.id, (u) => ({ ...u, isOnboarded: true }));

    assert.equal((await mockRepository.getCurrentUser()).isOnboarded, false);
    assert.equal((await mockRepository.getCurrentSession()).user.isOnboarded, false);
    const login = await mockRepository.login({ email: user.email });
    assert.equal(login.user.isOnboarded, false);
    assert.equal(login.redirectUrl, "/onboarding");
    assert.equal((await mockRepository.switchDemoUser(user.id)).isOnboarded, false);
  });

  await t.test("code review P12: the Marketplace feed requires a signed-in user", async () => {
    await mockRepository.logout();
    await assert.rejects(
      () => mockRepository.getMarketplaceFeed(),
      (error) => error.code === "AUTH_REQUIRED",
    );
  });
});
