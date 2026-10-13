// ASSUMED API CONTRACT: backend Stories 12.7–12.10 must match or update these schemas.
import { z } from "zod";
import { MAX_PAGINATION_OFFSET } from "../common/pagination.schema";

const id = z.string().uuid();
const instant = z.string().datetime();
const count = z.number().int().nonnegative();
export const VOUCHER_CATEGORIES = ["COFFEE", "TEA", "CHICKEN_BURGER", "BAKERY_DESSERT"] as const;
export const voucherCategorySchema = z.enum(VOUCHER_CATEGORIES);
export const voucherBrandSchema = z.object({ id: z.string().regex(/^[a-z0-9-]{2,40}$/), name: z.string().min(1).max(60) });
export const voucherPriceSourceSchema = z.enum(["BASE", "PROMO", "FLASH"]);
export const voucherDiscountPercent = (points: number, basePoints: number) => Math.round((1 - points / basePoints) * 100);
export const voucherPriceSchema = z.object({ points: z.number().int().positive(), basePoints: z.number().int().positive(), source: voucherPriceSourceSchema, discountPercent: z.number().int().min(0).max(99), priceVersion: z.number().int().min(1) }).refine(p => p.points <= p.basePoints && (p.source === "BASE") === (p.points === p.basePoints && p.discountPercent === 0) && p.discountPercent === voucherDiscountPercent(p.points, p.basePoints), "Invalid voucher price");
export const voucherStatusSchema = z.enum(["AVAILABLE", "SOLD_OUT", "EXPIRED", "PAUSED"]);
export const voucherFlashSummarySchema = z.object({ flashSaleId: id, flashSaleItemId: id, quota: z.number().int().positive(), sold: count, endsAt: instant }).refine(v => v.sold <= v.quota);
export const voucherListItemSchema = z.object({ id, title: z.string().min(1), brand: voucherBrandSchema, category: voucherCategorySchema, valueVnd: z.number().int().positive(), price: voucherPriceSchema, status: voucherStatusSchema, stockTotal: count, stockRemaining: count, redeemEndsAt: instant, codeExpiresAt: instant, flash: voucherFlashSummarySchema.nullable(), affordable: z.boolean(), imageUrl: z.string().url().nullable() });
// ASSUMED API CONTRACT (Story 12.2, additive)
export const voucherDetailSchema = voucherListItemSchema.extend({
  description: z.string().min(1).max(1000),
  whereToUse: z.string().min(1).max(300),
  terms: z.array(z.string()),
  howToUse: z.array(z.string()),
  isSharedCode: z.boolean(),
});
export const VOUCHER_SORTS = ["BEST_DEAL", "POINTS_ASC", "POINTS_DESC", "NEWEST"] as const;
export const voucherSortSchema = z.enum(VOUCHER_SORTS);
const csv = z.string().transform(value => value.split(",").map(part => part.trim()));
const flag = z.enum(["true", "false"]).transform(value => value === "true");
export const voucherCatalogQuerySchema = z.object({ q: z.string().trim().min(1).max(100).optional(), category: csv.pipe(z.array(voucherCategorySchema).min(1)).optional(), brand: csv.pipe(z.array(voucherBrandSchema.shape.id).min(1)).optional(), minPoints: z.coerce.number().int().nonnegative().optional(), maxPoints: z.coerce.number().int().nonnegative().optional(), onSale: flag.optional(), affordable: flag.optional(), sort: voucherSortSchema.default("BEST_DEAL"), limit: z.coerce.number().int().min(1).max(50).default(20), offset: z.coerce.number().int().min(0).max(MAX_PAGINATION_OFFSET).default(0) }).refine(q => q.minPoints === undefined || q.maxPoints === undefined || q.minPoints <= q.maxPoints, { path: ["maxPoints"] });
export const rewardsViewerBalanceSchema = z.object({ available: count, pending: count });
export const voucherCatalogSchema = z.object({ items: z.array(voucherListItemSchema), total: count, limit: z.number().int().min(1).max(50), offset: count, hasMore: z.boolean(), serverTime: instant, viewer: rewardsViewerBalanceSchema });
export const voucherDetailResponseSchema = z.object({ voucher: voucherDetailSchema, serverTime: instant, viewer: rewardsViewerBalanceSchema });
export const flashSaleItemStateSchema = z.enum(["UPCOMING", "ACTIVE", "ENDED", "SOLD_OUT"]);
// ASSUMED API CONTRACT (Story 12.2, additive)
export const flashSaleItemSchema = z.object({ id, voucherId: id, voucherTitle: z.string().min(1), brand: voucherBrandSchema, category: voucherCategorySchema, valueVnd: z.number().int().positive(), flashPoints: z.number().int().positive(), basePoints: z.number().int().positive(), discountPercent: z.number().int().min(0).max(99), quota: z.number().int().positive(), sold: count, perUserCap: z.number().int().min(1), state: flashSaleItemStateSchema }).refine(v => v.flashPoints < v.basePoints && v.sold <= v.quota && v.discountPercent === voucherDiscountPercent(v.flashPoints, v.basePoints));
export const flashSaleSchema = z.object({ id, code: z.string().regex(/^FS-\d{4}-[A-Z]$/), startsAt: instant, endsAt: instant, items: z.array(flashSaleItemSchema).min(1) }).refine(v => v.endsAt > v.startsAt, { path: ["endsAt"] }).refine(v => new Set(v.items.map(i => i.voucherId)).size === v.items.length, { path: ["items"] });
export const flashSaleListSchema = z.object({ items: z.array(flashSaleSchema), serverTime: instant });

export type VoucherCategory = z.infer<typeof voucherCategorySchema>;
export type VoucherBrandDto = z.infer<typeof voucherBrandSchema>;
export type VoucherPriceSource = z.infer<typeof voucherPriceSourceSchema>;
export type VoucherPriceDto = z.infer<typeof voucherPriceSchema>;
export type VoucherStatus = z.infer<typeof voucherStatusSchema>;
export type VoucherFlashSummaryDto = z.infer<typeof voucherFlashSummarySchema>;
export type VoucherListItemDto = z.infer<typeof voucherListItemSchema>;
export type VoucherDetailDto = z.infer<typeof voucherDetailSchema>;
export type VoucherSort = z.infer<typeof voucherSortSchema>;
export type VoucherCatalogQuery = z.infer<typeof voucherCatalogQuerySchema>;
export type RewardsViewerBalanceDto = z.infer<typeof rewardsViewerBalanceSchema>;
export type VoucherCatalogDto = z.infer<typeof voucherCatalogSchema>;
export type VoucherDetailResponseDto = z.infer<typeof voucherDetailResponseSchema>;
export type FlashSaleItemState = z.infer<typeof flashSaleItemStateSchema>;
export type FlashSaleItemDto = z.infer<typeof flashSaleItemSchema>;
export type FlashSaleDto = z.infer<typeof flashSaleSchema>;
export type FlashSaleListDto = z.infer<typeof flashSaleListSchema>;
