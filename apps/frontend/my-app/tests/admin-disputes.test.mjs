import test from "node:test";
import assert from "node:assert/strict";

const view = await import("../lib/admin/disputes-view.ts");
const service = await import("../lib/admin/disputes-service.ts");
const messages = await import("../lib/admin/disputes-messages.ts");
const { ApiError } = await import("../lib/api/api-error.ts");
const rules = await import("../mocks/data/economy-rules.ts");
const disputeRules = await import("../mocks/data/dispute-rules.ts");
const history = await import("../lib/wallet/wallet-history.ts");
const { walletTransactionSchema } = await import("../lib/wallet/wallet-service.ts");

const NOW = Date.parse("2026-09-27T01:00:00Z");
const HOUR = 3_600_000;
const verifiedAt = new Date(NOW - 17 * HOUR).toISOString();

/** Figma 11c #7F3A. */
function dispute(overrides = {}) {
  return {
    id: "9e3c1a70-1d2b-4c3d-8e4f-0a1b2c3d6a01",
    kind: "ATTEMPT_DISPUTE",
    status: "OPEN",
    createdAt: new Date(NOW - 14 * HOUR).toISOString(),
    reporter: { role: "PUBLISHER", name: "Linh N." },
    survey: {
      id: "7c2e3f40-5a6b-4c7d-8e9f-0a1b2c3d4f02",
      title: "Thói quen đọc sách của sinh viên",
      type: "EXTERNAL",
      rewardPerResponse: 10,
    },
    attempt: {
      id: "8d1e4b20-7f3a-4c1d-9e2f-0a1b2c3d5a01",
      formVersionId: "6b1d2e3f-4a5b-4c6d-9e7f-0000000000f2",
      status: "COMPLETED",
      startedAt: new Date(Date.parse(verifiedAt) - 185_000).toISOString(),
      codeVerifiedAt: verifiedAt,
      declaredEffortSeconds: 480,
      wrongCodeCount: 0,
    },
    respondent: {
      id: "3f7a0c1d-2e3f-4a5b-8c6d-7e8f9a0b7f3a",
      code: "#7F3A",
      joinedAt: "2026-09-20T09:00:00+07:00",
      attemptCount: 14,
      fraudLogCount: 5,
      repeatOffender: true,
      recentFraudLogs: [
        { id: "a", type: "TIME_BARRIER", createdAt: "2026-09-25T21:14:00+07:00" },
        { id: "b", type: "SECURITY_VIOLATION", createdAt: "2026-09-24T10:02:00+07:00" },
        { id: "c", type: "RATE_LIMIT", createdAt: "2026-09-23T22:40:00+07:00" },
      ],
    },
    amount: 10,
    reviewEndsAt: new Date(Date.parse(verifiedAt) + 48 * HOUR).toISOString(),
    reason: "LOW_EFFORT",
    description: "Câu trả lời chọn cùng một đáp án cho tất cả 20 câu.",
    evidence: [
      { id: "e1", url: null },
      { id: "e2", url: null },
    ],
    resolution: null,
    ...overrides,
  };
}

test("the Figma case parses with the service schema", () => {
  const parsed = service.disputeCaseListSchema.safeParse({
    items: [dispute()],
    counts: { ATTEMPT_DISPUTE: 1, MISSING_CODE: 1, LOCKED_ATTEMPT: 0 },
  });
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.format()));
  // Dispute outcomes are the backend dispute-hold enum.
  assert.deepEqual(service.DISPUTE_CASE_OUTCOMES.slice(0, 2), ["RELEASE_TO_RESPONDENT", "REFUND_TO_PUBLISHER"]);
});

