import { adminStockOf, adminVoucherStatus, importCodesDecision, priceDeviationPercent, stockAdjustmentDecision, validateVoucherInput } from "./rewards-rules";
import { createCollection, mockId } from "../db/store";
import { idempotencyRecordKey, decideIdempotentRequest, type IdempotencyRecord } from "./idempotency";
import { codeIssueDecision, decideRedemption, effectiveStatus, effectiveVoucherPrice, forcedError, historyMonthSummary, markUsedDecision, ticketStatus, undoUseDecision, type FlashInventory, type RedemptionQuote, type VoucherInventory } from "./rewards-rules";

const day = 86_400_000;
const iso = (time: number) => new Date(time).toISOString();
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const brands = ["Highlands Coffee", "Lotteria", "Phúc Long", "KFC", "Gong Cha", "The Coffee House"];
const slugs = ["highlands", "lotteria", "phuc-long", "kfc", "gong-cha", "the-coffee-house"];
const specs: ReadonlyArray<readonly [number, string, string, number, number, number | null, number, number, number]> = [
  [0, "Voucher mua đồ uống", "COFFEE", 50000, 250, null, 300, 180, 60],
  [1, "Voucher burger & gà", "CHICKEN_BURGER", 25000, 125, null, 200, 90, 60],
  [2, "Giảm giá trà & bánh", "TEA", 30000, 150, 120, 150, 104, 40],
  [3, "Voucher combo gà rán", "CHICKEN_BURGER", 40000, 200, null, 120, 62, 55],
  [4, "Voucher trà sữa", "TEA", 20000, 100, null, 80, 9, 5],
  [5, "Voucher cà phê & bánh", "BAKERY_DESSERT", 40000, 200, null, 150, 0, 30],
  [0, "Voucher đồ uống", "COFFEE", 20000, 100, null, 100, 40, -33],
];

function makeCodes(slug: string, count: number): string[] {
  const prefix = slug.replaceAll("-", "").slice(0, 4).toUpperCase();
  return Array.from({ length: count }, (_, n) => `${prefix}-${String(n + 1000)}-${String(n + 2000)}`);
}

