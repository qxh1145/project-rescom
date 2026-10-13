// ASSUMED API CONTRACT: backend Stories 12.7–12.10 must match or update these schemas.
import { z } from "zod";
import { voucherPriceSchema, voucherPriceSourceSchema, voucherBrandSchema } from "./voucher-catalog.schema";
const id = z.string().uuid();
const instant = z.string().datetime();
const count = z.number().int().nonnegative();
export const REDEMPTION_REFERENCE_PATTERN = /^RDM-\d{4}-[0-9A-Z]{4}$/;
export const REFUND_REFERENCE_PATTERN = /^RFD-\d{4}-[0-9A-Z]{4}$/;
const redemptionReference = z.string().regex(REDEMPTION_REFERENCE_PATTERN);
export const createRedemptionQuoteSchema = z.object({ voucherId: id });
export const redemptionQuoteSchema = z.object({ quoteId: id, voucherId: id, price: voucherPriceSchema, flashSaleItemId: id.nullable(), expiresAt: instant, flashEndsAt: instant.nullable(), balance: z.object({ available: count, after: count }), serverTime: instant }).refine(v => v.balance.after === v.balance.available - v.price.points, { path: ["balance", "after"] }).refine(v => (v.price.source === "FLASH") === (v.flashSaleItemId !== null && v.flashEndsAt !== null) && (v.flashEndsAt === null || v.expiresAt <= v.flashEndsAt), { path: ["flashEndsAt"] });
export const redeemVoucherSchema = z.object({ quoteId: id });
export const REDEMPTION_ERROR_CODES = ["SOLD_OUT", "PRICE_CHANGED", "INSUFFICIENT_POINTS", "VOUCHER_UNAVAILABLE", "ACCOUNT_NOT_ELIGIBLE"] as const;
export const redemptionErrorCodeSchema = z.enum(REDEMPTION_ERROR_CODES);
export const accountNotEligibleReasonSchema = z.enum(["ACCOUNT_NOT_ACTIVATED", "ACCOUNT_LOCKED", "FRAUD_FLAGGED", "NO_RECENT_SURVEY", "VOUCHER_LIMIT_REACHED", "DAILY_LIMIT_REACHED", "FLASH_LIMIT_REACHED"]);
export const redemptionErrorSchema = z.discriminatedUnion("code", [
  z.object({ code: z.literal("SOLD_OUT"), message: z.string(), details: z.object({ voucherId: id, regularStockRemaining: count }) }),
  z.object({ code: z.literal("PRICE_CHANGED"), message: z.string(), details: z.object({ voucherId: id, price: voucherPriceSchema }) }),
  z.object({ code: z.literal("INSUFFICIENT_POINTS"), message: z.string(), details: z.object({ required: z.number().int().positive(), available: count }).refine(v => v.available < v.required) }),
  z.object({ code: z.literal("VOUCHER_UNAVAILABLE"), message: z.string(), details: z.object({ voucherId: id, status: z.enum(["PAUSED", "HIDDEN", "ARCHIVED", "EXPIRED"]) }) }),
  z.object({ code: z.literal("ACCOUNT_NOT_ELIGIBLE"), message: z.string(), details: z.object({ reason: accountNotEligibleReasonSchema }) }),
]);
export const REDEMPTION_ERROR_HTTP_STATUS = { SOLD_OUT: 409, PRICE_CHANGED: 409, INSUFFICIENT_POINTS: 409, VOUCHER_UNAVAILABLE: 409, ACCOUNT_NOT_ELIGIBLE: 403 } as const;
export const voucherTicketStatusSchema = z.enum(["UNUSED", "EXPIRING", "USED", "EXPIRED"]);
export const codeIssueStatusSchema = z.enum(["OPEN", "REPLACED", "REFUNDED", "REJECTED"]);
export const codeIssueReasonSchema = z.enum(["CODE_INVALID", "CODE_ALREADY_USED", "STORE_REFUSED", "OTHER"]);
export const voucherTicketSchema = z.object({ id, redemptionId: id, reference: redemptionReference, voucherId: id, title: z.string().min(1), brand: voucherBrandSchema, valueVnd: z.number().int().positive(), code: z.string().min(4).max(64), isSharedCode: z.boolean(), status: voucherTicketStatusSchema, redeemedAt: instant, expiresAt: instant, usedAt: instant.nullable(), undoUntil: instant.nullable(), pointsSpent: z.number().int().positive(), priceSource: voucherPriceSourceSchema, howToUse: z.array(z.string()), openIssue: z.object({ id, status: codeIssueStatusSchema }).nullable() }).refine(v => (v.status === "USED") === (v.usedAt !== null), { path: ["usedAt"] });
export const redemptionResultSchema = z.object({ redemptionId: id, reference: redemptionReference, status: z.literal("SUCCEEDED"), voucherId: id, pointsSpent: z.number().int().positive(), priceSource: voucherPriceSourceSchema, balanceAfter: count, ticket: voucherTicketSchema, createdAt: instant });
export const redemptionHistoryKindSchema = z.enum(["SUCCEEDED", "FAILED", "REFUNDED"]);
export const redemptionHistoryEntrySchema = z.object({ id, reference: z.string().refine(v => REDEMPTION_REFERENCE_PATTERN.test(v) || REFUND_REFERENCE_PATTERN.test(v)), kind: redemptionHistoryKindSchema, voucherTitle: z.string().min(1), brand: voucherBrandSchema, valueVnd: z.number().int().positive(), isFlash: z.boolean(), points: z.number().int(), failureCode: redemptionErrorCodeSchema.nullable(), journalId: id.nullable(), note: z.string().nullable(), createdAt: instant }).refine(v => v.kind === "FAILED" ? v.points === 0 && v.journalId === null && v.failureCode !== null : v.kind === "SUCCEEDED" ? v.points < 0 && REDEMPTION_REFERENCE_PATTERN.test(v.reference) : v.points > 0 && REFUND_REFERENCE_PATTERN.test(v.reference), { path: ["points"] });
export const createCodeIssueReportSchema = z.object({ reason: codeIssueReasonSchema, note: z.string().trim().max(500).optional() });
export const codeIssueReportSchema = z.object({ id, redemptionId: id, ticketId: id, reason: codeIssueReasonSchema, note: z.string().nullable(), status: codeIssueStatusSchema, createdAt: instant, resolvedAt: instant.nullable(), replacementCode: z.string().nullable(), refundReference: z.string().nullable() }).refine(v => v.status === "REPLACED" ? !!v.replacementCode && v.refundReference === null && v.resolvedAt !== null : v.status === "REFUNDED" ? v.replacementCode === null && v.refundReference !== null && REFUND_REFERENCE_PATTERN.test(v.refundReference) && v.resolvedAt !== null : v.status === "OPEN" ? v.replacementCode === null && v.refundReference === null && v.resolvedAt === null : v.replacementCode === null && v.refundReference === null && v.resolvedAt !== null);
export const voucherTicketListSchema = z.object({ items: z.array(voucherTicketSchema), total: count, serverTime: instant });
export const redemptionHistoryListSchema = z.object({ items: z.array(redemptionHistoryEntrySchema), total: count, limit: z.number().int().positive(), offset: count, hasMore: z.boolean() });