test("Figma 11c header, title and pill copy", () => {
  const item = dispute();
  assert.equal(view.urgencyLabel(item, NOW), "Điểm còn chờ 31 giờ · xử lý trước khi tự chuyển");
  assert.equal(view.caseTitle(item), "Linh N. khiếu nại lượt làm của người dùng #7F3A");
  assert.equal(view.caseSubtitle(item), "Khảo sát: Thói quen đọc sách của sinh viên · Google Forms · 10 điểm");
  assert.equal(view.respondentSummary(item.respondent), "Tham gia 20/09 · 14 lượt làm · 5 mục FraudLog trong 14 ngày");
  assert.equal(view.hiddenFraudLogCount(item.respondent), 2);
  assert.equal(view.FRAUD_LOG_LABELS.SECURITY_VIOLATION, "Sai mã hoàn thành");
  assert.equal(view.urgencyLabel(dispute({ reviewEndsAt: new Date(NOW - HOUR).toISOString() }), NOW).startsWith("Đã quá 48 giờ"), true);
});

test("timeline: start, code verified after 3 phút 05 giây (khai 8 phút), pending credit", () => {
  const rows = view.timelineOf(dispute());
  assert.equal(rows.length, 3);
  assert.equal(rows[0].segments[0].text, "Bắt đầu lượt làm, mở Google Form");
  assert.deepEqual(
    rows[1].segments.map((segment) => segment.text),
    ["Nhập đúng mã hoàn thành · ", "3 phút 05 giây", " (khai 8 phút)"],
  );
  assert.equal(rows[1].segments[1].strong, true);
  assert.equal(rows[2].segments[0].text, "10 điểm vào mục Chờ 48 giờ");
  assert.match(rows[0].time, /^\d{2}:\d{2}:\d{2}$/);
  assert.equal(view.formatClock("2026-09-27T08:07:05Z"), "15:07:05");
});

test("formatDuration and hoursLeft", () => {
  assert.equal(view.formatDuration(185), "3 phút 05 giây");
  assert.equal(view.formatDuration(45), "45 giây");
  assert.equal(view.formatDuration(3720), "1 giờ 02 phút");
  assert.equal(view.hoursLeft(new Date(NOW + 30.2 * HOUR).toISOString(), NOW), 31);
  assert.equal(view.hoursLeft(new Date(NOW - HOUR).toISOString(), NOW), 0);
  assert.equal(view.hoursLeft(null, NOW), 0);
});

test("actions: dispute buttons mirror the dispute-hold outcomes", () => {
  const actions = view.actionsOf(dispute());
  assert.deepEqual(
    actions.map((action) => [action.outcome, action.label, action.primary]),
    [
      ["RELEASE_TO_RESPONDENT", "Bác bỏ khiếu nại", false],
      ["REFUND_TO_PUBLISHER", "Chấp nhận · hoàn 10 điểm cho người đăng", true],
    ],
  );
  const missing = dispute({ kind: "MISSING_CODE", reviewEndsAt: null, amount: 18, attempt: { ...dispute().attempt, wrongCodeCount: 1 } });
  assert.deepEqual(
    view.actionsOf(missing).map((action) => action.outcome),
    ["DISMISSED", "CODE_LIMIT_RESET", "CREDIT_RESPONDENT"],
  );
  // No wrong code counted: nothing to reset.
  assert.deepEqual(
    view.actionsOf({ ...missing, attempt: { ...missing.attempt, wrongCodeCount: 0 } }).map((action) => action.outcome),
    ["DISMISSED", "CREDIT_RESPONDENT"],
  );
  const locked = view.actionsOf(dispute({ kind: "LOCKED_ATTEMPT" }));
  assert.deepEqual(locked.map((action) => [action.outcome, action.primary]), [["DISMISSED", false], ["CODE_LIMIT_RESET", true]]);
});