function seed() {
  const now = Date.now();
  const vouchers: VoucherInventory[] = specs.map(([brand, title, category, valueVnd, basePoints, promoPoints, stockTotal, stockRemaining, ends], index) => {
    const codes = index === 5 ? [] : makeCodes(slugs[brand], 15);
    const standardTerms = [
      "Áp dụng cho hoá đơn từ 60.000đ.",
      "Mỗi hoá đơn dùng 1 voucher; không cộng dồn khuyến mãi khác.",
      "Không đổi thành tiền mặt, không trả lại phần dư.",
      "Đưa mã hoặc QR cho thu ngân trước khi thanh toán.",
    ];
    let description = `Voucher ${valueVnd.toLocaleString("vi-VN")}đ dùng tại ${brands[brand]}.`;
    let whereToUse = `Mọi cửa hàng ${brands[brand]} trên toàn quốc.`;
    let terms = standardTerms;

    if (index === 0) {
      description = "Voucher 50.000đ dùng cho mọi đồ uống và bánh tại Highlands Coffee. Phù hợp cho buổi học nhóm hay cà phê sáng trước giờ thi.";
      whereToUse = "Mọi cửa hàng Highlands Coffee trên toàn quốc, trừ quầy ở sân bay.";
      terms = standardTerms;
    } else if (index === 3) {
      description = "Voucher 40.000đ cho combo gà rán tại KFC.";
      whereToUse = "Các cửa hàng KFC tại Đà Nẵng.";
      terms = standardTerms.slice(1);
    } else {
      terms = standardTerms.slice(1);
    }

    return {
      id: id(index + 1), title, brand: { id: slugs[brand], name: brands[brand] }, category, valueVnd, basePoints, promoPoints,
      priceVersion: 1, stockTotal, stockRemaining,
      redeemStartsAt: iso(now - (index === 6 ? 60 : index < 2 ? 20 : index < 4 ? 10 : 30) * day),
      redeemEndsAt: iso(now + ends * day),
      codeExpiresAt: iso(now + (index === 6 ? -26 : index === 4 ? 12 : index === 2 ? 48 : index === 3 ? 63 : 79) * day),
      codesAvailable: codes.length, state: "ACTIVE", isVisible: true, imageUrl: null,
      description, whereToUse, terms, isSharedCode: false,
      howToUse: [`Gọi món như bình thường${terms.some((t) => t.includes("60.000đ")) ? ", hoá đơn từ 60.000đ." : "."}`,
        "Trước khi thanh toán, đưa QR hoặc đọc mã cho thu ngân.", `Thu ngân quét mã, trừ ${valueVnd.toLocaleString("vi-VN")}đ vào hoá đơn.`],
    };
  });
  // ponytail: codes stored separately from inventory; codesAvailable is the count for pure rules
  const codePools: Record<string, string[]> = {};
  vouchers.forEach((v, index) => { codePools[v.id] = index === 5 ? [] : makeCodes(slugs[specs[index][0]], 15); });

  const flashes: FlashInventory[] = [
    { id: id(101), code: "FS-1013-A", startsAt: iso(now - 3 * 3600000), endsAt: iso(now + 135 * 60000), endedEarlyAt: null,
      items: ([[1, 150, 100, 75], [2, 90, 80, 48], [5, 70, 50, 50]] as const).map(([n, flashPoints, quota, sold]) =>
        ({ id: id(110 + n), voucherId: id(n), flashPoints, quota, sold, perUserCap: 1 })) },
    { id: id(102), code: "FS-1013-B", startsAt: iso(now + 7 * 3600000), endsAt: iso(now + 10 * 3600000), endedEarlyAt: null,
      items: [{ id: id(114), voucherId: id(4), flashPoints: 140, quota: 50, sold: 0, perUserCap: 1 }] },
  ];

  const tickets = ([
    [5, 100, 5, "RDM-2610-1MZ4", "GCHA-4T8P-2LQW", now + 7 * day - 3600000, null] as const,
    [1 / 24, 150, 1, "RDM-2610-8F2K", "HLRC-7K2M-9QXA", now + 79 * day, null] as const,
    [1, 125, 2, "RDM-2610-3QK7", "LTRA-9D3F-6VNM", now + 79 * day, null] as const,
    [20, 120, 3, "RDM-2609-2PLB", "PLNG-7K2M-9QXA", now + 28 * day, iso(now - 18 * day)] as const,
    [50, 100, 7, "RDM-2608-6HCX", "HLRC-9K2M-9QXA", now - 26 * day, null] as const,
  ] as const).map(([ago, points, vIndex, reference, code, expires, used], n) => {
    const v = vouchers[vIndex - 1];
    return { id: id(300 + n), redemptionId: id(400 + n), reference: String(reference), voucherId: v.id, title: v.title, brand: v.brand, category: v.category,
      valueVnd: v.valueVnd, code: String(code), isSharedCode: false,
      status: ticketStatus({ usedAt: used as string | null, expiresAt: iso(expires) }, now),
      redeemedAt: iso(now - ago * day), expiresAt: iso(expires), usedAt: used as string | null,
      undoUntil: used ? iso(Date.parse(used) + day) : null,
      pointsSpent: points, priceSource: reference === "RDM-2610-8F2K" ? "FLASH" as const : "BASE" as const,
      howToUse: v.howToUse, openIssue: null };
  });

  const history: HistoryRow[] = tickets.map((ticket) => ({ id: ticket.redemptionId, reference: ticket.reference, kind: "SUCCEEDED" as const,
    voucherTitle: ticket.title, brand: ticket.brand, valueVnd: ticket.valueVnd, isFlash: ticket.priceSource === "FLASH",
    points: -ticket.pointsSpent, failureCode: null, journalId: ticket.redemptionId, note: null, createdAt: ticket.redeemedAt }));
  const coffee = vouchers[5];
  history.push({ id: id(490), reference: "RDM-2610-5TC1", kind: "SUCCEEDED", voucherTitle: coffee.title, brand: coffee.brand,
    valueVnd: coffee.valueVnd, isFlash: false, points: -200, failureCode: null, journalId: id(490), note: null, createdAt: iso(now - 8 * day) });
  history.push({ id: id(491), reference: "RFD-2610-7HC2", kind: "REFUNDED", voucherTitle: coffee.title, brand: coffee.brand,
    valueVnd: coffee.valueVnd, isFlash: false, points: 200, failureCode: null, journalId: id(491), note: "mã lỗi, Admin duyệt", createdAt: iso(now - 6 * day) });
  history.push({ id: id(492), reference: "RDM-2610-4KF1", kind: "FAILED", voucherTitle: vouchers[3].title, brand: vouchers[3].brand,
    valueVnd: vouchers[3].valueVnd, isFlash: true, points: 0, failureCode: "SOLD_OUT", journalId: null, note: "Flash Sale · hết suất", createdAt: iso(now - 2 * 3600000) });
  history.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  const demo: UserState = { tickets, history, issues: [{ id: id(493), redemptionId: id(490), ticketId: id(494), reason: "CODE_INVALID", note: "Mã lỗi",
    status: "REFUNDED", createdAt: iso(now - 7 * day), resolvedAt: iso(now - 6 * day), replacementCode: null, refundReference: "RFD-2610-7HC2" }] };
  return {
    vouchers, flashes, codePools, priceHistory: Object.fromEntries(vouchers.map(v => [v.id, [{ version: 1, basePoints: v.basePoints, promoPoints: v.promoPoints, effectiveFrom: v.redeemStartsAt, changedBy: { id: id(999), name: "Admin Hùng" } }]])),
    quotes: {} as Record<string, RedemptionQuote>,
    users: { "user-active-002": demo, "00000000-0000-4000-8000-00000000d001": structuredClone(demo) } as Record<string, UserState>,
    idempotency: {} as Record<string, IdempotencyRecord<StoredResponse>>,
  };
}

