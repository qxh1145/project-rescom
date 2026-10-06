import test from "node:test";
import assert from "node:assert/strict";

const steps = await import("../lib/onboarding/onboarding-steps.ts");
const answersLib = await import("../lib/onboarding/onboarding-answers.ts");
const draftLib = await import("../lib/onboarding/onboarding-draft.ts");
const { submitOnboarding, saveProfileExtras, isProfileSaveFailure, profileFixStep } = await import(
  "../lib/onboarding/onboarding-submit.ts"
);
const { profileNotSavedMessage } = await import("../lib/onboarding/onboarding-messages.ts");
const { searchOptions, foldVietnamese } = await import("../lib/onboarding/option-search.ts");
const { resolvePostOnboardingPath } = await import("../lib/onboarding.ts");
const { SCHOOL_YEAR_OPTIONS, VIETNAM_LOCATIONS, OCCUPATIONS, DANANG_UNIVERSITY_OPTIONS } = await import("../lib/demographic-options.ts");
const { ApiError } = await import("../lib/api/api-error.ts");
const { SCHOOL_YEAR_VALUES, submitDemographicSurveySchema, updateUserProfileSchema, userProfileSchema } = await import(
  "@rescom/schemas"
);

const YEAR = 2026;

/** Figma "Linh" (page 12): a student who picked "Cả hai". */
const STUDENT = {
  ...answersLib.EMPTY_ANSWERS,
  displayName: "Linh Nguyễn",
  birthYear: "2005",
  gender: "FEMALE",
  location: "Đà Nẵng",
  occupation: "Sinh viên đại học",
  school: "Trường Đại học FPT – Đà Nẵng",
  schoolYear: "Năm 3",
  fieldOfStudy: "Marketing & Truyền thông",
  householdIncome: "Không chia sẻ",
  interests: ["Khởi nghiệp & Kinh doanh", "Marketing & Mạng xã hội", "Du lịch & Ẩm thực", "Tâm lý học đường"],
  goal: "BOTH",
};

const OFFICE = { ...STUDENT, occupation: "Nhân viên văn phòng", school: null, schoolYear: null };

test("step sequence: 11 questions for students, 9 otherwise", () => {
  assert.equal(steps.isStudentOccupation("Học sinh / Sinh viên / Học viên"), true);
  assert.deepEqual(steps.visibleSteps(STUDENT), [...steps.QUESTION_STEPS]);
  assert.equal(steps.visibleSteps(OFFICE).length, 9);
  assert.ok(!steps.visibleSteps(OFFICE).includes("school"));
  assert.ok(!steps.visibleSteps(OFFICE).includes("school-year"));
  // Figma 12.5 helper: "sinh viên hay học viên" both get the school questions.
  assert.equal(steps.isStudentOccupation("Học viên sau đại học"), true);
  assert.equal(steps.isStudentOccupation(null), false);

  assert.equal(steps.nextStepOf("occupation", STUDENT), "school");
  assert.equal(steps.nextStepOf("occupation", OFFICE), "field");
  assert.equal(steps.nextStepOf("goal", STUDENT), "done");
  assert.equal(steps.previousStepOf("field", STUDENT), "school-year");
  assert.equal(steps.previousStepOf("field", OFFICE), "occupation");
  assert.equal(steps.previousStepOf("name", STUDENT), "welcome");
});

test("onboarding catalogs contain 34 current provinces, five occupations and Đà Nẵng universities", () => {
  assert.equal(VIETNAM_LOCATIONS.length, 34);
  assert.equal(new Set(VIETNAM_LOCATIONS).size, 34);
  assert.ok(VIETNAM_LOCATIONS.includes("Huế"));
  assert.ok(!VIETNAM_LOCATIONS.includes("Quảng Nam"));
  assert.deepEqual(OCCUPATIONS, [
    "Học sinh / Sinh viên / Học viên",
    "Giảng viên / Nghiên cứu viên",
    "Nhân viên văn phòng",
    "Lao động tự do",
    "Khác",
  ]);
  assert.ok(DANANG_UNIVERSITY_OPTIONS.includes("Trường Đại học FPT – Đà Nẵng"));
  assert.ok(DANANG_UNIVERSITY_OPTIONS.includes("Trường Đại học Ngoại ngữ – Đại học Đà Nẵng"));
  assert.ok(DANANG_UNIVERSITY_OPTIONS.includes("Trường Đại học Đông Á"));
  assert.ok(!DANANG_UNIVERSITY_OPTIONS.some((school) => school.includes("Hà Nội")));
});

