import test from "node:test";
import assert from "node:assert/strict";

const view = await import("../lib/admin/quality-view.ts");
const service = await import("../lib/admin/quality-service.ts");
const messages = await import("../lib/admin/quality-messages.ts");
const rules = await import("../mocks/data/economy-rules.ts");
const history = await import("../lib/wallet/wallet-history.ts");
const { ApiError } = await import("../lib/api/api-error.ts");

/** Figma 17b "#9A2E" (63:3344). */
const review = {
  responseId: "a9a2e000-17b0-4e5f-9c1d-000000009a2e",
  attemptId: "a9a2e000-17b0-4e5f-9c1d-10000000a9a2",
  reference: "9A2E",
  surveyId: "5a0c1f7e-2b4d-4c6a-8e1f-0a1b2c3d4e01",
  surveyTitle: "Hành vi mua sắm online của sinh viên Đà Nẵng",
  formVersionNumber: 1,
  submittedAt: "2026-09-26T08:02:00.000Z",
  heldPoints: 12,
  reviewDeadline: null,
  qualityScore: 34,
  confidence: "MEDIUM",
  coverage: 0.8,
  policyVersion: "integrity-v1",
  reasons: [
    { code: "FAST_COMPLETION", params: { durationSeconds: 100, expectedSeconds: 300 } },
    { code: "ATTENTION_CHECK_FAILED", params: { questionNumber: 6 } },
    { code: "STRAIGHT_LINING", params: { scaleCount: 6 } },
  ],
  respondent: { reliabilityLevel: "FORMING", priorAssessed: 3, priorPassed: 3 },
  surveyQuality: { version: 1, status: "INSUFFICIENT_DATA" },
  answers: [{ question: "Bạn đang là sinh viên năm mấy?", answer: "Năm 1" }],
};

test("admin quality view (Figma 17b)", async (t) => {
  await t.test("header meta: count, earliest deadline when governance sets one", () => {
    assert.equal(view.qualityQueueMeta([review, review, review]), "3 câu trả lời cần xem");
    assert.equal(
      view.qualityQueueMeta([
        { reviewDeadline: "2026-09-28T08:02:00.000Z" },
        { reviewDeadline: "2026-09-27T15:00:00.000Z" },
        { reviewDeadline: null },
      ]),
      "3 câu trả lời cần xem · hạn xem xét 27/09 22:00",
    );
    assert.equal(view.qualityQueueMeta([]), "Không còn câu trả lời cần xem");
  });

  await t.test("reason codes read like Figma", () => {
    assert.deepEqual(review.reasons.map(view.reasonText), [
      "Làm xong trong 1 phút 40 giây, khảo sát dự kiến 5 phút",
      "Trả lời sai câu kiểm tra chú ý (câu 6)",
      "Chọn cùng một mức cho cả 6 câu thang đo",
    ]);
    assert.equal(view.reasonText({ code: "FAST_COMPLETION", params: {} }), "Làm xong nhanh hơn nhiều so với thời gian dự kiến");
    assert.equal(
      view.reasonText({ code: "ANSWER_INCONSISTENCY", params: { firstQuestion: 2, secondQuestion: 7 } }),
      "Hai câu trả lời mâu thuẫn nhau (câu 2 và câu 7)",
    );
    assert.equal(view.reasonText({ code: "NEW_SIGNAL", params: {} }), "Tín hiệu chất lượng cần Admin xem");
  });

  await t.test("metrics and context lines", () => {
    assert.equal(view.confidenceLabel("MEDIUM"), "Trung bình");
    assert.equal(view.coverageText(0.8), "80%");
    assert.equal(view.respondentContextText(review.respondent), "Đang hình thành độ tin cậy · 3 câu trả lời trước đều Đạt");
    assert.equal(
      view.respondentContextText({ reliabilityLevel: "GOOD", priorAssessed: 8, priorPassed: 7 }),
      "Độ tin cậy tốt · 7/8 câu trả lời trước Đạt",
    );
    assert.equal(
      view.respondentContextText({ reliabilityLevel: "FORMING", priorAssessed: 0, priorPassed: 0 }),
      "Đang hình thành độ tin cậy · chưa có câu trả lời trước",
    );
    assert.equal(view.surveyQualityText(review.surveyQuality), "Chất lượng v1: chưa đủ dữ liệu");
    assert.equal(view.surveyQualityText({ version: 2, status: "READY" }), "Chất lượng v2: đủ dữ liệu");
  });

  await t.test("decision options name the held points", () => {
    assert.deepEqual(
      view.decisionOptionsFor(12).map((option) => [option.value, option.label, option.description]),
      [
        ["ACCEPT", "Chấp nhận", "Giải phóng 12 điểm vào Khả dụng"],
        ["INSUFFICIENT_EVIDENCE", "Chưa đủ căn cứ", "Giải phóng 12 điểm, ghi nhận để hiệu chỉnh"],
        ["REJECT", "Từ chối", "Cần ghi lý do · đảo giao dịch giữ điểm"],
      ],
    );
  });

  await t.test("validation: a decision is required, a rejection needs a reason", () => {
    assert.deepEqual(view.validateDecision(null, ""), { decision: "Chọn một quyết định." });
    assert.deepEqual(view.validateDecision("ACCEPT", ""), {});
    assert.deepEqual(view.validateDecision("REJECT", "   "), { note: "Nhập lý do từ chối để người trả lời hiểu." });
    assert.deepEqual(view.validateDecision("REJECT", "Trả lời cho có"), {});
    assert.match(view.validateDecision("ACCEPT", "x".repeat(501)).note, /tối đa 500/);
  });

  await t.test("after a decision the next answer opens, else the previous one", () => {
    const items = [{ responseId: "a" }, { responseId: "b" }, { responseId: "c" }];
    assert.equal(view.nextReviewId(items, "a"), "b");
    assert.equal(view.nextReviewId(items, "b"), "c");
    assert.equal(view.nextReviewId(items, "c"), "b");
    assert.equal(view.nextReviewId([{ responseId: "a" }], "a"), null);
    assert.equal(view.nextReviewId(items, "missing"), "a");
  });

  await t.test("saved confirmation", () => {
    assert.equal(
      view.decisionSavedText("9A2E", "INSUFFICIENT_EVIDENCE", 12),
      "Đã lưu quyết định cho #9A2E: 12 điểm vào Khả dụng của người trả lời.",
    );
    assert.equal(view.decisionSavedText("9A2E", "REJECT", 12), "Đã từ chối câu trả lời #9A2E và đảo 12 điểm đang giữ.");
  });
});

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