interface HistoryRow { id: string; reference: string; kind: string; voucherTitle: string; brand: { id: string; name: string }; valueVnd: number; isFlash: boolean; points: number; failureCode: string | null; journalId: string | null; note: string | null; createdAt: string }
interface TicketRow { id: string; redemptionId: string; reference: string; voucherId: string; title: string; brand: { id: string; name: string }; category: string; valueVnd: number; code: string; isSharedCode: boolean; status: string; redeemedAt: string; expiresAt: string; usedAt: string | null; undoUntil: string | null; pointsSpent: number; priceSource: string; howToUse: string[]; openIssue: { id: string; status: string } | null }
interface IssueRow { id: string; redemptionId: string; ticketId: string; reason: string; note: string | null; status: string; createdAt: string; resolvedAt: string | null; replacementCode: string | null; refundReference: string | null }
interface UserState { tickets: TicketRow[]; history: HistoryRow[]; issues: IssueRow[] }
interface StoredResponse { status: number; body: Record<string, unknown> }
type CatalogState = Pick<ReturnType<typeof seed>, "vouchers" | "flashes" | "codePools" | "priceHistory">;
type UserSideState = Pick<ReturnType<typeof seed>, "quotes" | "users" | "idempotency">;

type Failure = { ok: false; status: number; code: string; details: Record<string, unknown>; replayed?: boolean };
type Decision = { ok: true; result: { pointsSpent: number; ticket: { id: string; title: string }; [key: string]: unknown }; replayed?: boolean } | Failure;
type QuoteDecision = { ok: true; result: Omit<RedemptionQuote, "userId"> } | Failure;

// Catalog inventory and per-user artifacts persist separately; one update per collection on redeem.
export const rewardsCatalog = createCollection<CatalogState>("rewards-catalog", () => {
  const { vouchers, flashes, codePools, priceHistory } = seed(); return { vouchers, flashes, codePools, priceHistory };
});
export const rewardsState = createCollection<UserSideState>("rewards-users", () => {
  const { quotes, users, idempotency } = seed(); return { quotes, users, idempotency };
});

const failure = (code: string, details: Record<string, unknown>): Failure => ({ ok: false, status: code === "ACCOUNT_NOT_ELIGIBLE" ? 403 : 409, code, details });
const viewerOf = (viewer: { available: number; pending?: number }) => ({ available: viewer.available, pending: viewer.pending ?? 0 });
const userRows = (users: Record<string, UserState>, userId: string): UserState => users[userId] ??= { tickets: [], history: [], issues: [] };

/** The mock session gives the demo account a generated id; it gets its own copy of the seeded tickets/history (same email rule as `seedWallet`). */
export function claimDemoRewards(user: { id: string; email: string }): void {
  const { users } = rewardsState.get();
  if (users[user.id] || user.email !== "minh.le@fpt.edu.vn" || !users["user-active-002"]) return;
  rewardsState.update((draft) => { draft.users[user.id] = structuredClone(draft.users["user-active-002"]); });
}

function listed(v: VoucherInventory, catalog: CatalogState, available: number, now: number) {
  const { price, flash } = effectiveVoucherPrice(v, catalog.flashes, now);
  const status = effectiveStatus(v, catalog.flashes, now);
  return { id: v.id, title: v.title, brand: v.brand, category: v.category, valueVnd: v.valueVnd, price,
    status, stockTotal: v.stockTotal, stockRemaining: v.stockRemaining, redeemEndsAt: v.redeemEndsAt,
    codeExpiresAt: v.codeExpiresAt, flash: flash ? { flashSaleId: flash.flash.id, flashSaleItemId: flash.item.id, quota: flash.item.quota, sold: flash.item.sold, endsAt: flash.flash.endsAt } : null,
    affordable: available >= price.points, imageUrl: v.imageUrl };
}

export function voucherOf(voucherId: string, viewer: { available: number; pending?: number }, now = Date.now()) {
  const catalog = rewardsCatalog.get();
  const v = catalog.vouchers.find((v) => v.id === voucherId && v.isVisible && v.state !== "ARCHIVED");
  return v ? { voucher: { ...listed(v, catalog, viewer.available, now), description: v.description, whereToUse: v.whereToUse, terms: v.terms, howToUse: v.howToUse, isSharedCode: v.isSharedCode }, serverTime: iso(now), viewer: viewerOf(viewer) } : null;
}

