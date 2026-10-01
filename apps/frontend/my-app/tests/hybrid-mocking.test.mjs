import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Gate G (`.omc/plans/mock-off-full-backend.md`): with
 * `NEXT_PUBLIC_API_MOCKING=hybrid` MSW registers exactly the
 * `DEFERRED_KEEP_MOCK` handlers of `mocks/route-allowlist.ts`, and each one
 * answers a real session: no mock session (the stand-in below throws when
 * read), random backend UUIDs that the mock DB has never seen, the FE schema
 * still parses the answer, and writes still need `X-CSRF-Token`.
 *
 * Same loader set-up as `admin-contract.test.mjs`.
 */
process.env.NEXT_PUBLIC_API_MOCKING = "hybrid";

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

/**
 * Any read of the signed-in mock user fails the request: hybrid handlers must
 * not depend on it. `findMockUserByEmail` stays real: it reads the seeded demo
 * users (fixtures) that the demo dispute/quality cases name, not the session.
 */
const NO_MOCK_SESSION = `
export { findMockUserByEmail } from ${JSON.stringify(pathToFileURL(path.join(appRoot, "mocks", "db", "session.ts")).href)};
export async function getMockSessionUser() {
  throw new Error("hybrid handler read the mock session");
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
      [path.join("mocks", "db", "session.ts")]: dataModule(NO_MOCK_SESSION),
      [path.join("mocks", "scenarios.ts")]: dataModule(SCENARIOS_STAND_IN),
    },
  },
});

const { getResponse } = await import("msw");
const { handlers, hybridHandlers } = await import("../mocks/handlers/index.ts");
const { ROUTE_ALLOWLIST } = await import("../mocks/route-allowlist.ts");
const disputes = await import("../lib/admin/disputes-service.ts");
const quality = await import("../lib/admin/quality-service.ts");
const { reliabilitySummarySchema } = await import("../lib/participation/trust-service.ts");
const { engagementSummarySchema } = await import("../lib/engagement/engagement-service.ts");
const { leaderboardSchema } = await import("../lib/engagement/leaderboard-service.ts");
const { disputeResultSchema } = await import("../lib/forms/dispute-service.ts");
const { formQualitySchema } = await import("../lib/forms/results-service.ts");
const ai = await import("../lib/forms/builder-ai.ts");

const ORIGIN = "http://localhost";
const CSRF = { "X-CSRF-Token": "real-session-token" };

async function call(method, route, { body, csrf = method !== "GET" } = {}) {
  const headers = { ...(csrf ? CSRF : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) };
  const request = new Request(`${ORIGIN}/api${route}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const response = await getResponse(hybridHandlers, request, { baseUrl: ORIGIN });
  assert.ok(response, `a hybrid handler answers ${method} ${route}`);
  return { status: response.status, body: await response.json() };
}

/** 2xx `data` must parse with the FE schema the service uses. */
function parsed(schema, result, status = 200) {
  assert.equal(result.status, status, JSON.stringify(result.body.error));
  const outcome = schema.safeParse(result.body.data);
  assert.ok(outcome.success, outcome.success ? "" : JSON.stringify(outcome.error.issues));
  return outcome.data;
}

const routeKey = (route) => route.replace(/:[A-Za-z_]\w*/g, ":param");

test("hybrid registers exactly the 14 DEFERRED_KEEP_MOCK handlers, once each", () => {
  const registered = hybridHandlers.map((handler) => routeKey(`${handler.info.method} ${handler.info.path.replace(/^\/api/, "")}`));
  const deferred = Object.keys(ROUTE_ALLOWLIST.DEFERRED_KEEP_MOCK).map(routeKey);
  assert.equal(deferred.length, 14);
  assert.deepEqual([...registered].sort(), [...deferred].sort());
  assert.ok(handlers.length > hybridHandlers.length, "full mocking (`enabled`) keeps every handler");
  // Nothing mock-only (demo accounts, mock Google, mock upload) runs next to the real backend.
  const mockOnly = new Set(Object.keys(ROUTE_ALLOWLIST.MOCK_ONLY).map(routeKey));
  assert.ok(registered.every((key) => !mockOnly.has(key)));
});

test("a route outside the allowlist is not mocked in hybrid (it reaches the backend)", async () => {
  for (const route of ["/auth/me", "/forms", `/forms/${randomUUID()}/progress`]) {
    const response = await getResponse(hybridHandlers, new Request(`${ORIGIN}/api${route}`), { baseUrl: ORIGIN });
    assert.equal(response, undefined, `GET ${route} is not answered by MSW`);
  }
});

test("engagement and reliability answer without a mock session", async () => {
  parsed(engagementSummarySchema, await call("GET", "/engagement/me"));
  const board = parsed(leaderboardSchema, await call("GET", "/engagement/leaderboard?type=streak&period=all"));
  assert.equal(board.me.name, "Bạn");
  parsed(reliabilitySummarySchema, await call("GET", "/integrity/reliability/me"));
});

