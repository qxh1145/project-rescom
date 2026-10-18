import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Mock-off Phase 4: the MSW handlers of the admin read views (queue counts,
 * overview, FraudLog, ledger) emit exactly the shared `@rescom/schemas`
 * contracts the backend controllers return, accept the same queries and
 * reject the same malformed ones (the frontend half of the contract test; the
 * backend half is `apps/backend/test/admin-read-views.e2e-spec.ts`).
 *
 * Same loader set-up as `participation-contract.test.mjs`: the real handler
 * modules run in Node with stand-ins for the signed-in user and the scenario switch.
 */
const appRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const dataModule = (source) => `data:text/javascript,${encodeURIComponent(source)}`;

const HOOKS = `
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

let appRoot = "";
let replacements = {};

export function initialize(data) {
  appRoot = data.appRoot;
  replacements = data.replacements;
}

function asFile(candidate) {
  for (const file of [candidate, candidate + ".ts", path.join(candidate, "index.ts")]) {
    if (existsSync(file) && statSync(file).isFile()) return file;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  let file = null;
  if (specifier.startsWith("@/")) {
    file = asFile(path.join(appRoot, specifier.slice(2)));
  } else if (/^\\.\\.?\\//.test(specifier) && context.parentURL?.startsWith("file:")) {
    const parent = fileURLToPath(context.parentURL);
    if (parent.startsWith(appRoot + path.sep) && !parent.includes(path.sep + "node_modules" + path.sep)) {
      file = asFile(path.resolve(path.dirname(parent), specifier));
    }
  }
  if (!file) return nextResolve(specifier, context);
  const replacement = replacements[path.relative(appRoot, file)];
  return { url: replacement ?? pathToFileURL(file).href, shortCircuit: true };
}
`;

const SESSION_STAND_IN = `
export async function getMockSessionUser() {
  return globalThis.__adminContractUser ?? null;
}
export function findMockUserByEmail() {
  return null;
}
`;

const SCENARIOS_STAND_IN = `
export const MOCK_SCENARIOS = ["default"];
export const SCENARIO_STORAGE_KEY = "rescom:msw-scenario";
export function getActiveScenario() {
  return "default";
}
export async function applyScenario() {
  return undefined;
}
`;

register(dataModule(HOOKS), import.meta.url, {
  data: {
    appRoot,
    replacements: {
      [path.join("mocks", "db", "session.ts")]: dataModule(SESSION_STAND_IN),
      [path.join("mocks", "scenarios.ts")]: dataModule(SCENARIOS_STAND_IN),
    },
  },
});

const { getResponse } = await import("msw");
const { adminHandlers } = await import("../mocks/handlers/admin.ts");
const { adminOverviewHandlers } = await import("../mocks/handlers/admin-overview.ts");
const { adminFraudLogHandlers } = await import("../mocks/handlers/admin-fraud-log.ts");
const { adminAuditLogsHandlers } = await import("../mocks/handlers/admin-audit-logs.ts");
const { adminTransactionHandlers } = await import("../mocks/handlers/admin-transactions.ts");
const { journalKindOf, matchesTransactionFilter, TRANSACTION_FILTERS } = await import("../lib/admin/admin-transactions.ts");
const schemas = await import("@rescom/schemas");

const handlers = [
  ...adminHandlers,
  ...adminOverviewHandlers,
  ...adminFraudLogHandlers,
  ...adminAuditLogsHandlers,
  ...adminTransactionHandlers,
];
const ORIGIN = "http://localhost";

function signIn(role = "ADMIN") {
  globalThis.__adminContractUser = { id: randomUUID(), email: `${randomUUID()}@fpt.edu.vn`, name: "Admin", role, profileComplete: true };
}

async function get(route) {
  const response = await getResponse(handlers, new Request(`${ORIGIN}/api${route}`), { baseUrl: ORIGIN });
  assert.ok(response, `a handler answers GET ${route}`);
  return { status: response.status, body: await response.json() };
}

/** 2xx `data` must parse with the shared schema (strict: no extra field). */
function parsed(schema, result) {
  assert.equal(result.status, 200, JSON.stringify(result.body.error));
  const outcome = schema.safeParse(result.body.data);
  assert.ok(outcome.success, outcome.success ? "" : JSON.stringify(outcome.error.issues));
  return outcome.data;
}

const ROUTES = [
  "/admin/queue-counts",
  "/admin/overview",
  "/admin/fraud-log",
  "/admin/audit-logs",
  "/admin/ledger/journals",
  "/admin/ledger/summary",
];