test("admin quality service (ASSUMED routes)", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const calls = [];
  function installFetch(handler) {
    calls.length = 0;
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url) === "/api/auth/csrf") return jsonResponse(200, { data: { csrfToken: "csrf-token" } });
      return handler(String(url), init);
    };
  }

  await t.test("lists the open reviews", async () => {
    installFetch(() => jsonResponse(200, { data: { items: [review], total: 1 }, error: null, meta: {} }));
    const list = await service.listQualityReviews();
    assert.equal(calls[0].url, "/api/admin/quality-reviews");
    assert.equal(list.items[0].reference, "9A2E");
  });

  await t.test("posts a decision with CSRF", async () => {
    const result = {
      responseId: review.responseId,
      decision: "REJECT",
      outcome: "REVERSED",
      points: 12,
      decidedAt: "2026-09-26T09:00:00.000Z",
    };
    installFetch(() => jsonResponse(200, { data: result, error: null, meta: {} }));
    const saved = await service.decideQualityReview(review.responseId, { decision: "REJECT", note: "Trả lời cho có" });
    const post = calls.find((call) => call.url.endsWith("/decision"));
    assert.equal(post.url, `/api/admin/quality-reviews/${review.responseId}/decision`);
    assert.equal(post.init.method, "POST");
    assert.equal(new Headers(post.init.headers).get("X-CSRF-Token"), "csrf-token");
    assert.deepEqual(JSON.parse(post.init.body), { decision: "REJECT", note: "Trả lời cho có" });
    assert.equal(saved.outcome, "REVERSED");
  });

  await t.test("command schema: a rejection needs a reason; notes are trimmed", () => {
    assert.equal(service.qualityDecisionCommandSchema.safeParse({ decision: "REJECT", note: "  " }).success, false);
    assert.equal(service.qualityDecisionCommandSchema.safeParse({ decision: "ACCEPT", note: "" }).success, true);
    assert.equal(service.qualityDecisionCommandSchema.safeParse({ decision: "ACCEPT", note: "", extra: 1 }).success, false);
    assert.equal(service.qualityDecisionCommandSchema.parse({ decision: "REJECT", note: " lý do " }).note, "lý do");
  });

  await t.test("error copy and stale detection", () => {
    const decided = new ApiError({ kind: "http", status: 409, code: "QUALITY_REVIEW_ALREADY_DECIDED", message: "x" });
    assert.match(messages.qualityDecisionErrorMessage(decided), /Admin khác/);
    assert.equal(messages.isStaleReviewError(decided), true);
    assert.equal(messages.isStaleReviewError(new ApiError({ kind: "network", message: "x" })), false);
    assert.match(messages.qualityDecisionErrorMessage(new ApiError({ kind: "network", message: "x" })), /Không kết nối/);
    assert.match(messages.qualityLoadErrorMessage(new Error("x")), /Không tải được/);
  });
});

