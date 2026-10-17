import test from "node:test";
import assert from "node:assert/strict";

const {
  refundStatusBadge,
  refundEligibilityBadge,
  refundReasonLabel,
  refundIneligibleReasonLabel,
  verdictChip,
  verdictShortReason,
  verdictExplanation,
  refundTransferContent,
  refundSla,
  auditTrail,
  rejectReasonState,
  bankTransferState,
} = await import("../lib/admin/payos-top-up-refund.ts");

const { payosAdminErrorMessage } = await import("../lib/admin/payos-top-up-admin-messages.ts");

const {
  adminTopUpRefundListItemSchema,
  adminTopUpRefundDetailSchema,
  resolveTopUpRefundSchema,
  recordTopUpRefundBankTransferSchema,
  addBusinessDays,
} = await import("@rescom/schemas");

const { ApiError } = await import("../lib/api/api-error.ts");

test("Story 13.12: admin refund presentation and labels", () => {
  assert.equal(refundStatusBadge("REQUESTED").label, "Chờ xử lý");
  assert.equal(refundStatusBadge("REFUNDED").label, "Đã hoàn tiền");
  assert.equal(refundStatusBadge("REJECTED").label, "Đã từ chối");
  assert.equal(refundStatusBadge("WITHDRAWN").label, "Đã rút");

  assert.equal(refundEligibilityBadge("ELIGIBLE").label, "Hợp lệ");
  assert.equal(refundEligibilityBadge("NOT_ELIGIBLE").label, "Không đủ ĐK");

  assert.equal(refundReasonLabel("WRONG_AMOUNT"), "Nạp nhầm số tiền");
  assert.equal(refundReasonLabel("WRONG_ACCOUNT"), "Nạp nhầm tài khoản");
  assert.equal(refundReasonLabel("NO_LONGER_NEEDED"), "Không còn nhu cầu");
  assert.equal(refundReasonLabel("OTHER"), "Lý do khác");

  assert.equal(refundIneligibleReasonLabel("SPENT_SINCE_TOP_UP"), "Điểm đã được sử dụng");
  assert.equal(refundIneligibleReasonLabel("INSUFFICIENT_AVAILABLE"), "Số dư khả dụng không đủ phong toả");
  assert.equal(refundIneligibleReasonLabel(null), null);
});

test("Story 13.12: SLA calculation (refundSla across weekend & overdue)", () => {
  // Friday morning -> 3 business days later is Wednesday
  const fri = new Date("2026-10-16T09:00:00Z");
  const dueAt = addBusinessDays(fri, 3);
  assert.equal(dueAt.getUTCDay(), 3); // Wednesday

  // On Monday morning (1 business day passed) -> 2 days left
  const mon = new Date("2026-10-19T09:00:00Z");
  const slaMon = refundSla({ dueAt: dueAt.toISOString(), status: "REQUESTED" }, mon);
  assert.equal(slaMon.overdue, false);
  assert.match(slaMon.line, /Còn 2 ngày/);
  assert.match(slaMon.dueLabel, /^Hạn \d{2}\/\d{2}$/);

  // Exact due time -> overdue is true (now >= dueAt)
  const slaExact = refundSla({ dueAt: dueAt.toISOString(), status: "REQUESTED" }, dueAt);
  assert.equal(slaExact.overdue, true);
  assert.equal(slaExact.line, "Quá hạn");

  // After Wednesday -> overdue is true
  const nextThu = new Date("2026-10-22T10:00:00Z");
  const slaOverdue = refundSla({ dueAt: dueAt.toISOString(), status: "REQUESTED" }, nextThu);
  assert.equal(slaOverdue.overdue, true);
  assert.equal(slaOverdue.line, "Quá hạn");
});

test("Story 13.12: admin refund error messages per code", () => {
  const err = (code) => new ApiError({ kind: "http", status: 409, code, message: code });

  assert.equal(payosAdminErrorMessage(err("REFUND_ALREADY_RESOLVED")), "Yêu cầu đã được xử lý");
  assert.equal(
    payosAdminErrorMessage(err("REFUND_DESTINATION_UNCONFIRMED")),
    "Vui lòng xác nhận đã kiểm tra tài khoản đích trước khi hoàn tất.",
  );
  assert.equal(
    payosAdminErrorMessage(err("REFUND_NOT_HELD")),
    "Điểm giữ hoàn tiền không khả dụng hoặc đã bị thay đổi.",
  );
  assert.equal(
    payosAdminErrorMessage(err("REFUND_NOT_REFUNDED")),
    "Chỉ có thể ghi nhận chuyển khoản cho yêu cầu ở trạng thái ĐÃ HOÀN TIỀN.",
  );
  assert.equal(
    payosAdminErrorMessage(err("REFUND_BANK_TRANSFER_ALREADY_RECORDED")),
    "Giao dịch chuyển khoản ngân hàng đã được ghi nhận trước đó.",
  );
  assert.equal(
    payosAdminErrorMessage(err("TOPUP_REFUND_NOT_FOUND")),
    "Không tìm thấy yêu cầu hoàn tiền này.",
  );
  assert.equal(
    payosAdminErrorMessage(err("TOPUP_SELF_REVIEW_FORBIDDEN")),
    "Bạn không thể tự xử lý yêu cầu của chính mình.",
  );
});