test("tabs: default tab, filtering and urgency order", () => {
  assert.equal(view.defaultTab({ ATTEMPT_DISPUTE: 0, MISSING_CODE: 1, LOCKED_ATTEMPT: 0 }), "MISSING_CODE");
  assert.equal(view.defaultTab({ ATTEMPT_DISPUTE: 0, MISSING_CODE: 0, LOCKED_ATTEMPT: 0 }), "ATTEMPT_DISPUTE");
  assert.equal(view.defaultTab(undefined), "ATTEMPT_DISPUTE");
  const later = dispute({ id: "later", reviewEndsAt: new Date(NOW + 40 * HOUR).toISOString() });
  const sooner = dispute({ id: "sooner", reviewEndsAt: new Date(NOW + 5 * HOUR).toISOString() });
  const closed = dispute({ id: "closed", status: "RESOLVED" });
  const other = dispute({ id: "other", kind: "LOCKED_ATTEMPT" });
  assert.deepEqual(
    view.casesOfKind([later, closed, other, sooner], "ATTEMPT_DISPUTE").map((item) => item.id),
    ["sooner", "later"],
  );
  assert.equal(view.queueChipLabel(sooner, NOW), "#7F3A · còn 5 giờ");
});

test("decision note is required (sent to both parties)", () => {
  assert.match(view.validateDecisionNote("   ngắn  "), /ít nhất 10 ký tự/);
  assert.equal(view.validateDecisionNote("Câu trả lời không hợp lệ."), null);
  assert.match(view.validateDecisionNote("x".repeat(1001)), /tối đa 1000/);
});

test("error copy", () => {
  const conflict = new ApiError({ kind: "http", status: 409, code: "DISPUTE_CASE_ALREADY_RESOLVED", message: "x" });
  assert.match(messages.disputeResolveErrorMessage(conflict), /Admin khác/);
  assert.equal(messages.isStaleCaseError(conflict), true);
  const network = new ApiError({ kind: "network", message: "x" });
  assert.match(messages.disputeListErrorMessage(network), /Không kết nối/);
  assert.equal(messages.isStaleCaseError(network), false);
});

test("mock ledger: dispute resolutions map to the backend journal keys and wallet rows", () => {
  const row = (overrides) => ({
    id: "11111111-1111-4111-8111-111111111110",
    note: "Thói quen đọc sách của sinh viên",
    surveyId: "s",
    attemptId: "a",
    createdAt: "2026-09-27T01:00:00.000Z",
    releasesAt: null,
    kind: "DISPUTE_RESOLUTION",
    ...overrides,
  });
  const publisher = rules.ledgerItemsFromRows("u", [
    row({ amount: 10, status: "AVAILABLE", dispute: { caseId: "case-1", action: "refund" } }),
  ]);
  // Backend `resolveDisputeHold` refund: the publisher's side is USER_AVAILABLE +N (not Ký quỹ).
  assert.deepEqual(
    publisher.map((item) => [item.idempotencyKey, item.accountClass, item.amount, item.surveyTitle]),
    [["dispute-resolution:case-1:refund", "USER_AVAILABLE", 10, "Thói quen đọc sách của sinh viên"]],
  );
  const released = rules.ledgerItemsFromRows("u", [
    row({ amount: 10, status: "AVAILABLE", dispute: { caseId: "case-2", action: "release" } }),
  ]);
  assert.deepEqual(
    released.map((item) => [item.idempotencyKey, item.accountClass, item.amount]),
    [
      ["dispute-resolution:case-2:release", "INTEGRITY_HOLD", -10],
      ["dispute-resolution:case-2:release", "USER_AVAILABLE", 10],
    ],
  );
  const reversed = rules.ledgerItemsFromRows("u", [
    row({ amount: -10, status: "REVERSED", dispute: { caseId: "case-3", action: "refund" } }),
  ]);
  assert.deepEqual(reversed.map((item) => [item.accountClass, item.amount]), [["INTEGRITY_HOLD", -10]]);
  for (const item of [...publisher, ...released, ...reversed]) {
    assert.equal(walletTransactionSchema.safeParse(item).success, true, item.idempotencyKey);
  }

  // Wallet history titles (lib/wallet/wallet-history.ts).
  const titles = [publisher, released, reversed].map((items) => {
    const [first] = history.toHistoryRows(items, new Date(NOW));
    return [first.title, first.amount, first.direction];
  });
  assert.deepEqual(titles, [
    ["Hoàn điểm khiếu nại", 10, "in"],
    ["Trả điểm sau khiếu nại", 10, "in"],
    ["Thu hồi sau khiếu nại", -10, "out"],
  ]);
});

