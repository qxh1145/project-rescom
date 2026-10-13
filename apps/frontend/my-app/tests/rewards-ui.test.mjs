import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseRewardsParams,
  serializeRewardsParams,
  toCatalogQuery,
  activeFilterCount,
  DEFAULT_REWARDS_FILTERS,
} from "../lib/rewards/catalog-query.ts";

import {
  serverOffset,
  remaining,
  countdownMinuteKey,
  countdownAnnouncement,
} from "../lib/rewards/server-clock.ts";

import {
  brandInitials,
  brandTintClass,
  detailExpiryLine,
  detailStockLine,
  flashItemOrder,
  formatFullDate,
  formatPoints,
  formatVnd,
  howToGetCodeLine,
  shortfall,
  suggestedTopUp,
  voucherCardState,
  voucherMetaLine,
} from "../lib/rewards/voucher-display.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- Seed fixtures (needs a module loader for the mock's `@/` imports and extensionless .ts) ---
const { register } = await import("node:module");
const root = path.resolve(__dirname, "..");
const loader = `import { existsSync, statSync } from 'node:fs'; import path from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
export async function resolve(specifier, context, nextResolve) {
 if (specifier.startsWith('@/')) { const file = path.join(${JSON.stringify(root)}, specifier.slice(2)); for (const f of [file + '.ts', file, path.join(file, 'index.ts')]) if (existsSync(f) && statSync(f).isFile()) return { url:pathToFileURL(f).href, shortCircuit:true }; }
 if (!specifier.startsWith('./') && !specifier.startsWith('../')) return nextResolve(specifier, context);
 if (!context.parentURL?.startsWith('file:')) return nextResolve(specifier, context);
 const base = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
 for (const file of [base, base + '.ts', path.join(base, 'index.ts')]) if (existsSync(file) && statSync(file).isFile()) return { url:pathToFileURL(file).href, shortCircuit:true };
 return nextResolve(specifier, context);
}`;
register(`data:text/javascript,${encodeURIComponent(loader)}`, import.meta.url);
const mock = await import("../mocks/data/rewards.ts");
const schemas = await import("@rescom/schemas");

const seed = mock.catalogOf("user-active-002", { available: 186, pending: 18 }).items;
/** Seed voucher by its trailing id digit (1..7). */
const seedItem = (n) => seed.find((item) => item.id.endsWith(String(n)));
/** Schema-valid variant of a seed voucher. */
const variant = (n, overrides) => schemas.voucherListItemSchema.parse({ ...seedItem(n), ...overrides });

// --- 9.1 catalog-query ---

test("catalog-query: parse and serialize roundtrip correctly", () => {
  const emptyParsed = parseRewardsParams(new URLSearchParams());
  assert.deepEqual(emptyParsed, DEFAULT_REWARDS_FILTERS);
  assert.equal(serializeRewardsParams(DEFAULT_REWARDS_FILTERS).toString(), "", "defaults are omitted");

  const initial = {
    q: "phúc long",
    category: ["COFFEE", "TEA"],
    brand: ["phuc-long"],
    points: "100-200",
    sale: true,
    afford: true,
    sort: "POINTS_ASC",
  };

  const serialized = serializeRewardsParams(initial);
  assert.equal(serialized.get("q"), "phúc long");
  assert.equal(serialized.get("category"), "COFFEE,TEA");
  assert.equal(serialized.get("brand"), "phuc-long");
  assert.equal(serialized.get("points"), "100-200");
  assert.equal(serialized.get("sale"), "1");
  assert.equal(serialized.get("afford"), "1");
  assert.equal(serialized.get("sort"), "POINTS_ASC");

  assert.deepEqual(parseRewardsParams(serialized), initial);
});

test("catalog-query: drops invalid params and empty strings", () => {
  const dirty = new URLSearchParams({
    q: "   ",
    category: "INVALID_CAT",
    brand: "unknown_brand",
    points: "invalid-range",
    sort: "RANDOM_SORT",
    sale: "0",
    afford: "false",
    unknownKey: "value",
  });

  const parsed = parseRewardsParams(dirty);
  assert.equal(parsed.q, "");
  assert.deepEqual(parsed.category, []);
  assert.deepEqual(parsed.brand, []);
  assert.equal(parsed.points, null);
  assert.equal(parsed.sale, false);
  assert.equal(parsed.afford, false);
  assert.equal(parsed.sort, "BEST_DEAL");
});

test("catalog-query: preserves msw query parameter when present", () => {
  const serialized = serializeRewardsParams(
    { ...DEFAULT_REWARDS_FILTERS, q: "highlands" },
    new URLSearchParams({ msw: "off" }),
  );
  assert.equal(serialized.get("msw"), "off");
  assert.equal(serialized.get("q"), "highlands");
});