export function catalogOf(_userId: string, viewer: { available: number; pending?: number }, query: { q?: string; category?: string[] | string; brand?: string[] | string; minPoints?: number; maxPoints?: number; onSale?: boolean; affordable?: boolean; sort?: string; limit?: number; offset?: number } = {}, now = Date.now()) {
  const catalog = rewardsCatalog.get();
  const categories = typeof query.category === "string" ? query.category.split(",") : query.category;
  const brandsFilter = typeof query.brand === "string" ? query.brand.split(",") : query.brand;
  let items = catalog.vouchers.filter((v) => v.isVisible && v.state !== "ARCHIVED").map((v) => listed(v, catalog, viewer.available, now));
  items = items.filter((v) => (!query.q || `${v.title} ${v.brand.name}`.toLocaleLowerCase().includes(query.q.toLocaleLowerCase())) &&
    (!categories?.length || categories.includes(v.category)) && (!brandsFilter?.length || brandsFilter.includes(v.brand.id)) &&
    (query.minPoints == null || v.price.points >= query.minPoints) && (query.maxPoints == null || v.price.points <= query.maxPoints) &&
    (!query.onSale || v.price.source !== "BASE") && (!query.affordable || v.affordable));
  const rank = (v: typeof items[number]) => v.status === "AVAILABLE" || v.status === "PAUSED" ? 0 : 1;
  items.sort((a, b) => rank(a) - rank(b) || (query.sort === "POINTS_ASC" ? a.price.points - b.price.points : query.sort === "POINTS_DESC" ? b.price.points - a.price.points : query.sort === "NEWEST" ? b.id.localeCompare(a.id) : b.price.discountPercent - a.price.discountPercent));
  const total = items.length, offset = Number(query.offset ?? 0), limit = Number(query.limit ?? 20);
  return { items: items.slice(offset, offset + limit), total, limit, offset, hasMore: offset + limit < total, serverTime: iso(now), viewer: viewerOf(viewer) };
}

export function flashSalesAt(now = Date.now()) {
  const catalog = rewardsCatalog.get();
  return { serverTime: iso(now), items: catalog.flashes.filter((f) => Date.parse(f.endsAt) > now - day).map((f) => ({ id: f.id, code: f.code, startsAt: f.startsAt, endsAt: f.endsAt,
    items: f.items.map((item) => { const v = catalog.vouchers.find((v) => v.id === item.voucherId)!;
      return { id: item.id, voucherId: item.voucherId, voucherTitle: v.title, brand: v.brand, category: v.category, valueVnd: v.valueVnd,
        flashPoints: item.flashPoints, basePoints: v.basePoints, discountPercent: Math.round((1 - item.flashPoints / v.basePoints) * 100), quota: item.quota, sold: item.sold, perUserCap: item.perUserCap,
        state: now < Date.parse(f.startsAt) ? "UPCOMING" : now >= Date.parse(f.endsAt) || f.endedEarlyAt && now >= Date.parse(f.endedEarlyAt) ? "ENDED" : item.sold >= item.quota ? "SOLD_OUT" : "ACTIVE" }; }) })) };
}

export function createVoucherQuote(userId: string, voucherId: string, viewer: { available: number; pending?: number }, now = Date.now()): QuoteDecision {
  const catalog = rewardsCatalog.get();
  const v = catalog.vouchers.find((row) => row.id === voucherId && row.isVisible && row.state !== "ARCHIVED");
  if (!v) return { ok: false, status: 404, code: "VOUCHER_NOT_FOUND", details: {} };
  const { price, flash } = effectiveVoucherPrice(v, catalog.flashes, now);
  const status = effectiveStatus(v, catalog.flashes, now);
  if (status !== "AVAILABLE") return failure(status === "SOLD_OUT" ? "SOLD_OUT" : "VOUCHER_UNAVAILABLE", status === "SOLD_OUT" ? { voucherId, regularStockRemaining: 0 } : { voucherId, status });
  if (viewer.available < price.points) return failure("INSUFFICIENT_POINTS", { required: price.points, available: viewer.available });
  const quote: RedemptionQuote = { quoteId: mockId(), voucherId, userId, price, flashSaleItemId: flash?.item.id ?? null,
    expiresAt: iso(Math.min(now + 300000, flash ? Date.parse(flash.flash.endsAt) : Infinity)), flashEndsAt: flash?.flash.endsAt ?? null,
    balance: { available: viewer.available, after: viewer.available - price.points }, serverTime: iso(now) };
  rewardsState.update((draft) => { draft.quotes[quote.quoteId] = quote; });
  const { quoteId: qId, voucherId: vId, price: p, flashSaleItemId: fId, expiresAt: exp, flashEndsAt: fExp, balance: bal, serverTime: st } = quote;
  return { ok: true, result: { quoteId: qId, voucherId: vId, price: p, flashSaleItemId: fId, expiresAt: exp, flashEndsAt: fExp, balance: bal, serverTime: st } };
}