test("step position: part and 'câu x/y' as drawn in Figma", () => {
  assert.deepEqual(steps.stepPosition("name", STUDENT), { partIndex: 0, questionNumber: 1, questionCount: 4 });
  assert.deepEqual(steps.stepPosition("school", STUDENT), { partIndex: 1, questionNumber: 2, questionCount: 5 });
  assert.deepEqual(steps.stepPosition("income", STUDENT), { partIndex: 1, questionNumber: 5, questionCount: 5 });
  assert.deepEqual(steps.stepPosition("income", OFFICE), { partIndex: 1, questionNumber: 3, questionCount: 3 });
  assert.deepEqual(steps.stepPosition("interests", OFFICE), { partIndex: 2, questionNumber: 1, questionCount: 1 });
  assert.deepEqual(steps.stepPosition("goal", OFFICE), { partIndex: 3, questionNumber: 1, questionCount: 1 });
});

test("step URL keeps required/returnTo and parses unknown steps as welcome", () => {
  assert.equal(
    steps.buildStepHref("birth-year", "required=1&returnTo=%2Fattempts%2Fa-1"),
    "/onboarding?required=1&returnTo=%2Fattempts%2Fa-1&step=birth-year",
  );
  assert.equal(steps.buildStepHref("welcome", "required=1&step=gender"), "/onboarding?required=1");
  assert.equal(steps.buildStepHref("welcome", ""), "/onboarding");
  assert.equal(steps.parseStep("school-year"), "school-year");
  assert.equal(steps.parseStep("done"), "done");
  assert.equal(steps.parseStep("admin"), "welcome");
  assert.equal(steps.parseStep(null), "welcome");
});

test("birth year → age: 4 digits, age 13–100", () => {
  assert.deepEqual(answersLib.checkBirthYear("2005", YEAR), { ok: true, year: 2005, age: 21 });
  assert.equal(answersLib.checkBirthYear("2013", YEAR).ok, true); // 13
  assert.equal(answersLib.checkBirthYear("1926", YEAR).ok, true); // 100
  assert.equal(answersLib.checkBirthYear("2014", YEAR).message, "Rescom dành cho người từ 13 tuổi trở lên.");
  assert.match(answersLib.checkBirthYear("1925", YEAR).message, /chưa hợp lệ/);
  assert.equal(answersLib.checkBirthYear("205", YEAR).message, "Năm sinh gồm 4 chữ số, ví dụ 2005.");
  assert.equal(answersLib.checkBirthYear("20a5", YEAR).ok, false);
  assert.equal(answersLib.checkBirthYear("  ", YEAR).message, "Nhập năm sinh của bạn.");
  // A future year has its own message, before the age range check.
  assert.equal(answersLib.checkBirthYear("2027", YEAR).message, "Năm sinh không thể ở tương lai.");
  assert.equal(answersLib.checkBirthYear("2026", YEAR).message, "Rescom dành cho người từ 13 tuổi trở lên.");
});

test("validation per question, incl. the Figma 3-interest minimum", () => {
  assert.equal(answersLib.validateStep("name", STUDENT, YEAR), null);
  assert.ok(answersLib.validateStep("name", { ...STUDENT, displayName: "  " }, YEAR));
  assert.ok(answersLib.validateStep("name", { ...STUDENT, displayName: "x".repeat(51) }, YEAR));
  assert.ok(answersLib.validateStep("gender", { ...STUDENT, gender: null }, YEAR));
  assert.equal(
    answersLib.validateStep("interests", { ...STUDENT, interests: ["A"] }, YEAR),
    "Chọn thêm 2 chủ đề nữa để tiếp tục (tối thiểu 3).",
  );
  assert.equal(answersLib.validateStep("interests", { ...STUDENT, interests: ["A", "B", "C"] }, YEAR), null);
  const many = Array.from({ length: 31 }, (_, index) => `Chủ đề ${index}`);
  assert.equal(answersLib.validateStep("interests", { ...STUDENT, interests: many }, YEAR), "Chọn tối đa 30 chủ đề.");
  assert.equal(answersLib.firstInvalidStep(STUDENT, YEAR), null);
  assert.equal(answersLib.firstInvalidStep({ ...STUDENT, schoolYear: null }, YEAR), "school-year");
  // A non-student never has to answer the school questions.
  assert.equal(answersLib.firstInvalidStep(OFFICE, YEAR), null);
});

