#!/usr/bin/env node
/**
 * Story 12.11 Task 8: mock-off Rewards journey (8.3 steps, 8.4 SQL checks).
 *
 * Drives the pilot frontend's same-origin `/api` rewrite (cookies + CSRF like a
 * browser). Prisma is used only for setup (admin role, funding, activation),
 * waiting on `flash_sales.reserved_at`, and the final SQL checks.
 *
 *   node scripts/rewards-journey.mjs              # flag-on journey (8.3 + 8.4)
 *   node scripts/rewards-journey.mjs --flag-off   # flag-off sweep, appended to the report
 *
 * Env: REWARDS_BASE_URL (default http://localhost:3000), REWARDS_DATABASE_URL
 * (scratch DB ending in _check/_test), REWARDS_OUT_DIR.
 * Writes 12-11-evidence/rewards-journey-report.{json,md}. Never records
 * passwords, cookies, CSRF tokens or voucher codes. Exit 1 on any failed step.
 */
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Actor } from "./lib/actor.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.env.REWARDS_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const DB_URL = process.env.REWARDS_DATABASE_URL ?? "postgresql://rescom_admin:rescom_password@localhost:5433/rescom_rewards_check?schema=public";
const ORIGIN = process.env.REWARDS_ORIGIN ?? BASE;
const OUT = process.env.REWARDS_OUT_DIR ?? path.join(root, "_bmad-output/implementation-artifacts/12-11-evidence");
const FLAG_OFF = process.argv.includes("--flag-off");
const REPORT_JSON = path.join(OUT, "rewards-journey-report.json");
const CASH_COPY = "Điểm chỉ dùng trong Rescom, không bao giờ rút ra thành tiền mặt.";

const dbName = new URL(DB_URL).pathname.slice(1);
if (!/_(check|test)$/.test(dbName)) {
  console.error(`REWARDS_DATABASE_URL must target a scratch DB ending in _check or _test (got ${dbName}).`);
  process.exit(2);
}

const req = createRequire(path.join(root, "apps/backend/package.json"));
const { PrismaClient } = req("@prisma/client");
const S = req("@rescom/schemas");
const prisma = new PrismaClient({ datasources: { db: { url: DB_URL } } });

const steps = [];
let phase = "setup";
const recordSink = (rec) => steps.push({ phase, ...rec });
const secrets = new Set(); // voucher code values, in memory only (leak check on Admin payloads)

// ---------------------------------------------------------------- helpers
function need(v, what) {
  if (v === undefined || v === null || v === "") throw new Error(`missing ${what}`);
  return v;
}
function eq(actual, expected, what) {
  if (actual !== expected) throw new Error(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function truthy(cond, what) {
  if (!cond) throw new Error(what);
}
function parse(schemaName, data, what) {
  const r = need(S[schemaName], `schema ${schemaName}`).safeParse(data);
  if (!r.success) {
    throw new Error(`${what}: ${schemaName} mismatch (${r.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}:${i.code}`).join(", ")})`);
  }
  return r.data;
}
function assertNoCodes(label, payload) {
  const text = JSON.stringify(payload);
  for (const s of secrets) if (text.includes(s)) throw new Error(`${label}: Admin payload contains a voucher code value`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(what, fn, timeoutMs = 90_000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timeout waiting for ${what}`);
    await sleep(1000);
  }
}

/** Assertion-level step: failures are recorded and the journey continues. */
async function S_(name, fn) {
  const started = performance.now();
  try {
    const ids = await fn();
    steps.push({ phase, actor: "journey", step: name, request: "assert", status: 0, ok: true, ms: Math.round(performance.now() - started), ids: ids ?? undefined });
  } catch (error) {
    steps.push({ phase, actor: "journey", step: name, request: "assert", status: 0, ok: false, ms: Math.round(performance.now() - started), error: error.message });
  }
}

/** Call that must fail with `status` and error.code `code` (and optional details.reason). */
async function fails(actor, step, method, apiPath, { status, code, reason, body, headers }) {
  await actor.call(step, method, apiPath, { body, headers, expect: status, recordSink });
  const e = actor.last?.json?.error;
  eq(e?.code, code, `${step} error.code`);
  if (reason) eq(e?.details?.reason, reason, `${step} details.reason`);
  return e;
}

const dataOf = async (actor, step, method, apiPath, opts = {}) => actor.call(step, method, apiPath, { recordSink, ...opts });
const available = async (actor) =>
  need((await dataOf(actor, "wallet balance", "GET", "/economy/wallet")).balance?.available, "wallet.balance.available");

async function setRole(actor, role) {
  await prisma.user.update({ where: { id: actor.id }, data: { role } });
  steps.push({ phase, actor: actor.label, step: `scratch-DB role -> ${role}`, request: "SQL", status: 0, ok: true, ms: 0 });
  await actor.login(recordSink);
}

async function ledgerAccount(userId, accountClass) {
  const found = await prisma.ledgerAccount.findFirst({ where: { userId, accountClass } });
  return found ?? prisma.ledgerAccount.create({ data: { userId, accountClass, balance: 0 } });
}
/** One balanced journal SYSTEM_ISSUANCE -> USER_AVAILABLE (deploy/grant-points.js shape). */
async function postGrant(userId, amount, key, description) {
  const system = await ledgerAccount(null, "SYSTEM_ISSUANCE");
  const user = await ledgerAccount(userId, "USER_AVAILABLE");
  await prisma.$transaction(async (tx) => {
    await tx.ledgerJournal.create({
      data: { idempotencyKey: key, description, entries: { create: [{ accountId: system.id, amount: -amount }, { accountId: user.id, amount }] } },
    });
    await tx.ledgerAccount.update({ where: { id: system.id }, data: { balance: { decrement: amount } } });
    await tx.ledgerAccount.update({ where: { id: user.id }, data: { balance: { increment: amount } } });
  });
}
/** Activation = the `starter-unlock:{userId}` journal (survey-based activation is IR.5's path); funding is a separate keyed grant. */
async function activateAndFund(actor, amount, tag) {
  await postGrant(actor.id, 100, `starter-unlock:${actor.id}`, "Journey activation (seeded starter-unlock journal)");
  await postGrant(actor.id, amount, `rewards-journey-fund:${tag}:${actor.id}`, `Journey funding ${amount} pts`);
  steps.push({ phase, actor: actor.label, step: `scratch-DB activation + funding ${amount} pts`, request: "SQL", status: 0, ok: true, ms: 0 });
}

const vnToday = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const q = async (sql, ...args) => prisma.$queryRawUnsafe(sql, ...args);
const n = async (sql, ...args) => Number((await q(sql, ...args))[0].n);

