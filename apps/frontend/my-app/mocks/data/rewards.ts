import { createCollection, mockId } from "../db/store";
import { idempotencyRecordKey, decideIdempotentRequest, type IdempotencyRecord } from "./idempotency";
import { decideRedemption, effectiveStatus, effectiveVoucherPrice, forcedError, ticketStatus, type FlashInventory, type RedemptionQuote, type VoucherInventory } from "./rewards-rules";

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
      description, whereToUse, terms, howToUse: ["Xuất trình mã tại quầy"], isSharedCode: false,
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
    return { id: id(300 + n), redemptionId: id(400 + n), reference: String(reference), voucherId: v.id, title: v.title, brand: v.brand,
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
    vouchers, flashes, codePools,
    quotes: {} as Record<string, RedemptionQuote>,
    users: { "user-active-002": demo, "00000000-0000-4000-8000-00000000d001": structuredClone(demo) } as Record<string, UserState>,
    idempotency: {} as Record<string, IdempotencyRecord<StoredResponse>>,
  };
}

interface HistoryRow { id: string; reference: string; kind: string; voucherTitle: string; brand: { id: string; name: string }; valueVnd: number; isFlash: boolean; points: number; failureCode: string | null; journalId: string | null; note: string | null; createdAt: string }
interface TicketRow { id: string; redemptionId: string; reference: string; voucherId: string; title: string; brand: { id: string; name: string }; valueVnd: number; code: string; isSharedCode: boolean; status: string; redeemedAt: string; expiresAt: string; usedAt: string | null; undoUntil: string | null; pointsSpent: number; priceSource: string; howToUse: string[]; openIssue: { id: string; status: string } | null }
interface IssueRow { id: string; redemptionId: string; ticketId: string; reason: string; note: string | null; status: string; createdAt: string; resolvedAt: string | null; replacementCode: string | null; refundReference: string | null }
interface UserState { tickets: TicketRow[]; history: HistoryRow[]; issues: IssueRow[] }
interface StoredResponse { status: number; body: Record<string, unknown> }
type CatalogState = Pick<ReturnType<typeof seed>, "vouchers" | "flashes" | "codePools">;
type UserSideState = Pick<ReturnType<typeof seed>, "quotes" | "users" | "idempotency">;

type Failure = { ok: false; status: number; code: string; details: Record<string, unknown>; replayed?: boolean };
type Decision = { ok: true; result: { pointsSpent: number; ticket: { id: string; title: string }; [key: string]: unknown }; replayed?: boolean } | Failure;
type QuoteDecision = { ok: true; result: Omit<RedemptionQuote, "userId"> } | Failure;

// Catalog inventory and per-user artifacts persist separately; one update per collection on redeem.
export const rewardsCatalog = createCollection<CatalogState>("rewards-catalog", () => {
  const { vouchers, flashes, codePools } = seed(); return { vouchers, flashes, codePools };
});
export const rewardsState = createCollection<UserSideState>("rewards-users", () => {
  const { quotes, users, idempotency } = seed(); return { quotes, users, idempotency };
});

const failure = (code: string, details: Record<string, unknown>): Failure => ({ ok: false, status: code === "ACCOUNT_NOT_ELIGIBLE" ? 403 : 409, code, details });
const viewerOf = (viewer: { available: number; pending?: number }) => ({ available: viewer.available, pending: viewer.pending ?? 0 });
const userRows = (users: Record<string, UserState>, userId: string): UserState => users[userId] ??= { tickets: [], history: [], issues: [] };

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
  const ticket = { id: mockId(), redemptionId, reference, voucherId: v.id, title: v.title, brand: v.brand, valueVnd: v.valueVnd, code,
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