test("missing-code credit: refused once the attempt is completed or rewarded, the survey closed/full or the escrow short", () => {
  const check = (overrides = {}) => ({
    amount: 10,
    attemptStatus: "IN_PROGRESS",
    alreadyRewarded: false,
    survey: { closed: false, completedCompletions: 6, expectedCompletions: 10 },
    escrow: { form: 40, wallet: 40 },
    ...overrides,
  });
  const codeOf = (overrides) => disputeRules.creditRespondentRefusal(check(overrides))?.code ?? null;
  assert.equal(codeOf({}), null);
  assert.equal(codeOf({ attemptStatus: "LOCKED" }), null);
  // Figma sample surveys: nothing tracked, nothing to refuse.
  assert.equal(codeOf({ survey: null, escrow: null }), null);
  assert.equal(codeOf({ escrow: { form: 40, wallet: null } }), null);
  assert.equal(codeOf({ attemptStatus: "COMPLETED" }), "DISPUTE_ATTEMPT_ALREADY_REWARDED");
  assert.equal(codeOf({ alreadyRewarded: true }), "DISPUTE_ATTEMPT_ALREADY_REWARDED");
  assert.equal(codeOf({ survey: { closed: true, completedCompletions: 6, expectedCompletions: 10 } }), "DISPUTE_SURVEY_CLOSED");
  assert.equal(codeOf({ survey: { closed: false, completedCompletions: 10, expectedCompletions: 10 } }), "DISPUTE_SURVEY_CLOSED");
  assert.equal(codeOf({ escrow: { form: 9, wallet: 40 } }), "INSUFFICIENT_BALANCE");
  assert.equal(codeOf({ escrow: { form: 40, wallet: 9 } }), "INSUFFICIENT_BALANCE");
  assert.equal(disputeRules.creditRespondentRefusal(check({ alreadyRewarded: true })).status, 409);

  const error = (code) => new ApiError({ kind: "http", status: 409, code, message: "x" });
  assert.match(messages.disputeResolveErrorMessage(error("DISPUTE_ATTEMPT_ALREADY_REWARDED")), /đã được cộng điểm/);
  assert.equal(messages.isStaleCaseError(error("DISPUTE_ATTEMPT_ALREADY_REWARDED")), true);
  assert.match(messages.disputeResolveErrorMessage(error("DISPUTE_SURVEY_CLOSED")), /đủ mẫu/);
  assert.match(messages.disputeResolveErrorMessage(error("INSUFFICIENT_BALANCE")), /ký quỹ/);
});

