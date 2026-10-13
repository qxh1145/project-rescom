import { adminVoucherStateSchema, adminVoucherStockSchema, adminVoucherInputSchema, adminVoucherSchema, adminVoucherDetailSchema, adminVoucherPriceVersionSchema, adminVoucherPriceChangeSchema, adminStockAdjustmentSchema, adminCodeImportRequestSchema, adminCodeImportResultSchema, adminFlashSaleStatusSchema, adminFlashSaleInputSchema, adminFlashSaleSchema, rewardsStatsQuerySchema, rewardsStatsSchema } from "./rewards-admin.schema";
const id = "11111111-1111-4111-8111-111111111111";
const start = "2026-10-01T00:00:00.000Z";
const end = "2026-10-02T00:00:00.000Z";
const expires = "2026-10-09T00:00:00.000Z";
const brand = { id: "highlands", name: "Highlands" };
const input = { title: "Coffee", brandId: "highlands", category: "COFFEE", valueVnd: 50000, basePoints: 250, promoPoints: null, isSharedCode: false, redeemStartsAt: start, redeemEndsAt: end, codeExpiresAt: expires, terms: [], howToUse: [], imageUrl: null };
const stock = { total: 10, issued: 1, flashReserved: 2, remaining: 7, codesAvailable: 7 };
const voucher = { ...input, id, brand, price: { points: 250, basePoints: 250, source: "BASE", discountPercent: 0, priceVersion: 1 }, state: "ACTIVE", isVisible: true, stock, priceDeviationPercent: 0, createdAt: start, updatedAt: start };
const flashItem = { id, voucherId: id, voucherTitle: "Coffee", brand, valueVnd: 50000, flashPoints: 150, basePoints: 250, discountPercent: 40, quota: 2, sold: 0, perUserCap: 1, state: "ACTIVE" };
describe("admin rewards contracts (Story 12.1, FR-73)", () => {
  it("validates voucher input and field-level date, price, and stock issues", () => {
    expect(adminVoucherStateSchema.safeParse("PAUSED").success).toBe(true);
    expect(adminVoucherInputSchema.safeParse(input).success).toBe(true);
    for (const [changed, path] of [[{ promoPoints: 250 }, "promoPoints"], [{ redeemEndsAt: start }, "redeemEndsAt"], [{ codeExpiresAt: end }, "codeExpiresAt"]] as const) {
      expect(adminVoucherInputSchema.safeParse({ ...input, ...changed }).error?.issues.some(issue => issue.path.includes(path))).toBe(true);
    }
    expect(adminVoucherStockSchema.safeParse(stock).success).toBe(true);
    expect(adminVoucherStockSchema.safeParse({ ...stock, remaining: 8 }).success).toBe(false);
    expect(adminVoucherSchema.safeParse(voucher).success).toBe(true);
    const version = { version: 1, basePoints: 250, promoPoints: null, effectiveFrom: start, changedBy: { id, name: "Admin" } };
    expect(adminVoucherPriceVersionSchema.safeParse(version).success).toBe(true);
    expect(adminVoucherDetailSchema.safeParse({ voucher, priceHistory: [version], redemptions: [{ reference: "RDM-2610-8F2K", userLabel: "User", points: -150, kind: "SUCCEEDED", createdAt: start }] }).success).toBe(true);
    expect(adminVoucherPriceChangeSchema.safeParse({ basePoints: 250, promoPoints: 150 }).success).toBe(true);
    expect(adminVoucherPriceChangeSchema.safeParse({ basePoints: 250, promoPoints: 250 }).success).toBe(false);
    expect(adminStockAdjustmentSchema.safeParse({ total: 20, reason: "restock" }).success).toBe(true);
    expect(adminStockAdjustmentSchema.safeParse({ total: 20, reason: "x" }).success).toBe(false);
  });
  it("validates code imports and flash sale uniqueness/date rules", () => {
    expect(adminCodeImportRequestSchema.safeParse({ codes: ["ABC-123"], mode: "COMMIT" }).success).toBe(true);
    expect(adminCodeImportRequestSchema.safeParse({ codes: ["bad!"], mode: "COMMIT" }).success).toBe(false);
    expect(adminCodeImportResultSchema.safeParse({ received: 1, accepted: 1, duplicatesInFile: [], alreadyStored: [], committed: true }).success).toBe(true);
    expect(adminCodeImportResultSchema.safeParse({ received: 1, accepted: 0, duplicatesInFile: ["CODE"], alreadyStored: [], committed: true }).success).toBe(false);
    expect(adminFlashSaleStatusSchema.safeParse("UPCOMING").success).toBe(true);
    const flash = { startsAt: start, endsAt: end, items: [{ voucherId: id, flashPoints: 150, quota: 2 }] };
    expect(adminFlashSaleInputSchema.parse(flash).items[0].perUserCap).toBe(1);
    expect(adminFlashSaleInputSchema.safeParse({ ...flash, endsAt: start }).success).toBe(false);
    expect(adminFlashSaleInputSchema.safeParse({ ...flash, items: [flash.items[0], flash.items[0]] }).success).toBe(false);
    expect(adminFlashSaleSchema.safeParse({ id, code: "FS-1013-A", startsAt: start, endsAt: end, status: "ACTIVE", endedEarlyAt: null, items: [flashItem], pointsSpent: 150 }).success).toBe(true);
  });
  it("validates date span and statistics payload", () => {
    expect(rewardsStatsQuerySchema.safeParse({ from: "2026-01-01", to: "2026-12-31" }).success).toBe(true);
    for (const range of [{ from: "2026-10-02", to: "2026-10-01" }, { from: "2025-01-01", to: "2026-10-01" }, { from: "2026-02-30", to: "2026-10-01" }]) expect(rewardsStatsQuerySchema.safeParse(range).success).toBe(false);
    const stats = { range: { from: "2026-10-01", to: "2026-10-02" }, updatedAt: start, kpis: { activeVouchers: { active: 1, total: 2, soldOut: 0, expired: 1 }, redemptions: { count: 1, avgPerRegularDay: 0.5 }, pointsSpent: { points: 150, vndEquivalent: 30000 }, redemptionRate: { redeemed: 1, offered: 2, rate: 0.5 }, topVoucher: { voucherId: id, label: "Coffee", count: 1, share: 1 }, selfReportedUsageRate: 0.5 }, daily: [{ date: "2026-10-01", count: 1, flashSaleCodes: ["FS-1013-A"] }], byBrand: [{ brand, redemptions: 1, pointsSpent: 150, soldRatio: 0.5 }], flashSales: [{ flashSaleId: id, code: "FS-1013-A", startsAt: start, itemsLabel: "Coffee", sold: 1, quota: 2, status: "ACTIVE", pointsSpent: 150, soldOutAfterMinutes: null }] };
    expect(rewardsStatsSchema.safeParse(stats).success).toBe(true);
    expect(rewardsStatsSchema.safeParse({ ...stats, kpis: { ...stats.kpis, selfReportedUsageRate: 1.1 } }).success).toBe(false);
  });
});