test("name, school and school year follow the shared profile rules", () => {
  assert.equal(answersLib.DISPLAY_NAME_MAX, 50);
  assert.equal(answersLib.validateStep("name", { ...STUDENT, displayName: "x".repeat(50) }, YEAR), null);
  assert.equal(
    answersLib.validateStep("name", { ...STUDENT, displayName: "Linh\tNguyễn" }, YEAR),
    "Tên hiển thị có ký tự không hợp lệ. Bạn sửa lại giúp nhé.",
  );
  assert.equal(
    answersLib.validateStep("school", { ...STUDENT, school: "ĐH\u0007 FPT" }, YEAR),
    "Tên trường có ký tự không hợp lệ. Bạn sửa lại giúp nhé.",
  );
  // A school year no longer in the catalog must be picked again.
  assert.equal(
    answersLib.validateStep("school-year", { ...STUDENT, schoolYear: "Năm 6" }, YEAR),
    "Chọn năm học hiện tại của bạn.",
  );
  assert.equal(answersLib.firstInvalidStep({ ...STUDENT, schoolYear: "Năm 6" }, YEAR), "school-year");
  // The wizard options are exactly the values `schoolYear` accepts.
  assert.deepEqual(
    SCHOOL_YEAR_OPTIONS.map((option) => option.value),
    [...SCHOOL_YEAR_VALUES],
  );
});

test("resolveStep: no skipping ahead, hidden student steps, done only after submit", () => {
  const empty = answersLib.EMPTY_ANSWERS;
  assert.equal(answersLib.resolveStep("welcome", empty, false, YEAR), "welcome");
  assert.equal(answersLib.resolveStep("gender", empty, false, YEAR), "name");
  assert.equal(answersLib.resolveStep("name", empty, false, YEAR), "name");
  assert.equal(answersLib.resolveStep("gender", { ...STUDENT, gender: null }, false, YEAR), "gender");
  assert.equal(answersLib.resolveStep("goal", { ...STUDENT, gender: null }, false, YEAR), "gender");
  // A student-only step deep-linked by a non-student → the next question that applies.
  assert.equal(answersLib.resolveStep("school", OFFICE, false, YEAR), "field");
  assert.equal(answersLib.resolveStep("school-year", { ...OFFICE, goal: null }, false, YEAR), "field");
  assert.equal(answersLib.resolveStep("school", { ...OFFICE, location: null }, false, YEAR), "location");
  assert.equal(answersLib.resolveStep("done", STUDENT, false, YEAR), "goal");
  assert.equal(answersLib.resolveStep("done", STUDENT, true, YEAR), "done");
  assert.equal(answersLib.resolveStep("done", { ...STUDENT, location: null }, false, YEAR), "location");
});

test("payload mapping: POST /demographics/survey passes the shared schema", () => {
  const payload = answersLib.toSurveyPayload(STUDENT, YEAR);
  assert.deepEqual(payload, {
    age: 21,
    gender: "FEMALE",
    location: "Đà Nẵng",
    occupation: "Sinh viên đại học",
    fieldOfStudy: "Marketing & Truyền thông",
    householdIncome: "Không chia sẻ",
    specificInterests: STUDENT.interests,
  });
  assert.equal(submitDemographicSurveySchema.safeParse(payload).success, true);
  assert.throws(() => answersLib.toSurveyPayload({ ...STUDENT, birthYear: "" }, YEAR));
});

test("payload mapping: PATCH /users/me/profile passes the shared schema", () => {
  const patch = answersLib.toProfilePatch(STUDENT, YEAR);
  assert.deepEqual(patch, {
    displayName: "Linh Nguyễn",
    birthYear: 2005,
    school: "Trường Đại học FPT – Đà Nẵng",
    schoolYear: "Năm 3",
    goal: "BOTH",
  });
  assert.deepEqual(updateUserProfileSchema.parse(patch), patch);
  // Stale school answers of someone who switched to a non-student occupation are cleared.
  const office = answersLib.toProfilePatch({ ...STUDENT, occupation: "Nhân viên văn phòng" }, YEAR);
  assert.equal(office.school, null);
  assert.equal(office.schoolYear, null);
  assert.equal(updateUserProfileSchema.safeParse(office).success, true);
  assert.equal(updateUserProfileSchema.safeParse(answersLib.toProfilePatch(OFFICE, YEAR)).success, true);
});

