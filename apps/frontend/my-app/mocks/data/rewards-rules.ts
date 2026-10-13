/** Pure pricing and redemption decisions; time is supplied by the caller. No state mutation. */
export interface VoucherInventory {
  id: string; title: string; brand: { id: string; name: string }; category: string;
  valueVnd: number; basePoints: number; promoPoints: number | null; priceVersion: number;
  stockTotal: number; stockRemaining: number; redeemStartsAt: string; redeemEndsAt: string;
  codeExpiresAt: string; codesAvailable: number; state: "ACTIVE" | "PAUSED" | "ARCHIVED";
  isVisible: boolean; imageUrl: string | null; description: string; whereToUse: string; terms: string[]; howToUse: string[]; isSharedCode: boolean;
}
export interface FlashInventory {
  id: string; code: string; startsAt: string; endsAt: string; endedEarlyAt: string | null;
  items: { id: string; voucherId: string; flashPoints: number; quota: number; sold: number; perUserCap: number }[];
}
export type VoucherPrice = { points: number; basePoints: number; source: "BASE" | "PROMO" | "FLASH"; discountPercent: number; priceVersion: number };
export interface RedemptionQuote {
  quoteId: string; voucherId: string; userId: string;
  price: VoucherPrice; flashSaleItemId: string | null;
  expiresAt: string; flashEndsAt: string | null; balance: { available: number; after: number }; serverTime: string;
}
export const discountPercent = (points: number, base: number): number => Math.round((1 - points / base) * 100);

export function effectiveVoucherPrice(voucher: VoucherInventory, flashes: FlashInventory[], now: number): { price: VoucherPrice; flash: { flash: FlashInventory; item: FlashInventory["items"][number] } | null } {
  const match = flashes.flatMap((flash) => flash.items.map((item) => ({ flash, item }))).find(({ flash, item }) =>
    item.voucherId === voucher.id && Date.parse(flash.startsAt) <= now && now < Date.parse(flash.endsAt) &&
    (!flash.endedEarlyAt || now < Date.parse(flash.endedEarlyAt)) && item.sold < item.quota);
  const points = match?.item.flashPoints ?? voucher.promoPoints ?? voucher.basePoints;
  const source = match ? "FLASH" as const : voucher.promoPoints ? "PROMO" as const : "BASE" as const;
  return { price: { points, basePoints: voucher.basePoints, source, discountPercent: discountPercent(points, voucher.basePoints), priceVersion: voucher.priceVersion },
    flash: match ?? null };
}

export function voucherAvailability(voucher: VoucherInventory, now: number) {
  if (voucher.state !== "ACTIVE" || !voucher.isVisible) return voucher.state === "PAUSED" ? "PAUSED" : "HIDDEN";
  if (now >= Date.parse(voucher.redeemEndsAt)) return "EXPIRED";
  if (now < Date.parse(voucher.redeemStartsAt)) return "PAUSED";
  if (voucher.stockRemaining === 0 || voucher.codesAvailable === 0) return "SOLD_OUT";
  return "AVAILABLE";
}

/** Effective user-facing status: SOLD_OUT regular stock can still be AVAILABLE via Flash. */
export function effectiveStatus(voucher: VoucherInventory, flashes: FlashInventory[], now: number) {
  const base = voucherAvailability(voucher, now);
  if (base !== "SOLD_OUT") return base;
  const { flash } = effectiveVoucherPrice(voucher, flashes, now);
  return flash && voucher.codesAvailable > 0 ? "AVAILABLE" : "SOLD_OUT";
}

export interface RedemptionError { code: string; details: Record<string, unknown> }

/** Mock-rules decision (Task 5): checks in AD-24 order, returns null on success. Pure. */
export function decideRedemption(voucher: VoucherInventory, flashes: FlashInventory[], quote: RedemptionQuote, available: number, now: number): RedemptionError | null {
  const status = effectiveStatus(voucher, flashes, now);
  if (status !== "AVAILABLE") {
    if (status === "SOLD_OUT") return { code: "SOLD_OUT", details: { voucherId: voucher.id, regularStockRemaining: voucher.stockRemaining } };
    return { code: "VOUCHER_UNAVAILABLE", details: { voucherId: voucher.id, status: status === "HIDDEN" ? "HIDDEN" : status } };
  }
  const { price, flash } = effectiveVoucherPrice(voucher, flashes, now);
  if (now >= Date.parse(quote.expiresAt) || price.priceVersion !== quote.price.priceVersion || price.source !== quote.price.source || price.points !== quote.price.points || flash?.item.id !== (quote.flashSaleItemId ?? undefined))
    return { code: "PRICE_CHANGED", details: { voucherId: voucher.id, price } };
  if ((flash ? flash.item.sold >= flash.item.quota : voucher.stockRemaining <= 0) || voucher.codesAvailable === 0)
    return { code: "SOLD_OUT", details: { voucherId: voucher.id, regularStockRemaining: voucher.stockRemaining } };
  if (available < price.points) return { code: "INSUFFICIENT_POINTS", details: { required: price.points, available } };
  return null;
}

