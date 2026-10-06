import test from "node:test";
import assert from "node:assert/strict";

const form = await import("../lib/participation/survey-form.ts");
const draft = await import("../lib/participation/answer-draft.ts");
const completion = await import("../lib/participation/completion-view.ts");
const messages = await import("../lib/participation/participation-messages.ts");
const consent = await import("../lib/participation/consent-service.ts");
const { ApiError } = await import("../lib/api/api-error.ts");

function choice(id, order, labels, extra = {}) {
  return {
    id,
    order,
    type: "single_choice",
    title: `Câu ${id}`,
    required: true,
    allowOther: false,
    options: labels.map((label, index) => ({ id: `${id}-${index}`, label, value: label })),
    ...extra,
  };
}

const q1 = choice("q1", 0, ["Năm 1", "Năm 2"]);
const q2 = { ...choice("q2", 1, ["Shopee", "Lazada", "Tiki"]), type: "multiple_choice", maxSelections: 2 };
const q3 = choice("q3", 2, ["Ít hơn 1 lần", "1 – 3 lần"]);
const q4 = { id: "q4", order: 3, type: "linear_scale", title: "Tin tưởng", required: true, min: 1, max: 5, step: 1 };
const q5 = { id: "q5", order: 4, type: "number", title: "Chi tiêu", required: true, integerOnly: true, min: 0, max: 1000 };
const q6 = { id: "q6", order: 5, type: "textarea", title: "Góp ý", required: false, maxLength: 10 };
const q7 = { id: "q7", order: 6, type: "rating", title: "Sao", required: true, maxRating: 5, ratingShape: "STAR" };
const q8 = { id: "q8", order: 7, type: "date", title: "Ngày", required: false };
const blocks = [q8, q7, q6, q5, q4, q3, q2, q1]; // unordered on purpose

const sections = [
  { id: "s1", title: "Thông tin chung", blockIds: ["q1", "q2"] },
  { id: "s2", title: "Thói quen mua sắm", blockIds: ["q3", "q4", "q5"] },
  { id: "s3", title: "Mức độ tin tưởng", blockIds: ["q6", "q7", "q8"] },
];

test("section paging: 2 questions per page, never across sections", () => {
  const layout = form.buildSurveyLayout(blocks, sections);
  assert.equal(layout.total, 8);
  assert.deepEqual(
    layout.pages.map((page) => page.blocks.map((block) => block.id)),
    [["q1", "q2"], ["q3", "q4"], ["q5"], ["q6", "q7"], ["q8"]],
  );
  assert.deepEqual(
    layout.sections.map(({ number, title, firstPage, lastPage }) => ({ number, title, firstPage, lastPage })),
    [
      { number: 1, title: "Thông tin chung", firstPage: 0, lastPage: 0 },
      { number: 2, title: "Thói quen mua sắm", firstPage: 1, lastPage: 2 },
      { number: 3, title: "Mức độ tin tưởng", firstPage: 3, lastPage: 4 },
    ],
  );
  assert.equal(layout.numbers.q4, 4);
  // Figma 4 headers: "Câu 3 – 4 / 8", "4/8 câu", 4b "Câu 8 / 8".
  assert.equal(form.pageRangeLabel(layout.pages[1], layout.total), "Câu 3 đến 4 / 8");
  assert.equal(form.pageProgressLabel(layout.pages[1], layout.total), "4/8 câu");
  assert.equal(form.pageRangeLabel(layout.pages[4], layout.total), "Câu 8 / 8");
  assert.equal(form.firstPageWith(layout, ["q7", "q5"]), 2);
});

