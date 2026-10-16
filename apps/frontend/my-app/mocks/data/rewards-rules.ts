import { POINT_VND_RATE } from "@rescom/schemas";

/** Pure pricing and redemption decisions; time is supplied by the caller. No state mutation. */
export interface VoucherInventory {
  id: string; title: string; brand: { id: string; name: string }; category: string;
  valueVnd: number; basePoints: number; promoPoints: number | null; priceVersion: number;
  stockTotal: number; stockRemaining: number; redeemStartsAt: string; redeemEndsAt: string;
  codeExpiresAt: string; codesAvailable: number; state: "ACTIVE" | "PAUSED" | "ARCHIVED";
  createdAt?: string; updatedAt?: string; isVisible: boolean; imageUrl: string | null; description: string; whereToUse: string; terms: string[]; howToUse: string[]; isSharedCode: boolean;
}
export interface FlashInventory {
  id: string; code: string; title: string; createdBy: { id: string; name: string }; rules: { requireRecentSurvey: boolean; remindBefore10m: boolean; blockFlagged: boolean }; remindCount: number; endReason: "WRONG_PRICE" | "STOCK_ISSUE" | "PARTNER_REQUEST" | "OTHER" | null; settledAt: string | null; failures: { SOLD_OUT: number; INSUFFICIENT_POINTS: number; OTHER: number }; afterTopUp: { count: number; rate: number; flagged: number }; participants: number; startsAt: string; endsAt: string; endedEarlyAt: string | null;
  items: { id: string; voucherId: string; flashPoints: number; quota: number; sold: number; perUserCap: number; soldOutAt?: string | null }[];
}
export type VoucherPrice = { points: number; basePoints: number; source: "BASE" | "PROMO" | "FLASH"; discountPercent: number; priceVersion: number };
export interface RedemptionQuote {
  quoteId: string; voucherId: string; userId: string;
  price: VoucherPrice; flashSaleItemId: string | null;
  expiresAt: string; flashEndsAt: string | null; balance: { available: number; after: number }; serverTime: string;
  /** Set when a redeem with this quote succeeded; a quote is single-use (mirrors backend 12.8). */
  redeemedAt?: string;
}
export const VOUCHER_BRAND_IDS = ["highlands", "lotteria", "phuc-long", "kfc", "gong-cha", "the-coffee-house"];
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
export function decideRedemption(voucher: VoucherInventory, flashes: FlashInventory[], quote: RedemptionQuote, available: number, now: number, refundHold?: number): RedemptionError | null {
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
  if (available < price.points) {
    return {
      code: "INSUFFICIENT_POINTS",
      details: {
        required: price.points,
        available,
        ...(refundHold && refundHold > 0 ? { refundHoldPoints: refundHold } : {}),
      },
    };
  }
  return null;
}