test("catalog-query: toCatalogQuery converts filters to a query the contract accepts", () => {
  const qs = toCatalogQuery({
    q: "voucher",
    category: ["COFFEE"],
    brand: ["highlands"],
    points: "100-200",
    sale: true,
    afford: true,
    sort: "POINTS_DESC",
  });

  const params = new URLSearchParams(qs);
  assert.equal(params.get("q"), "voucher");
  assert.equal(params.get("category"), "COFFEE");
  assert.equal(params.get("brand"), "highlands");
  assert.equal(params.get("minPoints"), "100");
  assert.equal(params.get("maxPoints"), "200");
  assert.equal(params.get("onSale"), "true");
  assert.equal(params.get("affordable"), "true");
  assert.equal(params.get("sort"), "POINTS_DESC");
  assert.doesNotThrow(() => schemas.voucherCatalogQuerySchema.parse(Object.fromEntries(params)));
});

test("catalog-query: point ranges map to min/max and parse with voucherCatalogQuerySchema", () => {
  const cases = [
    { points: "lt100", expected: { maxPoints: "99" } },
    { points: "100-200", expected: { minPoints: "100", maxPoints: "200" } },
    { points: "gt200", expected: { minPoints: "201" } },
  ];
  for (const { points, expected } of cases) {
    const params = new URLSearchParams(toCatalogQuery({ ...DEFAULT_REWARDS_FILTERS, points }));
    assert.deepEqual(Object.fromEntries(params), expected, points);
    schemas.voucherCatalogQuerySchema.parse(Object.fromEntries(params));
  }
  assert.equal(toCatalogQuery(DEFAULT_REWARDS_FILTERS), "", "defaults produce an empty query");
});

test("catalog-query: whitespace-only q is omitted and q over 100 chars is sliced to 100", () => {
  assert.equal(new URLSearchParams(toCatalogQuery({ ...DEFAULT_REWARDS_FILTERS, q: "   " })).has("q"), false);

  const long = "a".repeat(150);
  const qs = new URLSearchParams(toCatalogQuery({ ...DEFAULT_REWARDS_FILTERS, q: long }));
  assert.equal(qs.get("q")?.length, 100);
  schemas.voucherCatalogQuerySchema.parse(Object.fromEntries(qs));

  assert.equal(parseRewardsParams(new URLSearchParams({ q: long })).q.length, 100);
});

test("catalog-query: duplicate category values are deduped", () => {
  const parsed = parseRewardsParams(new URLSearchParams("category=COFFEE,COFFEE&brand=kfc,kfc"));
  assert.deepEqual(parsed.category, ["COFFEE"]);
  assert.deepEqual(parsed.brand, ["kfc"]);
});

test("catalog-query: activeFilterCount counts active filters", () => {
  assert.equal(activeFilterCount(DEFAULT_REWARDS_FILTERS), 0);
  assert.equal(activeFilterCount({ ...DEFAULT_REWARDS_FILTERS, category: ["COFFEE"] }), 1);
  assert.equal(activeFilterCount({ ...DEFAULT_REWARDS_FILTERS, points: "100-200", afford: true }), 2);
  // Search text and sort are not facets.
  assert.equal(
    activeFilterCount({ ...DEFAULT_REWARDS_FILTERS, q: "search text", sort: "POINTS_ASC", category: ["COFFEE", "TEA"], sale: true }),
    3,
  );
});

// --- 9.2 server-clock ---

test("server-clock: serverOffset follows a skewed server clock", () => {
  const receivedAtMs = Date.parse("2026-10-13T12:00:00.000Z");
  assert.equal(serverOffset("2026-10-13T12:00:05.000Z", receivedAtMs), 5000);
  assert.equal(serverOffset("2026-10-13T11:59:50.000Z", receivedAtMs), -10000);
  assert.equal(serverOffset("not-a-date", receivedAtMs), 0);

  // A client clock 1 h ahead still counts down against server time.
  const clientNow = receivedAtMs + 3_600_000;
  const offset = serverOffset("2026-10-13T12:00:00.000Z", clientNow);
  assert.equal(remaining("2026-10-13T12:10:00.000Z", clientNow + offset).mm, "10");
});

test("server-clock: remaining formats hh/mm/ss and clamps at 0", () => {
  const nowMs = Date.parse("2026-10-13T12:00:00.000Z");
  const endsAt = new Date(nowMs + ((2 * 60 + 15) * 60 + 30) * 1000).toISOString();
  assert.deepEqual(remaining(endsAt, nowMs), { totalSeconds: 8130, hh: "02", mm: "15", ss: "30" });

  const past = remaining("2026-10-13T11:59:00.000Z", nowMs);
  assert.deepEqual(past, { totalSeconds: 0, hh: "00", mm: "00", ss: "00" });
  assert.equal(remaining("garbage", nowMs).totalSeconds, 0);
});