test("section paging: no sections → one default section; unlisted blocks are appended", () => {
  const plain = form.buildSurveyLayout(blocks, undefined);
  assert.equal(plain.sections.length, 1);
  assert.equal(plain.sections[0].title, form.DEFAULT_SECTION_TITLE);
  assert.equal(plain.pages.length, 4);

  const partial = form.buildSurveyLayout(blocks, [{ id: "a", title: "A", blockIds: ["q2", "q1", "missing"] }]);
  assert.deepEqual(partial.pages[0].blocks.map((block) => block.id), ["q1", "q2"]);
  assert.equal(partial.sections.at(-1).title, "Câu hỏi khác");
  assert.equal(partial.total, 8);
});

test("answer validation (Vietnamese copy)", () => {
  assert.equal(form.validateAnswer(q1, undefined), "Vui lòng chọn một đáp án.");
  assert.equal(form.validateAnswer(q1, "Năm 3"), "Đáp án không hợp lệ.");
  assert.equal(form.validateAnswer(q1, "Năm 2"), null);
  assert.equal(form.validateAnswer(q2, []), "Vui lòng chọn ít nhất một đáp án.");
  assert.equal(form.validateAnswer(q2, ["Shopee", "Lazada", "Tiki"]), "Chọn tối đa 2 đáp án.");
  assert.equal(form.validateAnswer(q4, 6), "Đáp án không hợp lệ.");
  assert.equal(form.validateAnswer(q4, 4), null);
  assert.equal(form.validateAnswer(q5, "abc"), "Vui lòng nhập một số.");
  assert.equal(form.validateAnswer(q5, 2.5), "Vui lòng nhập số nguyên.");
  assert.equal(form.validateAnswer(q5, 5000), "Nhập giá trị từ 0 đến 1000.");
  assert.equal(form.validateAnswer(q6, "   "), null, "optional blank text is fine");
  assert.equal(form.validateAnswer(q6, "12345678901"), "Tối đa 10 ký tự.");
  assert.equal(form.validateAnswer(q7, 0), "Đáp án không hợp lệ.");
  assert.equal(form.validateAnswer(q8, "2026-02-30"), "Ngày không hợp lệ.");
  assert.equal(form.validateAnswer(q8, "2026-02-28"), null);
  assert.deepEqual(Object.keys(form.validateBlocks([q1, q3, q6], { q1: "Năm 1" })), ["q3"]);
});

test("submit payload: form order, trimmed text, option order, empty answers dropped", () => {
  const payload = form.toSubmissionAnswers(blocks, {
    q2: ["Tiki", "Shopee"],
    q1: "Năm 1",
    q6: "  ổn  ",
    q5: 300,
    q4: 4,
    q8: "",
    stale: "old draft key",
  });
  // A record by block id (`internalFormSubmissionInputSchema`), in form order.
  assert.deepEqual(payload, { q1: "Năm 1", q2: ["Shopee", "Tiki"], q4: 4, q5: 300, q6: "ổn" });
  assert.deepEqual(Object.keys(payload), ["q1", "q2", "q4", "q5", "q6"]);
  assert.equal(form.countAnswered(blocks, { q1: "Năm 1", q2: [], q6: " " }), 1);
});

const fileQ = {
  id: "file1",
  order: 8,
  type: "file_upload",
  title: "Ảnh minh chứng",
  required: true,
  maxFileSizeMb: 5,
  allowedMimeTypes: ["image/*"],
  maxFiles: 2,
};
const attachment = (n) => ({
  objectId: `00000000-0000-4000-8000-00000000000${n}`,
  fileName: `anh-${n}.png`,
  fileSize: 1024 * n,
  mimeType: "image/png",
  status: "CLEAN",
});

