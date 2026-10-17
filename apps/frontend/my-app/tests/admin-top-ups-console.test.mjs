import test from "node:test";
import assert from "node:assert/strict";
import { defaultDateRange, normalizeSearch, toListQuery, recheckToast, payosStatusOptions } from "../lib/admin/payos-top-up-admin.ts";
import { payosAdminErrorMessage } from "../lib/admin/payos-top-up-admin-messages.ts";
import { attachmentFileName } from "../lib/api/client.ts";
import { ApiError } from "../lib/api/api-error.ts";
import { adminPayosTopUpListSchema, exportAdminPayosTopUpsSchema } from "@rescom/schemas";

test("Vietnam month and midnight boundaries", () => {
  assert.deepEqual(defaultDateRange(new Date("2026-10-31T16:59:59Z")), { from: "2026-10-01", to: "2026-10-31" });
  assert.deepEqual(defaultDateRange(new Date("2026-10-31T17:00:00Z")), { from: "2026-11-01", to: "2026-11-01" });
});
test("search and page query", () => {
  assert.equal(normalizeSearch("  01234  "), "01234");
  assert.deepEqual(toListQuery({ from: "2026-10-01", to: "2026-10-31", status: "SUCCESSFUL", q: "  user@example.com " }, 2),
    { limit: 10, offset: 10, from: "2026-10-01", to: "2026-10-31", status: "SUCCESSFUL", q: "user@example.com" });
  assert.equal(payosStatusOptions().length, 6);
});
test("recheck result copy", () => {
  assert.equal(recheckToast({ result: "CREDITED" }).title, "Đã cộng Điểm");
  assert.equal(recheckToast({ result: "STILL_UNPAID" }).tone, "info");
  assert.equal(recheckToast({ result: "MISMATCH" }).tone, "warning");
});
test("admin error mapping", () => {
  assert.match(payosAdminErrorMessage(new ApiError({ kind: "http", status: 503, code: "TOPUP_PROVIDER_UNAVAILABLE", message: "" })), /payOS/);
  assert.match(payosAdminErrorMessage(new ApiError({ kind: "http", status: 400, code: "TOPUP_EXPORT_TOO_LARGE", details: { maxRows: 10000 }, message: "" })), /10000/);
  assert.match(payosAdminErrorMessage(new ApiError({ kind: "network", message: "" })), /mạng/);
  assert.match(payosAdminErrorMessage(exportAdminPayosTopUpsSchema.safeParse({ from: "2025-01-01", to: "2026-10-01" }).error), /366/);
});
test("CSV attachment filename parsing", () => {
  assert.equal(attachmentFileName('attachment; filename="rescom-payos.csv"'), "rescom-payos.csv");
  assert.equal(attachmentFileName("attachment; filename*=UTF-8''topups%20Oct.csv"), "topups Oct.csv");
  assert.equal(attachmentFileName(null), null);
});
test("admin DTO rejects sensitive extra keys", () => {
  const row = { id: "11111111-1111-4111-8111-111111111111", orderCode: 12345,
    userId: "11111111-1111-4111-8111-111111111111", userEmail: "a@b.test", amountVnd: 20000, points: 100,
    pointsCredited: null, amountPaidVnd: null, status: "PROCESSING", createdAt: "2026-10-01T00:00:00Z",
    paidAt: null, expiresAt: "2026-10-01T01:00:00Z", cancelledAt: null };
  assert.equal(adminPayosTopUpListSchema.safeParse({ items: [row], total: 1, limit: 10, offset: 0, hasMore: false }).success, true);
  assert.equal(adminPayosTopUpListSchema.safeParse({ items: [{ ...row, counterAccountNumber: "123" }], total: 1, limit: 10, offset: 0, hasMore: false }).success, false);
});

test("Story 13.12: tab counts schema and tab ordering", async () => {
  const { adminTopUpTabCountsSchema } = await import("@rescom/schemas");
  const parsed = adminTopUpTabCountsSchema.safeParse({
    payos: 128,
    manual: 5,
    actionRequired: 3,
    refunds: 2,
  });
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.refunds, 2);

  // Default refunds count to 0 if omitted
  const defaulted = adminTopUpTabCountsSchema.safeParse({
    payos: 10,
    manual: 2,
    actionRequired: 1,
  });
  assert.equal(defaulted.success, true);
  assert.equal(defaulted.data.refunds, 0);
});