test("missing-code credit: a second credit is refused and the escrow is debited once", () => {
  let tick = 0;
  const ctx = { now: NOW, newId: () => `22222222-2222-4222-8222-2222222222${String(tick++).padStart(2, "0")}` };
  const attemptId = "8d1e4b20-2c9d-4c1d-9e2f-0a1b2c3d5a03";
  const reward = { amount: 10, surveyId: "7c2e3f40-5a6b-4c7d-8e9f-0a1b2c3d4f02", attemptId, title: "Thói quen đọc sách của sinh viên" };
  const publisher = { wallet: { available: 0, pending: 0, escrow: 40, frozen: 0, integrityHold: 0 }, rows: [] };
  const respondent = { wallet: { available: 0, pending: 0, escrow: 0, frozen: 0, integrityHold: 0 }, rows: [] };
  const form = { escrowLocked: 40, completedCompletions: 6, expectedCompletions: 10 };
  let attemptStatus = "IN_PROGRESS";

  // What `resolveMockDisputeCase` does for CREDIT_RESPONDENT, on plain state.
  const credit = () => {
    const refusal = disputeRules.creditRespondentRefusal({
      amount: reward.amount,
      attemptStatus,
      alreadyRewarded: respondent.rows.some((row) => row.kind === "SURVEY_REWARD" && row.attemptId === attemptId),
      survey: { closed: false, completedCompletions: form.completedCompletions, expectedCompletions: form.expectedCompletions },
      escrow: { form: form.escrowLocked, wallet: publisher.wallet.escrow },
    });
    if (refusal) return refusal.code;
    rules.payRewardFromEscrow(publisher, ctx, reward);
    form.escrowLocked -= reward.amount;
    form.completedCompletions += 1;
    attemptStatus = "COMPLETED";
    rules.creditReward(respondent, ctx, { ...reward, pending: false });
    return "CREDITED";
  };

  assert.equal(credit(), "CREDITED");
  assert.equal(credit(), "DISPUTE_ATTEMPT_ALREADY_REWARDED");
  // Even if the attempt status lagged, the reward row alone refuses a second credit.
  attemptStatus = "IN_PROGRESS";
  assert.equal(credit(), "DISPUTE_ATTEMPT_ALREADY_REWARDED");
  assert.equal(publisher.wallet.escrow, 30);
  assert.equal(form.escrowLocked, 30);
  assert.equal(form.completedCompletions, 7);
  assert.equal(respondent.wallet.available, 10);
  assert.equal(publisher.rows.filter((row) => row.kind === "SURVEY_PAYOUT").length, 1);

  // The respondent verified the code after reporting (Google Forms, 48h Chờ duyệt): no admin credit on top.
  const verified = { wallet: { ...respondent.wallet, available: 0 }, rows: [] };
  rules.creditReward(verified, ctx, { ...reward, pending: true });
  assert.equal(
    disputeRules.creditRespondentRefusal({
      amount: 10,
      attemptStatus: "COMPLETED",
      alreadyRewarded: verified.rows.length > 0,
      survey: null,
      escrow: null,
    })?.code,
    "DISPUTE_ATTEMPT_ALREADY_REWARDED",
  );

  // Publisher ledger: one ESCROW −10 entry on the respondent credit's journal key → "Trả thưởng khảo sát".
  const items = rules.ledgerItemsFromRows("publisher", publisher.rows);
  assert.deepEqual(
    items.map((item) => [item.idempotencyKey, item.accountClass, item.amount, item.surveyTitle]),
    [[`internal-reward:${attemptId}`, "ESCROW", -10, "Thói quen đọc sách của sinh viên"]],
  );
  assert.equal(walletTransactionSchema.safeParse(items[0]).success, true);
  const respondentKeys = rules.ledgerItemsFromRows("respondent", respondent.rows).map((item) => item.idempotencyKey);
  assert.ok(respondentKeys.includes(`internal-reward:${attemptId}`));
  const [row] = history.toHistoryRows(items, new Date(NOW));
  assert.deepEqual([row.title, row.amount, row.direction, row.note], ["Trả thưởng khảo sát", -10, "out", "Khảo sát của bạn"]);

  // A short escrow throws and changes nothing.
  const poor = { wallet: { available: 0, pending: 0, escrow: 5, frozen: 0, integrityHold: 0 }, rows: [] };
  assert.throws(() => rules.payRewardFromEscrow(poor, ctx, reward), /INSUFFICIENT_BALANCE/);
  assert.deepEqual([poor.wallet.escrow, poor.rows.length], [5, 0]);
});