test("Story 13.12: refund schema validation", () => {
  const item = {
    id: "00000000-0000-4000-8000-000000000001",
    topUpId: "00000000-0000-4000-8000-000000000002",
    orderCode: 800001,
    userId: "00000000-0000-4000-8000-000000000003",
    userEmail: "minh.le@fpt.edu.vn",
    userName: "minh.le",
    amountVnd: 50000,
    points: 250,
    status: "REQUESTED",
    eligibility: "ELIGIBLE",
    ineligibleReason: null,
    reason: "WRONG_AMOUNT",
    destinationVerified: true,
    heldPoints: 250,
    submittedAt: "2026-10-16T12:00:00.000Z",
    dueAt: "2026-10-21T12:00:00.000Z",
    overdue: false,
    resolvedAt: null,
  };
  assert.equal(adminTopUpRefundListItemSchema.safeParse(item).success, true);

  const detail = {
    ...item,
    note: "Nạp nhầm số tiền",
    paidAt: "2026-10-16T11:00:00.000Z",
    providerReference: "PO-800001",
    destination: {
      bankId: "970422",
      bankName: "MB Bank",
      holderName: "LE THI MINH",
      accountNumber: "0987654321",
      verified: true,
    },
    rejectionReason: null,
    manualTransferRecorded: false,
    bankTransferReference: null,
    bankTransferredAt: null,
    bankTransferRecordedAt: null,
    withdrawnAt: null,
    resolvedBy: null,
    holdJournalId: "00000000-0000-4000-8000-000000000004",
    resolveJournalId: null,
  };
  assert.equal(adminTopUpRefundDetailSchema.safeParse(detail).success, true);

  // Resolution schemas
  assert.equal(
    resolveTopUpRefundSchema.safeParse({
      decision: "REFUNDED",
      destinationConfirmed: true,
    }).success,
    true,
  );
  assert.equal(
    resolveTopUpRefundSchema.safeParse({
      decision: "REJECTED",
      reason: "Tài khoản không chính chủ",
      manualTransferRecorded: true,
    }).success,
    true,
  );

  // Bank transfer schema
  assert.equal(
    recordTopUpRefundBankTransferSchema.safeParse({
      bankTransferReference: "FT123456",
      bankTransferredAt: "2026-10-16T14:00:00.000Z",
    }).success,
    true,
  );
});

test("Story 13.12: verdict chips, reasons and explanations", () => {
  assert.deepEqual(verdictChip({ eligibility: "ELIGIBLE" }), { label: "Hợp lệ", tone: "success" });
  assert.deepEqual(verdictChip({ eligibility: "NOT_ELIGIBLE" }), { label: "Không hợp lệ", tone: "warning" });

  assert.equal(verdictShortReason({ eligibility: "ELIGIBLE", ineligibleReason: null }), "Chưa tiêu Điểm sau khi nạp");
  assert.equal(verdictShortReason({ eligibility: "NOT_ELIGIBLE", ineligibleReason: "SPENT_SINCE_TOP_UP" }), "Đã dùng Điểm sau khi nạp");
  assert.equal(verdictShortReason({ eligibility: "NOT_ELIGIBLE", ineligibleReason: "INSUFFICIENT_AVAILABLE" }), "Khả dụng ít hơn số Điểm nạp");

  assert.match(
    verdictExplanation({ eligibility: "ELIGIBLE", ineligibleReason: null, paidAt: "2026-10-16T11:00:00Z", points: 250 }),
    /User chưa tiêu Điểm nào kể từ lúc nạp/
  );
  assert.match(
    verdictExplanation({ eligibility: "NOT_ELIGIBLE", ineligibleReason: "SPENT_SINCE_TOP_UP", paidAt: null, points: 250 }),
    /User đã dùng Điểm/
  );
  assert.match(
    verdictExplanation({ eligibility: "NOT_ELIGIBLE", ineligibleReason: "INSUFFICIENT_AVAILABLE", paidAt: null, points: 250 }),
    /ít hơn 250 Điểm/
  );

  assert.equal(refundTransferContent(800001), "RESCOM HOAN 800001");

  // Audit trail
  const testDetail = {
    submittedAt: "2026-10-16T10:00:00.000Z",
    userName: "Minh Le",
    userEmail: "minh@example.com",
    eligibility: "ELIGIBLE",
    ineligibleReason: null,
    points: 250,
    destination: { verified: false },
    withdrawnAt: null,
    resolvedAt: "2026-10-16T15:00:00.000Z",
    resolvedBy: { email: "admin@rescom.vn" },
    status: "REFUNDED",
    bankTransferRecordedAt: "2026-10-16T16:00:00.000Z",
  };
  const trail = auditTrail(testDetail);
  assert.equal(trail.length, 5);
  assert.match(trail[0].text, /Minh Le · gửi yêu cầu hoàn tiền/);
  assert.match(trail[1].text, /kết luận Hợp lệ/);
  assert.match(trail[2].text, /cần xác minh qua email/);
  assert.match(trail[3].text, /Admin admin@rescom.vn · đánh dấu Đã hoàn tiền/);
  assert.match(trail[4].text, /Admin · thêm mã chuyển khoản/);

  // Reject reason state
  assert.equal(rejectReasonState("   ").valid, false);
  assert.equal(rejectReasonState("Valid reason").valid, true);
  assert.equal(rejectReasonState("x".repeat(500)).valid, true);
  assert.equal(rejectReasonState("x".repeat(501)).valid, false);

  // Bank transfer state
  assert.equal(bankTransferState({}, new Date("2026-10-16T10:00:00Z")).valid, false);
  assert.equal(bankTransferState({ reference: "FT999" }, new Date("2026-10-16T10:00:00Z")).valid, true);
  assert.equal(
    bankTransferState(
      { reference: "FT999", transferredAt: "2026-10-15T10:00:00Z" },
      new Date("2026-10-16T10:00:00Z")
    ).valid,
    false // before createdAt
  );
  assert.equal(
    bankTransferState(
      { reference: "FT999", transferredAt: new Date(Date.now() + 10 * 60 * 1000) },
      new Date("2026-10-16T10:00:00Z"),
      new Date()
    ).valid,
    false // future > 5 min
  );
});