test("server-clock: remaining reaches 0 only once the target has passed", () => {
  const endsAtMs = Date.parse("2026-10-13T12:00:00.000Z");
  const endsAt = new Date(endsAtMs).toISOString();
  assert.equal(remaining(endsAt, endsAtMs - 1).totalSeconds, 1, "1 ms left is not elapsed");
  assert.equal(remaining(endsAt, endsAtMs - 999).totalSeconds, 1);
  assert.equal(remaining(endsAt, endsAtMs).totalSeconds, 0);
});

test("server-clock: minute key changes at the minute boundary and is stable within a minute", () => {
  assert.equal(countdownMinuteKey(0), 0);
  assert.equal(countdownMinuteKey(1), 1);
  assert.equal(countdownMinuteKey(59), 1);
  assert.equal(countdownMinuteKey(60), 1);
  assert.equal(countdownMinuteKey(61), 2);
  assert.equal(countdownMinuteKey(120), 2);
  assert.equal(countdownMinuteKey(121), 3);
  // Every second inside one minute shares the key.
  const keys = new Set();
  for (let s = 61; s <= 120; s += 1) keys.add(countdownMinuteKey(s));
  assert.equal(keys.size, 1);
});

test("server-clock: announcement copy for ends, starts and elapsed", () => {
  assert.equal(countdownAnnouncement(8100, "ends"), "Flash Sale kết thúc sau 2 giờ 15 phút");
  assert.equal(countdownAnnouncement(8100, "starts"), "Flash Sale bắt đầu sau 2 giờ 15 phút");
  assert.equal(countdownAnnouncement(7200, "ends"), "Flash Sale kết thúc sau 2 giờ");
  assert.equal(countdownAnnouncement(59, "ends"), "Flash Sale kết thúc sau 1 phút");
  assert.equal(countdownAnnouncement(65, "ends"), "Flash Sale kết thúc sau 2 phút");
  assert.equal(countdownAnnouncement(0, "ends"), "Flash Sale đã kết thúc");
  assert.equal(countdownAnnouncement(0, "starts"), "Flash Sale đã bắt đầu");

  // Text follows the minute key, so it never changes within a minute.
  assert.equal(countdownAnnouncement(8130, "ends"), countdownAnnouncement(8101, "ends"));
  assert.notEqual(countdownAnnouncement(8100, "ends"), countdownAnnouncement(8101, "ends"));
});

// --- 9.3 voucher-display ---

test("voucher-display: voucherCardState for the 7 seed shapes plus paused", () => {
  seed.forEach((item) => schemas.voucherListItemSchema.parse(item));
  assert.equal(seed.length, 7);

  assert.equal(voucherCardState(seedItem(1)), "sale", "Flash");
  assert.equal(voucherCardState(seedItem(2)), "sale", "Flash");
  assert.equal(voucherCardState(seedItem(3)), "sale", "promo");
  assert.equal(voucherCardState(seedItem(4)), "default");
  assert.equal(voucherCardState(seedItem(5)), "default", "Flash sold out falls back to regular price");
  assert.equal(voucherCardState(seedItem(6)), "soldOut");
  assert.equal(voucherCardState(seedItem(7)), "expired");
  assert.equal(voucherCardState(variant(4, { status: "PAUSED" })), "paused");
});

test("voucher-display: every list meta line from the copy table", () => {
  const codeExpiresAt = "2026-12-31T10:00:00.000Z"; // 31/12/2026 in Vietnam
  const redeemEndsAt = "2026-09-10T10:00:00.000Z";

  assert.equal(
    voucherMetaLine(variant(4, { stockRemaining: 62, codeExpiresAt })),
    "Còn 62 · HSD 31/12/2026",
  );
  assert.equal(
    voucherMetaLine(variant(5, { stockRemaining: 9, codeExpiresAt })),
    "Sắp hết · còn 9 · HSD 31/12/2026",
  );
  assert.equal(
    voucherMetaLine(variant(4, { stockRemaining: 10, codeExpiresAt })),
    "Sắp hết · còn 10 · HSD 31/12/2026",
    "low-stock threshold is inclusive",
  );
  assert.equal(
    voucherMetaLine(variant(4, { stockRemaining: 11, codeExpiresAt })),
    "Còn 11 · HSD 31/12/2026",
  );

  const flashSource = seedItem(1);
  assert.equal(
    voucherMetaLine(variant(1, { flash: { ...flashSource.flash, quota: 40, sold: 15 }, codeExpiresAt })),
    "Flash Sale · còn 25 suất · HSD 31/12/2026",
  );

  assert.equal(voucherMetaLine(seedItem(6)), "Đã đổi hết 150/150");
  assert.equal(
    voucherMetaLine(variant(7, { redeemEndsAt })),
    "Hết thời gian đổi từ 10/09/2026",
  );
  assert.equal(
    voucherMetaLine(variant(4, { status: "PAUSED", codeExpiresAt })),
    "Tạm dừng đổi · HSD 31/12/2026",
  );
});