export function redemptionByKey(userId: string, key: string): Decision | null {
  const recordKey = idempotencyRecordKey(userId, key);
  if (!recordKey) return null;
  const record = rewardsState.get().idempotency[recordKey];
  if (!record) return null;
  const body = record.response.body as Decision;
  return { ...body, replayed: true };
}

export function redeemVoucherQuote(userId: string, quoteId: string, viewer: { available: number; pending?: number }, now = Date.now(), key?: string, forcedCode?: string): Decision {
  // Idempotency: reuse helpers from idempotency.ts (Task 5.3)
  const recordKey = key ? idempotencyRecordKey(userId, key) : null;
  if (recordKey) {
    const existing = rewardsState.get().idempotency[recordKey];
    const decision = decideIdempotentRequest(existing, quoteId);
    if (decision.kind === "replay") return { ...decision.response.body as Decision, replayed: true };
    if (decision.kind === "conflict") return { ok: false, status: 409, code: "IDEMPOTENCY_KEY_CONFLICT", details: {} };
  }

  const userState = rewardsState.get();
  const quote = userState.quotes[quoteId];
  if (!quote || quote.userId !== userId) return { ok: false, status: 404, code: "QUOTE_NOT_FOUND", details: {} };

  const catalog = structuredClone(rewardsCatalog.get());
  const users = structuredClone(userState.users);
  const v = catalog.vouchers.find((v) => v.id === quote.voucherId)!;

  // Task 7.2: forced error uses real details from current state
  const error = forcedCode
    ? forcedError(forcedCode, v, catalog.flashes, viewer.available, now)
    : decideRedemption(v, catalog.flashes, quote, viewer.available, now);

  if (error) {
    // Task 5.6: failure changes only history + idempotency record, not catalog/wallet
    const rows = userRows(users, userId);
    rows.history.unshift({ id: mockId(), reference: generateReference(rows.history, now),
      kind: "FAILED", voucherTitle: v.title, brand: v.brand, valueVnd: v.valueVnd, isFlash: quote.price.source === "FLASH",
      points: 0, failureCode: error.code, journalId: null, note: null, createdAt: iso(now) });
    const result: Decision = failure(error.code, error.details);
    rewardsState.update((draft) => {
      draft.users = users;
      if (recordKey) draft.idempotency[recordKey] = { fingerprint: quoteId, response: { status: result.status, body: result as unknown as Record<string, unknown> } };
    });
    return result;
  }

  // Success: mutate catalog (stock, codes) and user state (ticket, history, idempotency)
  const flash = quote.flashSaleItemId && catalog.flashes.flatMap((f) => f.items).find((item) => item.id === quote.flashSaleItemId);
  if (flash) flash.sold++; else v.stockRemaining--;
  const codePool = catalog.codePools[v.id];
  const code = codePool.shift()!;
  v.codesAvailable = codePool.length;
  const redemptionId = mockId();
  const reference = generateReference(userRows(users, userId).history, now);
  const ticket = { id: mockId(), redemptionId, reference, voucherId: v.id, title: v.title, brand: v.brand, category: v.category, valueVnd: v.valueVnd, code,
    isSharedCode: v.isSharedCode, status: ticketStatus({ usedAt: null, expiresAt: v.codeExpiresAt }, now), redeemedAt: iso(now), expiresAt: v.codeExpiresAt,
    usedAt: null, undoUntil: null, pointsSpent: quote.price.points, priceSource: quote.price.source, howToUse: v.howToUse, openIssue: null };
  const rows = userRows(users, userId);
  rows.tickets.unshift(ticket);
  rows.history.unshift({ id: redemptionId, reference, kind: "SUCCEEDED", voucherTitle: v.title, brand: v.brand, valueVnd: v.valueVnd,
    isFlash: quote.price.source === "FLASH", points: -quote.price.points, failureCode: null, journalId: redemptionId, note: null, createdAt: iso(now) });
  const result: Decision = { ok: true, result: { redemptionId, reference, status: "SUCCEEDED", voucherId: v.id, pointsSpent: quote.price.points,
    priceSource: quote.price.source, balanceAfter: viewer.available - quote.price.points, ticket, createdAt: iso(now) } };

  rewardsCatalog.update((draft) => { draft.vouchers = catalog.vouchers; draft.flashes = catalog.flashes; draft.codePools = catalog.codePools; });
  rewardsState.update((draft) => {
    draft.users = users;
    if (recordKey) draft.idempotency[recordKey] = { fingerprint: quoteId, response: { status: 201, body: result as unknown as Record<string, unknown> } };
  });
  return result;
}

