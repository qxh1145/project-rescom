import test from "node:test";
import assert from "node:assert/strict";

const wizard = await import("../lib/forms/create-wizard.ts");
const storage = await import("../lib/forms/create-storage.ts");
const messages = await import("../lib/forms/create-messages.ts");
const { ApiError } = await import("../lib/api/api-error.ts");
const { createExternalSurveySchema, surveyTargetingSchema } = await import("@rescom/schemas");

function draft(overrides = {}) {
  return {
    ...wizard.emptyWizardDraft(),
    externalUrl: "https://forms.gle/Qm8xYt2hLpR",
    title: "Hành vi tiêu dùng của sinh viên Marketing",
    topic: "Marketing",
    description: "Khảo sát phục vụ đồ án tốt nghiệp ngành Marketing.",
    durationBand: "FROM_5_TO_10",
    ageMin: "18",
    ageMax: "25",
    fieldsOfStudy: ["Marketing & Truyền thông", "Kinh tế & Quản trị kinh doanh"],
    rewardPerResponse: "10",
    ...overrides,
  };
}

function memoryStorage() {
  const store = new Map();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
}

test("Google Forms wizard · step 1 (Figma 9a)", async (t) => {
  await t.test("accepts only Google Forms links over HTTPS", () => {
    assert.deepEqual(wizard.checkGoogleFormsUrl(" https://forms.gle/abc "), { valid: true, url: "https://forms.gle/abc" });
    assert.equal(wizard.checkGoogleFormsUrl("").valid, false);
    assert.equal(wizard.checkGoogleFormsUrl("http://forms.gle/abc").error, messages.CREATE_MESSAGES.urlNotHttps);
    assert.equal(
      wizard.checkGoogleFormsUrl("https://docs.google.com/document/d/1").error,
      messages.CREATE_MESSAGES.urlNotGoogleForms,
    );
    assert.equal(wizard.checkGoogleFormsUrl("forms.gle").error, messages.CREATE_MESSAGES.urlInvalid);
  });

  await t.test("requires url, title (≤ 80) and a duration", () => {
    assert.deepEqual(wizard.validateInfoStep(draft()), {});
    const errors = wizard.validateInfoStep(draft({ externalUrl: "", title: "  ", durationBand: null }));
    assert.deepEqual(Object.keys(errors).sort(), ["durationBand", "externalUrl", "title"]);
    assert.ok(wizard.validateInfoStep(draft({ title: "x".repeat(81) })).title);
  });

  await t.test("each duration button sits in its FR-14 band and the 30-minute window", () => {
    const ranges = wizard.DURATION_BANDS.map((band) => [band.minutes, wizard.rewardRangeOf(band.id)]);
    assert.deepEqual(
      ranges.map(([, range]) => [range.min, range.max]),
      [
        [5, 10],
        [10, 20],
        [15, 25],
        [20, 40],
      ],
    );
    for (const [minutes] of ranges) assert.ok(minutes >= 1 && minutes <= 30);
  });

  await t.test("parses the ?step= URL state", () => {
    assert.equal(wizard.parseWizardStep("2"), 2);
    assert.equal(wizard.parseWizardStep("3"), 3);
    assert.equal(wizard.parseWizardStep("9"), 1);
    assert.equal(wizard.parseWizardStep(null), 1);
  });

  await t.test("a step opens only once the earlier steps are valid", () => {
    assert.equal(wizard.reachableStep(3, draft()), 3);
    assert.equal(wizard.reachableStep(3, draft({ title: "" })), 1);
    assert.equal(wizard.reachableStep(3, draft({ ageMin: "", ageMax: "", fieldsOfStudy: [] })), 2);
  });
});

test("Google Forms wizard · step 2 targeting (Figma 9b)", async (t) => {
  await t.test("maps the choices onto surveyTargetingSchema (+ ASSUMED schools)", () => {
    const targeting = wizard.toTargetingJson(
      draft({ gender: "FEMALE", school: "Trường Đại học FPT – Đà Nẵng", location: "Đà Nẵng" }),
    );
    assert.deepEqual(targeting, {
      ageRange: { min: 18, max: 25 },
      genders: ["FEMALE"],
      fieldOfStudy: ["Marketing & Truyền thông", "Kinh tế & Quản trị kinh doanh"],
      locations: ["Đà Nẵng"],
      schools: ["Trường Đại học FPT – Đà Nẵng"],
    });
    const { schools, ...backend } = targeting;
    assert.ok(schools);
    assert.equal(surveyTargetingSchema.safeParse(backend).success, true);
  });

  await t.test("'Tất cả' and empty fields add no criterion", () => {
    const targeting = wizard.toTargetingJson(draft({ ageMin: "", ageMax: "", fieldsOfStudy: [] }));
    assert.deepEqual(targeting, {});
    assert.deepEqual(wizard.validateAudienceStep(draft({ ageMin: "", ageMax: "", fieldsOfStudy: [] })), {
      criteria: messages.CREATE_MESSAGES.criteriaRequired,
    });
  });

  await t.test("validates the age range", () => {
    assert.equal(wizard.validateAudienceStep(draft({ ageMax: "" })).age, messages.CREATE_MESSAGES.ageIncomplete);
    assert.equal(wizard.validateAudienceStep(draft({ ageMin: "12" })).age, messages.CREATE_MESSAGES.ageOutOfRange);
    assert.equal(wizard.validateAudienceStep(draft({ ageMin: "30" })).age, messages.CREATE_MESSAGES.ageOrder);
  });

  await t.test("summaries", () => {
    const withSchool = draft({ school: "Trường Đại học FPT – Đà Nẵng", location: "Đà Nẵng" });
    assert.deepEqual(wizard.criteriaSummary(withSchool).map((row) => row.value), [
      "Tất cả",
      "18 – 25",
      "2 ngành",
      "FPT – Đà Nẵng · Đà Nẵng",
    ]);
    assert.equal(wizard.audienceSummaryLine(withSchool), "18–25 tuổi · 2 ngành · FPT – Đà Nẵng · Đà Nẵng");
  });
});