test("missing-code reports: one OPEN case per attempt", () => {
  const report = (overrides = {}) => ({
    id: "r",
    kind: "MISSING_CODE",
    status: "OPEN",
    reporter: { role: "RESPONDENT", name: "#2C9D" },
    description: "Không thấy mã hoàn thành.",
    attempt: { id: "attempt-1" },
    ...overrides,
  });
  const cases = [];
  assert.equal(disputeRules.addMissingCodeCase(cases, report({ id: "first" })), "ADDED");
  assert.equal(disputeRules.addMissingCodeCase(cases, report({ id: "second", description: "Báo lại lần nữa." })), "DUPLICATE");
  assert.deepEqual(cases.map((item) => [item.id, item.description]), [["first", "Không thấy mã hoàn thành."]]);

  // Once the case is resolved, a new report opens a new case.
  cases[0].status = "RESOLVED";
  assert.equal(disputeRules.addMissingCodeCase(cases, report({ id: "third" })), "ADDED");
  assert.equal(cases.length, 2);

  // An open locked-attempt case of the same attempt becomes the report (so it can be credited).
  const locked = [report({ id: "lock", kind: "LOCKED_ATTEMPT", reporter: { role: "SYSTEM", name: "Hệ thống" }, description: null })];
  assert.equal(disputeRules.addMissingCodeCase(locked, report({ id: "late" })), "MERGED");
  assert.deepEqual(
    locked.map((item) => [item.id, item.kind, item.reporter.role, item.description]),
    [["lock", "MISSING_CODE", "RESPONDENT", "Không thấy mã hoàn thành."]],
  );
});

test("case detail: current attempt status; a completed attempt cannot be credited", () => {
  const missing = dispute({ kind: "MISSING_CODE", reviewEndsAt: null, amount: 18, attempt: { ...dispute().attempt, status: "IN_PROGRESS", wrongCodeCount: 0 } });
  assert.equal(view.ATTEMPT_STATUS_LABELS.COMPLETED, "Đã hoàn thành");
  const open = view.actionsOf(missing).find((action) => action.outcome === "CREDIT_RESPONDENT");
  assert.equal(open.disabledReason, undefined);
  const completed = view
    .actionsOf({ ...missing, attempt: { ...missing.attempt, status: "COMPLETED" } })
    .find((action) => action.outcome === "CREDIT_RESPONDENT");
  assert.match(completed.disabledReason, /đã hoàn thành/);
});

test("accepted dispute: publisher Khả dụng copy, and refused 409 without a covering integrity hold", () => {
  const item = dispute();
  assert.match(view.resolvedMessage(item, "REFUND_TO_PUBLISHER"), /hoàn vào Khả dụng của người đăng/);
  const accept = view.actionsOf(item).find((action) => action.outcome === "REFUND_TO_PUBLISHER");
  assert.match(accept.confirmBody, /hoàn vào Khả dụng của người đăng/);
  assert.doesNotMatch(accept.confirmBody, /ký quỹ/);

  assert.equal(disputeRules.disputeHoldRefusal(10, 10), null);
  assert.equal(disputeRules.disputeHoldRefusal(25, 10), null);
  // A hold that exists but falls short of the amount: INSUFFICIENT_BALANCE.
  const short = disputeRules.disputeHoldRefusal(9, 10);
  assert.equal(short?.status, 409);
  assert.equal(short?.code, "INSUFFICIENT_BALANCE");
  // No held points at all (not a mock account, or the hold is already gone): a distinct code.
  for (const held of [0, null]) {
    const refusal = disputeRules.disputeHoldRefusal(held, 10);
    assert.equal(refusal?.status, 409, String(held));
    assert.equal(refusal?.code, "DISPUTE_NO_HELD_POINTS", String(held));
  }
  // Mapped to admin copy already.
  assert.match(messages.disputeResolveErrorMessage(new ApiError({ kind: "http", status: 409, code: "INSUFFICIENT_BALANCE", message: "x" })), /Điểm đang giữ/);
  assert.match(
    messages.disputeResolveErrorMessage(new ApiError({ kind: "http", status: 409, code: "DISPUTE_NO_HELD_POINTS", message: "x" })),
    /không còn điểm đang giữ/,
  );
});