test("publisher survey quality: demo data for any real form id, deterministic per id + version", async () => {
  const formId = randomUUID();
  const first = parsed(formQualitySchema, await call("GET", `/forms/${formId}/quality?versionNumber=2`));
  assert.equal(first.versionNumber, 2);
  assert.equal(first.dropOff.length, first.questionCount);
  assert.equal(first.passed + first.needsReview, first.basedOnResponses);
  const again = parsed(formQualitySchema, await call("GET", `/forms/${formId}/quality?versionNumber=2`));
  assert.deepEqual({ ...again, updatedAt: null }, { ...first, updatedAt: null });
  assert.equal(parsed(formQualitySchema, await call("GET", `/forms/${randomUUID()}/quality`)).versionNumber, 1);
});

test("publisher dispute on a real attempt: CSRF, validation, 201 once then 409", async () => {
  const route = `/forms/${randomUUID()}/attempts/${randomUUID()}/disputes`;
  const body = { reason: "LOW_EFFORT", description: "Trả lời quá nhanh, các câu giống hệt nhau." };
  const noCsrf = await call("POST", route, { body, csrf: false });
  assert.equal(noCsrf.status, 403);
  assert.equal(noCsrf.body.error.code, "AUTH_INVALID_CSRF_TOKEN");
  assert.equal((await call("POST", route, { body: { reason: "LOW_EFFORT" } })).status, 400);
  const created = parsed(disputeResultSchema, await call("POST", route, { body }), 201);
  assert.equal(created.dispute.status, "OPEN");
  assert.equal((await call("POST", route, { body })).body.error.code, "DISPUTE_ALREADY_OPEN");
});

test("admin disputes: demo queue and resolve without a mock session; unknown case 404; CSRF on resolve", async () => {
  const queue = parsed(disputes.disputeCaseListSchema, await call("GET", "/admin/disputes?status=OPEN"));
  assert.ok(queue.items.length > 0, "the demo queue has cases");
  const target = queue.items.find((item) => item.kind !== "ATTEMPT_DISPUTE") ?? queue.items[0];
  const outcome = target.kind === "ATTEMPT_DISPUTE" ? "RELEASE_TO_RESPONDENT" : "DISMISSED";
  const note = "Đã kiểm tra, đóng ca demo này.";
  assert.equal((await call("POST", `/admin/disputes/${target.id}/resolve`, { body: { outcome, note }, csrf: false })).status, 403);
  const resolved = parsed(disputes.disputeCaseSchema, await call("POST", `/admin/disputes/${target.id}/resolve`, { body: { outcome, note } }));
  assert.equal(resolved.status, "RESOLVED");
  const unknown = await call("POST", `/admin/disputes/${randomUUID()}/resolve`, { body: { outcome, note } });
  assert.equal(unknown.body.error.code, "DISPUTE_CASE_NOT_FOUND");
});

test("admin quality reviews: demo queue and decision without a mock session; CSRF on decision", async () => {
  const list = parsed(quality.qualityReviewListSchema, await call("GET", "/admin/quality-reviews"));
  assert.ok(list.items.length > 0, "the demo queue has reviews");
  const route = `/admin/quality-reviews/${list.items[0].responseId}/decision`;
  const body = { decision: "ACCEPT", note: "" };
  assert.equal((await call("POST", route, { body, csrf: false })).status, 403);
  parsed(quality.qualityDecisionResultSchema, await call("POST", route, { body }));
  assert.equal((await call("POST", `/admin/quality-reviews/${randomUUID()}/decision`, { body })).body.error.code, "QUALITY_REVIEW_NOT_FOUND");
});

test("AI builder (5 routes) works on real form ids the mock DB never saw", async () => {
  const formId = randomUUID();
  const other = randomUUID();
  const message = { message: "Khảo sát thói quen đọc sách của sinh viên năm nhất", options: { duration: "UNDER_5", suggestAttentionChecks: true } };

  const none = await call("GET", `/forms/${formId}/ai/conversation`);
  assert.equal(none.body.error.code, "AI_CONVERSATION_NOT_FOUND");
  assert.equal((await call("POST", "/forms/ai/messages", { body: message, csrf: false })).status, 403);

  // Both replies wait the mock AI delay: run them together.
  const [first, followUp] = await Promise.all([
    call("POST", "/forms/ai/messages", { body: message }),
    call("POST", `/forms/${other}/ai/messages`, { body: message }),
  ]);
  const chat = parsed(ai.aiNewChatSchema, first);
  assert.equal(parsed(ai.aiConversationSchema, followUp).formId, other);

  const adopted = parsed(ai.aiConversationSchema, await call("POST", `/forms/${formId}/ai/conversation`, { body: { conversationId: chat.conversationId } }));
  assert.equal(adopted.formId, formId);
  assert.equal(parsed(ai.aiConversationSchema, await call("GET", `/forms/${formId}/ai/conversation`)).formId, formId);
  parsed(ai.aiSuggestedBlockSchema, await call("POST", `/forms/${formId}/ai/suggest-block`, { body: {} }));
});