function generateReference(history: HistoryRow[], now: number): string {
  const usedReferences = new Set(history.map(row => row.reference));
  let reference: string;
  do { reference = `RDM-${iso(now).slice(2, 4)}${iso(now).slice(5, 7)}-${mockId().replaceAll("-", "").slice(-4).toUpperCase()}`; }
  while (usedReferences.has(reference));
  return reference;
}

// My vouchers (Story 12.4). ASSUMED API CONTRACT; statuses are recomputed at `now`, never trusted from storage.
const withStatus = (ticket: TicketRow, now: number) => ({ ...ticket, status: ticketStatus(ticket, now) });
const findTicket = (userId: string, ticketId: string) => rewardsState.get().users[userId]?.tickets.find((t) => t.id === ticketId);

export function ticketsOf(userId: string, now = Date.now()) {
  const items = (rewardsState.get().users[userId]?.tickets ?? []).filter((t) => t.openIssue?.status !== "REFUNDED")
    .map((t) => withStatus(t, now)).sort((a, b) => Date.parse(a.expiresAt) - Date.parse(b.expiresAt));
  return { items, total: items.length, serverTime: iso(now) };
}

/** Refunded tickets are returned here so a deep link still explains what happened. */
export function ticketOf(userId: string, ticketId: string, now = Date.now()) {
  const ticket = findTicket(userId, ticketId);
  return ticket ? { ticket: withStatus(ticket, now), serverTime: iso(now) } : null;
}

function changeTicket(userId: string, ticketId: string, now: number, decide: typeof markUsedDecision, apply: (ticket: TicketRow, decision: { usedAt?: string; undoUntil?: string }) => void) {
  const ticket = findTicket(userId, ticketId);
  if (!ticket) return { ok: false as const, status: 404, code: "TICKET_NOT_FOUND" };
  const decision = decide(ticket, now);
  if (!decision.ok) return decision;
  if (decision.changed) rewardsState.update((draft) => { apply(draft.users[userId].tickets.find((t) => t.id === ticketId)!, decision); });
  return { ok: true as const, result: ticketOf(userId, ticketId, now)! };
}

export const markTicketUsed = (userId: string, ticketId: string, now = Date.now()) =>
  changeTicket(userId, ticketId, now, markUsedDecision, (t, d) => { t.usedAt = d.usedAt!; t.undoUntil = d.undoUntil!; });
export const undoTicketUse = (userId: string, ticketId: string, now = Date.now()) =>
  changeTicket(userId, ticketId, now, undoUseDecision, (t) => { t.usedAt = null; t.undoUntil = null; });

export function reportCodeIssue(userId: string, ticketId: string, input: { reason: string; note?: string }, now = Date.now()) {
  const ticket = findTicket(userId, ticketId);
  if (!ticket) return { ok: false as const, status: 404, code: "TICKET_NOT_FOUND" };
  const decision = codeIssueDecision(ticket, now);
  if (!decision.ok) return decision;
  const report = { id: mockId(), redemptionId: ticket.redemptionId, ticketId, reason: input.reason, note: input.note?.trim() || null,
    status: "OPEN", createdAt: iso(now), resolvedAt: null, replacementCode: null, refundReference: null };
  rewardsState.update((draft) => {
    const rows = draft.users[userId];
    rows.issues.push(report);
    rows.tickets.find((t) => t.id === ticketId)!.openIssue = { id: report.id, status: "OPEN" };
  });
  return { ok: true as const, result: report };
}

export function historyOf(userId: string, query: { limit: number; offset: number }, now = Date.now()) {
  const rows = rewardsState.get().users[userId]?.history ?? [];
  const { limit, offset } = query;
  return { items: rows.slice(offset, offset + limit), total: rows.length, limit, offset, hasMore: offset + limit < rows.length, monthSummary: historyMonthSummary(rows, now) };
}

// Admin voucher catalog (Story 12.5); one catalog update for every successful write.
type AdminInput = { title: string; brandId: string; category: VoucherInventory["category"]; valueVnd: number; basePoints: number; promoPoints: number | null; isSharedCode: boolean; redeemStartsAt: string; redeemEndsAt: string; codeExpiresAt: string; terms: string[]; howToUse: string[]; imageUrl: string | null };
const missingVoucher = () => ({ ok: false as const, status: 404, code: "VOUCHER_NOT_FOUND", details: {} });
const archivedVoucher = () => ({ ok: false as const, status: 409, code: "VOUCHER_ARCHIVED", details: {} });
const adminRow = (v: VoucherInventory, catalog: CatalogState, now: number) => ({
  id: v.id, title: v.title, brand: v.brand, category: v.category, valueVnd: v.valueVnd,
  price: effectiveVoucherPrice(v, catalog.flashes, now).price, basePoints: v.basePoints, promoPoints: v.promoPoints,
  state: v.state, status: adminVoucherStatus(v, catalog.flashes, now), isVisible: v.isVisible, stock: adminStockOf(v, catalog.flashes, now), isSharedCode: v.isSharedCode,
  redeemStartsAt: v.redeemStartsAt, redeemEndsAt: v.redeemEndsAt, codeExpiresAt: v.codeExpiresAt,
  priceDeviationPercent: priceDeviationPercent(v.valueVnd, v.basePoints), createdAt: v.createdAt ?? v.redeemStartsAt,
  updatedAt: v.updatedAt ?? v.redeemStartsAt,
});