test("prefill from GET /demographics + GET /users/me/profile", () => {
  const fromAge = answersLib.answersFromServer(
    { age: 21, gender: "MALE", location: "Hà Nội", specificInterests: ["AI", 3, " "] },
    null,
    YEAR,
  );
  assert.equal(fromAge.birthYear, "2005");
  assert.equal(fromAge.gender, "MALE");
  assert.deepEqual(fromAge.interests, ["AI"]);
  assert.equal(fromAge.occupation, null);

  const withProfile = answersLib.answersFromServer(
    { age: 21 },
    { displayName: "Linh", birthYear: 2004, school: null, schoolYear: null, goal: "EARN" },
    YEAR,
  );
  assert.equal(withProfile.birthYear, "2004");
  assert.equal(withProfile.displayName, "Linh");
  assert.equal(withProfile.goal, "EARN");
  assert.deepEqual(answersLib.answersFromServer(null, null, YEAR), answersLib.EMPTY_ANSWERS);
});

test("contract: a backend profile response parses and prefills every saved answer", () => {
  const response = userProfileSchema.parse({
    displayName: "Linh Nguyễn",
    birthYear: 2005,
    school: "Trường Đại học FPT – Đà Nẵng",
    schoolYear: "Năm 3",
    goal: "BOTH",
  });
  const demographics = { ...answersLib.toSurveyPayload(STUDENT, YEAR) };
  const prefilled = answersLib.answersFromServer(demographics, response, YEAR);
  // "Sửa" opens with everything saved: no question has to be answered again.
  assert.deepEqual(prefilled, STUDENT);
  assert.equal(answersLib.firstInvalidStep(prefilled, YEAR), null);
  assert.equal(answersLib.resolveStep("school", prefilled, false, YEAR), "school");

  // A user without a profile row gets all-null fields: the extras are asked again.
  const blank = userProfileSchema.parse({
    displayName: null,
    birthYear: null,
    school: null,
    schoolYear: null,
    goal: null,
  });
  assert.equal(answersLib.resolveStep("school", answersLib.answersFromServer(demographics, blank, YEAR), false, YEAR), "name");
  // Extra keys are a contract drift, not silently accepted.
  assert.equal(userProfileSchema.safeParse({ ...response, userId: "u-1" }).success, false);
});

test("a 400 from the survey routes back to the first invalid question", () => {
  assert.equal(
    answersLib.stepFromValidationDetails({
      _errors: [],
      householdIncome: { _errors: ["Household income is required"] },
      age: { _errors: ["Age must be at least 13"] },
    }),
    "birth-year",
  );
  // Nested errors (one bad interest) route to the field that owns the subtree.
  assert.equal(
    answersLib.stepFromValidationDetails({
      _errors: [],
      specificInterests: { _errors: [], 2: { _errors: ["Interest cannot be blank"] } },
    }),
    "interests",
  );
  assert.equal(answersLib.stepFromValidationDetails({ _errors: [], location: { _errors: [] } }), null);
  assert.equal(answersLib.stepFromValidationDetails({ _errors: ["x"] }), null);
  assert.equal(answersLib.stepFromValidationDetails(null), null);
  // `PATCH /users/me/profile` fields route to their questions too, still in flow order.
  assert.equal(
    answersLib.stepFromValidationDetails({ _errors: [], goal: { _errors: ["x"] }, displayName: { _errors: ["x"] } }),
    "name",
  );
  assert.equal(answersLib.stepFromValidationDetails({ _errors: [], schoolYear: { _errors: ["x"] } }), "school-year");
});

test("a profile save refused with 400 VALIDATION_ERROR offers Sửa, not the same retry", () => {
  const refused = (details) =>
    new ApiError({ kind: "http", status: 400, code: "VALIDATION_ERROR", message: "Invalid", details });
  assert.equal(profileFixStep(refused({ _errors: [], birthYear: { _errors: ["Age must be 13 to 100"] } })), "birth-year");
  assert.equal(profileFixStep(refused({ _errors: [], school: { _errors: ["x"] } })), "school");
  // No field named (strict-object error): the first profile question.
  assert.equal(profileFixStep(refused({ _errors: ["Unrecognized key"] })), "name");
  assert.equal(profileFixStep(new ApiError({ kind: "network", message: "offline" })), null);
  assert.equal(profileFixStep(new ApiError({ kind: "http", status: 500, code: "INTERNAL", message: "x" })), null);
  assert.equal(profileFixStep(new ApiError({ kind: "http", status: 400, code: "OTHER", message: "x" })), null);
  assert.equal(
    profileNotSavedMessage(refused({ _errors: [] }), false),
    "Hồ sơ đã lưu, nhưng tên hiển thị và mục tiêu của bạn có thông tin chưa hợp lệ nên chưa lưu được. Bấm Sửa để kiểm tra lại.",
  );
});

