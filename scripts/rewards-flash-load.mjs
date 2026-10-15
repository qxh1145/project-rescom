#!/usr/bin/env node
/**
 * Story 12.11 Task 9: Flash Sale load test (9.1-9.6). Node stdlib + the repo's
 * Prisma client only; no load-test dependency.
 *
 * N users (default 300) are registered and funded on a scratch DB, one voucher
 * and one Flash Sale (quota 100, perUserCap 1, requireRecentSurvey=false,
 * starting ~90 s out) are created through the Admin API, the script waits for
 * `flash_sales.reserved_at`, then releases every user at the same instant:
 * quote, then redeem with the user's own Idempotency-Key. DOUBLE users send the
 * same redeem twice concurrently. After the run every 9.5 invariant is checked
 * in SQL (hard assert, exit 1).
 *
 * Env: LOAD_BASE_URL (backend, default http://localhost:4001), LOAD_DATABASE_URL
 * (scratch DB ending in _check/_test), LOAD_ORIGIN, LOAD_USERS, LOAD_QUOTA,
 * LOAD_STOCK (default = quota; > quota leaves regular stock), LOAD_DOUBLE,
 * LOAD_START_DELAY_S, LOAD_BACKEND_CONTAINER / LOAD_DB_CONTAINER (for the
 * hardware profile), LOAD_OUT_DIR, LOAD_REPORT_NAME.
 */
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Actor } from "./lib/actor.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = process.env;
const BASE = (env.LOAD_BASE_URL ?? "http://localhost:4001").replace(/\/$/, "");
const DB_URL = env.LOAD_DATABASE_URL ?? "postgresql://rescom_admin:rescom_password@localhost:5434/rescom_rewards_check?schema=public";
const ORIGIN = env.LOAD_ORIGIN ?? "http://localhost:3000";
const OUT = env.LOAD_OUT_DIR ?? path.join(root, "_bmad-output/implementation-artifacts/12-11-evidence");
const REPORT = env.LOAD_REPORT_NAME ?? "rewards-flash-load-report";
const N = Number(env.LOAD_USERS ?? 300);
const QUOTA = Number(env.LOAD_QUOTA ?? 100);
const STOCK = Number(env.LOAD_STOCK ?? QUOTA);
const DOUBLE = Number(env.LOAD_DOUBLE ?? 20);
const START_DELAY_S = Number(env.LOAD_START_DELAY_S ?? 90);
const PRICE_FLASH = 600;
const PRICE_BASE = 1000;
const FUND = 2000;
const ACTIVATION = 100;
const SETUP_CONCURRENCY = 8;

const dbName = new URL(DB_URL).pathname.slice(1);
if (!/_(check|test)$/.test(dbName)) {
  console.error(`LOAD_DATABASE_URL must target a scratch DB ending in _check or _test (got ${dbName}).`);
  process.exit(2);
}
if (!(DOUBLE <= N && QUOTA > 0 && STOCK >= QUOTA && N > QUOTA)) {
  console.error("Need DOUBLE <= N, 0 < QUOTA <= STOCK and N > QUOTA.");
  process.exit(2);
}

const { PrismaClient } = createRequire(path.join(root, "apps/backend/package.json"))("@prisma/client");
const prisma = new PrismaClient({ datasources: { db: { url: DB_URL } } });
const q = (sql, ...args) => prisma.$queryRawUnsafe(sql, ...args);
const num = async (sql, ...args) => Number((await q(sql, ...args))[0].n);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (msg) => console.log(`[${new Date().toISOString().slice(11, 23)}] ${msg}`);

