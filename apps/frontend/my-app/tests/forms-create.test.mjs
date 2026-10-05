import test from "node:test";
import assert from "node:assert/strict";

const wizard = await import("../lib/forms/create-wizard.ts");
const storage = await import("../lib/forms/create-storage.ts");
const messages = await import("../lib/forms/create-messages.ts");
const { ApiError } = await import("../lib/api/api-error.ts");
const { createExternalSurveySchema, surveyTargetingSchema, FORM_TOPICS, FORM_TOPIC_SEARCH_TERMS } = await import("@rescom/schemas");

function draft(overrides = {}) {
  return {
    ...wizard.emptyWizardDraft(),
    externalUrl: "https://forms.gle/Qm8xYt2hLpR",
    title: "Hành vi tiêu dùng của sinh viên Marketing",
    topic: "MARKETING",
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
    assert.equal(wizard.reachableStep(3, draft({ ageMin: "12" })), 2);
    assert.equal(wizard.reachableStep(3, draft({ ageMin: "", ageMax: "", fieldsOfStudy: [] })), 3);
  });
});

test("Google Forms wizard · step 2 targeting (Figma 9b)", async (t) => {
  await t.test("maps the choices onto surveyTargetingSchema (school hidden, never sent)", () => {
    assert.equal(wizard.SCHOOL_TARGETING_SUPPORTED, false);
    const targeting = wizard.toTargetingJson(
      draft({ gender: "FEMALE", school: "Trường Đại học FPT – Đà Nẵng", locations: ["Đà Nẵng"] }),
    );
    assert.deepEqual(targeting, {
      ageRange: { min: 18, max: 25 },
      genders: ["FEMALE"],
      fieldOfStudy: ["Marketing & Truyền thông", "Kinh tế & Quản trị kinh doanh"],
      locations: ["Đà Nẵng"],
    });
    assert.equal(surveyTargetingSchema.safeParse(targeting).success, true);
  });

  await t.test("a school alone is no criterion: the survey would reach everyone", () => {
    const schoolOnly = draft({ ageMin: "", ageMax: "", fieldsOfStudy: [], school: "Trường Đại học FPT – Đà Nẵng" });
    assert.equal(wizard.criteriaCount(wizard.toTargetingJson(schoolOnly)), 0);
    assert.deepEqual(wizard.validateAudienceStep(schoolOnly), {});
    assert.equal(wizard.audienceSummaryLine(schoolOnly), "Mọi người dùng");
    assert.equal(wizard.criteriaSummary(schoolOnly).at(-1).value, "Tất cả");
  });

  await t.test("'Tất cả người dùng': no criterion is a valid open-to-everyone survey", () => {
    const targeting = wizard.toTargetingJson(draft({ ageMin: "", ageMax: "", fieldsOfStudy: [] }));
    assert.deepEqual(targeting, {});
    assert.equal(surveyTargetingSchema.safeParse(targeting).success, true);
    assert.deepEqual(wizard.validateAudienceStep(draft({ ageMin: "", ageMax: "", fieldsOfStudy: [] })), {});
  });

  await t.test("validates the age range", () => {
    assert.equal(wizard.validateAudienceStep(draft({ ageMax: "" })).age, messages.CREATE_MESSAGES.ageIncomplete);
    assert.equal(wizard.validateAudienceStep(draft({ ageMin: "12" })).age, messages.CREATE_MESSAGES.ageOutOfRange);
    assert.equal(wizard.validateAudienceStep(draft({ ageMin: "30" })).age, messages.CREATE_MESSAGES.ageOrder);
  });

  await t.test("summaries leave the hidden school out", () => {
    const withSchool = draft({ school: "Trường Đại học FPT – Đà Nẵng", locations: ["Đà Nẵng"] });
    assert.deepEqual(wizard.criteriaSummary(withSchool), [
      { label: "Giới tính", value: "Tất cả" },
      { label: "Tuổi", value: "18 – 25" },
      { label: "Ngành", value: "2 ngành" },
      { label: "Khu vực", value: "Đà Nẵng" },
    ]);
    assert.equal(wizard.audienceSummaryLine(withSchool), "18–25 tuổi · 2 ngành · Đà Nẵng");
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
    // Plan 2.2 / Story IR.2b: the topic and the collection deadline are sent.
    assert.equal(body.topic, "MARKETING");
    assert.equal(typeof body.deadlineAt, "string");
    assert.equal("collectionDays" in body, false);
    // The deadline is the end of the day shown by the label (Asia/Ho_Chi_Minh).
    const fixed = wizard.toCreateRequest(draft(), new Date("2026-09-26T03:00:00Z"));
    assert.equal(fixed.deadlineAt, "2026-10-10T16:59:59.999Z");
    assert.equal(wizard.toCreateRequest(draft(), new Date("2026-09-26T16:59:00Z")).deadlineAt, fixed.deadlineAt);
    assert.equal(wizard.toCreateRequest(draft({ topic: "" })).topic, null);
    assert.equal("schools" in body.targetingJson, false);
    assert.equal(wizard.toCreateRequest(draft({ rewardPerResponse: "99" })), null);
  });

  await t.test("a school saved before the field was hidden is dropped on load", () => {
    const local = memoryStorage();
    storage.saveWizardDraft(local, "u1", draft({ school: "Trường Đại học FPT – Đà Nẵng" }));
    assert.equal(storage.loadWizardDraft(local, "u1").school, "");
  });

  await t.test("topics: shared values, Vietnamese labels, legacy drafts (plan 2.2)", () => {
    for (const option of wizard.TOPIC_OPTIONS) {
      assert.equal(FORM_TOPIC_SEARCH_TERMS[option.value][0], option.label);
    }
    assert.deepEqual(
      wizard.TOPIC_OPTIONS.map((option) => option.value),
      [...FORM_TOPICS],
    );
    assert.equal(wizard.topicLabel("IT"), "Công nghệ thông tin");
    assert.equal(wizard.topicLabel(null), null);
    const local = memoryStorage();
    local.setItem("rescom:create-gform-draft:legacy", JSON.stringify({ ...draft(), topic: "Kinh tế" }));
    assert.equal(storage.loadWizardDraft(local, "legacy").topic, "BUSINESS");
    assert.equal(
      wizard.wizardDraftFromSurvey({
        type: "EXTERNAL",
        title: "T",
        rewardPerResponse: 10,
        expectedCompletions: 5,
        topic: "HEALTH",
        currentVersion: { externalUrl: "https://forms.gle/x" },
      }).topic,
      "HEALTH",
    );
  });

  await t.test("several regions: all sent, summarised by count; single-region drafts migrate", () => {
    const multi = draft({ locations: ["Đà Nẵng", "Hà Nội"] });
    assert.deepEqual(wizard.toTargetingJson(multi).locations, ["Đà Nẵng", "Hà Nội"]);
    assert.equal(wizard.criteriaSummary(multi).at(-1).value, "2 khu vực");
    assert.equal(wizard.audienceSummaryLine(multi), "18–25 tuổi · 2 ngành · 2 khu vực");
    const local = memoryStorage();
    const { locations, ...legacy } = draft();
    local.setItem("rescom:create-gform-draft:old", JSON.stringify({ ...legacy, location: "Huế" }));
    assert.deepEqual(storage.loadWizardDraft(local, "old").locations, ["Huế"]);
    local.setItem("rescom:create-gform-draft:none", JSON.stringify({ ...legacy, location: "" }));
    assert.deepEqual(storage.loadWizardDraft(local, "none").locations, []);
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

test("Google Forms wizard · Idempotency-Key per draft (decision C6 a)", async (t) => {
  const http = (code, status) => new ApiError({ kind: "http", message: code ?? "x", status, code });

  await t.test("one key per draft: generated once, reused by retries, cleared with the draft", () => {
    const local = memoryStorage();
    let generated = 0;
    const generate = () => `00000000-0000-4000-8000-00000000000${++generated}`;
    const first = storage.wizardIdempotencyKey(local, "u1", generate);
    assert.equal(first, "00000000-0000-4000-8000-000000000001");
    assert.equal(storage.wizardIdempotencyKey(local, "u1", generate), first);
    assert.notEqual(storage.wizardIdempotencyKey(local, "u2", generate), first, "per user");
    storage.clearWizardDraft(local, "u1");
    assert.equal(storage.wizardIdempotencyKey(local, "u1", generate), "00000000-0000-4000-8000-000000000003");
    storage.clearWizardIdempotencyKey(local, "u1");
    assert.equal(storage.wizardIdempotencyKey(local, "u1", generate), "00000000-0000-4000-8000-000000000004");
    // The default generator is a UUID; blocked storage still yields a key.
    assert.match(storage.wizardIdempotencyKey(null, "u9"), /^[0-9a-f-]{36}$/);
  });

  await t.test("the key survives only outcomes that are unknown", () => {
    assert.equal(messages.keepsIdempotencyKey(new ApiError({ kind: "network", message: "x" })), true);
    assert.equal(messages.keepsIdempotencyKey(new ApiError({ kind: "malformed", status: 201, message: "x" })), true);
    assert.equal(messages.keepsIdempotencyKey(http(null, 502)), true);
    assert.equal(messages.keepsIdempotencyKey(http("RATE_LIMITED", 429)), true);
    for (const [code, status] of [["VALIDATION_ERROR", 400], ["INSUFFICIENT_ESCROW_BALANCE", 409], ["SURVEY_DURATION_EXCEEDS_RESERVATION", 422]]) {
      assert.equal(messages.keepsIdempotencyKey(http(code, status)), false, code);
    }
    // Review MEDIUM-4: a conflict keeps the key (the survey may exist).
    assert.equal(messages.keepsIdempotencyKey(http("IDEMPOTENCY_KEY_CONFLICT", 409)), true);
    assert.match(messages.createSurveyErrorMessage(http("IDEMPOTENCY_KEY_CONFLICT", 409)), /danh sách khảo sát của bạn/);
  });

  await t.test("review MEDIUM-4: a retry after midnight resends the deadline of the first submit", () => {
    const local = memoryStorage();
    const day1 = new Date("2026-10-01T16:50:00Z"); // 23:50 in Vietnam
    const day2 = new Date("2026-10-01T17:10:00Z"); // 00:10 the next day
    const first = storage.wizardSubmitDeadline(local, "u1", 14, () => wizard.collectionDeadlineAt(14, day1));
    const retry = storage.wizardSubmitDeadline(local, "u1", 14, () => wizard.collectionDeadlineAt(14, day2));
    assert.equal(retry, first);
    assert.notEqual(wizard.collectionDeadlineAt(14, day2), first);
    // A changed "Hạn thu thập" is recomputed; clearing the key forgets it.
    assert.notEqual(storage.wizardSubmitDeadline(local, "u1", 7, () => wizard.collectionDeadlineAt(7, day2)), first);
    storage.clearWizardIdempotencyKey(local, "u1");
    assert.equal(
      storage.wizardSubmitDeadline(local, "u1", 7, () => wizard.collectionDeadlineAt(7, day2)),
      wizard.collectionDeadlineAt(7, day2),
    );
  });

  await t.test("a key reused with another body reads as a possible duplicate", () => {
    for (const code of ["IDEMPOTENCY_KEY_CONFLICT", "IDEMPOTENCY_KEY_REUSED"]) {
      assert.match(messages.createSurveyErrorMessage(http(code, 409)), /Khảo sát của tôi/);
    }
  });

  await t.test("createGoogleFormSurvey sends the key header", async () => {
    const { createGoogleFormSurvey } = await import("../lib/forms/create-service.ts");
    const { setCsrfToken } = await import("../lib/api/client.ts");
    setCsrfToken("tok");
    const originalFetch = globalThis.fetch;
    let sent = null;
    globalThis.fetch = async (_url, init) => {
      sent = init;
      return new Response(JSON.stringify({ data: null, error: { code: "VALIDATION_ERROR", message: "x" }, meta: {} }), { status: 400 });
    };
    try {
      await assert.rejects(createGoogleFormSurvey(wizard.toCreateRequest(draft()), "key-abc-123"));
      assert.equal(sent.headers["Idempotency-Key"], "key-abc-123");
      await assert.rejects(createGoogleFormSurvey(wizard.toCreateRequest(draft())));
      assert.equal(sent.headers["Idempotency-Key"], undefined);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.test("mock: same key + same body replays, another body conflicts", async () => {
    const { decideIdempotentRequest, idempotencyRecordKey } = await import("../mocks/data/idempotency.ts");
    assert.equal(idempotencyRecordKey("u1", null), null);
    assert.equal(idempotencyRecordKey("u1", "k"), "u1:k");
    assert.deepEqual(decideIdempotentRequest(undefined, "{}"), { kind: "new" });
    const record = { fingerprint: '{"a":1}', response: { id: "f1" } };
    assert.deepEqual(decideIdempotentRequest(record, '{"a":1}'), { kind: "replay", response: { id: "f1" } });
    assert.deepEqual(decideIdempotentRequest(record, '{"a":2}'), { kind: "conflict" });
  });
});

test("Google Forms wizard · Sửa & gửi lại prefill (?from=<id>)", async (t) => {
  const rejected = {
    id: "7c2e3f40-5a6b-4c7d-8e9f-0a1b2c3d4f04",
    type: "EXTERNAL",
    title: "Trải nghiệm dùng app giao đồ ăn",
    description: "Đồ án môn Hành vi người tiêu dùng.",
    rewardPerResponse: 12,
    expectedCompletions: 10,
    estimatedDurationMinutes: 5,
    currentVersion: {
      externalUrl: "https://docs.google.com/forms/d/e/mock-food-delivery/viewform",
      targetingJson: {
        ageRange: { min: 18, max: 22 },
        genders: ["FEMALE"],
        fieldOfStudy: ["Marketing & Truyền thông", "Ngành không có trong danh mục"],
        locations: ["Đà Nẵng"],
      },
    },
  };

  await t.test("maps the rejected survey onto a fresh, submittable draft", () => {
    const filled = wizard.wizardDraftFromSurvey(rejected);
    assert.deepEqual(filled, {
      ...wizard.emptyWizardDraft(),
      externalUrl: "https://docs.google.com/forms/d/e/mock-food-delivery/viewform",
      title: "Trải nghiệm dùng app giao đồ ăn",
      description: "Đồ án môn Hành vi người tiêu dùng.",
      durationBand: "FROM_5_TO_10",
      gender: "FEMALE",
      ageMin: "18",
      ageMax: "22",
      fieldsOfStudy: ["Marketing & Truyền thông"],
      locations: ["Đà Nẵng"],
      sampleSize: "10",
      rewardPerResponse: "12",
    });
    const body = wizard.toCreateRequest(filled);
    assert.ok(body, "every step is valid");
    assert.equal(createExternalSurveySchema.safeParse(body).success, true);
  });

  await t.test("no targeting or an unknown gender mix falls back to the neutral choices", () => {
    const filled = wizard.wizardDraftFromSurvey({
      ...rejected,
      description: null,
      estimatedDurationMinutes: null,
      currentVersion: { externalUrl: null, targetingJson: { genders: ["MALE", "FEMALE"] } },
    });
    assert.equal(filled.gender, "ALL");
    assert.equal(filled.externalUrl, "");
    assert.equal(filled.description, "");
    assert.equal(filled.durationBand, null);
    assert.equal(filled.ageMin, "");
    assert.deepEqual(filled.fieldsOfStudy, []);
  });

  await t.test("duration minutes → wizard band; in-Rescom surveys are not prefilled", () => {
    assert.deepEqual(
      [3, 5, 10, 11, 15, 16, 0, null].map((minutes) => wizard.durationBandForMinutes(minutes)),
      ["UNDER_5", "FROM_5_TO_10", "FROM_5_TO_10", "FROM_10_TO_15", "FROM_10_TO_15", "OVER_15", null, null],
    );
    assert.equal(wizard.wizardDraftFromSurvey({ ...rejected, type: "INTERNAL" }), null);
  });

  await t.test("an untouched wizard is not an in-progress draft", () => {
    assert.equal(wizard.isWizardDraftStarted(wizard.emptyWizardDraft()), false);
    assert.equal(wizard.isWizardDraftStarted({ ...wizard.emptyWizardDraft(), title: "x" }), true);
  });

  await t.test("prefill failures read in Vietnamese", () => {
    const http = (code, status) => new ApiError({ kind: "http", message: code, status, code });
    assert.match(messages.prefillErrorMessage(http("FORM_FORBIDDEN", 403)), /tài khoản khác/);
    assert.match(messages.prefillErrorMessage(http("FORM_NOT_FOUND", 404)), /Không tìm thấy/);
    assert.match(messages.PREFILL_MESSAGES.filled("A"), /“A”/);
  });
});

test("Google Forms wizard · audience estimate contract (plan 5.5, VERIFIED)", async (t) => {
  const { estimateAudience } = await import("../lib/forms/create-service.ts");
  const { audienceEstimateInputSchema, audienceEstimateSchema, toAudienceEstimate } = await import("@rescom/schemas");
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  let sent = null;
  globalThis.fetch = async (url, init) => {
    if (String(url) === "/api/auth/csrf") return json(200, { data: { csrfToken: "csrf" } });
    sent = { url: String(url), init };
    return json(200, { data: toAudienceEstimate(6), error: null, meta: {} });
  };

  await t.test("sends the strict backend targeting (never the UI-only school) with CSRF", async () => {
    const result = await estimateAudience({ ageRange: { min: 18, max: 22 }, locations: ["Hà Nội"], schools: ["FPT"] });
    assert.equal(sent.url, "/api/forms/audience-estimate");
    assert.equal(sent.init.method, "POST");
    assert.ok(sent.init.headers["X-CSRF-Token"], "the CSRF token is sent");
    const body = JSON.parse(sent.init.body);
    assert.deepEqual(body, { targeting: { ageRange: { min: 18, max: 22 }, locations: ["Hà Nội"] } });
    assert.equal(audienceEstimateInputSchema.safeParse(body).success, true);
    // A group under the minimum comes back without a number (k-anonymity).
    assert.deepEqual(result, { estimatedRespondents: null, minimumReportable: 10 });
  });

  await t.test("a response outside the shared schema is rejected as malformed", async () => {
    globalThis.fetch = async (url) =>
      String(url) === "/api/auth/csrf"
        ? json(200, { data: { csrfToken: "csrf" } })
        : json(200, { data: { estimatedRespondents: 7 }, error: null, meta: {} });
    await assert.rejects(estimateAudience({}), (error) => error.kind === "malformed");
    assert.equal(audienceEstimateSchema.safeParse({ estimatedRespondents: 7 }).success, false);
  });
});
