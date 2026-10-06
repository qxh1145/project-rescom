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
  };
}

const COMPLETE_SURVEY = {
  age: 20,
  gender: "FEMALE",
  location: "Hà Nội",
  occupation: "Sinh viên đại học",
  fieldOfStudy: "Kinh tế & Quản trị kinh doanh",
  householdIncome: "Dưới 5 triệu VNĐ/tháng",
  specificInterests: ["Du lịch & Ẩm thực"],
};

test("Story 7.1: Mandatory Demographic Survey gate (mock-first)", async (t) => {
  const { mockRepository } = await import("../mocks/legacy/repository.ts");
  const { setMockStorage } = await import("../mocks/legacy/store.ts");
  const onboarding = await import("../lib/onboarding.ts");

  t.beforeEach(() => {
    setMockStorage(createMockStorage());
    mockRepository.setLatency(0);
    mockRepository.setSimulateError(false);
  });

  await t.test("reports onboarding status for routing guards", async () => {
    await mockRepository.switchDemoUser("user-onboarding-003");
    const pending = await mockRepository.getOnboardingStatus();
    assert.equal(pending.isAuthenticated, true);
    assert.equal(pending.isProfileComplete, false);
    assert.deepEqual(pending.missingFields, [
      "age",
      "gender",
      "location",
      "occupation",
      "fieldOfStudy",
      "householdIncome",
      "specificInterests",
    ]);

    await mockRepository.switchDemoUser("user-active-002");
    const done = await mockRepository.getOnboardingStatus();
    assert.equal(done.isProfileComplete, true);
    assert.deepEqual(done.missingFields, []);
    assert.equal(done.isActivated, true);

    await mockRepository.logout();
    const anonymous = await mockRepository.getOnboardingStatus();
    assert.equal(anonymous.isAuthenticated, false);
  });

  await t.test("blocks the Marketplace feed before onboarding", async () => {
    await mockRepository.switchDemoUser("user-onboarding-003");
    await assert.rejects(
      () => mockRepository.getMarketplaceFeed({ hideCompleted: true }),
      (error) => {
        assert.equal(error.code, "DEMOGRAPHIC_PROFILE_REQUIRED");
        assert.equal(error.details.missingFields.length, 7);
        assert.ok(onboarding.isDemographicProfileRequiredError(error));
        return true;
      },
    );
  });

  await t.test("blocks starting a survey attempt before onboarding", async () => {
    await mockRepository.register({
      email: "gate.student@fpt.edu.vn",
      password: "Password123!",
      name: "Sinh Viên Mới",
    });
    await assert.rejects(
      () => mockRepository.startSurveyAttempt("survey-int-002"),
      (error) => error.code === "DEMOGRAPHIC_PROFILE_REQUIRED",
    );
    await assert.rejects(
      () => mockRepository.startSurveyAttempt("survey-ext-001"),
      (error) => error.code === "DEMOGRAPHIC_PROFILE_REQUIRED",
    );
  });

  await t.test("a partially saved profile does not pass the gate", async () => {
    await mockRepository.switchDemoUser("user-new-001");
    await mockRepository.saveDemographicProfile({
      age: 21,
      gender: "MALE",
      location: "Đà Nẵng",
    });
    const user = await mockRepository.getCurrentUser();
    assert.equal(user.isOnboarded, false);
    await assert.rejects(
      () => mockRepository.getMarketplaceFeed(),
      (error) =>
        error.code === "DEMOGRAPHIC_PROFILE_REQUIRED" &&
        error.details.missingFields.includes("specificInterests"),
    );
  });

  await t.test("rejects an incomplete mandatory survey submission", async () => {
    await mockRepository.switchDemoUser("user-onboarding-003");
    await assert.rejects(
      () =>
        mockRepository.submitDemographicSurvey({
          ...COMPLETE_SURVEY,
          specificInterests: [],
        }),
      (error) => {
        assert.equal(error.code, "VALIDATION_ERROR");
        assert.deepEqual(error.details.fields, ["specificInterests"]);
        return true;
      },
    );
    await assert.rejects(
      () =>
        mockRepository.submitDemographicSurvey({
          ...COMPLETE_SURVEY,
          occupation: "  ",
          householdIncome: undefined,
        }),
      (error) =>
        error.code === "VALIDATION_ERROR" &&
        error.details.fields.includes("occupation") &&
        error.details.fields.includes("householdIncome"),
    );
    assert.equal(await mockRepository.getDemographicProfile(), null);
    const user = await mockRepository.getCurrentUser();
    assert.equal(user.isOnboarded, false);
  });

  await t.test(
    "submission saves the profile, hands off to the activation step and keeps points Frozen",
    async () => {
      await mockRepository.switchDemoUser("user-onboarding-003");

      const result = await mockRepository.submitDemographicSurvey(COMPLETE_SURVEY);

      assert.equal(result.isComplete, true);
      assert.deepEqual(result.missingFields, []);
      assert.equal(result.nextStep, "MARKETPLACE_ACTIVATION");
      assert.equal(result.redirectUrl, onboarding.MARKETPLACE_ACTIVATION_PATH);
      assert.equal(result.profile.location, "Hà Nội");

      const user = await mockRepository.getCurrentUser();
      assert.equal(user.isOnboarded, true);
      assert.equal(user.isActivated, false);
      assert.equal(await mockRepository.getOnboardingDraft(), null);

      // FR-7/FR-8: still 100 Frozen until one Marketplace survey is completed.
      const wallet = await mockRepository.getWalletDetails();
      assert.equal(wallet.balance.frozen, 100);
      assert.equal(wallet.balance.available, 0);

      const feed = await mockRepository.getMarketplaceFeed({ hideCompleted: true });
      assert.equal(feed.profileCompleted, true);
      assert.ok(feed.surveys.length > 0);
      const attempt = await mockRepository.startSurveyAttempt(feed.surveys[0].id);
      assert.equal(attempt.status, "IN_PROGRESS");
    },
  );

  await t.test("an already activated respondent is not sent back to activation", async () => {
    await mockRepository.switchDemoUser("user-active-002");
    const result = await mockRepository.submitDemographicSurvey({
      ...COMPLETE_SURVEY,
      location: "Đà Nẵng",
    });
    assert.equal(result.nextStep, "COMPLETED");
    assert.equal(result.redirectUrl, "/marketplace");
  });

  await t.test("routing helpers", () => {
    assert.equal(onboarding.ONBOARDING_PATH, "/onboarding");
    assert.equal(onboarding.MARKETPLACE_ACTIVATION_PATH, "/marketplace?activation=1");
    assert.equal(
      onboarding.buildOnboardingRedirect("/attempts/att-1"),
      "/onboarding?required=1&returnTo=%2Fattempts%2Fatt-1",
    );
    assert.equal(onboarding.buildOnboardingRedirect(null), "/onboarding?required=1");
    assert.equal(onboarding.sanitizeReturnTo("/marketplace?type=INTERNAL"), "/marketplace?type=INTERNAL");
    assert.equal(onboarding.sanitizeReturnTo("https://evil.example"), null);
    assert.equal(onboarding.sanitizeReturnTo("//evil.example"), null);
    assert.equal(onboarding.sanitizeReturnTo("/onboarding?required=1"), null);
    assert.equal(onboarding.sanitizeReturnTo(undefined), null);
    assert.equal(
      onboarding.resolvePostOnboardingPath(
        { nextStep: "MARKETPLACE_ACTIVATION", redirectUrl: "/marketplace?activation=1" },
        "/attempts/att-1",
      ),
      "/marketplace?activation=1",
    );
    assert.equal(
      onboarding.resolvePostOnboardingPath(
        { nextStep: "COMPLETED", redirectUrl: "/marketplace" },
        "/attempts/att-1",
      ),
      "/attempts/att-1",
    );
    assert.equal(
      onboarding.resolvePostOnboardingPath(
        { nextStep: "COMPLETED", redirectUrl: "/marketplace" },
        "https://evil.example",
      ),
      "/marketplace",
    );
    assert.equal(onboarding.isDemographicProfileRequiredError(new Error("x")), false);
    assert.equal(onboarding.isDemographicProfileRequiredError(null), false);
  });

  await t.test("code review P13: null clears a profile field and re-engages the gate", async () => {
    await mockRepository.switchDemoUser("user-active-002");
    const before = await mockRepository.getDemographicProfile();
    assert.ok(before.location);

    const cleared = await mockRepository.saveDemographicProfile({ location: null });
    assert.equal(cleared.location, null);
    assert.equal(cleared.gender, before.gender, "fields not in the input are kept");
    assert.equal((await mockRepository.getCurrentUser()).isOnboarded, false);
    await assert.rejects(
      () => mockRepository.getMarketplaceFeed(),
      (error) => error.code === "DEMOGRAPHIC_PROFILE_REQUIRED" &&
        error.details.missingFields.includes("location"),
    );

    // `undefined` keeps, a blank string clears, `null` clears the interests.
    const kept = await mockRepository.saveDemographicProfile({ age: 30 });
    assert.equal(kept.location, null);
    assert.equal(kept.age, 30);
    assert.equal((await mockRepository.saveDemographicProfile({ occupation: "   " })).occupation, null);
    assert.equal((await mockRepository.saveDemographicProfile({ specificInterests: null })).specificInterests, null);
  });

  await t.test("code review P1: returnTo cannot escape the origin via control characters", () => {
    // URL parsing strips tab/CR/LF, so these would resolve to https://evil.example/.
    assert.equal(onboarding.sanitizeReturnTo("/\t/evil.example"), null);
    assert.equal(onboarding.sanitizeReturnTo("/\n/evil.example"), null);
    assert.equal(onboarding.sanitizeReturnTo("/\r\n/evil.example"), null);
    assert.equal(onboarding.sanitizeReturnTo("/\u0000/evil.example"), null);
    assert.equal(onboarding.sanitizeReturnTo("/\\evil.example"), null);
    // Percent-encoded tab stays a literal same-origin path segment.
    assert.equal(onboarding.sanitizeReturnTo("/%09/evil.example"), "/%09/evil.example");
    // The onboarding page itself (any form) is never a return target.
    assert.equal(onboarding.sanitizeReturnTo("/onboarding#x"), null);
    assert.equal(onboarding.sanitizeReturnTo("/onboarding/"), null);
    assert.equal(onboarding.sanitizeReturnTo("/onboarding"), null);
    // Normalized same-origin paths keep search + hash.
    assert.equal(onboarding.sanitizeReturnTo("/attempts/att-1?x=1#top"), "/attempts/att-1?x=1#top");
    assert.equal(onboarding.sanitizeReturnTo("/marketplace"), "/marketplace");
    assert.equal(
      onboarding.resolvePostOnboardingPath(
        { nextStep: "COMPLETED", redirectUrl: "/marketplace" },
        "/\t/evil.example",
      ),
      "/marketplace",
    );
    assert.equal(
      onboarding.buildOnboardingRedirect("/\t/evil.example"),
      "/onboarding?required=1",
    );
  });
});