// ---------------------------------------------------------------- report
function writeReport(result) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(REPORT_JSON, `${JSON.stringify(result, null, 2)}\n`);
  const row = (s) =>
    `| ${s.actor} | ${s.step} | \`${s.request}\` | ${s.status || "-"} | ${s.ok ? "pass" : "FAIL"} | ${s.ms} | ${s.requestId ?? ""} | ${s.errorCode ?? ""} ${s.ids ? `\`${JSON.stringify(s.ids)}\`` : ""}${s.error ? ` ${s.error}` : ""} |`;
  const phases = [...new Set(result.steps.map((s) => s.phase))];
  const md = [
    `# Rewards journey report (${result.run})`,
    "",
    `- Base URL: ${result.base} (pilot build, \`/api\` rewrite to backend); DB: \`${result.database}\``,
    `- Commit: \`${result.commit}\` (working tree includes uncommitted Story 12.11 changes)`,
    `- Result: **${result.passed ? "PASS" : "FAIL"}**${result.error ? ` - ${result.error}` : ""}`,
    `- Steps ok: ${result.steps.filter((s) => s.ok).length}/${result.steps.length}`,
    result.flagOff ? `- Flag-off sweep: ${result.flagOff.passed ? "PASS" : "FAIL"} (${result.flagOff.checks.filter((c) => c.ok).length}/${result.flagOff.checks.length})` : "- Flag-off sweep: not run",
    "",
    ...phases.flatMap((p) => [
      `## ${p}`,
      "",
      "| Actor | Step | Request | Status | Result | ms | X-Request-Id | Key ids / error |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
      ...result.steps.filter((s) => s.phase === p).map(row),
      "",
    ]),
    "## 8.4 SQL checks",
    "",
    "| Check | Result | Counts |",
    "| --- | --- | --- |",
    ...(result.sql ?? []).map((c) => `| ${c.name} | ${c.ok ? "pass" : "FAIL"} | \`${JSON.stringify(c.counts)}\` |`),
    "",
    "## Route sweep (flag on, signed in)",
    "",
    "| Actor | Route | Status | Expected | Result |",
    "| --- | --- | --- | --- | --- |",
    ...(result.routes ?? []).map((r) => `| ${r.actor} | \`${r.route}\` | ${r.status} | ${r.expected} | ${r.ok ? "pass" : "FAIL"} |`),
    "",
    "## Flag-off sweep (REWARDS_ENABLED=false, NEXT_PUBLIC_REWARDS_ENABLED unset)",
    "",
    "| Check | Status | Expected | Result |",
    "| --- | --- | --- | --- |",
    ...(result.flagOff?.checks ?? []).map((c) => `| ${c.name} | ${c.status} | ${c.expected} | ${c.ok ? "pass" : "FAIL"} |`),
    "",
  ].join("\n");
  writeFileSync(path.join(OUT, "rewards-journey-report.md"), md);
}

// ---------------------------------------------------------------- journey
async function importRoutes() {
  // Node >= 22.18 strips the types of this .ts module (same as ir5-journey).
  return import(path.join(root, "apps/frontend/my-app/lib/pilot-scope.ts"));
}
const sample = (route) => route.replace(/\[[^\]]+\]/g, () => randomUUID());
const page = async (actor, route) => {
  const res = await fetch(`${BASE}${route}`, { headers: actor ? { Cookie: actor.cookieHeader() } : {}, redirect: "manual" });
  const html = await res.text();
  return { status: res.status, html };
};