export function adminBrands() { return { items: slugs.map((slug, index) => ({ id: slug, name: brands[index] })) }; }
export function adminVouchersOf(query: { filter?: string; q?: string } = {}, now = Date.now()) {
  const catalog = rewardsCatalog.get();
  const all = catalog.vouchers.map(v => adminRow(v, catalog, now));
  const statuses = catalog.vouchers.map(v => adminVoucherStatus(v, catalog.flashes, now));
  const items = all.filter((v, index) => (!query.filter || query.filter === "ALL" || statuses[index] === query.filter) &&
    (!query.q || `${v.title} ${v.brand.name}`.toLocaleLowerCase("vi").includes(query.q.toLocaleLowerCase("vi"))));
  const count = (status: string) => statuses.filter(s => s === status).length;
  return { items, summary: { total: all.length, active: count("ACTIVE"), paused: count("PAUSED"), soldOut: count("SOLD_OUT"),
    expired: count("EXPIRED"), hidden: count("HIDDEN"), archived: count("ARCHIVED"),
    lowStock: all.filter(v => v.stock.remaining > 0 && v.stock.remaining <= v.stock.total * 0.1).map(v => ({ voucherId: v.id, label: v.title })),
    codesAvailable: all.reduce((n, v) => n + v.stock.codesAvailable, 0), flashReserved: all.reduce((n, v) => n + v.stock.flashReserved, 0),
    activeFlashSales: catalog.flashes.filter(f => Date.parse(f.startsAt) <= now && now < Date.parse(f.endsAt) && !f.endedEarlyAt).length }, serverTime: iso(now) };
}
export function adminVoucherDetailOf(voucherId: string, now = Date.now()) {
  const catalog = rewardsCatalog.get(), v = catalog.vouchers.find(v => v.id === voucherId);
  if (!v) return missingVoucher();
  const seen = new Set<string>();
  const redemptions = Object.entries(rewardsState.get().users).flatMap(([userId, user]) => {
    const tickets = user.tickets.filter(t => t.voucherId === voucherId);
    const ticketReferences = new Set(tickets.map(t => t.reference));
    const relevantHistory = user.history.filter(h => {
      if (h.kind === "FAILED") return false;
      if (ticketReferences.has(h.reference)) return true;
      return false;
    });
    return relevantHistory.map(h => ({ reference: h.reference, userLabel: `#${userId.slice(-4).toUpperCase()}`,
      points: Math.abs(h.points), kind: h.kind, createdAt: h.createdAt }));
  }).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .filter(row => !seen.has(row.reference) && !!seen.add(row.reference)).slice(0, 50);
  return { ok: true as const, result: { voucher: adminRow(v, catalog, now), priceHistory: catalog.priceHistory[v.id], redemptions } };
}
function changeAdminVoucher(id: string, now: number, mutate: (v: VoucherInventory, draft: CatalogState) => ReturnType<typeof archivedVoucher> | { ok: false; status: number; code: string; details?: unknown } | void) {
  const catalog = rewardsCatalog.get(), v = catalog.vouchers.find(v => v.id === id);
  if (!v) return missingVoucher();
  if (v.state === "ARCHIVED") return archivedVoucher();
  const draft = structuredClone(catalog), target = draft.vouchers.find(v => v.id === id)!;
  const error = mutate(target, draft);
  if (error) return error;
  rewardsCatalog.update(state => { Object.assign(state, draft); });
  return { ok: true as const, result: { voucher: adminRow(target, draft, now) } };
}
export function createAdminVoucher(input: AdminInput, admin: { id: string; name: string }, now = Date.now()) {
  const errors = validateVoucherInput(input);
  if (errors.length) return { ok: false as const, status: 400, code: "VALIDATION_ERROR", details: errors };
  const catalog = rewardsCatalog.get(), id = mockId(), date = iso(now);
  const v: VoucherInventory = { id, title: input.title, brand: { id: input.brandId, name: brands[slugs.indexOf(input.brandId)] }, category: input.category,
    valueVnd: input.valueVnd, basePoints: input.basePoints, promoPoints: input.promoPoints, priceVersion: 1,
    stockTotal: 0, stockRemaining: 0, codesAvailable: 0, state: "ACTIVE", isVisible: true, imageUrl: input.imageUrl,
    description: "", whereToUse: "", terms: input.terms, howToUse: input.howToUse, isSharedCode: input.isSharedCode,
    redeemStartsAt: input.redeemStartsAt, redeemEndsAt: input.redeemEndsAt, codeExpiresAt: input.codeExpiresAt, createdAt: date, updatedAt: date };
  rewardsCatalog.update(draft => { draft.vouchers.push(v); draft.codePools[id] = []; draft.priceHistory[id] = [
    { version: 1, basePoints: input.basePoints, promoPoints: input.promoPoints, effectiveFrom: date, changedBy: admin }]; });
  return { ok: true as const, result: { voucher: adminRow(v, { ...catalog, vouchers: [...catalog.vouchers, v] }, now) } };
}
export function updateAdminVoucher(id: string, input: AdminInput, now = Date.now()) {
  return changeAdminVoucher(id, now, (v, draft) => {
    const errors = validateVoucherInput(input, { voucher: v, issued: adminStockOf(v, draft.flashes, now).issued, now });
    if (errors.length) return { ok: false, status: errors.some(e => e.code === "SHARED_FLAG_LOCKED") ? 409 : 400,
      code: errors.some(e => e.code === "SHARED_FLAG_LOCKED") ? "SHARED_FLAG_LOCKED" : "VALIDATION_ERROR", details: errors };
    Object.assign(v, { title: input.title, brand: { id: input.brandId, name: brands[slugs.indexOf(input.brandId)] }, category: input.category,
      valueVnd: input.valueVnd, isSharedCode: input.isSharedCode, redeemStartsAt: input.redeemStartsAt, redeemEndsAt: input.redeemEndsAt,
      codeExpiresAt: input.codeExpiresAt, terms: input.terms.length ? input.terms : v.terms,
      howToUse: input.howToUse.length ? input.howToUse : v.howToUse, imageUrl: input.imageUrl ?? v.imageUrl, updatedAt: iso(now) });
  });
}
export function patchAdminVoucherState(id: string, patch: { state?: VoucherInventory["state"]; isVisible?: boolean }, now = Date.now()) {
  if (patch.state === "ARCHIVED") {
    const v = rewardsCatalog.get().vouchers.find(v => v.id === id);
    if (!v) return missingVoucher();
    if (v.state === "ARCHIVED") return archivedVoucher();
  }
  return changeAdminVoucher(id, now, v => { if (patch.state) v.state = patch.state; if (patch.isVisible !== undefined) v.isVisible = patch.isVisible; v.updatedAt = iso(now); });
}
export function changeAdminVoucherPrice(id: string, change: { basePoints: number; promoPoints: number | null }, admin: { id: string; name: string }, now = Date.now()) {
  return changeAdminVoucher(id, now, (v, draft) => {
    v.basePoints = change.basePoints; v.promoPoints = change.promoPoints; v.priceVersion++; v.updatedAt = iso(now);
    draft.priceHistory[id].push({ version: v.priceVersion, ...change, effectiveFrom: iso(now), changedBy: admin });
  });
}
export function adjustAdminVoucherStock(id: string, adjustment: { total: number; reason: string }, now = Date.now()) {
  return changeAdminVoucher(id, now, (v, draft) => {
    const decision = stockAdjustmentDecision(v, adminStockOf(v, draft.flashes, now), adjustment.total);
    if (!decision.ok) return { ...decision, details: "details" in decision ? decision.details : {} };
    if (!v.isSharedCode && decision.removeCodes > 0) draft.codePools[id].splice(-decision.removeCodes);
    v.stockRemaining += adjustment.total - v.stockTotal; v.stockTotal = adjustment.total;
    v.codesAvailable = draft.codePools[id].length; v.updatedAt = iso(now);
  });
}
export function importAdminVoucherCodes(id: string, request: { codes: string[]; mode: "VALIDATE" | "COMMIT" }, now = Date.now()) {
  const catalog = rewardsCatalog.get(), v = catalog.vouchers.find(v => v.id === id);
  if (!v) return missingVoucher();
  if (v.state === "ARCHIVED") return archivedVoucher();
  if (v.isSharedCode) return { ok: false as const, status: 409, code: "SHARED_CODE_VOUCHER", details: {} };
  const result = importCodesDecision(request.codes, Object.values(catalog.codePools).flat());
  if (request.mode === "COMMIT" && result.accepted) {
    rewardsCatalog.update(draft => { const voucher = draft.vouchers.find(v => v.id === id)!;
      draft.codePools[id].push(...request.codes.map(code => code.trim())); voucher.stockTotal += result.accepted;
      voucher.stockRemaining += result.accepted; voucher.codesAvailable = draft.codePools[id].length; voucher.updatedAt = iso(now); });
    result.committed = true;
  }
  return { ok: true as const, result };
}