test("Story 13.12: refundSla - only REQUESTED can be overdue", () => {
  const past = new Date("2026-10-01T00:00:00Z").toISOString();
  const now = new Date("2026-10-20T00:00:00Z");
  assert.equal(refundSla({ dueAt: past, status: "REQUESTED" }, now).overdue, true);
  for (const status of ["REFUNDED", "REJECTED", "WITHDRAWN"]) {
    const sla = refundSla({ dueAt: past, status }, now);
    assert.equal(sla.overdue, false, status);
    assert.equal(sla.line, refundStatusBadge(status).label);
  }
});

// No DOM test runner in this app: the component rules below are asserted on source.
const { readFileSync } = await import("node:fs");
const componentSource = (name) =>
  readFileSync(new URL(`../app/(signed-in)/(admin)/admin/top-ups/components/${name}.tsx`, import.meta.url), "utf8");

test("Story 13.12: drawer status chip uses refundStatusBadge, not the top-up chip", () => {
  const drawer = componentSource("RefundDrawer");
  assert.match(drawer, /refundStatusBadge\(item\.status\)/);
  assert.doesNotMatch(drawer, /topUpChip\(/);
});

test("Story 13.12: deep link opens, 404 drops the param, close cannot reopen", () => {
  const panel = componentSource("RefundRequestsPanel");
  // open: effect opens the drawer from ?request= without rewriting the URL
  assert.match(panel, /openDetail\(requestParam, false\)/);
  // close: remembers the closed id and the effect skips it until the URL drops it
  assert.match(panel, /dismissedRef\.current = detailRequestIdRef\.current \?\? requestParam/);
  assert.match(panel, /dismissedRef\.current === requestParam/);
  // 404: toast + delete the param; other failures keep the URL
  const catchBlock = panel.slice(panel.indexOf("} catch (err) {"), panel.indexOf("const closeDetail"));
  assert.match(catchBlock, /err\.status === 404[\s\S]*nextQuery\.delete\("request"\)[\s\S]*else \{[\s\S]*Không thể tải yêu cầu/);
  assert.match(catchBlock, /dismissedRef\.current = id/);
});

test("Story 13.12: dialog rules (manual checkbox, confirmation, Mark enablement)", () => {
  const reject = componentSource("RejectRefundDialog");
  assert.match(reject, /const isHeld = item\.heldPoints > 0/);
  assert.match(reject, /\{!isHeld && \(\s*<label/);
  assert.match(reject, /manualTransferRecorded: isHeld \? false : manualTransfer/);

  const mark = componentSource("MarkRefundedDialog");
  assert.match(mark, /const needsConfirmation = !item\.destination\.verified/);
  assert.match(mark, /\{needsConfirmation && \(\s*<label/);
  assert.match(mark, /destinationConfirmed: needsConfirmation \? confirmed : true/);

  const drawer = componentSource("RefundDrawer");
  assert.match(drawer, /canMarkRefunded = isRequested && item\.heldPoints > 0 && item\.eligibility === "ELIGIBLE"/);
  assert.match(drawer, /disabled=\{busy \|\| !canMarkRefunded\}/);

  // server errors stay inside the dialogs (Alert), they do not close them
  for (const name of ["MarkRefundedDialog", "RejectRefundDialog", "BankTransferDialog"]) {
    assert.match(componentSource(name), /catch \(err\) \{\s*setClientError\(payosAdminErrorMessage\(err\)\)/, name);
  }
  assert.match(componentSource("RefundRequestsPanel"), /if \(!gone && !resolved\) throw err/);
});