async function runJourney(result) {
  const tag = randomUUID().slice(0, 6);
  const mk = (l) => new Actor(l, BASE, ORIGIN);
  const admin = mk("admin"), A = mk("userA"), B = mk("userB"), C = mk("userC"), D = mk("userD"), E = mk("userE");
  const cx = {}; // shared ids
  const succeeded = []; // redemption ids created by this run

  phase = "setup";
  for (const a of [admin, A, B, C, D, E]) await a.register(`rwj-${a.label}-${tag}@example.com`, recordSink);
  await setRole(admin, "ADMIN");
  await activateAndFund(A, 30000, tag);
  await activateAndFund(B, 1000, tag);
  await activateAndFund(C, 30000, tag);
  await activateAndFund(D, 30000, tag);
  // E is funded but NOT activated (ACCOUNT_NOT_ACTIVATED case).
  await postGrant(E.id, 5000, `rewards-journey-fund:${tag}:${E.id}`, "Journey funding 5000 pts (not activated)");

  // ---------------- 8.3 Admin: catalog
  phase = "Admin catalog";
  const now = Date.now();
  const voucherBody = (title, brandId, overrides = {}) => ({
    title,
    brandId,
    category: "COFFEE",
    valueVnd: 50000,
    basePoints: 1000,
    promoPoints: null,
    isSharedCode: false,
    redeemStartsAt: new Date(now - 5 * 60_000).toISOString(),
    redeemEndsAt: new Date(now + 14 * 86400_000).toISOString(),
    codeExpiresAt: new Date(now + 23 * 86400_000).toISOString(),
    terms: ["Journey term"],
    howToUse: ["Journey step"],
    imageUrl: null,
    ...overrides,
  });
  const codesFor = (label, count) => Array.from({ length: count }, (_, i) => `J${tag}${label}${String(i + 1).padStart(2, "0")}`.toUpperCase());
  const brandIds = [];
  await S_("settings read", async () => {
    const s = await dataOf(admin, "settings read", "GET", "/admin/rewards/settings");
    parse("rewardsSettingsSchema", s, "settings");
    cx.dailyLimitBefore = s.dailyPointsLimit;
    return { dailyPointsLimit: s.dailyPointsLimit };
  });
  await S_("settings update (daily limit 100000 so price tests are not capped)", async () => {
    const s = await dataOf(admin, "settings update", "PUT", "/admin/rewards/settings", { body: { dailyPointsLimit: 100000 } });
    eq(s.dailyPointsLimit, 100000, "dailyPointsLimit");
  });
  await S_("brands list", async () => {
    const b = parse("adminVoucherBrandListSchema", await dataOf(admin, "list brands", "GET", "/admin/rewards/brands"), "brands");
    truthy(b.items.length >= 2, "need at least 2 seeded brands");
    brandIds.push(b.items[0].id, b.items[1].id);
    return { brands: b.items.length };
  });
  const createVoucher = async (key, label, body, codeCount) => {
    const created = parse("adminVoucherCreatedSchema", await dataOf(admin, `create voucher ${label}`, "POST", "/admin/rewards/vouchers", { body, expect: 201, ids: (d) => ({ voucherId: d.voucher?.id }) }), `create ${label}`);
    cx[key] = created.voucher.id;
    if (codeCount) {
      const codes = codesFor(label, codeCount);
      codes.forEach((c) => secrets.add(c));
      const csv = `code\n${codes.join("\n")}\n`; // the admin UI uploads a CSV; the API takes the parsed array
      const parsed = csv.split(/\r?\n/).slice(1).filter(Boolean);
      const res = await dataOf(admin, `import codes ${label}`, "POST", `/admin/rewards/vouchers/${cx[key]}/codes`, { body: { mode: "COMMIT", codes: parsed }, ids: (d) => ({ accepted: d.accepted, committed: d.committed }) });
      eq(res.committed, true, `${label} import committed`);
      eq(res.accepted, codeCount, `${label} accepted`);
    }
    return created.voucher;
  };
  await S_("create V1 (promo price, 9 codes) + CSV import", async () => {
    await createVoucher("v1", "V1", voucherBody(`Journey V1 ${tag}`, brandIds[0], { basePoints: 1000, promoPoints: 800 }), 9);
    const d = parse("adminVoucherDetailSchema", await dataOf(admin, "voucher detail V1", "GET", `/admin/rewards/vouchers/${cx.v1}`), "detail V1");
    eq(d.voucher.stock.total, 9, "V1 stock.total");
    eq(d.voucher.stock.codesAvailable, 9, "V1 codesAvailable");
    eq(d.voucher.price.source, "PROMO", "V1 price source");
    return { voucherId: cx.v1 };
  });
  await S_("create validation: promo >= base rejected", async () => {
    await fails(admin, "create voucher invalid promo", "POST", "/admin/rewards/vouchers", { status: 400, code: "VALIDATION_ERROR", body: voucherBody("bad", brandIds[0], { basePoints: 1000, promoPoints: 1000 }) });
  });
  await S_("CSV import: in-file duplicate rejected, nothing committed", async () => {
    const dup = `J${tag}DUPX01`.toUpperCase();
    secrets.add(dup);
    for (const mode of ["VALIDATE", "COMMIT"]) {
      const r = parse("adminCodeImportResultSchema", await dataOf(admin, `import duplicate (${mode})`, "POST", `/admin/rewards/vouchers/${cx.v1}/codes`, { body: { mode, codes: [dup, dup, `J${tag}DUPX02`.toUpperCase()] } }), "import dup");
      eq(r.duplicatesInFile.length, 1, `${mode} duplicatesInFile`);
      eq(r.accepted, 0, `${mode} accepted`);
      eq(r.committed, false, `${mode} committed`);
    }
    const d = await dataOf(admin, "voucher detail V1 after rejected import", "GET", `/admin/rewards/vouchers/${cx.v1}`);
    eq(d.voucher.stock.total, 9, "stock unchanged by the rejected import");
  });
  await S_("create V2..V8 (flash, last-unit, insufficient, cheap, shared, survey-rule, flash-whole-stock)", async () => {
    await createVoucher("v2", "V2", voucherBody(`Journey V2 flash ${tag}`, brandIds[0]), 5);
    await createVoucher("v8", "V8", voucherBody(`Journey V8 flash whole stock ${tag}`, brandIds[1], { basePoints: 700 }), 2);
    await createVoucher("v3", "V3", voucherBody(`Journey V3 last unit ${tag}`, brandIds[1], { basePoints: 500 }), 1);
    await createVoucher("v4", "V4", voucherBody(`Journey V4 ${tag}`, brandIds[1], { basePoints: 800 }), 3);
    await createVoucher("v5", "V5", voucherBody(`Journey V5 cheap ${tag}`, brandIds[0], { basePoints: 500 }), 4);
    const sharedCode = `SHARED-${tag}`.toUpperCase();
    secrets.add(sharedCode);
    await createVoucher("v6", "V6", voucherBody(`Journey V6 shared ${tag}`, brandIds[0], { basePoints: 600, isSharedCode: true, sharedCode }), 0);
    await dataOf(admin, "stock V6 shared (no codes needed)", "POST", `/admin/rewards/vouchers/${cx.v6}/stock`, { body: { total: 5, reason: "Journey shared stock" } });
    await createVoucher("v7", "V7", voucherBody(`Journey V7 survey rule ${tag}`, brandIds[1], { basePoints: 900 }), 3);
    return { v2: cx.v2, v3: cx.v3, v4: cx.v4, v5: cx.v5, v6: cx.v6, v7: cx.v7 };
  });
  await S_("admin list + filter + search", async () => {
    const all = parse("adminVoucherListSchema", await dataOf(admin, "admin voucher list", "GET", "/admin/rewards/vouchers"), "admin list");
    truthy(all.items.some((v) => v.id === cx.v1), "V1 in admin list");
    const filtered = parse("adminVoucherListSchema", await dataOf(admin, "admin voucher list ACTIVE + q", "GET", `/admin/rewards/vouchers?filter=ACTIVE&q=${encodeURIComponent(`Journey V1 ${tag}`)}`), "admin list q");
    eq(filtered.items.length, 1, "q matches V1 only");
    assertNoCodes("admin voucher list", all);
  });

  // ---------------- 8.3 Admin: Flash (create/conflicts)
  phase = "Admin Flash";
  const startsAt = new Date(Date.now() + 50_000);
  const endsAt = new Date(startsAt.getTime() + 30 * 60_000);
  const flashBody = (voucherId, flashPoints, quota, rules, s = startsAt, e = endsAt) => ({
    title: `Journey flash ${tag}`,
    startsAt: s.toISOString(),
    endsAt: e.toISOString(),
    rules,
    items: [{ voucherId, flashPoints, quota, perUserCap: 1 }],
  });
  const openRules = { requireRecentSurvey: false, blockFlagged: false, remindBefore10m: false };
  await S_("flash conflicts: price >= regular, quota > unreserved, start in past", async () => {
    await fails(admin, "flash price >= regular", "POST", "/admin/rewards/flash-sales", { status: 409, code: "FLASH_PRICE_NOT_BELOW_REGULAR", body: flashBody(cx.v2, 1000, 3, openRules) });
    await fails(admin, "flash quota > unreserved stock", "POST", "/admin/rewards/flash-sales", { status: 409, code: "FLASH_QUOTA_EXCEEDS_STOCK", body: flashBody(cx.v2, 600, 6, openRules) });
    await fails(admin, "flash starts in past", "POST", "/admin/rewards/flash-sales", { status: 409, code: "FLASH_STARTS_IN_PAST", body: flashBody(cx.v2, 600, 3, openRules, new Date(Date.now() - 60_000), endsAt) });
  });
  await S_("create Flash F1 (V2: 5 in stock, quota 3), F2 (V7, survey rule), F3 (V8: quota = whole stock 2)", async () => {
    const f1 = parse("adminFlashSaleCreatedSchema", await dataOf(admin, "create flash F1", "POST", "/admin/rewards/flash-sales", { body: flashBody(cx.v2, 600, 3, openRules), expect: 201, ids: (d) => ({ flashSaleId: d.flashSale?.id, code: d.flashSale?.code }) }), "F1");
    const f2 = parse("adminFlashSaleCreatedSchema", await dataOf(admin, "create flash F2", "POST", "/admin/rewards/flash-sales", { body: flashBody(cx.v7, 500, 2, { requireRecentSurvey: true, blockFlagged: false, remindBefore10m: false }), expect: 201, ids: (d) => ({ flashSaleId: d.flashSale?.id, code: d.flashSale?.code }) }), "F2");
    const f3 = parse("adminFlashSaleCreatedSchema", await dataOf(admin, "create flash F3", "POST", "/admin/rewards/flash-sales", { body: flashBody(cx.v8, 400, 2, openRules), expect: 201, ids: (d) => ({ flashSaleId: d.flashSale?.id, code: d.flashSale?.code }) }), "F3");
    cx.f1 = f1.flashSale.id; cx.f1Code = f1.flashSale.code; cx.f2 = f2.flashSale.id; cx.f3 = f3.flashSale.id;
    eq(f1.flashSale.status, "UPCOMING", "F1 status before start");
  });
  await S_("flash overlap on the same voucher rejected", async () => {
    await fails(admin, "flash overlap", "POST", "/admin/rewards/flash-sales", { status: 409, code: "FLASH_OVERLAP", body: flashBody(cx.v2, 650, 1, openRules, new Date(startsAt.getTime() + 60_000), endsAt) });
  });

  // ---------------- 8.3 User: browse
  phase = "User browse";
  await S_("catalog list with filters", async () => {
    const list = parse("voucherCatalogSchema", await dataOf(A, "catalog list", "GET", `/rewards/vouchers?brand=${brandIds[0]}&category=COFFEE&sort=POINTS_ASC&limit=5`), "catalog");
    truthy(list.items.length > 0, "catalog has items for the brand filter");
    truthy(list.items.every((v) => v.brand.id === brandIds[0] && v.category === "COFFEE"), "filter returns only the requested brand/category");
    const pts = list.items.map((v) => v.price.points);
    truthy(pts.every((p, i) => i === 0 || pts[i - 1] <= p), "POINTS_ASC order");
    const search = parse("voucherCatalogSchema", await dataOf(A, "catalog search q", "GET", `/rewards/vouchers?q=${encodeURIComponent(`Journey V3 last unit ${tag}`)}`), "catalog q");
    eq(search.items.length, 1, "q matches V3 only");
    const bBalance = await available(B);
    const aff = parse("voucherCatalogSchema", await dataOf(B, "catalog affordable=true", "GET", "/rewards/vouchers?affordable=true&limit=50"), "catalog affordable");
    truthy(aff.items.every((v) => v.affordable && v.price.points <= bBalance), "affordable filter respects the viewer balance");
    return { total: list.total };
  });
  await S_("voucher detail + balance from wallet", async () => {
    const d = parse("voucherDetailResponseSchema", await dataOf(A, "voucher detail", "GET", `/rewards/vouchers/${cx.v1}`), "detail");
    const w = await available(A);
    eq(d.viewer.available, w, "detail viewer.available equals wallet available");
    eq(w, 30100, "userA wallet (100 activation + 30000 funding)");
  });

  // ---------------- 8.3 Redeem success
  phase = "Redeem success";
  const claim = async (actor, voucherId, label, key = randomUUID()) => {
    const quote = parse("redemptionQuoteSchema", await dataOf(actor, `quote ${label}`, "POST", "/rewards/quotes", { body: { voucherId }, expect: 201, ids: (d) => ({ quoteId: d.quoteId, source: d.price?.source, points: d.price?.points }) }), `quote ${label}`);
    const redemption = parse("redemptionResultSchema", await dataOf(actor, `redeem ${label}`, "POST", "/rewards/redemptions", { body: { quoteId: quote.quoteId }, headers: { "Idempotency-Key": key }, expect: 201, ids: (d) => ({ redemptionId: d.redemptionId, reference: d.reference, ticketId: d.ticket?.id, pointsSpent: d.pointsSpent }) }), `redeem ${label}`);
    secrets.add(redemption.ticket.code);
    succeeded.push(redemption.redemptionId);
    return { quote, redemption, key };
  };
  let aV1;
  await S_("A: quote -> redeem V1 -> replay same key -> by-key", async () => {
    const before = await available(A);
    aV1 = await claim(A, cx.v1, "A V1");
    eq(aV1.quote.price.source, "PROMO", "quote source");
    eq(aV1.redemption.pointsSpent, 800, "pointsSpent");
    eq(aV1.redemption.balanceAfter, before - 800, "balanceAfter");
    const replay = parse("redemptionResultSchema", await dataOf(A, "replay redeem (same key)", "POST", "/rewards/redemptions", { body: { quoteId: aV1.quote.quoteId }, headers: { "Idempotency-Key": aV1.key }, expect: 201 }), "replay");
    eq(replay.redemptionId, aV1.redemption.redemptionId, "replay returns the same redemption");
    eq(await available(A), before - 800, "replay did not charge twice");
    const byKey = parse("redemptionResultSchema", await dataOf(A, "get redemption by key", "GET", `/rewards/redemptions/by-key/${aV1.key}`, { expect: 201 }), "by-key");
    eq(byKey.redemptionId, aV1.redemption.redemptionId, "by-key redemption");
    cx.aTicketV1 = aV1.redemption.ticket.id;
    cx.aRedemptionV1 = aV1.redemption.redemptionId;
    cx.aOriginalCode = aV1.redemption.ticket.code;
    cx.aPriceV1 = aV1.redemption.pointsSpent;
    return { ticketId: cx.aTicketV1 };
  });
  await S_("same key + different quote -> IDEMPOTENCY_KEY_CONFLICT; same quote + new key -> QUOTE_ALREADY_REDEEMED", async () => {
    const other = parse("redemptionQuoteSchema", await dataOf(A, "quote V5 for conflict", "POST", "/rewards/quotes", { body: { voucherId: cx.v5 }, expect: 201 }), "quote");
    await fails(A, "reuse key with another quote", "POST", "/rewards/redemptions", { status: 409, code: "IDEMPOTENCY_KEY_CONFLICT", body: { quoteId: other.quoteId }, headers: { "Idempotency-Key": aV1.key } });
    await fails(A, "redeem used quote with a new key", "POST", "/rewards/redemptions", { status: 409, code: "QUOTE_ALREADY_REDEEMED", body: { quoteId: aV1.quote.quoteId }, headers: { "Idempotency-Key": randomUUID() } });
  });
  let cV1, dV6;
  await S_("C redeems V1, D redeems shared V6 (tickets for the faulty-code flow)", async () => {
    cx.cBefore = await available(C);
    cV1 = await claim(C, cx.v1, "C V1");
    cx.cTicketV1 = cV1.redemption.ticket.id;
    cx.cPriceV1 = cV1.redemption.pointsSpent;
    dV6 = await claim(D, cx.v6, "D V6 shared");
    cx.dTicketV6 = dV6.redemption.ticket.id;
    eq(dV6.redemption.ticket.isSharedCode, true, "V6 ticket is a shared code");
    cx.dBefore = await available(D);
  });

  // ---------------- 8.3 My vouchers
  phase = "My vouchers";
  await S_("list by tab, detail with code, use, undo", async () => {
    const list = parse("voucherTicketListSchema", await dataOf(A, "list my vouchers", "GET", "/rewards/my-vouchers"), "tickets");
    const mine = list.items.find((t) => t.id === cx.aTicketV1);
    need(mine, "ticket of A V1 in my-vouchers");
    eq(mine.status, "UNUSED", "ticket status (tab Chua dung)");
    const detail = parse("voucherTicketResponseSchema", await dataOf(A, "ticket detail", "GET", `/rewards/my-vouchers/${cx.aTicketV1}`), "ticket detail");
    eq(detail.ticket.code, cx.aOriginalCode, "ticket detail shows the issued code");
    const used = parse("voucherTicketResponseSchema", await dataOf(A, "mark used", "POST", `/rewards/my-vouchers/${cx.aTicketV1}/use`), "use");
    eq(used.ticket.status, "USED", "status after use");
    need(used.ticket.undoUntil, "undoUntil");
    const tabUsed = parse("voucherTicketListSchema", await dataOf(A, "list after use", "GET", "/rewards/my-vouchers"), "tickets").items.filter((t) => t.status === "USED");
    truthy(tabUsed.some((t) => t.id === cx.aTicketV1), "ticket appears in the Da dung tab");
    const undone = parse("voucherTicketResponseSchema", await dataOf(A, "undo use", "POST", `/rewards/my-vouchers/${cx.aTicketV1}/undo-use`), "undo");
    eq(undone.ticket.status, "UNUSED", "status after undo");
    return { unused: list.items.filter((t) => t.status === "UNUSED").length };
  });
  await S_("another user's ticket is not found", async () => {
    await fails(B, "B opens A's ticket", "GET", `/rewards/my-vouchers/${cx.aTicketV1}`, { status: 404, code: "TICKET_NOT_FOUND" });
  });

  // ---------------- 8.3 Failure codes
  phase = "Failure codes";
  await S_("SOLD_OUT: last unit taken between quote and confirm (V3)", async () => {
    const qa = parse("redemptionQuoteSchema", await dataOf(A, "A quote V3", "POST", "/rewards/quotes", { body: { voucherId: cx.v3 }, expect: 201 }), "quote");
    const qb = parse("redemptionQuoteSchema", await dataOf(B, "B quote V3", "POST", "/rewards/quotes", { body: { voucherId: cx.v3 }, expect: 201 }), "quote");
    const ra = parse("redemptionResultSchema", await dataOf(A, "A redeem V3 (last unit)", "POST", "/rewards/redemptions", { body: { quoteId: qa.quoteId }, headers: { "Idempotency-Key": randomUUID() }, expect: 201 }), "redeem");
    secrets.add(ra.ticket.code); succeeded.push(ra.redemptionId);
    const before = await available(B);
    const e = await fails(B, "B redeem V3 (sold out)", "POST", "/rewards/redemptions", { status: 409, code: "SOLD_OUT", body: { quoteId: qb.quoteId }, headers: { "Idempotency-Key": randomUUID() } });
    eq(e.details?.regularStockRemaining, 0, "SOLD_OUT details.regularStockRemaining");
    eq(await available(B), before, "SOLD_OUT deducted no Points");
  });
  await S_("PRICE_CHANGED: Admin changes price between quote and confirm (V1)", async () => {
    const qb = parse("redemptionQuoteSchema", await dataOf(B, "B quote V1", "POST", "/rewards/quotes", { body: { voucherId: cx.v1 }, expect: 201 }), "quote");
    await dataOf(admin, "admin price change V1", "POST", `/admin/rewards/vouchers/${cx.v1}/price`, { body: { basePoints: 1100, promoPoints: 900 } });
    const detail = parse("adminVoucherDetailSchema", await dataOf(admin, "voucher detail after price change", "GET", `/admin/rewards/vouchers/${cx.v1}`), "detail");
    eq(Math.max(...detail.priceHistory.map((p) => p.version)), 2, "priceVersion 2 in history");
    const before = await available(B);
    const e = await fails(B, "B redeem V1 at stale price", "POST", "/rewards/redemptions", { status: 409, code: "PRICE_CHANGED", body: { quoteId: qb.quoteId }, headers: { "Idempotency-Key": randomUUID() } });
    eq(e.details?.price?.priceVersion, 2, "PRICE_CHANGED details.price.priceVersion");
    eq(await available(B), before, "PRICE_CHANGED deducted no Points");
  });
  await S_("INSUFFICIENT_POINTS: balance spent between quote and confirm (V4 then V5)", async () => {
    const q4 = parse("redemptionQuoteSchema", await dataOf(B, "B quote V4 (800 of 1100)", "POST", "/rewards/quotes", { body: { voucherId: cx.v4 }, expect: 201 }), "quote");
    const r5 = await claim(B, cx.v5, "B V5 (spends 500)");
    const before = await available(B);
    eq(before, 600, "B balance after V5 (100 activation + 1000 funding - 500)");
    const e = await fails(B, "B redeem V4 (not enough left)", "POST", "/rewards/redemptions", { status: 409, code: "INSUFFICIENT_POINTS", body: { quoteId: q4.quoteId }, headers: { "Idempotency-Key": randomUUID() } });
    eq(e.details?.required, 800, "required");
    eq(e.details?.available, 600, "available");
    eq(await available(B), before, "INSUFFICIENT_POINTS deducted no Points");
    void r5;
  });
  await S_("VOUCHER_UNAVAILABLE: Admin pauses after quote (V4), then hide -> not found at quote", async () => {
    const qc = parse("redemptionQuoteSchema", await dataOf(C, "C quote V4", "POST", "/rewards/quotes", { body: { voucherId: cx.v4 }, expect: 201 }), "quote");
    await dataOf(admin, "admin pause V4", "PATCH", `/admin/rewards/vouchers/${cx.v4}`, { body: { state: "PAUSED" } });
    const before = await available(C);
    const e = await fails(C, "C redeem paused V4", "POST", "/rewards/redemptions", { status: 409, code: "VOUCHER_UNAVAILABLE", body: { quoteId: qc.quoteId }, headers: { "Idempotency-Key": randomUUID() } });
    eq(e.details?.status, "PAUSED", "VOUCHER_UNAVAILABLE details.status");
    eq(await available(C), before, "VOUCHER_UNAVAILABLE deducted no Points");
    await dataOf(admin, "admin resume V4", "PATCH", `/admin/rewards/vouchers/${cx.v4}`, { body: { state: "ACTIVE" } });
    await dataOf(admin, "admin hide V4", "PATCH", `/admin/rewards/vouchers/${cx.v4}`, { body: { isVisible: false } });
    await fails(C, "C quote hidden V4", "POST", "/rewards/quotes", { status: 404, code: "VOUCHER_NOT_FOUND", body: { voucherId: cx.v4 } });
    const list = parse("voucherCatalogSchema", await dataOf(C, "catalog without hidden V4", "GET", `/rewards/vouchers?q=${encodeURIComponent(`Journey V4 ${tag}`)}`), "catalog");
    eq(list.items.length, 0, "hidden voucher is not listed");
    await dataOf(admin, "admin unhide V4", "PATCH", `/admin/rewards/vouchers/${cx.v4}`, { body: { isVisible: true } });
  });
  await S_("ACCOUNT_NOT_ELIGIBLE: ACCOUNT_NOT_ACTIVATED (E)", async () => {
    const before = await available(E);
    await fails(E, "E quote V1 (not activated)", "POST", "/rewards/quotes", { status: 403, code: "ACCOUNT_NOT_ELIGIBLE", reason: "ACCOUNT_NOT_ACTIVATED", body: { voucherId: cx.v1 } });
    eq(await available(E), before, "no Points moved");
  });
  await S_("ACCOUNT_NOT_ELIGIBLE: VOUCHER_LIMIT_REACHED (A, 3rd V5 in 30 days)", async () => {
    await claim(A, cx.v5, "A V5 #1");
    await claim(A, cx.v5, "A V5 #2");
    const before = await available(A);
    await fails(A, "A quote V5 3rd time", "POST", "/rewards/quotes", { status: 403, code: "ACCOUNT_NOT_ELIGIBLE", reason: "VOUCHER_LIMIT_REACHED", body: { voucherId: cx.v5 } });
    eq(await available(A), before, "no Points moved");
  });

  // ---------------- Admin: stock adjust
  phase = "Admin stock";
  await S_("stock adjust: below issued+reserved rejected; increase without codes rejected; decrease ok", async () => {
    await fails(admin, "stock below issued", "POST", `/admin/rewards/vouchers/${cx.v1}/stock`, { status: 409, code: "STOCK_BELOW_COMMITTED", body: { total: 1, reason: "Journey below committed" } });
    await fails(admin, "stock increase needs codes", "POST", `/admin/rewards/vouchers/${cx.v1}/stock`, { status: 409, code: "STOCK_INCREASE_NEEDS_CODES", body: { total: 20, reason: "Journey increase" } });
    const ok = await dataOf(admin, "stock decrease 9 -> 8", "POST", `/admin/rewards/vouchers/${cx.v1}/stock`, { body: { total: 8, reason: "Journey decrease" } });
    eq(ok.voucher?.stock?.total, 8, "stock.total after decrease");
  });

  // ---------------- Flash (wait for lifecycle job)
  phase = "Flash";
  await S_("wait for F1, F2, F3 reserved_at (lifecycle job)", async () => {
    await waitFor("flash_sales.reserved_at", async () => (await n("SELECT count(*) AS n FROM flash_sales WHERE id IN ($1::uuid,$2::uuid,$3::uuid) AND reserved_at IS NOT NULL", cx.f1, cx.f2, cx.f3)) === 3, 120_000);
    const d = parse("adminFlashSaleCreatedSchema", await dataOf(admin, "flash monitor F1 (active)", "GET", `/admin/rewards/flash-sales/${cx.f1}`), "flash detail");
    eq(d.flashSale.status, "ACTIVE", "F1 status after reserve");
    const v2 = await dataOf(admin, "voucher detail V2 (reserved)", "GET", `/admin/rewards/vouchers/${cx.v2}`);
    eq(v2.voucher.stock.flashReserved, 3, "V2 stock.flashReserved");
  });
  await S_("user flash list shows F1", async () => {
    const list = parse("flashSaleListSchema", await dataOf(A, "user flash list", "GET", "/rewards/flash-sales"), "flash list");
    truthy(list.items.some((f) => f.id === cx.f1), "F1 in the user flash list");
  });
  await S_("Flash: A,B,C,D quote FLASH; A,B,C redeem; per-user cap; D loses (PRICE_CHANGED to regular price); sale sold out", async () => {
    const quotes = {};
    for (const u of [A, B, C, D]) {
      // B has 500 points (< 600) -> top up so the Flash happy path is not the INSUFFICIENT case again.
      if (u === B) await postGrant(B.id, 2000, `rewards-journey-fund2:${tag}:${B.id}`, "Journey top-up before Flash");
      quotes[u.label] = parse("redemptionQuoteSchema", await dataOf(u, `${u.label} quote V2 (flash)`, "POST", "/rewards/quotes", { body: { voucherId: cx.v2 }, expect: 201, ids: (d) => ({ source: d.price?.source, points: d.price?.points }) }), "flash quote");
      eq(quotes[u.label].price.source, "FLASH", `${u.label} quote source`);
      need(quotes[u.label].flashEndsAt, "flashEndsAt");
    }
    const redeemFlash = async (u) => {
      const r = parse("redemptionResultSchema", await dataOf(u, `${u.label} redeem flash`, "POST", "/rewards/redemptions", { body: { quoteId: quotes[u.label].quoteId }, headers: { "Idempotency-Key": randomUUID() }, expect: 201 }), "flash redeem");
      eq(r.priceSource, "FLASH", "redeemed at FLASH price");
      eq(r.pointsSpent, 600, "flash pointsSpent");
      secrets.add(r.ticket.code); succeeded.push(r.redemptionId);
      return r;
    };
    await redeemFlash(A);
    await fails(A, "A second flash quote (cap 1)", "POST", "/rewards/quotes", { status: 403, code: "ACCOUNT_NOT_ELIGIBLE", reason: "FLASH_LIMIT_REACHED", body: { voucherId: cx.v2 } });
    await redeemFlash(B);
    await redeemFlash(C);
    const dBefore = await available(D);
    // V2 still has regular stock (5 in stock, quota 3): a Flash quote that lost the race falls back to the regular price.
    const e = await fails(D, "D redeem flash quote after sell-out (regular stock left)", "POST", "/rewards/redemptions", { status: 409, code: "PRICE_CHANGED", body: { quoteId: quotes.userD.quoteId }, headers: { "Idempotency-Key": randomUUID() } });
    eq(e.details?.price?.source, "BASE", "PRICE_CHANGED falls back to the regular price");
    eq(await available(D), dBefore, "no Points deducted");
    const d = parse("adminFlashSaleCreatedSchema", await dataOf(admin, "flash monitor F1 (sold out)", "GET", `/admin/rewards/flash-sales/${cx.f1}`), "flash detail");
    eq(d.flashSale.status, "SOLD_OUT", "F1 status");
    eq(d.flashSale.items[0].sold, 3, "F1 sold");
    eq(d.flashSale.items[0].quota, 3, "F1 quota");
    eq(d.flashSale.succeededCount, 3, "F1 succeededCount");
    const list = parse("adminFlashSaleListSchema", await dataOf(admin, "admin flash list", "GET", "/admin/rewards/flash-sales"), "admin flash list");
    truthy(list.items.some((f) => f.id === cx.f1), "F1 in the admin flash list");
  });
  await S_("Flash where quota = whole stock (stock_remaining 0 after reserve): first redeem succeeds", async () => {
    const r = await claim(C, cx.v8, "C V8 (flash, quota == stock)");
    eq(r.redemption.priceSource, "FLASH", "priceSource");
  });
  await S_("Flash F2: ACCOUNT_NOT_ELIGIBLE NO_RECENT_SURVEY; Admin ends early; unsold quota returns", async () => {
    await fails(A, "A quote V7 (flash needs a recent survey)", "POST", "/rewards/quotes", { status: 403, code: "ACCOUNT_NOT_ELIGIBLE", reason: "NO_RECENT_SURVEY", body: { voucherId: cx.v7 } });
    await fails(admin, "end F2 reason OTHER without note", "POST", `/admin/rewards/flash-sales/${cx.f2}/end`, { status: 400, code: "VALIDATION_ERROR", body: { reason: "OTHER" } });
    await dataOf(admin, "end F2 early", "POST", `/admin/rewards/flash-sales/${cx.f2}/end`, { body: { reason: "STOCK_ISSUE", note: "journey" } });
    await fails(admin, "end F2 again", "POST", `/admin/rewards/flash-sales/${cx.f2}/end`, { status: 409, code: "FLASH_ALREADY_ENDED", body: { reason: "STOCK_ISSUE" } });
    await waitFor("F2 settled and V7 stock returned", async () => {
      const v = await dataOf(admin, "poll V7 stock", "GET", `/admin/rewards/vouchers/${cx.v7}`);
      return v.voucher.stock.flashReserved === 0 && v.voucher.stock.remaining === 3;
    }, 60_000);
  });

  // ---------------- 8.3 Faulty code (Part D / Task 7.3)
  phase = "Faulty code";
  const issue = {};
  await S_("users report: A (V1), C (V1), D (V6 shared); duplicate report refused", async () => {
    for (const [u, ticket, reason, key] of [[A, cx.aTicketV1, "CODE_INVALID", "a"], [C, cx.cTicketV1, "CODE_ALREADY_USED", "c"], [D, cx.dTicketV6, "STORE_REFUSED", "d"]]) {
      const r = parse("codeIssueReportSchema", await dataOf(u, `${u.label} reports code issue`, "POST", `/rewards/my-vouchers/${ticket}/issues`, { body: { reason, note: "journey report" }, expect: 201, ids: (d) => ({ reportId: d.id, status: d.status }) }), "report");
      eq(r.status, "OPEN", "report status");
      issue[key] = r.id;
    }
    await fails(A, "A reports again", "POST", `/rewards/my-vouchers/${cx.aTicketV1}/issues`, { status: 409, code: "CODE_ISSUE_ALREADY_OPEN", body: { reason: "OTHER" } });
    const t = await dataOf(A, "A ticket shows open issue", "GET", `/rewards/my-vouchers/${cx.aTicketV1}`);
    eq(t.ticket.openIssue?.id, issue.a, "ticket.openIssue");
  });
  await S_("Admin queue lists them; canReplace and reason; no code value in payloads", async () => {
    const list = parse("adminCodeIssueListSchema", await dataOf(admin, "admin code-issue queue (OPEN)", "GET", "/admin/rewards/code-issues?status=OPEN&limit=50"), "queue");
    assertNoCodes("code-issue list", list);
    const find = (id) => need(list.items.find((i) => i.id === id), `code issue ${id} in the queue`);
    eq(find(issue.a).canReplace, true, "A canReplace");
    eq(find(issue.a).replaceBlockedReason, null, "A replaceBlockedReason");
    eq(find(issue.d).canReplace, false, "D (shared) canReplace");
    eq(find(issue.d).replaceBlockedReason, "SHARED_CODE", "D replaceBlockedReason");
    truthy(list.summary.open >= 3, "summary.open counts the three reports");
    const detail = parse("adminCodeIssueSchema", await dataOf(admin, "admin code-issue detail", "GET", `/admin/rewards/code-issues/${issue.a}`), "detail");
    assertNoCodes("code-issue detail", detail);
    return { open: list.summary.open };
  });
  await S_("REJECT: note required; REPLACE refused for shared code; REJECT with note; already resolved", async () => {
    const before = await available(D);
    await fails(admin, "reject without note", "POST", `/admin/rewards/code-issues/${issue.d}/resolve`, { status: 400, code: "VALIDATION_ERROR", body: { outcome: "REJECT" } });
    await fails(admin, "replace a shared code", "POST", `/admin/rewards/code-issues/${issue.d}/resolve`, { status: 409, code: "REPLACEMENT_NOT_SUPPORTED", body: { outcome: "REPLACE" } });
    const r = parse("adminCodeIssueSchema", await dataOf(admin, "reject with note", "POST", `/admin/rewards/code-issues/${issue.d}/resolve`, { body: { outcome: "REJECT", note: "Journey: code is valid" } }), "reject");
    assertNoCodes("resolve REJECT", r);
    eq(r.status, "REJECTED", "status");
    eq(r.resolutionNote, "Journey: code is valid", "resolutionNote");
    await fails(admin, "refund after reject", "POST", `/admin/rewards/code-issues/${issue.d}/resolve`, { status: 409, code: "CODE_ISSUE_ALREADY_RESOLVED", body: { outcome: "REFUND" } });
    eq(await available(D), before, "REJECT moved no Points");
  });
  await S_("REPLACE: user gets a different code; replay is idempotent; refund after replace refused", async () => {
    const r = parse("adminCodeIssueSchema", await dataOf(admin, "replace code", "POST", `/admin/rewards/code-issues/${issue.a}/resolve`, { body: { outcome: "REPLACE" } }), "replace");
    assertNoCodes("resolve REPLACE", r);
    eq(r.status, "REPLACED", "status");
    const t = parse("voucherTicketResponseSchema", await dataOf(A, "A ticket after replace", "GET", `/rewards/my-vouchers/${cx.aTicketV1}`), "ticket");
    truthy(t.ticket.code !== cx.aOriginalCode, "ticket now carries a different code");
    secrets.add(t.ticket.code);
    eq(t.ticket.openIssue?.status, "REPLACED", "ticket.openIssue carries the resolved status (no longer OPEN)");
    const again = await dataOf(admin, "replace again (idempotent)", "POST", `/admin/rewards/code-issues/${issue.a}/resolve`, { body: { outcome: "REPLACE" } });
    eq(again.status, "REPLACED", "replay status");
    await fails(admin, "refund after replace", "POST", `/admin/rewards/code-issues/${issue.a}/resolve`, { status: 409, code: "CODE_ISSUE_ALREADY_RESOLVED", body: { outcome: "REFUND" } });
  });
  await S_("REFUND: RFD- reference, wallet restored, history REFUNDED", async () => {
    const before = await available(C);
    const r = parse("adminCodeIssueSchema", await dataOf(admin, "refund", "POST", `/admin/rewards/code-issues/${issue.c}/resolve`, { body: { outcome: "REFUND" } }), "refund");
    assertNoCodes("resolve REFUND", r);
    eq(r.status, "REFUNDED", "status");
    truthy(/^RFD-\d{4}-[0-9A-Z]{4}$/.test(r.resolution?.refundReference ?? ""), "resolution.refundReference matches RFD-");
    eq(await available(C), before + cx.cPriceV1, "wallet restored by the redemption price");
    const h = parse("redemptionHistoryListSchema", await dataOf(C, "C history", "GET", "/rewards/redemptions?limit=50"), "history");
    const refunded = h.items.find((i) => i.kind === "REFUNDED");
    need(refunded, "REFUNDED history row");
    eq(refunded.reference, r.resolution.refundReference, "history refund reference");
    truthy(h.items.some((i) => i.kind === "SUCCEEDED"), "history keeps the SUCCEEDED row");
    cx.refundReference = r.resolution.refundReference;
  });

  // ---------------- 8.3 History
  phase = "History";
  await S_("history: Success / Failed / Refunded, pagination", async () => {
    const b = parse("redemptionHistoryListSchema", await dataOf(B, "B history", "GET", "/rewards/redemptions?limit=50"), "history B");
    const failed = b.items.filter((i) => i.kind === "FAILED").map((i) => i.failureCode);
    for (const code of ["SOLD_OUT", "PRICE_CHANGED", "INSUFFICIENT_POINTS"]) truthy(failed.includes(code), `B history has a FAILED ${code} row`);
    truthy(b.items.some((i) => i.kind === "SUCCEEDED"), "B history has a SUCCEEDED row");
    const page1 = parse("redemptionHistoryListSchema", await dataOf(B, "B history page 1", "GET", "/rewards/redemptions?limit=1&offset=0"), "page1");
    eq(page1.items.length, 1, "limit=1");
    eq(page1.hasMore, true, "hasMore");
    const a = parse("redemptionHistoryListSchema", await dataOf(A, "A history", "GET", "/rewards/redemptions?limit=50"), "history A");
    truthy(a.items.some((i) => i.kind === "SUCCEEDED" && i.isFlash), "A history has the Flash SUCCEEDED row");
    return { failedCodes: [...new Set(failed)] };
  });

  // ---------------- Notifications
  phase = "Notifications";
  await S_("faulty-code notifications reach A, C and D", async () => {
    for (const u of [A, C, D]) {
      await waitFor(`${u.label} CODE_ISSUE_RESOLVED notification`, async () => {
        const nots = await dataOf(u, `${u.label} notifications`, "GET", "/notifications");
        return (nots.items ?? []).some((x) => x.type === "CODE_ISSUE_RESOLVED");
      }, 60_000);
    }
  });

  // ---------------- Stats
  phase = "Stats";
  await S_("GET /admin/rewards/stats matches the run (refunded excluded)", async () => {
    const day = vnToday();
    const stats = parse("rewardsStatsSchema", await dataOf(admin, "admin stats (today)", "GET", `/admin/rewards/stats?from=${day}&to=${day}`), "stats");
    const rows = await q(
      `SELECT count(*)::int AS n, coalesce(sum(price_points),0)::int AS p FROM redemptions r
       WHERE r.status='SUCCEEDED' AND NOT EXISTS (SELECT 1 FROM redemption_refunds f WHERE f.redemption_id=r.id)
       AND ((r.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Ho_Chi_Minh')::date = $1::date`,
      day,
    );
    eq(stats.kpis.redemptions.count, rows[0].n, "stats redemptions.count == SQL counted redemptions");
    eq(stats.kpis.pointsSpent.points, rows[0].p, "stats pointsSpent.points == SQL sum");
    eq(stats.kpis.pointsSpent.vndEquivalent, rows[0].p * 200, "vndEquivalent = points x 200");
    eq(stats.daily.length, 1, "daily has one row");
    eq(stats.daily[0].count, rows[0].n, "daily[0].count");
    truthy(stats.daily[0].flashSaleCodes.includes(cx.f1Code), "daily[0] lists the Flash code");
    const fs = need(stats.flashSales.find((f) => f.code === cx.f1Code), "F1 in stats.flashSales");
    eq(fs.sold, 3, "stats flash sold");
    const runCounted = Number((await q(
      `SELECT count(*)::int AS n FROM redemptions r WHERE r.id = ANY($1::uuid[]) AND NOT EXISTS (SELECT 1 FROM redemption_refunds f WHERE f.redemption_id=r.id)`,
      succeeded,
    ))[0].n);
    eq(runCounted, succeeded.length - 1, "this run: succeeded minus the one refunded");
    truthy(stats.kpis.redemptions.count >= runCounted, "stats include every non-refunded redemption of this run");
    return { statsCount: stats.kpis.redemptions.count, runCounted, pointsSpent: stats.kpis.pointsSpent.points };
  });

  // ---------------- Route sweep (flag on)
  phase = "Route sweep";
  const { REWARDS_ROUTES } = await importRoutes();
  result.routes = [];
  for (const { route } of REWARDS_ROUTES) {
    const actor = route.startsWith("/admin") ? admin : A;
    const res = await page(actor, sample(route));
    result.routes.push({ actor: actor.label, route, status: res.status, expected: 200, ok: res.status === 200 });
  }

  // ---------------- 8.4 SQL checks
  phase = "SQL";
  result.sql = [];
  const check = async (name, counts, ok) => result.sql.push({ name, ok, counts });
  const unbalanced = await n("SELECT count(*) AS n FROM (SELECT journal_id FROM ledger_entries GROUP BY journal_id HAVING sum(amount) <> 0) t");
  await check("every journal sums to zero", { unbalancedJournals: unbalanced }, unbalanced === 0);
  const redemptionJournals = await q(
    `SELECT r.id, (SELECT count(*) FROM ledger_journals j WHERE j.idempotency_key = 'redemption:' || r.user_id || ':' || r.idempotency_key)::int AS journals,
            (SELECT count(*) FROM ledger_journals j WHERE j.id = r.journal_id AND j.idempotency_key = 'redemption:' || r.user_id || ':' || r.idempotency_key)::int AS linked
     FROM redemptions r WHERE r.status = 'SUCCEEDED'`,
  );
  const badRed = redemptionJournals.filter((r) => r.journals !== 1 || r.linked !== 1).length;
  await check("each SUCCEEDED redemption has exactly one journal keyed redemption:{userId}:{key}, linked via journal_id", { succeeded: redemptionJournals.length, violations: badRed }, redemptionJournals.length > 0 && badRed === 0);
  const refunds = await q(
    `SELECT f.id, (SELECT count(*) FROM ledger_journals j WHERE j.idempotency_key = 'redemption-refund:' || f.report_id)::int AS journals,
            (SELECT count(*) FROM ledger_journals j WHERE j.id = f.journal_id AND j.idempotency_key = 'redemption-refund:' || f.report_id)::int AS linked
     FROM redemption_refunds f`,
  );
  const badRef = refunds.filter((r) => r.journals !== 1 || r.linked !== 1).length;
  await check("each refund has exactly one journal keyed redemption-refund:{reportId}, linked via journal_id", { refunds: refunds.length, violations: badRef }, refunds.length > 0 && badRef === 0);
  const identity = await q(
    `SELECT v.id, v.stock_total, v.stock_remaining,
       coalesce((SELECT sum(i.quota - i.sold) FROM flash_sale_items i JOIN flash_sales s ON s.id = i.flash_sale_id
                 WHERE i.voucher_id = v.id AND s.reserved_at IS NOT NULL AND s.settled_at IS NULL), 0)::int AS flash_reserved,
       ((SELECT count(*) FROM redemptions r WHERE r.voucher_id = v.id AND r.status = 'SUCCEEDED')
        + (SELECT count(*) FROM voucher_codes c WHERE c.voucher_id = v.id AND c.issue_report_id IS NOT NULL))::int AS issued
     FROM vouchers v`,
  );
  const badId = identity.filter((v) => v.stock_total !== v.stock_remaining + v.flash_reserved + v.issued);
  await check("stock_total = stock_remaining + flash reserved + issued (per voucher)", { vouchers: identity.length, violations: badId.length, firstViolation: badId[0] ?? null }, badId.length === 0);
  const dupCodes = await n("SELECT count(*) AS n FROM (SELECT voucher_code_id FROM redemptions WHERE voucher_code_id IS NOT NULL AND status = 'SUCCEEDED' GROUP BY 1 HAVING count(*) > 1) t");
  const replacedAlsoIssued = await n("SELECT count(*) AS n FROM voucher_codes c WHERE c.issue_report_id IS NOT NULL AND EXISTS (SELECT 1 FROM redemptions r WHERE r.voucher_code_id = c.id)");
  await check("each code assigned at most once", { codesIssuedTwice: dupCodes, replacementAlsoIssued: replacedAlsoIssued }, dupCodes === 0 && replacedAlsoIssued === 0);
  const drift = await n("SELECT count(*) AS n FROM (SELECT a.id FROM ledger_accounts a LEFT JOIN ledger_entries e ON e.account_id = a.id GROUP BY a.id, a.balance HAVING a.balance <> COALESCE(sum(e.amount), 0)) t");
  const neg = await n("SELECT count(*) AS n FROM ledger_accounts WHERE user_id IS NOT NULL AND balance < 0");
  await check("ledger accounts: no balance drift, no negative user account", { driftedAccounts: drift, negativeUserAccounts: neg }, drift === 0 && neg === 0);
  for (const c of result.sql) steps.push({ phase, actor: "sql", step: c.name, request: "SQL", status: 0, ok: c.ok, ms: 0, ids: c.counts });
  result.settings = { dailyPointsLimitBefore: cx.dailyLimitBefore, dailyPointsLimitDuringRun: 100000 };
}