/** Forced scenario: build real-state details for a given error code (Task 7.2). Pure. */
export function forcedError(code: string, voucher: VoucherInventory, flashes: FlashInventory[], available: number, now: number): RedemptionError {
  const { price } = effectiveVoucherPrice(voucher, flashes, now);
  switch (code) {
    // Forced on an affordable voucher: simulate another transaction spending the difference.
    case "INSUFFICIENT_POINTS": return { code, details: { required: price.points, available: Math.min(available, price.points - 1) } };
    case "PRICE_CHANGED": return { code, details: { voucherId: voucher.id, price: { ...price, priceVersion: price.priceVersion + 1 } } };
    case "VOUCHER_UNAVAILABLE": return { code, details: { voucherId: voucher.id, status: "PAUSED" } };
    case "ACCOUNT_NOT_ELIGIBLE": return { code, details: { reason: "ACCOUNT_LOCKED" } };
    default: return { code: "SOLD_OUT", details: { voucherId: voucher.id, regularStockRemaining: voucher.stockRemaining } };
  }
}

export function ticketStatus(ticket: { usedAt: string | null; expiresAt: string }, now: number) {
  if (ticket.usedAt) return "USED";
  const remaining = Date.parse(ticket.expiresAt) - now;
  return remaining <= 0 ? "EXPIRED" : remaining <= 7 * 86_400_000 ? "EXPIRING" : "UNUSED";
}

const VN_OFFSET = 7 * 3_600_000;
const UNDO_WINDOW = 86_400_000;
type TicketFacts = { usedAt: string | null; undoUntil: string | null; expiresAt: string; openIssue?: { status: string } | null };
type TicketDecision = { ok: false; status: number; code: string } | { ok: true; changed: boolean; usedAt?: string; undoUntil?: string };

/** A REFUNDED code issue ends the ticket: points are back, so no mark/undo/report. */
const REFUNDED: TicketDecision = { ok: false, status: 409, code: "TICKET_REFUNDED" };
const isRefunded = (ticket: TicketFacts) => ticket.openIssue?.status === "REFUNDED";

/** Mark used (24 h undo window); idempotent: an already used ticket keeps its first `usedAt`. */
export function markUsedDecision(ticket: TicketFacts, now: number): TicketDecision {
  if (isRefunded(ticket)) return REFUNDED;
  if (ticketStatus(ticket, now) === "EXPIRED") return { ok: false, status: 409, code: "TICKET_EXPIRED" };
  if (ticket.usedAt) return { ok: true, changed: false };
  return { ok: true, changed: true, usedAt: new Date(now).toISOString(), undoUntil: new Date(now + UNDO_WINDOW).toISOString() };
}

export function undoUseDecision(ticket: TicketFacts, now: number): TicketDecision {
  if (isRefunded(ticket)) return REFUNDED;
  if (!ticket.usedAt) return { ok: true, changed: false };
  if (!ticket.undoUntil || now >= Date.parse(ticket.undoUntil)) return { ok: false, status: 409, code: "UNDO_WINDOW_CLOSED" };
  return { ok: true, changed: true };
}

export function codeIssueDecision(ticket: TicketFacts, now: number): TicketDecision {
  if (isRefunded(ticket)) return REFUNDED;
  if (ticketStatus(ticket, now) === "EXPIRED") return { ok: false, status: 409, code: "TICKET_EXPIRED" };
  if (ticket.openIssue?.status === "OPEN") return { ok: false, status: 409, code: "CODE_ISSUE_ALREADY_OPEN" };
  return { ok: true, changed: true };
}

/** Current Asia/Ho_Chi_Minh month: pointsSpent = SUCCEEDED spend minus REFUNDED points; voucherCount = #SUCCEEDED - #REFUNDED. */
export function historyMonthSummary(rows: { kind: string; points: number; createdAt: string }[], now: number) {
  const monthOf = (time: number) => new Date(time + VN_OFFSET).toISOString().slice(0, 7);
  const month = monthOf(now);
  let pointsSpent = 0, voucherCount = 0;
  for (const row of rows) {
    if (monthOf(Date.parse(row.createdAt)) !== month) continue;
    if (row.kind === "SUCCEEDED") { pointsSpent -= row.points; voucherCount++; }
    else if (row.kind === "REFUNDED") { pointsSpent -= row.points; voucherCount--; }
  }
  return { month, pointsSpent, voucherCount };
}