test("economy mock: admin decision on a held reward (settleHeldReward)", async (t) => {
  const USER = "11111111-1111-4111-8111-111111111111";
  const ATTEMPT = "22222222-2222-4222-8222-222222222222";
  let counter = 0;
  const ctx = {
    now: Date.parse("2026-09-26T09:00:00.000Z"),
    newId: () => `00000000-0000-4000-8000-${(counter += 1).toString(16).padStart(12, "0")}`,
  };
  function heldState() {
    return {
      wallet: { available: 0, pending: 0, escrow: 0, frozen: 100, integrityHold: 12 },
      rows: [
        {
          id: "00000000-0000-4000-8000-0000000000a1",
          kind: "SURVEY_REWARD",
          amount: 12,
          status: "HELD",
          note: "Hành vi mua sắm online của sinh viên Đà Nẵng",
          surveyId: null,
          attemptId: ATTEMPT,
          createdAt: "2026-09-26T08:02:00.000Z",
          releasesAt: null,
        },
        {
          id: "00000000-0000-4000-8000-0000000000a0",
          kind: "STARTER_GRANT",
          amount: 100,
          status: "FROZEN",
          note: "Tài khoản mới",
          surveyId: null,
          attemptId: null,
          createdAt: "2026-09-23T08:00:00.000Z",
          releasesAt: null,
        },
      ],
    };
  }

  await t.test("RELEASE: Đang giữ → Khả dụng, unlocks the starter points, keeps the hold credit in the ledger", () => {
    const state = heldState();
    const result = rules.settleHeldReward(state, ctx, { attemptId: ATTEMPT, outcome: "RELEASE" });
    assert.deepEqual(result, { amount: 12, activated: true });
    assert.deepEqual(state.wallet, { available: 112, pending: 0, escrow: 0, frozen: 0, integrityHold: 0 });

    const items = rules.ledgerItemsFromRows(USER, state.rows);
    const keys = items.map((item) => [item.idempotencyKey.split(":")[0], item.accountClass, item.amount]);
    assert.deepEqual(keys, [
      ["starter-unlock", "FROZEN", -100],
      ["starter-unlock", "USER_AVAILABLE", 100],
      ["integrity-decision", "INTEGRITY_HOLD", -12],
      ["integrity-decision", "USER_AVAILABLE", 12],
      ["integrity-hold", "INTEGRITY_HOLD", 12],
      ["starter-grant", "FROZEN", 100],
    ]);
    // Ledger entries sum to the wallet balance per bucket.
    const hold = items.filter((item) => item.accountClass === "INTEGRITY_HOLD").reduce((sum, item) => sum + item.amount, 0);
    assert.equal(hold, 0);
    const rows = history.toHistoryRows(items);
    assert.equal(rows.find((row) => row.kind === "REWARD_RELEASE")?.direction, "in");
  });

  await t.test("REVERSE: the hold is reversed (reversal journal) and nothing unlocks", () => {
    const state = heldState();
    const result = rules.settleHeldReward(state, ctx, { attemptId: ATTEMPT, outcome: "REVERSE" });
    assert.deepEqual(result, { amount: 12, activated: false });
    assert.deepEqual(state.wallet, { available: 0, pending: 0, escrow: 0, frozen: 100, integrityHold: 0 });
    assert.equal(state.rows.find((row) => row.kind === "SURVEY_REWARD").status, "REVERSED");

    const items = rules.ledgerItemsFromRows(USER, state.rows);
    const reversal = items.find((item) => item.idempotencyKey.startsWith("reversal:"));
    assert.equal(reversal.idempotencyKey, "reversal:00000000-0000-4000-8000-0000000000a1");
    assert.equal(reversal.reversesJournalId, "00000000-0000-4000-8000-0000000000a1");
    assert.deepEqual([reversal.accountClass, reversal.amount], ["INTEGRITY_HOLD", -12]);
    const held = items.find((item) => item.journalId === "00000000-0000-4000-8000-0000000000a1");
    assert.equal(held.idempotencyKey, `integrity-hold:${ATTEMPT}`);
    assert.equal(history.toHistoryRows(items).find((row) => row.kind === "REVERSAL")?.direction, "out");
  });

  await t.test("nothing held: no change", () => {
    const state = heldState();
    state.rows[0].status = "AVAILABLE";
    assert.equal(rules.settleHeldReward(state, ctx, { attemptId: ATTEMPT, outcome: "RELEASE" }), null);
    assert.equal(state.wallet.integrityHold, 12);
  });
});