test("file_upload answers: required, CLEAN attachments only, at most maxFiles (Phase 7)", () => {
  assert.equal(form.validateAnswer(fileQ, undefined), "Vui lòng tải lên ít nhất một tệp.");
  assert.equal(form.validateAnswer(fileQ, []), "Vui lòng tải lên ít nhất một tệp.");
  assert.equal(form.validateAnswer({ ...fileQ, required: false }, []), null);
  assert.equal(form.validateAnswer(fileQ, [attachment(1)]), null);
  assert.equal(form.validateAnswer(fileQ, [attachment(1), attachment(2)]), null);
  assert.equal(form.validateAnswer(fileQ, [attachment(1), attachment(2), attachment(3)]), "Chỉ được tải tối đa 2 tệp.");
  // Not finalized / not an upload: never accepted as an answer.
  assert.match(form.validateAnswer(fileQ, [{ ...attachment(1), status: "QUARANTINED" }]), /chưa hợp lệ/);
  assert.match(form.validateAnswer(fileQ, [{ name: "a.png", size: 1, type: "image/png" }]), /chưa hợp lệ/);
  assert.match(form.validateAnswer(fileQ, "a.png"), /chưa hợp lệ/);
});

test("file_upload answers go into the submit record as CLEAN attachments", async () => {
  const { internalFormSubmissionInputSchema, validateAnswersAgainstFormDefinition } = await import("@rescom/schemas");
  const payload = form.toSubmissionAnswers([q1, fileQ], {
    q1: "Năm 2",
    file1: [{ ...attachment(1), extra: "dropped" }],
  });
  assert.deepEqual(payload, { q1: "Năm 2", file1: [attachment(1)] });
  // The exact body the backend parses and validates (the array form cannot carry files).
  assert.equal(
    internalFormSubmissionInputSchema.safeParse({ attemptId: "00000000-0000-4000-8000-0000000000aa", answers: payload }).success,
    true,
  );
  assert.equal(validateAnswersAgainstFormDefinition([q1, fileQ], payload).isValid, true);
  // A stale non-attachment value is never sent.
  assert.deepEqual(form.toSubmissionAnswers([fileQ], { file1: [{ name: "x" }] }), {});
});

test("answer telemetry event types never depend on content", () => {
  assert.equal(form.answerEventType(q1, undefined, "Năm 1"), "ANSWER_SELECTED");
  assert.equal(form.answerEventType(q6, undefined, "abc"), "ANSWER_ENTERED");
  assert.equal(form.answerEventType(q1, "Năm 1", "Năm 2"), "ANSWER_CHANGED");
  assert.equal(form.answerEventType(q2, ["Tiki"], []), "ANSWER_CLEARED");
  assert.equal(form.answerEventType(q6, "", ""), null);
});

