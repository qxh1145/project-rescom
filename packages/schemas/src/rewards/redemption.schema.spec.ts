import { REDEMPTION_ERROR_CODES, redemptionErrorCodeSchema, redemptionErrorSchema, redemptionQuoteSchema, redeemVoucherSchema, createRedemptionQuoteSchema, voucherTicketSchema, redemptionResultSchema, redemptionHistoryEntrySchema, codeIssueReportSchema, createCodeIssueReportSchema, voucherTicketListSchema, voucherTicketResponseSchema, redemptionHistoryListSchema, redemptionHistoryQuerySchema, REDEMPTION_ERROR_HTTP_STATUS } from "./redemption.schema";
const id = "11111111-1111-4111-8111-111111111111";
const now = "2026-10-01T00:00:00.000Z";
const brand = { id: "highlands", name: "Highlands" };
const price = { points: 150, basePoints: 250, source: "FLASH", discountPercent: 40, priceVersion: 1 };
const ticket = { id, redemptionId: id, reference: "RDM-2610-8F2K", voucherId: id, title: "Coffee", brand, category: "COFFEE", valueVnd: 50000, code: "HLRC-1234", isSharedCode: false, status: "UNUSED", redeemedAt: now, expiresAt: now, usedAt: null, undoUntil: null, pointsSpent: 150, priceSource: "FLASH", howToUse: [], openIssue: null };
const errors = [
  { code: "SOLD_OUT", details: { voucherId: id, regularStockRemaining: 0 } },
  { code: "PRICE_CHANGED", details: { voucherId: id, price } },
  { code: "INSUFFICIENT_POINTS", details: { required: 150, available: 100 } },
  { code: "VOUCHER_UNAVAILABLE", details: { voucherId: id, status: "PAUSED" } },
  { code: "ACCOUNT_NOT_ELIGIBLE", details: { reason: "ACCOUNT_LOCKED" } },
];
describe("redemption contracts (Story 12.1, FR-69)", () => {
  it("closes five error codes and validates matching details", () => {
    expect(redemptionErrorCodeSchema.options).toEqual(REDEMPTION_ERROR_CODES);
    expect(Object.keys(REDEMPTION_ERROR_HTTP_STATUS)).toEqual(REDEMPTION_ERROR_CODES);
    for (const error of errors) {
      expect(redemptionErrorSchema.safeParse({ ...error, message: "Error" }).success).toBe(true);
      expect(redemptionErrorSchema.safeParse({ ...error, details: { no: "match" }, message: "Error" }).success).toBe(false);
    }
    expect(redemptionErrorSchema.safeParse({ code: "UNKNOWN", details: {}, message: "Error" }).success).toBe(false);
    expect(redemptionErrorSchema.safeParse({ ...errors[2], details: { required: 100, available: 100 }, message: "Error" }).success).toBe(false);
  });
  it("parses quote, ticket, result and history with invariants", () => {
    expect(createRedemptionQuoteSchema.safeParse({ voucherId: id }).success).toBe(true);
    expect(redeemVoucherSchema.safeParse({ quoteId: id }).success).toBe(true);
    const quote = { quoteId: id, voucherId: id, price, flashSaleItemId: id, expiresAt: now, flashEndsAt: now, balance: { available: 186, after: 36 }, serverTime: now };
    expect(redemptionQuoteSchema.safeParse(quote).success).toBe(true);
    expect(redemptionQuoteSchema.safeParse({ ...quote, balance: { available: 186, after: 35 } }).success).toBe(false);
    expect(redemptionQuoteSchema.safeParse({ ...quote, flashEndsAt: null }).success).toBe(false);
    expect(redemptionQuoteSchema.safeParse({ ...quote, expiresAt: "2026-10-02T00:00:00.000Z" }).success).toBe(false);
    expect(voucherTicketSchema.safeParse(ticket).success).toBe(true);
    expect(voucherTicketSchema.safeParse({ ...ticket, status: "USED" }).success).toBe(false);
    expect(voucherTicketListSchema.safeParse({ items: [ticket], total: 1, serverTime: now }).success).toBe(true);
    expect(redemptionResultSchema.safeParse({ redemptionId: id, reference: ticket.reference, status: "SUCCEEDED", voucherId: id, pointsSpent: 150, priceSource: "FLASH", balanceAfter: 36, ticket, createdAt: now }).success).toBe(true);
    const row = { id, reference: ticket.reference, kind: "SUCCEEDED", voucherTitle: "Coffee", brand, valueVnd: 50000, isFlash: true, points: -150, failureCode: null, journalId: id, note: null, createdAt: now };
    expect(redemptionHistoryEntrySchema.safeParse(row).success).toBe(true);
    expect(redemptionHistoryEntrySchema.safeParse({ ...row, reference: "RDM-BAD" }).success).toBe(false);
    expect(redemptionHistoryEntrySchema.safeParse({ ...row, kind: "FAILED", points: -150 }).success).toBe(false);
    expect(redemptionHistoryEntrySchema.safeParse({ ...row, kind: "REFUNDED", reference: "RFD-2610-7HC2", points: 150 }).success).toBe(true);
    const monthSummary = { month: "2026-10", pointsSpent: 150, voucherCount: 1 };
    const list = { items: [row], total: 1, limit: 20, offset: 0, hasMore: false, monthSummary };
    expect(redemptionHistoryListSchema.safeParse(list).success).toBe(true);
    expect(redemptionHistoryListSchema.safeParse({ ...list, monthSummary: { ...monthSummary, month: "2026-13" } }).success).toBe(false);
    expect(redemptionHistoryListSchema.safeParse({ ...list, monthSummary: { ...monthSummary, pointsSpent: -50, voucherCount: -1 } }).success).toBe(true);
    expect(voucherTicketResponseSchema.safeParse({ ticket, serverTime: now }).success).toBe(true);
    expect(redemptionHistoryQuerySchema.parse({})).toEqual({ limit: 20, offset: 0 });
    expect(redemptionHistoryQuerySchema.safeParse({ limit: "51" }).success).toBe(false);
  });
  it("enforces exclusive code-issue outcomes and refund references", () => {
    const report = { id, redemptionId: id, ticketId: id, reason: "CODE_INVALID", note: null, status: "OPEN", createdAt: now, resolvedAt: null, replacementCode: null, refundReference: null };
    expect(createCodeIssueReportSchema.safeParse({ reason: "OTHER", note: "ok" }).success).toBe(true);
    expect(createCodeIssueReportSchema.safeParse({ reason: "OTHER", note: "x".repeat(501) }).success).toBe(false);
    expect(codeIssueReportSchema.safeParse(report).success).toBe(true);
    expect(codeIssueReportSchema.safeParse({ ...report, status: "REFUNDED", resolvedAt: now, refundReference: "RFD-2610-7HC2" }).success).toBe(true);
    expect(codeIssueReportSchema.safeParse({ ...report, status: "REFUNDED", resolvedAt: now, refundReference: "RDM-2610-7HC2" }).success).toBe(false);
    expect(codeIssueReportSchema.safeParse({ ...report, status: "REPLACED", resolvedAt: now, replacementCode: "NEW-CODE" }).success).toBe(true);
    expect(codeIssueReportSchema.safeParse({ ...report, replacementCode: "NEW-CODE" }).success).toBe(false);
  });
});