// ---------------------------------------------------------------- http (raw: status + error.code, no throwing)
const netErrors = [];
async function raw(actor, kind, method, apiPath, { body, headers = {} } = {}) {
  const h = { Origin: ORIGIN, Accept: "application/json", Cookie: actor.cookieHeader(), ...headers };
  if (body !== undefined) h["Content-Type"] = "application/json";
  if (method !== "GET" && actor.csrf) h["X-CSRF-Token"] = actor.csrf;
  const started = performance.now();
  try {
    const res = await fetch(`${BASE}/api${apiPath}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    const ms = performance.now() - started;
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
    const code = res.status < 300 ? "OK" : (json?.error?.code ?? `HTTP_${res.status}`);
    return { kind, status: res.status, code, ms, json };
  } catch (error) {
    const ms = performance.now() - started;
    const msg = `${error.name}: ${error.cause?.code ?? error.message}`;
    if (netErrors.length < 10) netErrors.push(msg);
    return { kind, status: 0, code: "NETWORK_ERROR", ms, json: null };
  }
}

function percentiles(samples) {
  if (samples.length === 0) return { count: 0 };
  const s = [...samples].sort((a, b) => a - b);
  const at = (p) => s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))]; // nearest rank
  const r = (v) => Math.round(v * 10) / 10;
  return { count: s.length, p50: r(at(50)), p95: r(at(95)), p99: r(at(99)), max: r(s[s.length - 1]), min: r(s[0]) };
}
const tally = (list) => list.reduce((m, r) => ({ ...m, [`${r.status}:${r.code}`]: (m[`${r.status}:${r.code}`] ?? 0) + 1 }), {});

// ---------------------------------------------------------------- setup helpers
async function ledgerAccount(userId, accountClass) {
  const found = await prisma.ledgerAccount.findFirst({ where: { userId, accountClass } });
  return found ?? prisma.ledgerAccount.create({ data: { userId, accountClass, balance: 0 } });
}
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
async function pool(items, size, fn) {
  const queue = [...items];
  await Promise.all(Array.from({ length: size }, async () => { for (let item = queue.shift(); item !== undefined; item = queue.shift()) await fn(item); }));
}
function sh(cmd) {
  try { return execSync(cmd, { stdio: ["ignore", "pipe", "pipe"], timeout: 15000 }).toString().trim(); } catch (error) { return `unavailable (${String(error.message).split("\n")[0]})`; }
}
function hardwareProfile() {
  const backend = env.LOAD_BACKEND_CONTAINER;
  const db = env.LOAD_DB_CONTAINER;
  const inspect = (c) => (c ? sh(`docker inspect ${c} --format 'cpus={{.HostConfig.NanoCpus}}ns cpuset={{.HostConfig.CpusetCpus}} memory={{.HostConfig.Memory}}B image={{.Config.Image}}'`) : "not containerised");
  return {
    clientHost: { platform: `${os.platform()} ${os.arch()}`, cpus: os.cpus().length, memoryGiB: Math.round((os.totalmem() / 2 ** 30) * 10) / 10, node: process.version },
    dockerVm: sh("docker info --format '{{.NCPU}} CPUs, {{.MemTotal}} bytes, {{.Architecture}}'"),
    backend: { container: backend ?? "host process", inspect: inspect(backend), nprocInside: backend ? sh(`docker exec ${backend} nproc`) : os.cpus().length, cgroupCpuMax: backend ? sh(`docker exec ${backend} cat /sys/fs/cgroup/cpu.max`) : "n/a", cgroupMemoryMax: backend ? sh(`docker exec ${backend} cat /sys/fs/cgroup/memory.max`) : "n/a" },
    postgres: { container: db ?? "unspecified", inspect: inspect(db), cgroupCpuMax: db ? sh(`docker exec ${db} cat /sys/fs/cgroup/cpu.max`) : "n/a", nprocInside: db ? sh(`docker exec ${db} nproc`) : "n/a" },
  };
}

// ---------------------------------------------------------------- main
const result = { run: `rewards-flash-load-${new Date().toISOString().replace(/[:.]/g, "-")}`, base: BASE, database: dbName, params: { users: N, quota: QUOTA, voucherStock: STOCK, perUserCap: 1, requireRecentSurvey: false, doubleSubmitUsers: DOUBLE, flashPoints: PRICE_FLASH, basePoints: PRICE_BASE, fundPerUser: FUND + ACTIVATION, startDelaySeconds: START_DELAY_S } };
let commit = "unknown";
try { commit = execSync("git rev-parse --short HEAD", { cwd: root }).toString().trim(); } catch { /* not a git checkout */ }
result.commit = commit;
result.startedAt = new Date().toISOString();
const asserts = [];
const assertThat = (name, ok, detail) => asserts.push({ name, ok: Boolean(ok), detail });

try {
  result.hardware = hardwareProfile();
  result.authRateLimit = "AUTH_RATE_LIMIT_MAX_REQUESTS raised on the scratch backend (see hardware/env note in the evidence pack); users registered through POST /auth/register";

  // --- 9.3 setup: admin, N users (register via API), activation + funding journals
  log(`registering admin + ${N} users`);
  const tag = randomUUID().slice(0, 6);
  const admin = new Actor("admin", BASE, ORIGIN);
  await admin.register(`load-admin-${tag}@example.com`);
  await prisma.user.update({ where: { id: admin.id }, data: { role: "ADMIN" } });
  await admin.login();
  const users = Array.from({ length: N }, (_, i) => new Actor(`u${i}`, BASE, ORIGIN));
  const setupStart = performance.now();
  await pool(users, SETUP_CONCURRENCY, (u) => u.register(`load-${tag}-${u.label}@example.com`));
  result.setupRegisterSeconds = Math.round((performance.now() - setupStart) / 100) / 10;
  for (const u of users) {
    await postGrant(u.id, ACTIVATION, `starter-unlock:${u.id}`, "Load activation (seeded starter-unlock journal)");
    await postGrant(u.id, FUND, `rewards-load-fund:${tag}:${u.id}`, `Load funding ${FUND} pts`);
  }
  log("users funded");

  // --- voucher + Flash through the Admin API
  await admin.call("settings", "PUT", "/admin/rewards/settings", { body: { dailyPointsLimit: 100000 } });
  const brands = await admin.call("brands", "GET", "/admin/rewards/brands");
  const brandId = brands.items?.[0]?.id;
  if (!brandId) throw new Error("no seeded brand");
  const now = Date.now();
  const voucher = (await admin.call("create voucher", "POST", "/admin/rewards/vouchers", {
    expect: 201,
    body: {
      title: `Load voucher ${tag}`, brandId, category: "COFFEE", valueVnd: 50000, basePoints: PRICE_BASE, promoPoints: null, isSharedCode: false,
      redeemStartsAt: new Date(now - 5 * 60_000).toISOString(), redeemEndsAt: new Date(now + 14 * 86400_000).toISOString(), codeExpiresAt: new Date(now + 23 * 86400_000).toISOString(),
      terms: [], howToUse: [], imageUrl: null,
    },
  })).voucher;
  const codes = Array.from({ length: STOCK }, (_, i) => `LD${tag}${String(i + 1).padStart(4, "0")}`.toUpperCase());
  for (let i = 0; i < codes.length; i += 1000) {
    const r = await admin.call("import codes", "POST", `/admin/rewards/vouchers/${voucher.id}/codes`, { body: { mode: "COMMIT", codes: codes.slice(i, i + 1000) } });
    if (!r.committed) throw new Error("code import not committed");
  }
  const startsAt = new Date(Date.now() + START_DELAY_S * 1000);
  const flash = (await admin.call("create flash", "POST", "/admin/rewards/flash-sales", {
    expect: 201,
    body: {
      title: `Load flash ${tag}`, startsAt: startsAt.toISOString(), endsAt: new Date(startsAt.getTime() + 30 * 60_000).toISOString(),
      rules: { requireRecentSurvey: false, blockFlagged: false, remindBefore10m: false },
      items: [{ voucherId: voucher.id, flashPoints: PRICE_FLASH, quota: QUOTA, perUserCap: 1 }],
    },
  })).flashSale;
  const [item] = await q("SELECT id FROM flash_sale_items WHERE flash_sale_id = $1::uuid", flash.id);
  result.ids = { voucherId: voucher.id, flashSaleId: flash.id, flashCode: flash.code, flashSaleItemId: item.id, startsAt: startsAt.toISOString() };
  log(`flash ${flash.code} starts ${startsAt.toISOString()}; waiting for reserved_at`);

  // --- gotcha 6: wait until the lifecycle job set reserved_at (also implies start time passed)
  const reservedBy = Date.now() + (START_DELAY_S + 120) * 1000;
  let reservedAt = null;
  while (!reservedAt) {
    if (Date.now() > reservedBy) throw new Error("timeout: flash_sales.reserved_at never set");
    const [row] = await q("SELECT reserved_at FROM flash_sales WHERE id = $1::uuid", flash.id);
    reservedAt = row.reserved_at;
    if (!reservedAt) await sleep(500);
  }
  result.ids.reservedAt = new Date(reservedAt).toISOString();
  result.reserveDelaySecondsAfterStart = Math.round((new Date(reservedAt).getTime() - startsAt.getTime()) / 100) / 10;
  log(`reserved_at ${result.ids.reservedAt}; warming connections`);

  // --- warm-up (sockets) then the start barrier
  const warm = await Promise.all(users.map((u) => raw(u, "warmup", "GET", "/rewards/flash-sales")));
  assertThat("warm-up: all users reach the API", warm.every((r) => r.status === 200), tally(warm));
  const doubleSet = new Set(users.slice(0, DOUBLE).map((u) => u.id));
  const keys = new Map(users.map((u) => [u.id, randomUUID()]));
  let release;
  const gate = new Promise((r) => { release = r; });
  const outcomes = []; // per user
  const tasks = users.map(async (u) => {
    await gate;
    const quote = await raw(u, "quote", "POST", "/rewards/quotes", { body: { voucherId: voucher.id } });
    const out = { userId: u.id, quote, redeems: [], skipped: null };
    outcomes.push(out);
    if (quote.status !== 201) { out.skipped = `quote ${quote.status}:${quote.code}`; return; }
    if (quote.json?.data?.price?.source !== "FLASH") { out.skipped = `quote source ${quote.json?.data?.price?.source}`; return; }
    const redeemOnce = () => raw(u, doubleSet.has(u.id) ? "redeem-double" : "redeem", "POST", "/rewards/redemptions", { body: { quoteId: quote.json.data.quoteId }, headers: { "Idempotency-Key": keys.get(u.id) } });
    out.redeems = doubleSet.has(u.id) ? await Promise.all([redeemOnce(), redeemOnce()]) : [await redeemOnce()];
  });
  log(`releasing ${N} users`);
  const wall = performance.now();
  release();
  await Promise.all(tasks);
  result.wallClockSeconds = Math.round(performance.now() - wall) / 1000;
  log(`done in ${result.wallClockSeconds}s`);

  // --- 9.6 numbers
  const quotes = outcomes.map((o) => o.quote);
  const redeemsAll = outcomes.flatMap((o) => o.redeems);
  const redeemsSingle = redeemsAll.filter((r) => r.kind === "redeem");
  const redeemsDouble = redeemsAll.filter((r) => r.kind === "redeem-double");
  result.latencyMs = { quote: percentiles(quotes.map((r) => r.ms)), redeem: percentiles(redeemsSingle.map((r) => r.ms)), redeemDoubleSubmit: percentiles(redeemsDouble.map((r) => r.ms)), redeemAll: percentiles(redeemsAll.map((r) => r.ms)) };
  result.nfr1 = { thresholdMs: 500, redeemP95Ms: result.latencyMs.redeemAll.p95, quoteP95Ms: result.latencyMs.quote.p95, note: "information only; PRD OQ-22 owns SLOs" };
  result.errorsByCode = { quote: tally(quotes), redeem: tally(redeemsSingle), redeemDoubleSubmit: tally(redeemsDouble) };
  result.skippedUsers = outcomes.filter((o) => o.skipped).map((o) => o.skipped).reduce((m, s) => ({ ...m, [s]: (m[s] ?? 0) + 1 }), {});
  result.networkErrorSamples = netErrors;

  // --- 9.5 invariants (SQL)
  const success201 = redeemsSingle.filter((r) => r.status === 201).length;
  const userIds = users.map((u) => u.id);
  const [itemRow] = await q("SELECT sold, quota FROM flash_sale_items WHERE id = $1::uuid", item.id);
  const succeeded = await q("SELECT id, user_id, price_points, price_source, idempotency_key FROM redemptions WHERE flash_sale_item_id = $1::uuid AND status = 'SUCCEEDED'", item.id);
  result.counts = { apiFlashSuccessesSingle: success201, sqlSucceededFlashRedemptions: succeeded.length, flashItemSold: itemRow.sold, quotes201: quotes.filter((r) => r.status === 201).length };
  assertThat(`SUCCEEDED Flash redemptions == quota (${QUOTA})`, succeeded.length === QUOTA, `sql=${succeeded.length}`);
  assertThat(`flash_sale_items.sold == quota`, itemRow.sold === QUOTA && itemRow.quota === QUOTA, `sold=${itemRow.sold} quota=${itemRow.quota}`);
  assertThat("every SUCCEEDED redemption is at the Flash price", succeeded.every((r) => r.price_source === "FLASH" && r.price_points === PRICE_FLASH), `${succeeded.length} rows`);
  const dup = await num("SELECT count(*) AS n FROM (SELECT user_id FROM redemptions WHERE flash_sale_item_id = $1::uuid AND status = 'SUCCEEDED' GROUP BY user_id HAVING count(*) > 1) t", item.id);
  assertThat("no user has two SUCCEEDED redemptions for the item", dup === 0, `users with 2+=${dup}`);
  const allowedLoss = STOCK === QUOTA ? ["SOLD_OUT"] : ["SOLD_OUT", "PRICE_CHANGED"];
  const badRedeems = redeemsAll.filter((r) => r.status !== 201 && !allowedLoss.includes(r.code));
  assertThat(`non-winners fail only with ${allowedLoss.join("/")} (no 5xx, no network error, no other code)`, badRedeems.length === 0, tally(badRedeems));
  const badQuotes = quotes.filter((r) => r.status !== 201 && !(allowedLoss.includes(r.code) && r.code === "SOLD_OUT"));
  assertThat("quotes fail only with SOLD_OUT (after sell-out); no 5xx, no network error", badQuotes.length === 0, tally(badQuotes));
  const wins = new Set(succeeded.map((r) => r.user_id));
  const nonWinnerApiSuccess = outcomes.filter((o) => !wins.has(o.userId) && o.redeems.some((r) => r.status === 201)).length;
  assertThat("API 201 <=> SQL SUCCEEDED (no phantom success)", nonWinnerApiSuccess === 0 && outcomes.filter((o) => wins.has(o.userId)).every((o) => o.redeems.some((r) => r.status === 201)), `phantom=${nonWinnerApiSuccess}`);
  const journalRows = await q(
    `SELECT r.id, (SELECT count(*) FROM ledger_journals j WHERE j.idempotency_key = 'redemption:' || r.user_id || ':' || r.idempotency_key)::int AS journals,
            (SELECT count(*) FROM ledger_journals j WHERE j.id = r.journal_id AND j.idempotency_key = 'redemption:' || r.user_id || ':' || r.idempotency_key)::int AS linked,
            coalesce((SELECT sum(e.amount) FROM ledger_entries e WHERE e.journal_id = r.journal_id), 0)::int AS sum_amount,
            (SELECT count(*) FROM ledger_entries e WHERE e.journal_id = r.journal_id)::int AS entries
     FROM redemptions r WHERE r.flash_sale_item_id = $1::uuid AND r.status = 'SUCCEEDED'`, item.id);
  const badJ = journalRows.filter((r) => r.journals !== 1 || r.linked !== 1 || r.sum_amount !== 0 || r.entries !== 2);
  assertThat("one zero-sum 2-entry journal per success", journalRows.length === QUOTA && badJ.length === 0, `rows=${journalRows.length} violations=${badJ.length}`);
  const balances = await q("SELECT user_id, balance FROM ledger_accounts WHERE account_class = 'USER_AVAILABLE' AND user_id = ANY($1::uuid[])", userIds);
  const byUser = new Map(balances.map((b) => [b.user_id, b.balance]));
  const initial = FUND + ACTIVATION;
  const debits = userIds.reduce((s, id) => s + (initial - (byUser.get(id) ?? NaN)), 0);
  const priceSum = succeeded.reduce((s, r) => s + r.price_points, 0);
  assertThat("sum of wallet debits == sum of success prices", debits === priceSum, `debits=${debits} prices=${priceSum}`);
  const losersChanged = userIds.filter((id) => !wins.has(id) && byUser.get(id) !== initial).length;
  assertThat("losers' wallets unchanged", losersChanged === 0, `changed=${losersChanged}`);
  const winnersWrong = userIds.filter((id) => wins.has(id) && byUser.get(id) !== initial - PRICE_FLASH).length;
  assertThat("winners debited exactly the Flash price once", winnersWrong === 0, `wrong=${winnersWrong}`);
  const identity = await q(
    `SELECT v.stock_total, v.stock_remaining,
       coalesce((SELECT sum(i.quota - i.sold) FROM flash_sale_items i JOIN flash_sales s ON s.id = i.flash_sale_id WHERE i.voucher_id = v.id AND s.reserved_at IS NOT NULL AND s.settled_at IS NULL), 0)::int AS flash_reserved,
       ((SELECT count(*) FROM redemptions r WHERE r.voucher_id = v.id AND r.status = 'SUCCEEDED') + (SELECT count(*) FROM voucher_codes c WHERE c.voucher_id = v.id AND c.issue_report_id IS NOT NULL))::int AS issued
     FROM vouchers v WHERE v.id = $1::uuid`, voucher.id);
  const idr = identity[0];
  assertThat("stock identity: stock_total = stock_remaining + flash reserved + issued", idr.stock_total === idr.stock_remaining + idr.flash_reserved + idr.issued, JSON.stringify(idr));
  const codeDup = await num("SELECT count(*) AS n FROM (SELECT voucher_code_id FROM redemptions WHERE voucher_id = $1::uuid AND voucher_code_id IS NOT NULL AND status = 'SUCCEEDED' GROUP BY 1 HAVING count(*) > 1) t", voucher.id);
  assertThat("no code assigned twice", codeDup === 0, `dup=${codeDup}`);
  // double-submit pairs: one result per key
  const badPairs = [];
  for (const o of outcomes.filter((x) => doubleSet.has(x.userId))) {
    if (o.redeems.length !== 2) { badPairs.push(`${o.userId}: ${o.skipped ?? "no pair"}`); continue; }
    const [a, b] = o.redeems;
    const ids = new Set([a, b].filter((r) => r.status === 201).map((r) => r.json?.data?.redemptionId));
    const rows = await num("SELECT count(*) AS n FROM redemptions WHERE user_id = $1::uuid AND idempotency_key = $2", o.userId, keys.get(o.userId));
    const jr = await num("SELECT count(*) AS n FROM ledger_journals WHERE idempotency_key = 'redemption:' || $1 || ':' || $2", o.userId, keys.get(o.userId));
    const sameOutcome = a.status === b.status && a.code === b.code;
    if (rows !== 1 || jr > 1 || ids.size > 1 || !sameOutcome) badPairs.push(`${o.userId}: rows=${rows} journals=${jr} ids=${ids.size} ${a.status}:${a.code} vs ${b.status}:${b.code}`);
  }
  result.doubleSubmit = { pairs: DOUBLE, violations: badPairs.length, winnersAmongPairs: outcomes.filter((o) => doubleSet.has(o.userId) && wins.has(o.userId)).length };
  assertThat("double-submit pairs produce one result (1 redemption row, <=1 journal, same outcome both responses)", badPairs.length === 0, badPairs.slice(0, 3).join(" | ") || `${DOUBLE} pairs ok`);
  const unbalanced = await num("SELECT count(*) AS n FROM (SELECT journal_id FROM ledger_entries GROUP BY journal_id HAVING sum(amount) <> 0) t");
  const drift = await num("SELECT count(*) AS n FROM (SELECT a.id FROM ledger_accounts a LEFT JOIN ledger_entries e ON e.account_id = a.id GROUP BY a.id, a.balance HAVING a.balance <> COALESCE(sum(e.amount), 0)) t");
  const neg = await num("SELECT count(*) AS n FROM ledger_accounts WHERE user_id IS NOT NULL AND balance < 0");
  assertThat("ledger: every journal sums to zero, no drift, no negative user account", unbalanced === 0 && drift === 0 && neg === 0, `unbalanced=${unbalanced} drift=${drift} negative=${neg}`);
  const backendStats = env.LOAD_BACKEND_CONTAINER ? sh(`docker stats ${env.LOAD_BACKEND_CONTAINER} --no-stream --format 'cpu={{.CPUPerc}} mem={{.MemUsage}}'`) : "n/a";
  result.backendStatsAfterRun = backendStats;
} catch (error) {
  assertThat("load run completed without an exception", false, error.message);
  result.error = error.message;
}

result.finishedAt = new Date().toISOString();
result.invariants = asserts;
result.passed = asserts.length > 0 && asserts.every((a) => a.ok);
mkdirSync(OUT, { recursive: true });
writeFileSync(path.join(OUT, `${REPORT}.json`), `${JSON.stringify(result, null, 2)}\n`);
const L = result.latencyMs ?? {};
const lat = (name, v) => (v?.count ? `| ${name} | ${v.count} | ${v.p50} | ${v.p95} | ${v.p99} | ${v.max} |` : `| ${name} | 0 | - | - | - | - |`);
const hw = result.hardware ?? {};
const md = [
  `# Rewards Flash load report (${result.run})`,
  "",
  `- Result: **${result.passed ? "PASS" : "FAIL"}**${result.error ? ` - ${result.error}` : ""}`,
  `- Commit: \`${commit}\` (working tree includes uncommitted Story 12.11 changes); DB: \`${dbName}\`; backend: ${BASE}`,
  `- Parameters: N=${N} users, quota=${QUOTA}, voucher stock=${STOCK}, perUserCap=1, requireRecentSurvey=false, double-submit users=${DOUBLE}, Flash price ${PRICE_FLASH} (regular ${PRICE_BASE}), start ~T+${START_DELAY_S}s`,
  `- Wall clock from release to last response: ${result.wallClockSeconds ?? "n/a"} s; lifecycle job set reserved_at ${result.reserveDelaySecondsAfterStart ?? "n/a"} s after starts_at`,
  `- Users: registered via POST /auth/register (${result.setupRegisterSeconds ?? "n/a"} s, ${SETUP_CONCURRENCY} at a time), activated and funded with balanced journals SYSTEM_ISSUANCE -> USER_AVAILABLE keyed per run`,
  "",
  "## Hardware profile",
  "",
  "```json",
  JSON.stringify(hw, null, 2),
  "```",
  `- Backend after run: ${result.backendStatsAfterRun ?? "n/a"}`,
  "",
  "## Latency (ms, nearest-rank)",
  "",
  "| Request | n | p50 | p95 | p99 | max |",
  "| --- | --- | --- | --- | --- | --- |",
  lat("quote", L.quote),
  lat("redeem (single submit)", L.redeem),
  lat("redeem (double-submit, both calls)", L.redeemDoubleSubmit),
  lat("redeem (all)", L.redeemAll),
  "",
  `NFR-1 comparison (information only, PRD OQ-22 owns SLOs): redeem p95 ${result.nfr1?.redeemP95Ms ?? "n/a"} ms and quote p95 ${result.nfr1?.quoteP95Ms ?? "n/a"} ms against 500 ms.`,
  "",
  "## Errors by status:error.code",
  "",
  "```json",
  JSON.stringify({ errorsByCode: result.errorsByCode, skippedUsers: result.skippedUsers, networkErrorSamples: result.networkErrorSamples, counts: result.counts, doubleSubmit: result.doubleSubmit }, null, 2),
  "```",
  "",
  "## 9.5 invariants",
  "",
  "| Invariant | Result | Detail |",
  "| --- | --- | --- |",
  ...asserts.map((a) => `| ${a.name} | ${a.ok ? "pass" : "FAIL"} | ${String(a.detail ?? "").replace(/\|/g, "/")} |`),
  "",
].join("\n");
writeFileSync(path.join(OUT, `${REPORT}.md`), md);
await prisma.$disconnect();
console.log(`${result.passed ? "PASS" : "FAIL"}: ${OUT}/${REPORT}.md - quote p95 ${L.quote?.p95 ?? "n/a"} ms, redeem p95 ${L.redeemAll?.p95 ?? "n/a"} ms, successes ${result.counts?.sqlSucceededFlashRedemptions ?? "n/a"}/${QUOTA}`);
process.exit(result.passed ? 0 : 1);