function memoryStorage() {
  const map = new Map();
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

test("draft storage: save, load, restore only known blocks, clear", () => {
  const storage = memoryStorage();
  const now = new Date("2026-09-26T07:31:00.000Z");
  const saved = draft.saveAnswerDraft(storage, { attemptId: "a-1", answers: { q1: "Năm 1", gone: 1 }, pageIndex: 2.7, now });
  assert.equal(saved.pageIndex, 2);
  assert.equal(saved.savedAt, now.toISOString());

  const soon = now.getTime() + 60_000;
  const loaded = draft.loadAnswerDraft(storage, "a-1", soon);
  assert.deepEqual(loaded.answers, { q1: "Năm 1", gone: 1 });
  assert.deepEqual(draft.restorableAnswers(loaded, ["q1", "q2"]), { q1: "Năm 1" });
  assert.equal(draft.loadAnswerDraft(storage, "a-2", soon), null, "drafts are per attempt");

  draft.clearAnswerDraft(storage, "a-1");
  assert.equal(draft.loadAnswerDraft(storage, "a-1", soon), null);
});

test("draft storage: corrupt or foreign data is discarded; storage failures are no-ops", () => {
  const storage = memoryStorage();
  storage.setItem(draft.draftKey("a-1"), "{not json");
  assert.equal(draft.loadAnswerDraft(storage, "a-1"), null);
  assert.equal(storage.map.size, 0, "corrupt draft removed");

  storage.setItem(draft.draftKey("a-1"), JSON.stringify({ version: 1, attemptId: "other", answers: {}, pageIndex: 0, savedAt: "x" }));
  assert.equal(draft.loadAnswerDraft(storage, "a-1"), null);

  const broken = {
    getItem() {
      throw new Error("denied");
    },
    setItem() {
      throw new Error("quota");
    },
    removeItem() {
      throw new Error("denied");
    },
  };
  assert.equal(draft.saveAnswerDraft(broken, { attemptId: "a", answers: {}, pageIndex: 0 }), null);
  assert.equal(draft.loadAnswerDraft(broken, "a"), null);
  assert.doesNotThrow(() => draft.clearAnswerDraft(broken, "a"));
  assert.equal(draft.loadAnswerDraft(null, "a"), null);
});

test("completion view: outcome, then stashed submission, then the attempt", () => {
  const internal = { type: "INTERNAL", submittedAt: "2026-09-26T07:32:00.000Z", survey: { rewardPerResponse: 12 } };
  const external = { ...internal, type: "EXTERNAL", survey: { rewardPerResponse: 18 } };
  const outcomeOf = (state, amount, activated = false) => ({
    reward: { state, amount },
    starterUnlock: { activatedByThisAttempt: activated },
    submittedAt: null,
  });

  assert.deepEqual(completion.resolveCompletionView(internal, null, null), {
    kind: "available",
    amount: 12,
    activated: false,
    submittedAt: internal.submittedAt,
  });
  assert.equal(completion.resolveCompletionView(external, null, null).kind, "pending");
  assert.equal(
    completion.resolveCompletionView(internal, null, { reward: { status: "HELD_IN_INTEGRITY", amount: 12 }, submittedAt: "x" }).kind,
    "held",
  );
  const view = completion.resolveCompletionView(internal, outcomeOf("AVAILABLE", 12, true), {
    reward: { status: "HELD_IN_INTEGRITY", amount: 12 },
    submittedAt: "s",
  });
  assert.equal(view.kind, "available", "the outcome route wins over the stash");
  assert.equal(view.activated, true);
  assert.equal(view.submittedAt, "s");

  // Every reward.state of GET /attempts/:id/outcome (owner decision Q2: the edge states fall back by
  // type, except NO_REWARD / REVERSED, which never claim "+N điểm").
  const kinds = Object.fromEntries(
    ["AVAILABLE", "PENDING", "HELD_IN_INTEGRITY", "HELD_IN_DISPUTE", "REVERSED", "AWAITING_SETTLEMENT", "NO_REWARD", "NOT_COMPLETED"].map(
      (state) => [
        state,
        [
          completion.resolveCompletionView(internal, outcomeOf(state, 0), null).kind,
          completion.resolveCompletionView(external, outcomeOf(state, 0), null).kind,
        ],
      ],
    ),
  );
  assert.deepEqual(kinds, {
    AVAILABLE: ["available", "available"],
    PENDING: ["pending", "pending"],
    HELD_IN_INTEGRITY: ["held", "held"],
    HELD_IN_DISPUTE: ["held", "held"],
    REVERSED: ["reversed", "reversed"],
    AWAITING_SETTLEMENT: ["available", "pending"],
    NO_REWARD: ["no-reward", "no-reward"],
    NOT_COMPLETED: ["available", "pending"],
  });
  // The credited amount wins over the advertised one; a pending or held reward activates nothing.
  assert.equal(completion.resolveCompletionView(external, outcomeOf("PENDING", 15), null).amount, 15);
  assert.equal(completion.resolveCompletionView(external, outcomeOf("AWAITING_SETTLEMENT", 0), null).amount, 18);
  assert.equal(completion.resolveCompletionView(internal, outcomeOf("HELD_IN_INTEGRITY", 12, true), null).activated, false);
  // A reversed or missing reward activates nothing, whatever the stash said.
  const settled = { reward: { status: "SETTLED", amount: 12 }, submittedAt: "s" };
  for (const state of ["REVERSED", "NO_REWARD"]) {
    const neutral = completion.resolveCompletionView(internal, outcomeOf(state, 12, true), settled);
    assert.equal(neutral.kind, state === "REVERSED" ? "reversed" : "no-reward", state);
    assert.equal(neutral.activated, false, state);
  }

  assert.equal(completion.formatShortDateTime("2026-09-26T07:32:00.000Z"), "26/09 14:32");
  assert.equal(completion.formatClock("2026-09-26T07:31:00.000Z"), "14:31");
});

test("consent: only a missing response is tolerated; HTTP errors are shown", () => {
  const network = new ApiError({ kind: "network", message: "offline" });
  const notFound = new ApiError({ kind: "http", status: 404, code: "NOT_FOUND", message: "x" });
  const outdated = new ApiError({ kind: "http", status: 409, code: "INTEGRITY_CONSENT_VERSION_MISMATCH", message: "x" });
  assert.equal(consent.isConsentUnreachable(network), true);
  assert.equal(consent.isConsentUnreachable(notFound), false, "a 404 is no longer a missing route");
  assert.equal(consent.isConsentUnreachable(outdated), false);
  assert.equal(consent.isConsentNoticeOutdated(outdated), true);
  assert.equal(consent.isConsentNoticeOutdated(notFound), false);

  assert.equal(consent.hasAcceptedCurrentNotice({ currentVersion: 2, acceptedVersion: 1, acceptedAt: "2026-10-01T08:00:00.000Z" }), false);
  assert.equal(consent.hasAcceptedCurrentNotice({ currentVersion: 1, acceptedVersion: 1, acceptedAt: "2026-10-01T08:00:00.000Z" }), true);
  assert.equal(consent.hasAcceptedCurrentNotice(null), false);
  assert.equal(consent.FALLBACK_NOTICE_VERSION, 1);
});

test("attempt load errors: a 404 is the attempt, never the public form route", () => {
  assert.equal(
    messages.loadAttemptErrorMessage(new ApiError({ kind: "http", status: 404, code: "ATTEMPT_NOT_FOUND", message: "x" })),
    "Không tìm thấy lượt làm khảo sát này.",
  );
  assert.equal(
    messages.loadAttemptErrorMessage(new ApiError({ kind: "http", status: 403, code: "PUBLIC_ACCESS_DISABLED", message: "x" })),
    "Không tải được khảo sát. Vui lòng thử lại.",
  );
});

test("submit error helpers", () => {
  const tooFast = new ApiError({
    kind: "http",
    status: 422,
    code: "SUBMISSION_TOO_FAST",
    message: "too fast",
    details: {
      requiredSeconds: 20,
      elapsedSeconds: 12,
      remainingSeconds: 8,
      retryAfterSeconds: 8,
      earliestSubmitAt: "2026-09-26T07:32:00.000Z",
      questionCount: 8,
      secondsPerQuestion: 2,
      publisherMinimumSeconds: 20,
      policyVersion: "time-barrier-v1",
    },
  });
  assert.equal(messages.timeBarrierRemainingSeconds(tooFast), 8);
  assert.equal(messages.timeBarrierRemainingSeconds(new Error("x")), null);

  const invalid = new ApiError({ kind: "http", status: 400, code: "INVALID_FORM_SUBMISSION", message: "", details: { q3: "required" } });
  assert.deepEqual(messages.invalidBlockIds(invalid), ["q3"]);
  assert.match(messages.submitSurveyErrorMessage(invalid), /chưa hợp lệ/);

  const offline = new ApiError({ kind: "network", message: "Network request failed" });
  assert.equal(messages.isOfflineFailure(offline), true);
  assert.equal(messages.isAttemptExpiredError(new ApiError({ kind: "http", status: 409, code: "ATTEMPT_EXPIRED", message: "" })), true);
  assert.equal(
    messages.submitSurveyErrorMessage(new ApiError({ kind: "http", status: 429, code: "PARTICIPATION_RATE_LIMITED", message: "", retryAfterSeconds: 30 })),
    "Bạn thao tác quá nhanh. Vui lòng thử lại sau 30 giây.",
  );
});