/** Forced scenario: build real-state details for a given error code (Task 7.2). Pure. */
export function forcedError(code: string, voucher: VoucherInventory, flashes: FlashInventory[], available: number, now: number, refundHold?: number): RedemptionError {
  const { price } = effectiveVoucherPrice(voucher, flashes, now);
  switch (code) {
    // Forced on an affordable voucher: simulate another transaction spending the difference.
    case "INSUFFICIENT_POINTS":
      return {
        code,
        details: {
          required: price.points,
          available: Math.min(available, price.points - 1),
          ...(refundHold && refundHold > 0 ? { refundHoldPoints: refundHold } : {}),
        },
      };
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

export type CodeIssueOutcome = "REPLACE" | "REFUND" | "REJECT";
export type ReplaceBlockedReason = "SHARED_CODE" | "TICKET_EXPIRED" | "NO_STOCK" | "NO_CODE" | null;
export function replaceBlockedReason(facts: { status: string; isSharedCode: boolean; expiresAt: string | Date | number; stockRemaining: number; codesAvailable: number }, now: number): ReplaceBlockedReason {
  if (facts.status !== "OPEN") return null;
  if (facts.isSharedCode) return "SHARED_CODE";
  if (now >= +new Date(facts.expiresAt)) return "TICKET_EXPIRED";
  if (facts.stockRemaining <= 0) return "NO_STOCK";
  if (facts.codesAvailable <= 0) return "NO_CODE";
  return null;
}
export function resolveCodeIssueDecision(report: { status: string }, ticket: { expiresAt: string | Date | number; refunded: boolean }, voucher: { isSharedCode: boolean; stockRemaining: number; codesAvailable: number }, outcome: CodeIssueOutcome, now: number) {
  if (report.status !== "OPEN") return outcome === ({ REPLACED: "REPLACE", REFUNDED: "REFUND", REJECTED: "REJECT" } as Record<string, string>)[report.status]
    ? { ok: true as const, replay: true as const }
    : { ok: false as const, status: 409 as const, code: "CODE_ISSUE_ALREADY_RESOLVED" };
  if (outcome === "REJECT") return { ok: true as const, replay: false as const };
  if (outcome === "REFUND") return ticket.refunded ? { ok: false as const, status: 409 as const, code: "TICKET_REFUNDED" } : { ok: true as const, replay: false as const };
  const code = voucher.isSharedCode ? "REPLACEMENT_NOT_SUPPORTED" : now >= +new Date(ticket.expiresAt) ? "TICKET_EXPIRED" : voucher.stockRemaining <= 0 || voucher.codesAvailable <= 0 ? "NO_REPLACEMENT_AVAILABLE" : null;
  return code ? { ok: false as const, status: 409 as const, code } : { ok: true as const, replay: false as const };
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

/** Admin inventory keeps committed Flash quota separate from regular remaining. */
export function adminStockOf(v: VoucherInventory, flashes: FlashInventory[], now: number) {
  const flashReserved = flashes.filter(f => now < Date.parse(f.endsAt) && (!f.endedEarlyAt || now < Date.parse(f.endedEarlyAt)))
    .flatMap(f => f.items).filter(i => i.voucherId === v.id).reduce((sum, i) => sum + i.quota - i.sold, 0);
  return { total: v.stockTotal, issued: v.stockTotal - v.stockRemaining - flashReserved, flashReserved, remaining: v.stockRemaining, codesAvailable: v.codesAvailable };
}

export function adminVoucherStatus(v: VoucherInventory, flashes: FlashInventory[], now: number) {
  if (v.state === "ARCHIVED") return "ARCHIVED";
  const status = voucherAvailability(v.isSharedCode ? { ...v, codesAvailable: Math.max(v.codesAvailable, 1) } : v, now);
  if (!v.isVisible) return "HIDDEN";
  if (v.state === "PAUSED") return "PAUSED";
  if (status === "EXPIRED") return "EXPIRED";
  if (status === "SOLD_OUT") return "SOLD_OUT";
  return "ACTIVE";
}

export function priceDeviationPercent(valueVnd: number, basePoints: number) {
  return Math.round((basePoints / (valueVnd / POINT_VND_RATE) - 1) * 1000) / 10;
}

export function validateVoucherInput(input: { brandId: string; redeemEndsAt: string; isSharedCode: boolean }, existing?: { voucher: VoucherInventory; issued: number; now: number }) {
  const errors: { path: string; code: string }[] = [];
  if (!VOUCHER_BRAND_IDS.includes(input.brandId)) errors.push({ path: "brandId", code: "BRAND_NOT_FOUND" });
  if (existing && input.redeemEndsAt !== existing.voucher.redeemEndsAt && Date.parse(input.redeemEndsAt) < existing.now) errors.push({ path: "redeemEndsAt", code: "REDEMPTION_WINDOW_ENDED" });
  if (existing && existing.issued > 0 && input.isSharedCode !== existing.voucher.isSharedCode) errors.push({ path: "isSharedCode", code: "SHARED_FLAG_LOCKED" });
  return errors;
}

export function stockAdjustmentDecision(v: VoucherInventory, stock: ReturnType<typeof adminStockOf>, nextTotal: number) {
  if (nextTotal < stock.issued + stock.flashReserved) return { ok: false as const, status: 409, code: "STOCK_BELOW_COMMITTED", details: { minimum: stock.issued + stock.flashReserved } };
  if (nextTotal > stock.total && !v.isSharedCode) return { ok: false as const, status: 409, code: "STOCK_INCREASE_NEEDS_CODES" };
  const removeCodes = stock.total - nextTotal;
  if (!v.isSharedCode && removeCodes > stock.codesAvailable) return { ok: false as const, status: 409, code: "STOCK_EXCEEDS_CODES" };
  return { ok: true as const, removeCodes };
}

export function importCodesDecision(codes: string[], stored: string[]) {
  const seen = new Set<string>(), duplicates = new Set<string>(), storedSet = new Set(stored), already = new Set<string>();
  for (const raw of codes) {
    const code = raw.trim();
    if (seen.has(code)) duplicates.add(code);
    if (storedSet.has(code)) already.add(code);
    seen.add(code);
  }
  const duplicatesInFile = [...duplicates], alreadyStored = [...already];
  return { received: codes.length, accepted: duplicates.size || already.size ? 0 : codes.length, duplicatesInFile, alreadyStored, committed: false };
}

/** Vietnam uses a fixed UTC+7 offset; no daylight saving time. */
export const vietnamDayOf = (instant: string | number) => new Date((typeof instant === "number" ? instant : Date.parse(instant)) + 7 * 3600000).toISOString().slice(0, 10);
export function bucketByVietnamDay(instants: string[]) {
  return instants.reduce<Record<string, number>>((days, instant) => { const key = vietnamDayOf(instant); days[key] = (days[key] ?? 0) + 1; return days; }, {});
}
export function statsRange(query: { from: string; to: string }, now: number) {
  const today = vietnamDayOf(now);
  const to = query.to < today ? query.to : today;
  return { from: query.from > to ? to : query.from, to };
}
/** UPCOMING starts within 24 h; all program/item windows remain half-open. */
export function adminFlashStatus(flash: FlashInventory, now: number): "SCHEDULED" | "UPCOMING" | "ACTIVE" | "SOLD_OUT" | "ENDED" {
  const start = Date.parse(flash.startsAt);
  if (now >= Date.parse(flash.endsAt) || flash.endedEarlyAt && now >= Date.parse(flash.endedEarlyAt)) return "ENDED";
  if (now < start) return start - now <= 86400000 ? "UPCOMING" : "SCHEDULED";
  return flash.items.every(item => item.sold >= item.quota) ? "SOLD_OUT" : "ACTIVE";
}
export const flashItemState = (flash: FlashInventory, item: FlashInventory["items"][number], now: number) => {
  const status = adminFlashStatus(flash, now);
  return status === "SCHEDULED" || status === "UPCOMING" ? "UPCOMING" : status === "ENDED" ? "ENDED" : item.sold >= item.quota ? "SOLD_OUT" : "ACTIVE";
};
export interface FlashInput { startsAt: string; endsAt: string; items: { voucherId: string; flashPoints: number; quota: number; perUserCap: number }[] }
export function flashConflicts(input: FlashInput, vouchers: VoucherInventory[], flashes: FlashInventory[], now: number, selfId?: string) {
  const conflicts: { path: string; code: string; details: Record<string, unknown> }[] = [];
  if (Date.parse(input.startsAt) <= now) conflicts.push({ path: "startsAt", code: "FLASH_STARTS_IN_PAST", details: {} });
  input.items.forEach((item, index) => {
    const v = vouchers.find(v => v.id === item.voucherId), old = flashes.find(f => f.id === selfId)?.items.find(i => i.voucherId === item.voucherId);
    const path = (field: string) => `items.${index}.${field}`;
    if (!v || v.state !== "ACTIVE" || !v.isVisible || Date.parse(v.redeemStartsAt) > Date.parse(input.startsAt) || Date.parse(v.redeemEndsAt) < Date.parse(input.endsAt) || v.isSharedCode && v.stockRemaining + (old ? old.quota - old.sold : 0) === 0)
      conflicts.push({ path: path("voucherId"), code: "VOUCHER_NOT_FLASHABLE", details: {} });
    if (!v) return;
    const regular = v.promoPoints ?? v.basePoints;
    if (item.flashPoints >= regular) conflicts.push({ path: path("flashPoints"), code: "FLASH_PRICE_NOT_BELOW_REGULAR", details: { regular } });
    const available = v.stockRemaining + (old ? old.quota - old.sold : 0);
    if (item.quota > available) conflicts.push({ path: path("quota"), code: "FLASH_QUOTA_EXCEEDS_STOCK", details: { available } });
    if (old && item.quota < old.sold) conflicts.push({ path: path("quota"), code: "FLASH_QUOTA_BELOW_SOLD", details: { sold: old.sold } });
    const other = flashes.find(f => f.id !== selfId && f.items.some(i => i.voucherId === item.voucherId) &&
      Date.parse(f.startsAt) < Date.parse(input.endsAt) && Date.parse(input.startsAt) < Math.min(Date.parse(f.endsAt), f.endedEarlyAt ? Date.parse(f.endedEarlyAt) : Infinity));
    if (other) conflicts.push({ path: path("voucherId"), code: "FLASH_OVERLAP", details: { code: other.code } });
  });
  return conflicts;
}
export function flashProgress(flash: FlashInventory, now: number) {
  const start = Date.parse(flash.startsAt);
  return flash.items.map(item => {
    const soldOutAt = item.sold >= item.quota ? item.soldOutAt ?? null : null;
    // Rate stops at the real end of selling: sell-out, early end or window end.
    const stop = Math.min(now, Date.parse(flash.endsAt), flash.endedEarlyAt ? Date.parse(flash.endedEarlyAt) : Infinity, soldOutAt ? Date.parse(soldOutAt) : Infinity);
    const perMinute = Math.round(item.sold / Math.max(1, (stop - start) / 60000) * 10) / 10;
    const etaAt = flashItemState(flash, item, now) === "ACTIVE" && perMinute > 0 ? new Date(now + (item.quota - item.sold) / perMinute * 60000).toISOString() : null;
    return { perMinute, etaAt, soldOutAt };
  });
}
export function endEarlyDecision(flash: FlashInventory, now: number) {
  const status = adminFlashStatus(flash, now);
  if (status !== "ACTIVE") return { ok: false as const, status: 409, code: status === "ENDED" ? "FLASH_ALREADY_ENDED" : "FLASH_NOT_ACTIVE", details: {} };
  return { ok: true as const, result: { returned: flash.items.reduce((sum, item) => sum + item.quota - item.sold, 0), items: flash.items.map(item => ({ voucherId: item.voucherId, unsold: item.quota - item.sold })) } };
}
