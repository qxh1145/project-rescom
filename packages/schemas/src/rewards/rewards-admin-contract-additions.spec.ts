import { adminVoucherInputSchema, REWARDS_ADMIN_ERROR_CODES } from "./rewards-admin.schema";

test("shared code is optional and validated when present", () => {
  const input = { title: "Coffee", brandId: "highlands", category: "COFFEE", valueVnd: 50000, basePoints: 250, promoPoints: null, isSharedCode: true, redeemStartsAt: "2026-10-01T00:00:00.000Z", redeemEndsAt: "2026-10-10T00:00:00.000Z", codeExpiresAt: "2026-10-17T00:00:00.000Z", terms: [], howToUse: [], imageUrl: null };
  expect(adminVoucherInputSchema.safeParse(input).success).toBe(true);
  expect(adminVoucherInputSchema.safeParse({ ...input, sharedCode: "ABCD-1234" }).success).toBe(true);
  expect(adminVoucherInputSchema.safeParse({ ...input, sharedCode: "bad!" }).success).toBe(false);
  expect(adminVoucherInputSchema.safeParse({ ...input, sharedCode: "" }).success).toBe(false);
});

test("admin error codes include conflict and validation cases", () => {
  expect(REWARDS_ADMIN_ERROR_CODES).toContain("VOUCHER_ARCHIVED");
  expect(REWARDS_ADMIN_ERROR_CODES).toContain("STOCK_BELOW_COMMITTED");
  expect(REWARDS_ADMIN_ERROR_CODES).toContain("REDEMPTION_WINDOW_ENDED");
});
