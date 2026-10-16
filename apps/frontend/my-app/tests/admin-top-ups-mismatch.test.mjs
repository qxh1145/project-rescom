import test from "node:test";
import assert from "node:assert/strict";
import { mismatchPreview, mismatchSla, uncreditedBanner, noteState, diffVnd, resolveToast } from "../lib/admin/payos-top-up-mismatch.ts";
import { payosAdminErrorMessage } from "../lib/admin/payos-top-up-admin-messages.ts";
import { ApiError } from "../lib/api/api-error.ts";
import { adminTopUpActionRequiredSchema, resolveTopUpMismatchSchema } from "@rescom/schemas";

test("mismatch preview floors only complete 200-VND points", () => {
  assert.deepEqual(mismatchPreview(98_100), { points: 490, remainderVnd: 100, canCredit: true });
  assert.deepEqual(mismatchPreview(150), { points: 0, remainderVnd: 150, canCredit: false });
  assert.equal(diffVnd({ amountVnd: 100_000, amountPaidVnd: 98_000 }), -2_000);
});
test("deadline uses Vietnam business days and exact overdue boundary", () => {
  const row = { resolveDueAt: "2026-10-21T10:00:00.000Z" };
  assert.deepEqual(mismatchSla(row, new Date("2026-10-16T10:00:00.000Z")), { overdue: false, line: "Còn 3 ngày làm việc", dueLabel: "Hạn 21/10 17:00" });
  assert.equal(mismatchSla(row, new Date(row.resolveDueAt)).line, "Quá hạn");
  assert.equal(mismatchSla({ resolveDueAt: "2026-10-19T10:00:00.000Z" }, new Date("2026-10-17T10:00:00.000Z")).line, "Còn 1 ngày làm việc");
});
test("uncredited banner and refund note rules", () => {
  const banner = uncreditedBanner([{ orderCode: 123, paidAt: "2026-10-16T09:00:00.000Z" }], new Date("2026-10-16T09:45:00.000Z"));
  assert.match(banner.title, /^1 giao dịch/);
  assert.match(banner.lines[0], /#123.*16:00, đã 45 phút/);
  assert.deepEqual(noteState("  trả lại  "), { valid: true, value: "trả lại" });
  assert.equal(noteState("  ").valid, false);
  assert.equal(noteState("a".repeat(501)).valid, false);
  assert.equal(resolveTopUpMismatchSchema.safeParse({ action: "MANUAL_REFUND", expectedAmountPaidVnd: 500 }).success, false);
});
test("action DTO rejects full account numbers; error and replay messages", () => {
  assert.equal(adminTopUpActionRequiredSchema.safeParse({ uncredited: [], mismatches: [] }).success, true);
  assert.equal(adminTopUpActionRequiredSchema.safeParse({ uncredited: [], mismatches: [], counterAccountNumber: "secret" }).success, false);
  assert.match(resolveToast({ status: "SUCCESSFUL", pointsCredited: 245, replayed: false }).body, /245/);
  assert.match(payosAdminErrorMessage(new ApiError({ kind: "http", status: 409, code: "TOPUP_MISMATCH_AMOUNT_CHANGED", message: "changed" })), /Đã tải lại/);
});
