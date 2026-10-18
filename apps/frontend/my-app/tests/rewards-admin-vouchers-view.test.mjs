import assert from "node:assert/strict";
import { test } from "node:test";
process.env.NEXT_PUBLIC_REWARDS_ENABLED = "true";
const { parseCodeCsv, voucherFormErrors, deviationWarning, preCheckItems, voucherRowView, voucherActionsOf, STATUS_FILTERS } = await import("../lib/admin/rewards-vouchers-view.ts");

test("CSV strips BOM/header, accepts separators and records bad line numbers", () => {
  assert.deepEqual(parseCodeCsv("\uFEFFcode\r\nABCD;ignore\r\n\r\nBAD!\r\nEFGH,ignore"), {
    codes: ["ABCD", "EFGH"], skippedHeader: true, invalid: [{ line: 4, value: "BAD!" }],
  });
  assert.equal(parseCodeCsv("ABCD\n".repeat(5001)).invalid[0].value, "Tối đa 5000 mã.");
});

test("form issues map to Vietnamese field messages", () => {
  assert.deepEqual(voucherFormErrors([{ path: ["promoPoints"], message: "custom" }, { path: ["codeExpiresAt"], message: "custom" }]), {
    promoPoints: "Giá khuyến mãi phải thấp hơn giá điểm thường.",
    codeExpiresAt: "Hạn dùng mã phải sau ngày kết thúc đổi ít nhất 7 ngày.",
  });
});

test("deviation boundary and precheck", () => {
  assert.equal(deviationWarning(50000, 300), null);
  assert.match(deviationWarning(50000, 301), /20%/);
  const form = { valueVnd: 50000, basePoints: 250, isSharedCode: false, redeemStartsAt: "2026-10-14T00:00:00Z", redeemEndsAt: "2026-11-14T00:00:00Z", codeExpiresAt: "2026-11-21T00:00:00Z" };
  assert.deepEqual(preCheckItems(form, parseCodeCsv("ABCD"), "2026-10-13T00:00:00Z").map(item => item.tone), ["ok", "ok", "ok", "ok"]);
});

test("voucher row labels and archived actions", () => {
  const voucher = { state: "ARCHIVED", status: "ARCHIVED", isVisible: false, redeemStartsAt: "2026-09-01T00:00:00Z", redeemEndsAt: "2026-11-30T00:00:00Z", stock: { remaining: 88, total: 500, flashReserved: 25 }, basePoints: 250, valueVnd: 50000, promoPoints: null, price: { source: "BASE", points: 250 } };
  assert.equal(voucherRowView(voucher).statusLabel, "Lưu trữ");
  assert.equal(voucherRowView(voucher).stockLabel, "88/500");
  assert.deepEqual(voucherActionsOf(voucher).map(action => action.key), ["history"]);
  assert.equal(STATUS_FILTERS({ total: 3, active: 2, paused: 1, soldOut: 0, expired: 0, hidden: 1 })[0].label, "Tất cả 3");
});

test("CSV header is skipped on the first non-empty row, not only line one", () => {
  assert.deepEqual(parseCodeCsv("\n\ncode\nABCD"), { codes: ["ABCD"], skippedHeader: true, invalid: [] });
});

test("row status comes from the server field", () => {
  const voucher = { state: "ACTIVE", status: "SOLD_OUT", isVisible: true, stock: { remaining: 5, total: 5, flashReserved: 0 }, basePoints: 250, valueVnd: 50000, promoPoints: null, price: { source: "BASE", points: 250 }, redeemStartsAt: "2026-09-01T00:00:00Z", redeemEndsAt: "2026-11-30T00:00:00Z" };
  assert.equal(voucherRowView(voucher).statusLabel, "Hết hàng");
});

test("active voucher offers Flash Sale deep link, archived does not", () => {
  assert.deepEqual(voucherActionsOf({ id: "voucher-id", state: "ACTIVE", isVisible: true }).find(action => action.key === "flash"), { key: "flash", label: "Tạo Flash Sale", href: "/admin/flash-sales/new?voucherId=voucher-id" });
  assert.equal(voucherActionsOf({ state: "ARCHIVED" }).some(action => action.key === "flash"), false);
});

test("daily points limit input accepts integers 1..1,000,000 only", async () => {
  const { parseDailyLimitInput } = await import("../lib/admin/rewards-vouchers-view.ts");
  assert.deepEqual(parseDailyLimitInput("1"), { value: 1 });
  assert.deepEqual(parseDailyLimitInput("1000000"), { value: 1000000 });
  assert.deepEqual(parseDailyLimitInput(" 800 "), { value: 800 });
  for (const raw of ["", "0", "1000001", "1.5", "1e3", "-1", "abc", "1.000"]) {
    assert.deepEqual(parseDailyLimitInput(raw), { error: "Nhập số nguyên từ 1 đến 1.000.000." }, raw);
  }
});

test("daily points limit errors map to Vietnamese", async () => {
  const { rewardsSettingsErrorMessage } = await import("../lib/admin/rewards-vouchers-view.ts");
  const { ApiError } = await import("../lib/api/api-error.ts");
  const http = (status, code) => new ApiError({ kind: "http", status, code, message: "x" });
  assert.match(rewardsSettingsErrorMessage(http(400, "VALIDATION_ERROR")), /Giá trị không hợp lệ/);
  assert.match(rewardsSettingsErrorMessage(http(403, "REWARDS_ADMIN_CAPABILITY_REQUIRED")), /quyền Admin/);
  assert.match(rewardsSettingsErrorMessage(http(403, "FORBIDDEN_RESOURCE")), /quyền Admin/);
  assert.match(rewardsSettingsErrorMessage(http(403, "AUTH_INVALID_CSRF_TOKEN")), /Tải lại trang/);
  assert.match(rewardsSettingsErrorMessage(http(404, null)), /Đổi quà đang tắt/);
  assert.equal(rewardsSettingsErrorMessage(new ApiError({ kind: "network", message: "x" })), "Không lưu được giới hạn. Thử lại.");
  assert.equal(rewardsSettingsErrorMessage(new Error("boom")), "Không lưu được giới hạn. Thử lại.");
});
