import test from "node:test";
import assert from "node:assert/strict";

const admin = await import("../lib/admin/top-up-admin.ts");
const { adminTopUpListSchema, adminTopUpReviewResultSchema } = await import("../lib/admin/top-up-admin-service.ts");
const { topUpReviewErrorMessage, isStaleReviewError } = await import("../lib/admin/top-up-admin-messages.ts");
const { ApiError } = await import("../lib/api/api-error.ts");
const rules = await import("../mocks/data/economy-rules.ts");
const history = await import("../lib/wallet/wallet-history.ts");

const TOP_UP = {
  id: "6e0b3d1a-4c2f-4a8e-9b1d-2f3a4b5c6d01",
  amount: 200,
  amountVnd: 40_000,
  status: "PENDING",
  transferReference: "RESCOMMT4492QA",
  rejectionReason: null,
  createdAt: "2026-09-26T11:20:00.000Z",
  reviewedAt: null,
  paymentInstructions: null,
  userId: "11111111-1111-4111-8111-111111111111",
  userEmail: "minh.tran@fpt.edu.vn",
  adminId: null,
  journalId: null,
  correlationId: null,
};

test("tabs carry the pending queue size (Figma 'Chờ duyệt · 2')", () => {
  assert.deepEqual(
    admin.topUpStatusTabs(2).map((tab) => tab.label),
    ["Chờ duyệt · 2", "Đã duyệt", "Đã từ chối"],
  );
  assert.equal(admin.topUpStatusTabs(undefined)[0].label, "Chờ duyệt");
});

test("transfer reference is shown with the prefix apart", () => {
  assert.equal(admin.formatTransferReference("RESCOMMT4492QA"), "RESCOM MT4492QA");
  assert.equal(admin.formatTransferReference("OTHER"), "OTHER");
  assert.equal(admin.formatTransferReference("RESCOM"), "RESCOM");
});

test("requester label falls back from the ASSUMED name to the email", () => {
  assert.equal(admin.requesterName({ userName: "Trần Minh", userEmail: "minh.tran@fpt.edu.vn" }), "Trần Minh");
  assert.equal(admin.requesterName({ userEmail: "minh.tran@fpt.edu.vn" }), "minh.tran");
  assert.equal(admin.requesterName({ userName: null, userEmail: null }), "Người dùng");
});

test("checklist names the amount and the reference to match", () => {
  assert.deepEqual(admin.reviewChecks(TOP_UP), [
    "Đúng số tiền 40.000đ",
    "Đúng nội dung RESCOM MT4492QA",
    "Giao dịch chưa được dùng cho yêu cầu khác",
  ]);
});

test("reject reason follows the backend bounds (5–500 after trim)", () => {
  assert.match(admin.rejectReasonError("   "), /Nhập lý do/);
  assert.match(admin.rejectReasonError("abc "), /ít nhất 5/);
  assert.equal(admin.rejectReasonError("  Sai nội dung  "), null);
  assert.match(admin.rejectReasonError("x".repeat(501)), /tối đa 500/);
});

test("after a decision the next request in the queue is selected", () => {
  const previous = ["a", "b", "c"];
  assert.equal(admin.nextSelectedId([{ id: "b" }, { id: "c" }], "a", previous), "b");
  assert.equal(admin.nextSelectedId([{ id: "a" }, { id: "c" }], "b", previous), "c");
  assert.equal(admin.nextSelectedId([{ id: "a" }, { id: "b" }], "c", previous), "a");
  assert.equal(admin.nextSelectedId([{ id: "a" }], "a", previous), "a");
  assert.equal(admin.nextSelectedId([], "a", previous), null);
});

test("service schemas accept the verified DTO with and without the ASSUMED fields", () => {
  const list = { items: [TOP_UP, { ...TOP_UP, userName: "Trần Minh", userCreatedAt: "2026-09-12T02:00:00.000Z" }], total: 2, limit: 50, offset: 0, hasMore: false };
  assert.equal(adminTopUpListSchema.safeParse(list).success, true);
  const result = { topUp: { ...TOP_UP, status: "APPROVED" }, journalId: null, replayed: false };
  assert.equal(adminTopUpReviewResultSchema.safeParse(result).success, true);
  // Figma's "RESCOM MT4402" is not a valid backend reference (0 and 1 are excluded).
  assert.equal(adminTopUpListSchema.safeParse({ ...list, items: [{ ...TOP_UP, transferReference: "RESCOMMT4402" }] }).success, false);
});

test("review errors map backend codes to Vietnamese copy", () => {
  const conflict = new ApiError({ kind: "http", status: 409, code: "TOPUP_ALREADY_REVIEWED", message: "x" });
  assert.match(topUpReviewErrorMessage(conflict, "approve"), /vừa được xử lý/);
  assert.equal(isStaleReviewError(conflict), true);
  const self = new ApiError({ kind: "http", status: 403, code: "TOPUP_SELF_REVIEW_FORBIDDEN", message: "x" });
  assert.match(topUpReviewErrorMessage(self, "approve"), /chính mình/);
  assert.equal(isStaleReviewError(self), false);
  const network = new ApiError({ kind: "network", message: "x" });
  assert.match(topUpReviewErrorMessage(network, "reject"), /kết nối/);
  assert.match(topUpReviewErrorMessage(new Error("x"), "reject"), /Chưa từ chối/);
});

test("an approved top-up row becomes the 'Nạp điểm' journal on /wallet", () => {
  const row = {
    id: "22222222-2222-4222-8222-222222222222",
    kind: "TOP_UP",
    amount: 200,
    status: "AVAILABLE",
    note: "RESCOMMT4492QA",
    surveyId: null,
    attemptId: null,
    createdAt: "2026-09-27T01:00:00.000Z",
    releasesAt: null,
  };
  const items = rules.ledgerItemsFromRows(TOP_UP.userId, [row]);
  assert.equal(items.length, 1);
  assert.equal(items[0].idempotencyKey.startsWith("topup-approval:"), true);
  assert.equal(items[0].accountClass, "USER_AVAILABLE");
  const [historyRow] = history.toHistoryRows(items);
  assert.equal(historyRow.kind, "TOP_UP");
  assert.equal(historyRow.title, "Nạp điểm");
  assert.equal(historyRow.note, "Chuyển khoản RESCOMMT4492QA");
  assert.equal(historyRow.amount, 200);
});
