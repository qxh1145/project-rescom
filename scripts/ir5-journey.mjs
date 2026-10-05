#!/usr/bin/env node
/**
 * Story IR.5 D1 + E1: the no-MSW G3 journey, driven through the pilot
 * frontend's same-origin `/api` rewrite (cookies + CSRF like a browser), and
 * the pilot hidden/visible route sweep.
 *
 * Preconditions (runbook in ir-5-g3/ir-5-g3-evidence-*.md):
 * - docker compose: postgres, minio, minio-init, clamav (healthy);
 * - backend on IR5_DATABASE_URL (a scratch DB ending in `_check`/`_test`,
 *   migrated), AUTH_RATE_LIMIT_MAX_REQUESTS=60;
 * - pilot frontend: NEXT_PUBLIC_PILOT_BUILD=true NEXT_PUBLIC_API_MOCKING=disabled
 *   `npm run build && npm start` on IR5_BASE_URL.
 *
 * Writes ir-5-g3/ir5-journey-report.{json,md}. Never records passwords,
 * cookies, CSRF tokens or seed credentials. Exit code 1 on any failed step.
 */
import { createRequire } from "node:module";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.env.IR5_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const DB_URL = process.env.IR5_DATABASE_URL ?? "postgresql://rescom_admin:rescom_password@localhost:5433/rescom_ir5_check?schema=public";
// Browsers send the page origin; override only for a direct-to-backend dry run.
const ORIGIN = process.env.IR5_ORIGIN ?? BASE;
const OUT = process.env.IR5_OUT_DIR ?? path.join(root, "_bmad-output/implementation-artifacts/ir-5-g3");
const BARRIER_MS = 16_000; // forms.service minTimeBarrierSeconds = 15

const dbName = new URL(DB_URL).pathname.slice(1);
if (!/_(check|test)$/.test(dbName)) {
  console.error(`IR5_DATABASE_URL must target a scratch DB ending in _check or _test (got ${dbName}).`);
  process.exit(2);
}

const { PrismaClient } = createRequire(path.join(root, "apps/backend/package.json"))("@prisma/client");
const prisma = new PrismaClient({ datasources: { db: { url: DB_URL } } });