test("Google Forms wizard · step 3 cost and balance (Figma 9c / 9c')", async (t) => {
  await t.test("reward must stay inside the band of the chosen duration", () => {
    assert.deepEqual(wizard.validateRewardStep(draft()), {});
    assert.equal(
      wizard.validateRewardStep(draft({ rewardPerResponse: "25" })).rewardPerResponse,
      messages.CREATE_MESSAGES.rewardOutOfBand(10, 20),
    );
    assert.ok(wizard.validateRewardStep(draft({ rewardPerResponse: "" })).rewardPerResponse);
    assert.ok(wizard.validateRewardStep(draft({ sampleSize: "0" })).sampleSize);
    assert.ok(wizard.validateRewardStep(draft({ sampleSize: "100001" })).sampleSize);
  });

  await t.test("cost = sample × points/lượt against the available balance", () => {
    assert.deepEqual(wizard.escrowQuote(10, 10, 112), {
      sample: 10,
      reward: 10,
      cost: 100,
      available: 112,
      remaining: 12,
      shortfall: 0,
      affordableSample: 11,
    });
    const short = wizard.escrowQuote(30, 12, 112);
    assert.equal(short.cost, 360);
    assert.equal(short.shortfall, 248);
    assert.equal(short.affordableSample, 9);
  });

  await t.test("stepper stays within 1…100 000", () => {
    assert.equal(wizard.stepSampleSize("1", -1), "1");
    assert.equal(wizard.stepSampleSize("10", 1), "11");
    assert.equal(wizard.stepSampleSize("", 1), "11");
    assert.equal(wizard.stepSampleSize("100000", 1), "100000");
  });

  await t.test("collection deadline label", () => {
    assert.equal(wizard.collectionDaysLabel(14, new Date("2026-09-26T03:00:00Z")), "14 ngày · đến 10/10/2026");
  });
});

test("Google Forms wizard · request and storage", async (t) => {
  await t.test("builds a POST /forms/external body the backend schema accepts", () => {
    const body = wizard.toCreateRequest(draft());
    assert.equal(body.autoPublish, true);
    assert.equal(body.estimatedDurationMinutes, 8);
    assert.equal(body.expectedEffortSeconds, 480);
    assert.equal(body.rewardPerResponse, 10);
    assert.equal(body.expectedCompletions, 10);
    assert.equal(createExternalSurveySchema.safeParse(body).success, true);
    assert.equal("topic" in body, false);
    assert.equal("collectionDays" in body, false);
    assert.equal("schools" in body.targetingJson, false);
    assert.equal(wizard.toCreateRequest(draft({ rewardPerResponse: "99" })), null);
  });

  await t.test("draft round-trips per user and ignores stale shapes", () => {
    const local = memoryStorage();
    storage.saveWizardDraft(local, "u1", draft());
    assert.deepEqual(storage.loadWizardDraft(local, "u1"), draft());
    assert.deepEqual(storage.loadWizardDraft(local, "u2"), wizard.emptyWizardDraft());
    local.setItem("rescom:create-gform-draft:u3", JSON.stringify({ title: 1 }));
    assert.deepEqual(storage.loadWizardDraft(local, "u3"), wizard.emptyWizardDraft());
    storage.clearWizardDraft(local, "u1");
    assert.deepEqual(storage.loadWizardDraft(local, "u1"), wizard.emptyWizardDraft());
  });

  await t.test("the one-time code is readable only by the owner in this tab", () => {
    const session = memoryStorage();
    const survey = {
      formId: "f1",
      userId: "u1",
      title: "T",
      completionCode: "482917",
      externalUrl: "https://forms.gle/x",
      escrowPoints: 100,
    };
    storage.stashSubmittedSurvey(session, survey);
    assert.deepEqual(storage.readSubmittedSurvey(session, "f1", "u1"), survey);
    assert.equal(storage.readSubmittedSurvey(session, "f1", "u2"), null);
    storage.clearSubmittedSurvey(session, "f1");
    assert.equal(storage.readSubmittedSurvey(session, "f1", "u1"), null);
    assert.equal(messages.completionCodeLine("482917"), "Mã hoàn thành Rescom: 482917");
  });

  await t.test("maps submit errors", () => {
    const http = (code, status, details) => new ApiError({ kind: "http", message: code, status, code, details });
    assert.equal(messages.isInsufficientBalanceError(http("INSUFFICIENT_ESCROW_BALANCE", 409)), true);
    assert.match(
      messages.createSurveyErrorMessage(http("PRICING_REWARD_OUT_OF_BAND", 400, { min: 10, max: 20, suggested: 10 })),
      /từ 10 đến 20/,
    );
    assert.match(messages.createSurveyErrorMessage(new ApiError({ kind: "network", message: "x" })), /kết nối/);
  });
});