test("done-screen summary matches the Figma line", () => {
  const items = answersLib.profileSummary(STUDENT, YEAR);
  assert.equal(
    items.map((item) => item.text).join(" · "),
    "21 tuổi · Nữ · Đà Nẵng · Sinh viên năm 3 · Marketing · 4 chủ đề",
  );
  assert.equal(items.find((item) => item.text === "Sinh viên năm 3").desktopOnly, true);
});

test("draft: per-user sessionStorage round trip, corrupt data ignored", () => {
  const store = new Map();
  const storage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
  const draft = {
    answers: STUDENT,
    submitted: { nextStep: "MARKETPLACE_ACTIVATION" },
    updatedAt: "2026-09-27T10:00:00.000Z",
  };
  draftLib.writeDraft(storage, "user-1", draft);
  assert.deepEqual(draftLib.readDraft(storage, "user-1"), draft);
  assert.deepEqual(draftLib.readDraft(storage, "user-2"), draftLib.EMPTY_DRAFT);

  store.set(draftLib.draftKey("user-1"), "{not json");
  assert.deepEqual(draftLib.readDraft(storage, "user-1"), draftLib.EMPTY_DRAFT);
  store.set(draftLib.draftKey("user-1"), JSON.stringify({ answers: { gender: "ROBOT", interests: "x" }, submitted: { nextStep: "?" } }));
  const sanitized = draftLib.readDraft(storage, "user-1");
  assert.equal(sanitized.answers.gender, null);
  assert.deepEqual(sanitized.answers.interests, []);
  assert.equal(sanitized.submitted, null);

  draftLib.clearDraft(storage, "user-1");
  assert.equal(store.size, 0);

  // Done screen left: only nextStep stays.
  assert.deepEqual(draftLib.doneOnlyDraft(draft, "2026-09-27T11:00:00.000Z"), {
    answers: null,
    submitted: { nextStep: "MARKETPLACE_ACTIVATION" },
    updatedAt: "2026-09-27T11:00:00.000Z",
  });

  // Logout clears every user's draft, nothing else.
  const session = new Map([
    [draftLib.draftKey("a"), "{}"],
    [draftLib.draftKey("b"), "{}"],
    ["rescom:other", "keep"],
  ]);
  draftLib.clearAllOnboardingDrafts({
    get length() {
      return session.size;
    },
    key: (index) => [...session.keys()][index] ?? null,
    getItem: (key) => session.get(key) ?? null,
    setItem: (key, value) => session.set(key, value),
    removeItem: (key) => session.delete(key),
  });
  assert.deepEqual([...session.keys()], ["rescom:other"]);
  assert.deepEqual(draftLib.readDraft(null, "user-1"), draftLib.EMPTY_DRAFT);
});

test("option search ignores accents and case", () => {
  assert.equal(foldVietnamese("Đà Nẵng"), "da nang");
  assert.deepEqual(searchOptions(["Đà Nẵng", "Hà Nội", "Hà Nam"], "ha n", ["Đà Nẵng"]), ["Hà Nội", "Hà Nam"]);
  assert.deepEqual(searchOptions(["Đà Nẵng", "Hà Nội"], "  ", ["Đà Nẵng"]), ["Đà Nẵng"]);
  assert.deepEqual(searchOptions(["Trường Đại học FPT – Đà Nẵng"], "fpt da nang", []), ["Trường Đại học FPT – Đà Nẵng"]);
});

test("post-onboarding destination from the backend's nextStep alone", () => {
  assert.equal(resolvePostOnboardingPath({ nextStep: "MARKETPLACE_ACTIVATION" }, "/attempts/a-1"), "/marketplace?activation=1");
  assert.equal(resolvePostOnboardingPath({ nextStep: "COMPLETED" }, null), "/marketplace");
  assert.equal(resolvePostOnboardingPath({ nextStep: "COMPLETED" }, "/attempts/a-1"), "/attempts/a-1");
  assert.equal(resolvePostOnboardingPath({ nextStep: "COMPLETED" }, "https://evil.example"), "/marketplace");
});