const steps = [];
const run = `ir5-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const password = () => `Ir5!${randomBytes(12).toString("base64url")}`; // in memory only

/** One browser-like session: cookie jar + CSRF token, every call via `${BASE}/api`. */
class Actor {
  constructor(label) {
    this.label = label;
    this.jar = new Map();
    this.csrf = null;
    this.id = null;
  }

  cookieHeader() {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  absorb(res) {
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(";");
      const i = pair.indexOf("=");
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      const expired = !value || attrs.some((a) => /max-age=0\b/i.test(a) || /expires=thu, 01 jan 1970/i.test(a));
      if (expired) this.jar.delete(name);
      else this.jar.set(name, value);
    }
  }

  /** `expect`: status or list of statuses; anything else fails the step. */
  async call(step, method, apiPath, { body, expect = 200, headers = {}, ids } = {}) {
    const h = { Origin: ORIGIN, Accept: "application/json", ...headers };
    if (this.jar.size) h.Cookie = this.cookieHeader();
    if (body !== undefined) h["Content-Type"] = "application/json";
    if (method !== "GET" && this.csrf) h["X-CSRF-Token"] = this.csrf;
    const started = performance.now();
    const res = await fetch(`${BASE}/api${apiPath}`, {
      method,
      headers: h,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
    });
    this.absorb(res);
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON */
    }
    const ok = [].concat(expect).includes(res.status);
    const record = {
      actor: this.label,
      step,
      request: `${method} /api${apiPath.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ":id")}`,
      status: res.status,
      expected: expect,
      ok,
      ms: Math.round(performance.now() - started),
      requestId: res.headers.get("x-request-id") ?? undefined,
      errorCode: json?.error?.code ?? undefined,
      ids: ids ? ids(json?.data ?? {}) : undefined,
    };
    steps.push(record);
    if (!ok) throw new Error(`${this.label}: ${step} → ${res.status} ${json?.error?.code ?? ""} (expected ${expect})`);
    return json?.data;
  }

  async refreshCsrf() {
    const data = await this.call("csrf token", "GET", "/auth/csrf");
    this.csrf = data.csrfToken;
  }

  async register(email) {
    const pw = password();
    const data = await this.call("register (email)", "POST", "/auth/register", {
      body: { email, password: pw },
      expect: 201,
      ids: (d) => ({ userId: d.user?.id }),
    });
    this.id = data.user.id;
    this.email = email;
    this.pw = pw;
    await this.refreshCsrf();
  }

  async login() {
    this.jar.clear();
    this.csrf = null;
    await this.call("login", "POST", "/auth/login", { body: { email: this.email, password: this.pw } });
    await this.refreshCsrf();
  }
}

const DEMOGRAPHICS = {
  age: 24,
  gender: "FEMALE",
  location: "Hanoi",
  occupation: "Student",
  fieldOfStudy: "Computer Science",
  householdIncome: "Under 5M VND",
  specificInterests: ["Technology"],
};

async function onboard(actor) {
  await actor.call("demographics onboarding", "POST", "/demographics/survey", { body: DEMOGRAPHICS });
}

async function setRole(actor, role) {
  // The first Admin has no API (same as the seed); done on the scratch DB only.
  await prisma.user.update({ where: { id: actor.id }, data: { role } });
  steps.push({ actor: actor.label, step: `scratch-DB role → ${role}`, request: "SQL", status: 0, ok: true, ms: 0 });
  await actor.login(); // new role must be in the session
}

async function journey() {
  const tag = randomUUID().slice(0, 8);
  const respondent = new Actor("respondent");
  const publisher = new Actor("publisher");
  const adminA = new Actor("admin A");
  const adminB = new Actor("admin B");

  // --- Actors (every actor completes onboarding: Gate G finding) ---
  for (const [actor, role] of [
    [publisher, "PUBLISHER"],
    [adminA, "ADMIN"],
    [adminB, "ADMIN"],
    [respondent, null],
  ]) {
    await actor.register(`ir5-${actor.label.replace(" ", "-")}-${tag}@example.com`);
    if (role) await setRole(actor, role);
    await onboard(actor);
  }

  // --- D1.2 top-up governance ---
  const ownTopUp = await adminA.call("admin A requests own top-up", "POST", "/economy/top-ups", {
    body: { amount: 200 },
    expect: 201,
    ids: (d) => ({ topUpId: d.id }),
  });
  await adminA.call("admin A self-approval refused", "POST", `/admin/top-ups/${ownTopUp.id}/approve`, {
    body: {},
    expect: 403,
  });
  const topUp = await publisher.call("publisher top-up request", "POST", "/economy/top-ups", {
    body: { amount: 1000 },
    expect: 201,
    ids: (d) => ({ topUpId: d.id }),
  });
  await adminA.call("admin A approves top-up", "POST", `/admin/top-ups/${topUp.id}/approve`, { body: {} });
  const replay = await adminA.call("admin A approve replay (idempotent)", "POST", `/admin/top-ups/${topUp.id}/approve`, {
    body: {},
  });
  if (replay.replayed !== true) throw new Error("top-up approve replay was not marked replayed");

  // --- Internal form with a file-upload question, publish with escrow ---
  const title = `IR5 G3 journey ${tag}`;
  const draft = await publisher.call("create internal form", "POST", "/forms", {
    expect: 201,
    body: {
      title,
      type: "INTERNAL",
      rewardPerResponse: 10,
      estimatedDurationMinutes: 8,
      expectedCompletions: 5,
      schema: {
        schemaVersion: 1,
        title,
        blocks: [
          { id: "q-text", type: "text", order: 0, title: "Your field?", required: true },
          {
            id: "q-file",
            type: "file_upload",
            order: 1,
            title: "Attach a text file",
            required: true,
            maxFileSizeMb: 1,
            allowedMimeTypes: ["text/plain"],
            maxFiles: 1,
          },
        ],
      },
    },
    ids: (d) => ({ formId: d.id }),
  });
  const published = await publisher.call("publish with escrow", "POST", `/forms/${draft.id}/publish`, {
    body: {},
    ids: (d) => ({ formVersionId: d.currentVersion?.id, status: d.status }),
  });
  const versionId = published.currentVersion.id;
  await adminB.call("admin B moderation approve", "POST", `/admin/moderation/surveys/${draft.id}/approve`, {
    body: { formVersionId: versionId },
  });

  // --- D1.1 respondent ---
  const feed = await respondent.call("marketplace feed", "GET", "/marketplace/feed");
  if (!feed.surveys.some((s) => s.id === draft.id)) throw new Error("published survey missing from the feed");
  await respondent.call("survey summary", "GET", `/surveys/${draft.id}`);
  const attempt = await respondent.call("start attempt", "POST", `/surveys/${draft.id}/attempts`, {
    body: {},
    expect: 201,
    ids: (d) => ({ attemptId: d.attemptId, responseId: d.responseId, formVersionId: d.formVersionId }),
  });
  const pinned = await respondent.call("pinned form read", "GET", `/attempts/${attempt.attemptId}`);
  if (pinned.formVersionId !== versionId) throw new Error("attempt is not pinned to the published version");

  const bytes = Buffer.from(`IR.5 G3 journey upload ${tag}\n`);
  const upload = await respondent.call("upload initiate (presign)", "POST", "/storage/uploads/initiate", {
    expect: 201,
    body: {
      fileName: "ir5-evidence.txt",
      fileSize: bytes.length,
      mimeType: "text/plain",
      ownerContext: "participation",
      ownerRecordId: attempt.attemptId,
      questionId: "q-file",
      checksum: createHash("sha256").update(bytes).digest("hex"),
    },
    ids: (d) => ({ objectId: d.objectId }),
  });
  const putStarted = performance.now();
  const put = await fetch(upload.uploadUrl, { method: "PUT", headers: upload.headers ?? {}, body: bytes });
  steps.push({
    actor: "respondent",
    step: "browser PUT to presigned URL (MinIO, out-of-API)",
    request: "PUT <presigned>",
    status: put.status,
    expected: 200,
    ok: put.status === 200,
    ms: Math.round(performance.now() - putStarted),
  });
  if (put.status !== 200) throw new Error(`presigned PUT failed: ${put.status}`);
  const finalized = await respondent.call("finalize (scan → CLEAN)", "POST", `/storage/uploads/${upload.objectId}/finalize`, {
    body: {},
    ids: (d) => ({ objectId: d.id, status: d.status }),
  });
  if (finalized.status !== "CLEAN") throw new Error(`finalize returned ${finalized.status}`);

  await new Promise((r) => setTimeout(r, BARRIER_MS));
  const submitKey = randomUUID();
  const submitBody = {
    attemptId: attempt.attemptId,
    answers: {
      "q-text": "Computer Science",
      "q-file": [
        { objectId: upload.objectId, fileName: "ir5-evidence.txt", fileSize: bytes.length, mimeType: "text/plain", status: "CLEAN" },
      ],
    },
  };
  const submitted = await respondent.call("submit", "POST", `/responses/${attempt.responseId}/submit`, {
    body: submitBody,
    headers: { "Idempotency-Key": submitKey },
    ids: (d) => ({ status: d.status, reward: d.reward?.status, journalId: d.reward?.journalId }),
  });
  const again = await respondent.call("submit replay, same key (idempotent)", "POST", `/responses/${attempt.responseId}/submit`, {
    body: submitBody,
    headers: { "Idempotency-Key": submitKey },
    ids: (d) => ({ journalId: d.reward?.journalId }),
  });
  if (!submitted.reward?.journalId) throw new Error("submit did not return a reward journalId");
  if (again.reward?.journalId !== submitted.reward?.journalId) throw new Error("submit replay posted a second reward journal");
  await respondent.call("outcome", "GET", `/attempts/${attempt.attemptId}/outcome`, {
    ids: (d) => ({ attemptStatus: d.attemptStatus }),
  });
  const wallet = await respondent.call("wallet", "GET", "/economy/wallet", {
    ids: (d) => ({ available: d.available ?? d.balance?.available, pending: d.pending ?? d.balance?.pending }),
  });
  const notices = await respondent.call("notifications", "GET", "/notifications", {
    ids: (d) => ({ count: (d.items ?? d.notifications ?? d).length }),
  });
  if (!(notices.items ?? notices.notifications ?? notices).length) throw new Error("respondent has no notification");

  // --- D1.2 ledger read by an admin ---
  await adminA.call("admin ledger journals", "GET", "/admin/ledger/journals", {
    ids: (d) => ({ journals: (d.items ?? d.journals ?? []).length }),
  });
  const keys = [`publish:${versionId}`, `internal-reward:${attempt.responseId}`, `topup-approval:${topUp.id}`];
  const journals = await prisma.ledgerJournal.findMany({ where: { idempotencyKey: { in: keys } }, include: { entries: true } });
  const found = Object.fromEntries(keys.map((k) => [k.split(":")[0], journals.filter((j) => j.idempotencyKey === k).length]));
  const zeroSum = journals.every((j) => j.entries.reduce((n, e) => n + e.amount, 0) === 0);
  const ok = Object.values(found).every((n) => n === 1) && zeroSum;
  steps.push({ actor: "sql", step: "escrow, reward and top-up journals: exactly one each, zero-sum", request: "SQL", status: 0, ok, ms: 0, ids: { ...found, zeroSum } });
  if (!ok) throw new Error(`journal check failed: ${JSON.stringify(found)} zeroSum=${zeroSum}`);

  return { respondent, publisher, adminA, formId: draft.id, attemptId: attempt.attemptId };
}

/** Same SQL as apps/backend/test/fixtures/ledger-invariants.ts. */
async function ledgerInvariants() {
  const q = async (sql) => Number((await prisma.$queryRawUnsafe(sql))[0].n);
  const report = {
    unbalancedJournals: await q("SELECT count(*) AS n FROM (SELECT journal_id FROM ledger_entries GROUP BY journal_id HAVING sum(amount) <> 0) t"),
    driftedAccounts: await q(
      "SELECT count(*) AS n FROM (SELECT a.id FROM ledger_accounts a LEFT JOIN ledger_entries e ON e.account_id = a.id GROUP BY a.id, a.balance HAVING a.balance <> COALESCE(sum(e.amount), 0)) t",
    ),
    negativeUserAccounts: await q("SELECT count(*) AS n FROM ledger_accounts WHERE user_id IS NOT NULL AND balance < 0"),
    duplicateKeys: await q("SELECT count(*) AS n FROM (SELECT idempotency_key FROM ledger_journals GROUP BY 1 HAVING count(*) > 1) t"),
  };
  const ok = Object.values(report).every((n) => n === 0);
  steps.push({ actor: "sql", step: "ledger invariants (whole scratch DB)", request: "SQL", status: 0, ok, ms: 0, ids: report });
  return ok;
}

/** E1: hidden pilot routes → 404, visible top-level pages → 200 (signed in). */
async function routeSweep(actors) {
  // Node >= 22.18 strips the types of this .ts module.
  const { PILOT_HIDDEN_ROUTES } = await import(path.join(root, "apps/frontend/my-app/lib/pilot-scope.ts"));
  const hidden = PILOT_HIDDEN_ROUTES.map((r) => r.route);
  if (hidden.length !== 11) throw new Error(`expected 11 PILOT_HIDDEN_ROUTES, read ${hidden.length}`);
  const sample = (route) => route.replace(/\[[^\]]+\]/g, () => randomUUID());
  const visible = {
    respondent: ["/marketplace", "/wallet", "/wallet/top-up", "/notifications", "/account", "/account/profile", "/onboarding"],
    publisher: ["/forms", "/forms/new", "/forms/new/builder", "/forms/new/google-form"],
    adminA: ["/admin", "/admin/surveys", "/admin/top-ups", "/admin/transactions", "/admin/users", "/admin/disputes", "/admin/fraud-log"],
    guest: ["/", "/login", "/register", "/forgot-password", "/privacy", "/terms"],
  };
  const results = [];
  const page = async (actor, route, expect) => {
    const res = await fetch(`${BASE}${route}`, { headers: actor ? { Cookie: actor.cookieHeader() } : {}, redirect: "manual" });
    await res.arrayBuffer();
    results.push({ actor: actor?.label ?? "guest", route, status: res.status, expected: expect, ok: res.status === expect });
  };
  for (const route of hidden) await page(actors.respondent, sample(route), 404);
  for (const [who, routes] of Object.entries(visible)) for (const route of routes) await page(actors[who], route, 200);
  // Declared redirect: the old dashboard entry point lands on Khám phá.
  await page(actors.respondent, "/dashboard", 307);
  return results;
}

function writeReport(result) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, "ir5-journey-report.json"), `${JSON.stringify(result, null, 2)}\n`);
  const row = (s) =>
    `| ${s.actor} | ${s.step} | \`${s.request}\` | ${s.status || "—"} | ${s.ok ? "pass" : "FAIL"} | ${s.ms} | ${s.requestId ?? ""} | ${s.errorCode ?? ""} ${s.ids ? `\`${JSON.stringify(s.ids)}\`` : ""} |`;
  const md = [
    `# IR.5 G3 journey report (${result.run})`,
    "",
    `- Base URL: ${BASE} (pilot build, \`/api\` rewrite → backend); DB: \`${dbName}\``,
    `- Result: **${result.passed ? "PASS" : "FAIL"}**${result.error ? ` — ${result.error}` : ""}`,
    `- Journey steps: ${result.steps.filter((s) => s.ok).length}/${result.steps.length} ok; routes: ${result.routes.filter((r) => r.ok).length}/${result.routes.length} ok`,
    "",
    "## Journey (D1)",
    "",
    "| Actor | Step | Request | Status | Result | ms | X-Request-Id | Key ids / error |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...result.steps.map(row),
    "",
    "## Pilot route sweep (E1)",
    "",
    "| Actor | Route | Status | Expected | Result |",
    "| --- | --- | --- | --- | --- |",
    ...result.routes.map((r) => `| ${r.actor} | \`${r.route.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ":id")}\` | ${r.status} | ${r.expected} | ${r.ok ? "pass" : "FAIL"} |`),
    "",
  ].join("\n");
  writeFileSync(path.join(OUT, "ir5-journey-report.md"), md);
}

const result = { run, base: BASE, database: dbName, startedAt: new Date().toISOString(), steps, routes: [] };
try {
  const actors = await journey();
  const invariantsOk = await ledgerInvariants();
  const guest = null;
  result.routes = await routeSweep({ ...actors, guest });
  result.passed = invariantsOk && steps.every((s) => s.ok) && result.routes.every((r) => r.ok);
} catch (error) {
  result.passed = false;
  result.error = error.message;
} finally {
  result.finishedAt = new Date().toISOString();
  writeReport(result);
  await prisma.$disconnect();
}
console.log(`${result.passed ? "PASS" : "FAIL"}: ${OUT}/ir5-journey-report.md${result.error ? ` — ${result.error}` : ""}`);
process.exit(result.passed ? 0 : 1);
