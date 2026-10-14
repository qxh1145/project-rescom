import { adminVoucherStateSchema, adminVoucherStockSchema, adminVoucherInputSchema, adminVoucherSchema, adminVoucherDetailSchema, adminVoucherListSchema, adminVoucherListQuerySchema, adminVoucherStatePatchSchema, adminVoucherBrandListSchema, adminVoucherCreatedSchema, adminVoucherPriceVersionSchema, adminVoucherPriceChangeSchema, adminStockAdjustmentSchema, adminCodeImportRequestSchema, adminCodeImportResultSchema, adminFlashSaleStatusSchema, adminFlashSaleInputSchema, adminFlashSaleSchema, adminFlashEndRequestSchema, adminFlashSaleListQuerySchema, adminFlashSaleListSchema, adminFlashSaleCreatedSchema, rewardsStatsQuerySchema, rewardsStatsSchema } from "./rewards-admin.schema";
const id = "11111111-1111-4111-8111-111111111111";
const start = "2026-10-01T00:00:00.000Z";
const end = "2026-10-02T00:00:00.000Z";
const expires = "2026-10-09T00:00:00.000Z";
const brand = { id: "highlands", name: "Highlands" };
const input = { title: "Coffee", brandId: "highlands", category: "COFFEE", valueVnd: 50000, basePoints: 250, promoPoints: null, isSharedCode: false, redeemStartsAt: start, redeemEndsAt: end, codeExpiresAt: expires, terms: [], howToUse: [], imageUrl: null };
const stock = { total: 10, issued: 1, flashReserved: 2, remaining: 7, codesAvailable: 7 };
const voucher = { ...input, id, brand, price: { points: 250, basePoints: 250, source: "BASE", discountPercent: 0, priceVersion: 1 }, state: "ACTIVE", status: "ACTIVE", isVisible: true, stock, priceDeviationPercent: 0, createdAt: start, updatedAt: start };
const flashItem = { id, voucherId: id, voucherTitle: "Coffee", brand, category: "COFFEE", valueVnd: 50000, flashPoints: 150, basePoints: 250, discountPercent: 40, quota: 2, sold: 0, perUserCap: 1, state: "ACTIVE" };
describe("admin rewards contracts (Story 12.1, FR-73)", () => {
  it("validates admin voucher list, query, patch, brands, and write response", () => {
    const summary = { total: 1, active: 1, paused: 0, soldOut: 0, expired: 0, hidden: 0, archived: 0, lowStock: [{ voucherId: id, label: "Coffee" }], codesAvailable: 7, flashReserved: 2, activeFlashSales: 1 };
    const list = { items: [voucher], summary, serverTime: start };
    expect(adminVoucherListSchema.safeParse(list).success).toBe(true);
    for (const key of Object.keys(summary)) expect(adminVoucherListSchema.safeParse({ ...list, summary: { ...summary, [key]: undefined } }).success).toBe(false);
    expect(adminVoucherListSchema.safeParse({ ...list, serverTime: "invalid" }).success).toBe(false);
    expect(adminVoucherListQuerySchema.parse({}).filter).toBe("ALL");
    expect(adminVoucherListQuerySchema.parse({ q: " Coffee " }).q).toBe("Coffee");
    expect(adminVoucherListQuerySchema.safeParse({ filter: "ARCHIVED" }).success).toBe(false);
    expect(adminVoucherListQuerySchema.safeParse({ q: "  " }).success).toBe(false);
    expect(adminVoucherStatePatchSchema.safeParse({ state: "PAUSED" }).success).toBe(true);
    expect(adminVoucherStatePatchSchema.safeParse({ isVisible: false }).success).toBe(true);
    expect(adminVoucherStatePatchSchema.safeParse({}).success).toBe(false);
    expect(adminVoucherStatePatchSchema.safeParse({ state: "HIDDEN" }).success).toBe(false);
    expect(adminVoucherBrandListSchema.safeParse({ items: [brand] }).success).toBe(true);
    expect(adminVoucherBrandListSchema.safeParse({ items: [{ id: "!", name: "" }] }).success).toBe(false);
    expect(adminVoucherCreatedSchema.safeParse({ voucher }).success).toBe(true);
    expect(adminVoucherCreatedSchema.safeParse({ voucher: { ...voucher, stock: { ...stock, remaining: 8 } } }).success).toBe(false);
  });
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
    expect(adminFlashEndRequestSchema.safeParse({ reason: "OTHER" }).success).toBe(false);
    expect(adminFlashEndRequestSchema.safeParse({ reason: "OTHER", note: "Khác" }).success).toBe(true);
    expect(adminFlashSaleListQuerySchema.safeParse({ status: "BROKEN" }).success).toBe(false);
    const flash = { title: "Flash trưa", startsAt: start, endsAt: "2026-10-01T06:00:00.000Z", items: [{ voucherId: id, flashPoints: 150, quota: 2 }] };
    expect(adminFlashSaleInputSchema.parse(flash).items[0].perUserCap).toBe(1);
    expect(adminFlashSaleInputSchema.safeParse({ ...flash, startsAt: "2026-10-01T03:00:00.000Z", endsAt: "2026-10-01T03:00:00Z" }).success).toBe(false);
    expect(adminFlashSaleInputSchema.safeParse({ ...flash, endsAt: start }).success).toBe(false);
    expect(adminFlashSaleInputSchema.safeParse({ ...flash, endsAt: end }).success).toBe(false);
    expect(adminFlashSaleInputSchema.safeParse({ ...flash, title: " " }).success).toBe(false);
    expect(adminFlashSaleInputSchema.safeParse({ ...flash, items: [flash.items[0], flash.items[0]] }).success).toBe(false);
    expect(adminFlashSaleSchema.safeParse({ id, code: "FS-1013-A", title: "Flash trưa", createdBy: { id, name: "Admin" }, rules: { requireRecentSurvey: true, remindBefore10m: true, blockFlagged: true }, remindCount: 0, endReason: null, succeededCount: 0, participants: 0, failures: { SOLD_OUT: 0, INSUFFICIENT_POINTS: 0, OTHER: 0 }, afterTopUp: { count: 0, rate: 0, flagged: 0 }, startsAt: start, endsAt: end, status: "ACTIVE", endedEarlyAt: null, items: [{ ...flashItem, unsold: 2, pointsSpent: 0, perMinute: 0, soldOutAt: null, etaAt: null, regularPoints: 250 }], pointsSpent: 150 }).success).toBe(false);
    expect(adminFlashSaleSchema.safeParse({ id, code: "FS-261013-A", title: "Flash trưa", createdBy: { id, name: "Admin" }, rules: { requireRecentSurvey: true, remindBefore10m: true, blockFlagged: true }, remindCount: 0, endReason: null, succeededCount: 0, participants: 0, failures: { SOLD_OUT: 0, INSUFFICIENT_POINTS: 0, OTHER: 0 }, afterTopUp: { count: 0, rate: 0, flagged: 0 }, startsAt: start, endsAt: end, status: "ACTIVE", endedEarlyAt: null, items: [{ ...flashItem, unsold: 2, pointsSpent: 0, perMinute: 0, soldOutAt: null, etaAt: null, regularPoints: 250 }], pointsSpent: 150 }).success).toBe(true);
  });
  it("validates date span and statistics payload", () => {
    expect(rewardsStatsQuerySchema.safeParse({ from: "2026-01-01", to: "2026-12-31" }).success).toBe(true);
    for (const range of [{ from: "2026-10-02", to: "2026-10-01" }, { from: "2025-01-01", to: "2026-10-01" }, { from: "2026-02-30", to: "2026-10-01" }]) expect(rewardsStatsQuerySchema.safeParse(range).success).toBe(false);
    const stats = { range: { from: "2026-10-01", to: "2026-10-02" }, updatedAt: start, kpis: { activeVouchers: { active: 1, total: 2, soldOut: 0, expired: 1 }, redemptions: { count: 1, avgPerRegularDay: 0.5 }, pointsSpent: { points: 150, vndEquivalent: 30000 }, redemptionRate: { redeemed: 1, offered: 2, rate: 0.5 }, topVoucher: { voucherId: id, label: "Coffee", count: 1, share: 1 }, selfReportedUsageRate: 0.5 }, daily: [{ date: "2026-10-01", count: 1, flashSaleCodes: ["FS-261013-A"] }], byBrand: [{ brand, redemptions: 1, pointsSpent: 150, soldRatio: 0.5 }], flashSales: [{ flashSaleId: id, code: "FS-261013-A", startsAt: start, itemsLabel: "Coffee", sold: 1, quota: 2, status: "ACTIVE", pointsSpent: 150, soldOutAfterMinutes: null }] };
    expect(rewardsStatsSchema.safeParse(stats).success).toBe(true);
    expect(rewardsStatsSchema.safeParse({ ...stats, kpis: { ...stats.kpis, selfReportedUsageRate: 1.1 } }).success).toBe(false);
  });

  describe("admin code issue queue contracts (Story 12.10, FR-75)", () => {
    it("validates resolve input discriminated union and note requirement for REJECT", () => {
      const { adminResolveCodeIssueSchema } = require("./rewards-admin.schema");
      expect(adminResolveCodeIssueSchema.safeParse({ outcome: "REPLACE" }).success).toBe(true);
      expect(adminResolveCodeIssueSchema.safeParse({ outcome: "REFUND", note: "Customer service refund" }).success).toBe(true);
      expect(adminResolveCodeIssueSchema.safeParse({ outcome: "REJECT" }).success).toBe(false);
      expect(adminResolveCodeIssueSchema.safeParse({ outcome: "REJECT", note: "   " }).success).toBe(false);
      expect(adminResolveCodeIssueSchema.safeParse({ outcome: "REJECT", note: "Valid reason for rejection" }).success).toBe(true);
    });
  });
});