test("non-admins get 403 FORBIDDEN_RESOURCE (the backend RolesGuard code), anonymous 401", async () => {
  signIn("USER");
  for (const route of ROUTES) {
    const result = await get(route);
    assert.equal(result.status, 403);
    assert.equal(result.body.error.code, "FORBIDDEN_RESOURCE");
  }
  globalThis.__adminContractUser = null;
  for (const route of ROUTES) assert.equal((await get(route)).status, 401);
});

test("queue counts and overview parse with the shared schemas", async () => {
  signIn();
  parsed(schemas.adminQueueCountsSchema, await get("/admin/queue-counts"));
  const overview = parsed(schemas.adminOverviewSchema, await get("/admin/overview"));
  assert.ok(overview.flaggedAccounts.length <= schemas.ADMIN_OVERVIEW_FLAGGED_LIMIT);
});

test("FraudLog: shared query and page, keyset pages without repeats", async () => {
  signIn();
  const all = parsed(schemas.fraudLogPageSchema, await get("/admin/fraud-log"));
  assert.ok(all.items.length > 2, "the mock seed has entries");
  assert.equal(all.nextCursor, null);

  const seen = [];
  let cursor = null;
  for (let page = 0; page < 50; page += 1) {
    const query = new URLSearchParams({ limit: "2" });
    if (cursor) query.set("cursor", cursor);
    const result = parsed(schemas.fraudLogPageSchema, await get(`/admin/fraud-log?${query}`));
    seen.push(...result.items.map((item) => item.id));
    cursor = result.nextCursor;
    if (!cursor) break;
  }
  assert.deepEqual(seen, all.items.map((item) => item.id));

  assert.equal(all.totalCapped, false);
  assert.equal(all.truncated, false);
  // Accounts: most entries first, ties by account id (the backend order).
  for (let i = 1; i < all.accounts.length; i += 1) {
    const [a, b] = [all.accounts[i - 1], all.accounts[i]];
    assert.ok(a.count > b.count || (a.count === b.count && a.userId < b.userId), "accounts order");
  }

  // Search: the backend short-code rule (`shortCodePrefixOf`), among accounts with entries.
  const someone = all.items[0].userId;
  const code = `#${someone.replace(/-/g, "").slice(0, 4).toUpperCase()}`;
  const byCode = parsed(schemas.fraudLogPageSchema, await get(`/admin/fraud-log?search=${encodeURIComponent(code)}`));
  assert.ok(byCode.items.length > 0);
  assert.ok(byCode.items.every((item) => item.userId.replace(/-/g, "").startsWith(code.slice(1).toLowerCase())));
  const none = parsed(schemas.fraudLogPageSchema, await get("/admin/fraud-log?search=%23z"));
  assert.equal(none.total, 0);

  const wrongCodes = parsed(schemas.fraudLogPageSchema, await get("/admin/fraud-log?type=COMPLETION_CODE&days=30"));
  assert.ok(wrongCodes.items.every((item) => schemas.fraudLogKindOf(item) === "COMPLETION_CODE"));
  assert.equal(wrongCodes.windowDays, 30);

  for (const bad of ["days=5", "type=NOPE", "limit=101", "cursor=x", "page=2"]) {
    const result = await get(`/admin/fraud-log?${bad}`);
    assert.equal(result.status, 400, bad);
    assert.equal(result.body.error.code, "VALIDATION_ERROR");
  }
});

test("ledger: shared journal page and summary, before cursor, same validation", async () => {
  signIn();
  const first = parsed(schemas.adminJournalListSchema, await get("/admin/ledger/journals?limit=3"));
  assert.equal(first.items.length, 3);
  assert.equal(first.hasMore, true);
  const last = first.items[2];
  const next = parsed(
    schemas.adminJournalListSchema,
    await get(`/admin/ledger/journals?limit=3&before=${encodeURIComponent(`${last.createdAt}:${last.id}`)}`),
  );
  assert.ok(next.items.every((item) => !first.items.some((shown) => shown.id === item.id)));
  parsed(schemas.adminLedgerSummarySchema, await get("/admin/ledger/summary"));

  for (const bad of ["type=payout", "before=garbage", "limit=0", "extra=1"]) {
    const result = await get(`/admin/ledger/journals?${bad}`);
    assert.equal(result.status, 400, bad);
    assert.equal(result.body.error.code, "VALIDATION_ERROR");
  }
});