// ---------------------------------------------------------------- flag-off sweep
async function runFlagOff() {
  const tag = randomUUID().slice(0, 6);
  const admin = new Actor("admin", BASE, ORIGIN);
  const user = new Actor("user", BASE, ORIGIN);
  phase = "Flag-off setup";
  await admin.register(`rwj-off-admin-${tag}@example.com`, recordSink);
  await setRole(admin, "ADMIN");
  await user.register(`rwj-off-user-${tag}@example.com`, recordSink);
  const { REWARDS_ROUTES } = await importRoutes();
  const checks = [];
  const add = (name, status, expected, extra = {}) => checks.push({ name, status, expected, ok: status === expected, ...extra });
  for (const { route } of REWARDS_ROUTES) {
    const actor = route.startsWith("/admin") ? admin : user;
    add(`page ${route} (${actor.label})`, (await page(actor, sample(route))).status, 404);
  }
  for (const [actor, apiPath] of [[user, "/rewards/vouchers"], [admin, "/admin/rewards/vouchers"], [admin, "/admin/rewards/stats?from=2026-10-01&to=2026-10-02"]]) {
    const res = await fetch(`${BASE}/api${apiPath}`, { headers: { Cookie: actor.cookieHeader(), Origin: ORIGIN } });
    await res.arrayBuffer();
    add(`API GET ${apiPath.split("?")[0]} (${actor.label}, valid session)`, res.status, 404);
  }
  const wallet = await page(user, "/wallet");
  checks.push({ name: "wallet page (user) is served", status: wallet.status, expected: 200, ok: wallet.status === 200 });
  let copyIn = wallet.html.includes(CASH_COPY) ? "served HTML" : null;
  if (!copyIn) {
    // The wallet is a client component: the copy ships in the page's JS chunks (flag-independent).
    const chunks = [...wallet.html.matchAll(/\/_next\/static\/[^"'\s]+\.js/g)].map((m) => m[0]);
    for (const c of [...new Set(chunks)]) {
      const res = await fetch(`${BASE}${c}`);
      if ((await res.text()).includes(CASH_COPY)) { copyIn = `JS chunk ${c.split("/").pop()}`; break; }
    }
  }
  checks.push({ name: `wallet shows the cash copy (found in: ${copyIn ?? "NOT FOUND"})`, status: copyIn ? 200 : 0, expected: 200, ok: Boolean(copyIn) });
  return { checks, passed: checks.every((c) => c.ok) };
}

// ---------------------------------------------------------------- main
let commit = "unknown";
try { commit = execSync("git rev-parse --short HEAD", { cwd: root }).toString().trim(); } catch { /* not a git checkout */ }
const run = `rewards-journey-${new Date().toISOString().replace(/[:.]/g, "-")}`;
let result = { run, base: BASE, database: dbName, commit, node: process.version, startedAt: new Date().toISOString(), steps };
try {
  if (FLAG_OFF) {
    if (!existsSync(REPORT_JSON)) throw new Error(`run the flag-on journey first: ${REPORT_JSON} is missing`);
    const prior = JSON.parse(readFileSync(REPORT_JSON, "utf8"));
    const off = await runFlagOff();
    result = { ...prior, flagOff: { ...off, steps: steps.slice() } };
    result.passed = Boolean(prior.passed) && off.passed;
    for (const c of off.checks.filter((x) => !x.ok)) result.error = `${result.error ? `${result.error}; ` : ""}flag-off: ${c.name} -> ${c.status}`;
  } else {
    await runJourney(result);
    const failed = steps.filter((s) => !s.ok);
    result.passed = failed.length === 0 && result.sql.every((c) => c.ok) && result.routes.every((r) => r.ok);
    if (!result.passed) result.error = `${failed.length} failed step(s); first: ${failed[0]?.step ?? (result.sql.find((c) => !c.ok)?.name ?? "route sweep")}`;
  }
} catch (error) {
  result.passed = false;
  result.error = error.message;
} finally {
  result.finishedAt = new Date().toISOString();
  if (FLAG_OFF) result.steps = JSON.parse(readFileSync(REPORT_JSON, "utf8")).steps;
  writeReport(result);
  await prisma.$disconnect();
}
console.log(`${result.passed ? "PASS" : "FAIL"}: ${OUT}/rewards-journey-report.md${result.error ? ` - ${result.error}` : ""}`);
process.exit(result.passed ? 0 : 1);