test("voucher-display: dates use the Vietnam calendar day with the year", () => {
  assert.equal(formatFullDate("2026-12-31T10:00:00.000Z"), "31/12/2026");
  // 20:00 UTC is already the next day (and year) in Asia/Ho_Chi_Minh.
  assert.equal(formatFullDate("2026-12-31T20:00:00.000Z"), "01/01/2027");
  assert.equal(formatFullDate(null), "");
});

test("voucher-display: detail lines", () => {
  const detail = {
    ...variant(1, {
      codeExpiresAt: "2026-12-31T10:00:00.000Z",
      redeemEndsAt: "2026-12-12T10:00:00.000Z",
      stockRemaining: 180,
    }),
    description: "d",
    whereToUse: "w",
    terms: ["t"],
    howToUse: ["h"],
    isSharedCode: false,
  };
  schemas.voucherDetailSchema.parse(detail);
  assert.equal(detailExpiryLine(detail), "Đến hết 31/12/2026. Đổi được đến 12/12/2026.");
  assert.equal(
    detailStockLine({ ...detail, flash: { ...detail.flash, quota: 40, sold: 15 } }),
    "25 suất Flash Sale · 180 voucher giá thường",
  );
  assert.equal(detailStockLine({ ...detail, flash: null }), "180 voucher");
  assert.equal(howToGetCodeLine(false), "Mã riêng và QR hiện ngay trong Voucher của tôi sau khi đổi.");
  assert.equal(howToGetCodeLine(true), "Mã dùng chung hiện trong Voucher của tôi sau khi đổi.");
});

test("voucher-display: shortfall and suggestedTopUp", () => {
  assert.equal(shortfall(200, 186), 14);
  assert.equal(shortfall(500, 600), 0);

  assert.equal(suggestedTopUp(0), 0);
  assert.equal(suggestedTopUp(14), 100);
  assert.equal(suggestedTopUp(150), 200);
  assert.equal(suggestedTopUp(499), 500);
  assert.equal(suggestedTopUp(501), 600);
});

test("voucher-display: formatting, brand initials, tint and Flash order", () => {
  assert.equal(formatPoints(500), "500");
  assert.equal(formatVnd(50000), "50.000đ");

  const initials = { highlands: "HL", lotteria: "LT", "phuc-long": "PL", kfc: "KFC", "gong-cha": "GC", "the-coffee-house": "TCH" };
  for (const [id, expected] of Object.entries(initials)) {
    assert.equal(brandInitials({ id, name: "ignored" }), expected, id);
  }
  assert.equal(brandInitials({ id: "custom", name: "Gong Cha Milk Tea" }), "GCM");
  assert.equal(brandInitials({ id: "custom", name: "" }), "VC");

  assert.equal(brandTintClass("kfc", "CHICKEN_BURGER"), "bg-danger-soft text-danger");

  assert.deepEqual(["ACTIVE", "UPCOMING", "SOLD_OUT", "ENDED"].map(flashItemOrder), [0, 1, 2, 3]);
});

// --- 9.4 source-level guards ---

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

const rewardsDir = path.join(__dirname, "../app/(signed-in)/(app)/rewards");
const readRewards = (rel) => fs.readFileSync(path.join(rewardsDir, rel), "utf-8");

test("static code scan: Countdown has exactly one persistent aria-live region", () => {
  const countdownCode = readRewards("components/Countdown.tsx");
  assert.equal(countdownCode.match(/aria-live=/g)?.length, 1, "exactly one aria-live container");
  assert.ok(countdownCode.includes('aria-live="polite"'), "Countdown must announce politely");
  assert.ok(!/<p[^>]*\bkey=/.test(countdownCode), "the live region must not be remounted with a key");
});

test("static code scan: no rewards component computes a price on the client", () => {
  const files = sourceFiles(rewardsDir);
  assert.ok(files.length > 10, "scan covers the rewards folder");
  for (const file of files) {
    const code = fs.readFileSync(file, "utf-8");
    assert.ok(
      !/basePoints\s*[-*/]|\* POINT_VND_RATE/.test(code),
      `${path.relative(rewardsDir, file)} computes a price; prices come from the API (BR-17)`,
    );
  }
});

test("static code scan: card and detail delegate calculations to voucher-display", () => {
  assert.ok(!readRewards("components/VoucherCard.tsx").includes("shortfall("));
  const detailScreenCode = readRewards("components/VoucherDetailScreen.tsx");
  assert.ok(detailScreenCode.includes("shortfall("), "VoucherDetailScreen uses shortfall helper");
  assert.ok(detailScreenCode.includes("suggestedTopUp("), "VoucherDetailScreen uses suggestedTopUp helper");
});