test("ledger segments: the backend key prefixes match the frontend kind grouping", () => {
  const id = randomUUID();
  const segments = TRANSACTION_FILTERS.map((item) => item.value).filter((value) => value !== "all");
  for (const [segment, prefixes] of Object.entries(schemas.ADMIN_LEDGER_FILTER_KEY_PREFIXES)) {
    for (const prefix of prefixes) {
      const kind = journalKindOf({ idempotencyKey: `${prefix}${id}`, reversesJournalId: null });
      for (const other of segments) {
        assert.equal(matchesTransactionFilter(kind, other), other === segment, `${prefix} in ${other}`);
      }
    }
  }
  const reversal = journalKindOf({ idempotencyKey: `reversal:${id}`, reversesJournalId: id });
  assert.deepEqual(segments.filter((segment) => matchesTransactionFilter(reversal, segment)), ["refund"]);
  // Starter-point journals only show under "Tất cả".
  const starter = journalKindOf({ idempotencyKey: `starter-grant:${id}`, reversesJournalId: null });
  assert.deepEqual(segments.filter((segment) => matchesTransactionFilter(starter, segment)), []);
});

test("Audit log: shared query and page, filters, detail, 404", async () => {
  signIn();
  const pageResult = await get("/admin/audit-logs");
  const page = parsed(schemas.auditLogPageSchema, pageResult);
  assert.ok(page.items.length > 0, "the mock seed has audit logs");
  assert.equal(page.pagination.page, 1);
  assert.equal(page.pagination.limit, 20);

  // Newest first check
  for (let i = 0; i < page.items.length - 1; i++) {
    const a = new Date(page.items[i].createdAt).getTime();
    const b = new Date(page.items[i + 1].createdAt).getTime();
    assert.ok(a >= b, "items are newest first");
  }

  // Filter by action
  const byAction = parsed(
    schemas.auditLogPageSchema,
    await get("/admin/audit-logs?action=USER_ROLE_CHANGED"),
  );
  assert.ok(byAction.items.length > 0);
  assert.ok(byAction.pagination.total < page.pagination.total, "action filter narrows");
  assert.ok(byAction.items.every((item) => item.action === "USER_ROLE_CHANGED"));

  // Filter by outcome
  const byOutcome = parsed(
    schemas.auditLogPageSchema,
    await get("/admin/audit-logs?outcome=FAILURE"),
  );
  assert.ok(byOutcome.items.length > 0);
  assert.ok(byOutcome.pagination.total < page.pagination.total, "outcome filter narrows");
  assert.ok(byOutcome.items.every((item) => item.outcome === "FAILURE"));

  // Filter by actor and target user
  const actorId = page.items.find((item) => item.userId)?.userId;
  const byActor = parsed(schemas.auditLogPageSchema, await get(`/admin/audit-logs?userId=${actorId}`));
  assert.ok(byActor.items.length > 0);
  assert.ok(byActor.pagination.total < page.pagination.total, "actor filter narrows");
  assert.ok(byActor.items.every((item) => item.userId === actorId));
  const targetId = page.items.find((item) => item.targetUserId)?.targetUserId;
  const byTarget = parsed(schemas.auditLogPageSchema, await get(`/admin/audit-logs?targetUserId=${targetId}`));
  assert.ok(byTarget.items.length > 0);
  assert.ok(byTarget.pagination.total < page.pagination.total, "target filter narrows");
  assert.ok(byTarget.items.every((item) => item.targetUserId === targetId));

  // Filter by date
  const byDate = parsed(
    schemas.auditLogPageSchema,
    await get("/admin/audit-logs?startDate=2026-10-18T00:00:00%2B07:00&endDate=2026-10-18T23:59:59.999%2B07:00"),
  );
  assert.ok(byDate.items.length > 0);
  assert.ok(byDate.pagination.total < page.pagination.total, "date filter narrows");
  assert.ok(
    byDate.items.every((item) => {
      const at = new Date(item.createdAt).getTime();
      return at >= Date.parse("2026-10-18T00:00:00+07:00") && at <= Date.parse("2026-10-18T23:59:59.999+07:00");
    }),
  );

  // Detail endpoint
  const firstId = page.items[0].id;
  const detailRes = await get(`/admin/audit-logs/${firstId}`);
  const detail = parsed(schemas.auditLogDetailSchema, detailRes);
  assert.equal(detail.auditLog.id, firstId);
  assert.ok(detail.auditLog.userId, "newest seed row has an actor");
  assert.equal(detail.auditLog.actor?.id, detail.auditLog.userId);

  // 404 on unknown UUID
  const notFound = await get(`/admin/audit-logs/${randomUUID()}`);
  assert.equal(notFound.status, 404);
  assert.equal(notFound.body.error.code, "AUDIT_LOG_NOT_FOUND");

  // 400 on page=0
  const badQuery = await get("/admin/audit-logs?page=0");
  assert.equal(badQuery.status, 400);
  assert.equal(badQuery.body.error.code, "VALIDATION_ERROR");
});

