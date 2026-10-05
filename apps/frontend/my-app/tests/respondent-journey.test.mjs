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

test("Complete Respondent Journey End-to-End Tests", async (t) => {
  const { mockRepository } = await import("../mocks/legacy/repository.ts");
  const { setMockStorage, saveAttempt } = await import("../mocks/legacy/store.ts");

  let storage;

  t.beforeEach(() => {
    storage = createMockStorage();
    setMockStorage(storage);
    mockRepository.setLatency(0);
    mockRepository.setSimulateError(false);
  });

  await t.test(
    "Journey: Fresh user registers, onboards, and unlocks 100 Frozen points via Internal survey",
    async () => {
      // 1. Register fresh user
      const reg = await mockRepository.register({
        email: "journey.student@fpt.edu.vn",
        password: "Password123!",
        name: "Hoàng Văn Hành Trình",
      });

      assert.equal(reg.user.isOnboarded, false);
      assert.equal(reg.user.isActivated, false);
      assert.equal(reg.user.hasUnlockedFrozenPoints, false);
      assert.equal(reg.redirectUrl, "/onboarding");

      // Verify wallet starts with 100 Frozen points
      let wallet = await mockRepository.getWalletDetails();
      assert.equal(wallet.balance.frozen, 100);
      assert.equal(wallet.balance.available, 0);
      assert.equal(wallet.balance.pending, 0);
      assert.equal(wallet.balance.total, 100);

      // 2. Before onboarding the Marketplace and survey attempts are locked (Story 7.1)
      await assert.rejects(
        async () => mockRepository.getMarketplaceFeed({ hideCompleted: true }),
        (error) => error.code === "DEMOGRAPHIC_PROFILE_REQUIRED",
      );
      await assert.rejects(
        async () => mockRepository.startSurveyAttempt("survey-int-002"),
        (error) => error.code === "DEMOGRAPHIC_PROFILE_REQUIRED",
      );
      let feed;

      // 3. Submit the mandatory demographic survey → Marketplace activation step
      const submission = await mockRepository.submitDemographicSurvey({
        age: 21,
        gender: "MALE",
        location: "Đà Nẵng",
        occupation: "Sinh viên đại học",
        fieldOfStudy: "Công nghệ thông tin",
        householdIncome: "Dưới 5 triệu VNĐ/tháng",
        specificInterests: ["Trí tuệ nhân tạo (AI)"],
      });
      const profile = submission.profile;

      assert.equal(profile.userId, reg.user.id);
      assert.equal(submission.nextStep, "MARKETPLACE_ACTIVATION");
      assert.equal(submission.redirectUrl, "/marketplace?activation=1");
      let user = await mockRepository.getCurrentUser();
      assert.equal(user.isOnboarded, true);
      // Still not activated because 0 surveys completed
      assert.equal(user.isActivated, false);
      assert.equal(user.hasUnlockedFrozenPoints, false);

      // Wallet still holds 100 Frozen points
      wallet = await mockRepository.getWalletDetails();
      assert.equal(wallet.balance.frozen, 100);
      assert.equal(wallet.balance.available, 0);

      // 4. Feed after onboarding: now targeted survey (survey-int-001) is unlocked and visible!
      feed = await mockRepository.getMarketplaceFeed({ hideCompleted: true });
      assert.equal(feed.profileCompleted, true);
      const targetSurvey = feed.surveys.find((s) => s.id === "survey-int-001");
      assert.ok(targetSurvey, "Targeted IT survey should be matched");

      // 5. Start internal survey attempt
      const attempt = await mockRepository.startSurveyAttempt("survey-int-001");
      assert.equal(attempt.type, "INTERNAL");
      assert.equal(attempt.status, "IN_PROGRESS");

      // Story 8.2: 4 questions × 2 s barrier; a too-fast submit is refused and
      // leaves the attempt open, then the respondent "takes their time".
      await assert.rejects(
        () => mockRepository.submitInternalSurvey(attempt.attemptId, {}),
        (err) => err.code === "SUBMISSION_TOO_FAST",
      );
      saveAttempt({
        ...attempt,
        startedAt: new Date(Date.now() - (attempt.minTimeBarrierSeconds + 5) * 1000).toISOString(),
      });

      // 6. Complete and submit internal survey
      const subResult = await mockRepository.submitInternalSurvey(
        attempt.attemptId,
        {
          "b-int1-1": "nam_3",
          "b-int1-2": ["chatgpt", "gemini"],
          "b-int1-3": 5,
          "b-int1-4": "AI giúp viết dàn ý nhanh chóng",
        },
      );

      assert.equal(subResult.success, true);
      assert.equal(subResult.rewardEarned, 15);
      assert.equal(subResult.rewardType, "AVAILABLE");
      // 100 Frozen Points unlocked exactly here!
      assert.equal(subResult.unlockedStarterPoints, true);

      // 7. Verify wallet after first survey: 100 starter + 15 internal reward = 115 Available, 0 Frozen!
      wallet = await mockRepository.getWalletDetails();
      assert.equal(wallet.balance.frozen, 0);
      assert.equal(wallet.balance.available, 115);
      assert.equal(wallet.balance.total, 115);

      user = await mockRepository.getCurrentUser();
      assert.equal(user.isActivated, true);
      assert.equal(user.hasUnlockedFrozenPoints, true);
      assert.equal(user.streak, 1);

      // 8. Complete another survey (survey-int-002) to verify 100 points unlock EXACTLY ONCE
      const attempt2 = await mockRepository.startSurveyAttempt("survey-int-002");
      saveAttempt({
        ...attempt2,
        startedAt: new Date(Date.now() - (attempt2.minTimeBarrierSeconds + 5) * 1000).toISOString(),
      });
      const subResult2 = await mockRepository.submitInternalSurvey(
        attempt2.attemptId,
        {
          "b-int2-1": "daily",
          "b-int2-2": 4,
        },
      );
      assert.equal(subResult2.unlockedStarterPoints, false, "Must not unlock starter points twice");
      assert.equal(subResult2.rewardEarned, 10);

      wallet = await mockRepository.getWalletDetails();
      assert.equal(wallet.balance.available, 125); // 115 + 10
      assert.equal(wallet.balance.frozen, 0);

      // 9. Completed surveys are hidden from feed
      feed = await mockRepository.getMarketplaceFeed({ hideCompleted: true });
      assert.equal(
        feed.surveys.some((s) => s.id === "survey-int-001"),
        false,
      );
      assert.equal(
        feed.surveys.some((s) => s.id === "survey-int-002"),
        false,
      );
    },
  );

  await t.test(
    "Journey: External survey completion path with countdown, code validation, and 48h pending credit",
    async () => {
      // Use activated user
      await mockRepository.switchDemoUser("user-active-002");
      const initialWallet = await mockRepository.getWalletDetails();

      // Start external survey
      const attempt = await mockRepository.startSurveyAttempt("survey-ext-001");
      assert.equal(attempt.type, "EXTERNAL");

      // Fast submission fails time barrier
      await assert.rejects(
        async () =>
          mockRepository.submitExternalSurvey(attempt.attemptId, "689201"),
        /Thời gian làm bài quá ngắn/,
      );

      // Advance attempt startedAt past minTimeBarrierSeconds
      attempt.startedAt = new Date(Date.now() - 30000).toISOString();
      saveAttempt(attempt);

      // Wrong code fails
      await assert.rejects(
        async () =>
          mockRepository.submitExternalSurvey(attempt.attemptId, "000000"),
        /Mã hoàn thành không chính xác/,
      );

      // Correct code succeeds
      const result = await mockRepository.submitExternalSurvey(
        attempt.attemptId,
        "689201",
      );

      assert.equal(result.success, true);
      assert.equal(result.rewardType, "PENDING");
      assert.equal(result.pendingHours, 48);
      assert.equal(result.rewardEarned, 20);

      // Verify wallet updated: pending balance increased by 20
      const updatedWallet = await mockRepository.getWalletDetails();
      assert.equal(
        updatedWallet.balance.pending,
        initialWallet.balance.pending + 20,
      );
      assert.equal(
        updatedWallet.balance.available,
        initialWallet.balance.available,
      );
    },
  );

  await t.test(
    "Journey: Returning user login routing, filter, search, and duplicate prevention",
    async () => {
      // 1. Incomplete user routes to /onboarding
      const resIncomplete = await mockRepository.login({
        email: "linh.onboarding@fpt.edu.vn",
      });
      assert.equal(resIncomplete.redirectUrl, "/onboarding");

      // 2. Activated user routes to /dashboard
      const resActive = await mockRepository.login({
        email: "minh.le@fpt.edu.vn",
      });
      assert.equal(resActive.redirectUrl, "/dashboard");

      // 3. Feed search by keyword
      const searchFeed = await mockRepository.getMarketplaceFeed({
        search: "thói quen học tập",
        hideCompleted: false,
      });
      assert.equal(searchFeed.surveys.length, 1);
      assert.equal(searchFeed.surveys[0].id, "survey-int-001");

      // 4. Duplicate start prevented on already completed survey
      await assert.rejects(
        async () => mockRepository.startSurveyAttempt("survey-int-001"),
        /Bạn đã hoàn thành khảo sát này rồi/,
      );
    },
  );
});
