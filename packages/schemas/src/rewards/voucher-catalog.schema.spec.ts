import { voucherPriceSchema, voucherCatalogQuerySchema, flashSaleSchema, flashSaleItemSchema, voucherListItemSchema, voucherDetailSchema, voucherCatalogSchema, voucherDetailResponseSchema, flashSaleListSchema, voucherFlashSummarySchema, voucherDiscountPercent } from "./voucher-catalog.schema";
const id = "11111111-1111-4111-8111-111111111111";
const later = "2026-11-01T00:00:00.000Z";
const brand = { id: "highlands", name: "Highlands" };
const price = { points: 150, basePoints: 250, source: "FLASH", discountPercent: 40, priceVersion: 1 };
const item = { id, title: "Coffee", brand, category: "COFFEE", valueVnd: 50000, price, status: "AVAILABLE", stockTotal: 10, stockRemaining: 5, redeemEndsAt: later, codeExpiresAt: later, flash: null, affordable: true, imageUrl: null };
const flashItem = { id, voucherId: id, voucherTitle: "Coffee", brand, category: "COFFEE", valueVnd: 50000, flashPoints: 150, basePoints: 250, discountPercent: 40, quota: 10, sold: 1, perUserCap: 1, state: "ACTIVE" };
const detailItem = { ...item, description: "Voucher 50k", whereToUse: "Toàn quốc", terms: [], howToUse: [], isSharedCode: false };
describe("voucher catalog contracts (Story 12.1, FR-68)", () => {
  it("parses price, voucher, lists, flash, and response", () => {
    expect(voucherPriceSchema.safeParse(price).success).toBe(true);
    expect(voucherDiscountPercent(90, 125)).toBe(28);
    expect(voucherListItemSchema.safeParse(item).success).toBe(true);
    expect(voucherDetailSchema.safeParse(detailItem).success).toBe(true);
    expect(voucherFlashSummarySchema.safeParse({ flashSaleId: id, flashSaleItemId: id, quota: 2, sold: 1, endsAt: later }).success).toBe(true);
    expect(flashSaleItemSchema.safeParse(flashItem).success).toBe(true);
    const flash = { id, code: "FS-261013-A", startsAt: "2026-10-01T00:00:00.000Z", endsAt: later, items: [flashItem] };
    expect(flashSaleSchema.safeParse(flash).success).toBe(true);
    expect(flashSaleListSchema.safeParse({ items: [flash], serverTime: later }).success).toBe(true);
    expect(voucherCatalogSchema.safeParse({ items: [item], total: 1, limit: 20, offset: 0, hasMore: false, serverTime: later, viewer: { available: 186, pending: 18 } }).success).toBe(true);
    expect(voucherDetailResponseSchema.safeParse({ voucher: detailItem, serverTime: later, viewer: { available: 186, pending: 18 } }).success).toBe(true);
    expect(flashSaleSchema.safeParse({ ...flash, items: [flashItem, { ...flashItem, id: "22222222-2222-4222-8222-222222222222" }] }).success).toBe(false);
    expect(flashSaleSchema.safeParse({ ...flash, endsAt: flash.startsAt }).success).toBe(false);
    expect(flashSaleItemSchema.safeParse({ ...flashItem, sold: 11 }).success).toBe(false);
    expect(voucherFlashSummarySchema.safeParse({ flashSaleId: id, flashSaleItemId: id, quota: 2, sold: 3, endsAt: later }).success).toBe(false);
    expect(voucherDetailSchema.safeParse({ ...detailItem, description: "" }).success).toBe(false);
    expect(flashSaleItemSchema.safeParse({ ...flashItem, category: "UNKNOWN" }).success).toBe(false);
  });
  it("rejects wrong price arithmetic and parses false query flags", () => {
    for (const changed of [{ points: 251 }, { source: "BASE" }, { discountPercent: 39 }]) expect(voucherPriceSchema.safeParse({ ...price, ...changed }).success).toBe(false);
    expect(voucherCatalogQuerySchema.parse({ category: "COFFEE,TEA", brand: "highlands,phuc-long", onSale: "false", affordable: "true" })).toMatchObject({ category: ["COFFEE", "TEA"], brand: ["highlands", "phuc-long"], onSale: false, affordable: true });
    for (const query of [{ onSale: "yes" }, { minPoints: 201, maxPoints: 100 }, { offset: 10001 }]) expect(voucherCatalogQuerySchema.safeParse(query).success).toBe(false);
  });
});