test("draft vs server: the newer copy wins", () => {
  const server = { answers: { ...STUDENT, location: "Hà Nội" }, updatedAt: "2026-09-27T12:00:00.000Z" };
  const older = { answers: STUDENT, submitted: null, updatedAt: "2026-09-27T11:00:00.000Z" };
  const newer = { ...older, updatedAt: "2026-09-27T13:00:00.000Z" };
  assert.equal(draftLib.chooseAnswers(older, server).location, "Hà Nội");
  assert.equal(draftLib.chooseAnswers(newer, server).location, "Đà Nẵng");
  assert.equal(draftLib.chooseAnswers(older, { ...server, updatedAt: null }).location, "Đà Nẵng");
  assert.equal(draftLib.chooseAnswers(draftLib.EMPTY_DRAFT, server).location, "Hà Nội");
  assert.equal(draftLib.chooseAnswers(draftLib.EMPTY_DRAFT, undefined), null);
});

test("submit guard: the first unanswered question is found before any request", () => {
  assert.equal(answersLib.firstInvalidStep({ ...STUDENT, interests: ["A"] }, YEAR), "interests");
  assert.equal(answersLib.firstInvalidStep({ ...STUDENT, birthYear: "2030" }, YEAR), "birth-year");
});

test("submit: survey first; a failed profile save is returned, never thrown", async () => {
  const calls = [];
  const ok = await submitOnboarding(STUDENT, YEAR, {
    submitSurvey: async (input) => {
      calls.push(["survey", input.age]);
      return { nextStep: "MARKETPLACE_ACTIVATION" };
    },
    updateProfile: async (input) => {
      calls.push(["profile", input.displayName]);
    },
  });
  assert.deepEqual(calls, [
    ["survey", 21],
    ["profile", "Linh Nguyễn"],
  ]);
  assert.deepEqual(ok, { nextStep: "MARKETPLACE_ACTIVATION", profileError: null });

  const profileDown = new Error("404");
  const partial = await submitOnboarding(STUDENT, YEAR, {
    submitSurvey: async () => ({ nextStep: "COMPLETED" }),
    updateProfile: async () => {
      throw profileDown;
    },
  });
  assert.deepEqual(partial, { nextStep: "COMPLETED", profileError: profileDown });

  let profileCalled = false;
  await assert.rejects(
    submitOnboarding(STUDENT, YEAR, {
      submitSurvey: async () => {
        throw new Error("400");
      },
      updateProfile: async () => {
        profileCalled = true;
      },
    }),
    /400/,
  );
  assert.equal(profileCalled, false);
});

test("a failed profile save is shown with a retry, except for an aborted request", async () => {
  const network = new ApiError({ kind: "network", message: "Network request failed" });
  const notFound = new ApiError({ kind: "http", status: 404, code: "NOT_FOUND", message: "Not found" });
  const aborted = new DOMException("The operation was aborted.", "AbortError");
  assert.equal(isProfileSaveFailure(null), false);
  assert.equal(isProfileSaveFailure(aborted), false);
  assert.equal(isProfileSaveFailure(network), true);
  // A backend without the route is a failure too: the extras were not saved.
  assert.equal(isProfileSaveFailure(notFound), true);

  assert.equal(
    profileNotSavedMessage(notFound, true),
    "Hồ sơ đã lưu, nhưng chưa lưu được tên hiển thị, trường, năm học và mục tiêu của bạn. Bấm Thử lại để lưu.",
  );
  assert.equal(
    profileNotSavedMessage(network, false),
    "Hồ sơ đã lưu, nhưng chưa lưu được tên hiển thị và mục tiêu của bạn. Kiểm tra mạng rồi bấm Thử lại.",
  );

  // "Thử lại" sends the same patch as the submit and reports the outcome.
  const sent = [];
  assert.equal(
    await saveProfileExtras(STUDENT, YEAR, async (input) => {
      sent.push(input);
    }),
    null,
  );
  assert.deepEqual(sent, [answersLib.toProfilePatch(STUDENT, YEAR)]);
  assert.equal(
    await saveProfileExtras(STUDENT, YEAR, async () => {
      throw network;
    }),
    network,
  );
});