test("code review P9: demo profiles only use the wizard's option catalogs", async () => {
  const options = await import("../lib/demographic-options.ts");
  const fixtures = await import("../mocks/legacy/fixtures.ts");

  const profiles = [fixtures.MOCK_ACTIVATED_DEMOGRAPHICS, fixtures.MOCK_INCOMPLETE_DRAFT.answers];
  for (const profile of profiles) {
    if (profile.location != null) assert.ok(options.VIETNAM_LOCATIONS.includes(profile.location), profile.location);
    if (profile.occupation != null) {
      assert.ok(
        options.OCCUPATIONS.includes(profile.occupation) || options.STUDENT_OCCUPATIONS.includes(profile.occupation),
        profile.occupation,
      );
    }
    if (profile.fieldOfStudy != null) assert.ok(options.FIELDS_OF_STUDY.includes(profile.fieldOfStudy), profile.fieldOfStudy);
    if (profile.householdIncome != null) assert.ok(options.INCOME_RANGES.includes(profile.householdIncome), profile.householdIncome);
    if (profile.gender != null) assert.ok(options.GENDER_OPTIONS.some((g) => g.value === profile.gender), profile.gender);
    for (const interest of profile.specificInterests ?? []) {
      assert.ok(options.INTEREST_OPTIONS.includes(interest), interest);
    }
  }
  assert.ok(options.INTEREST_OPTIONS.length >= 17, "FR-6: 17+ interest categories");

  // A saved value outside the catalog is still shown (not a blank placeholder).
  assert.deepEqual(options.withSavedOption(["A", "B"], "B"), ["A", "B"]);
  assert.deepEqual(options.withSavedOption(["A", "B"], "Legacy"), ["A", "B", "Legacy"]);
  assert.deepEqual(options.withSavedOption(["A", "B"], ""), ["A", "B"]);
  assert.deepEqual(options.withSavedOption(["A", "B"], null), ["A", "B"]);
  assert.deepEqual(options.withSavedOptions(["A", "B"], ["B", "Old", "Old", " "]), ["A", "B", "Old"]);
});
