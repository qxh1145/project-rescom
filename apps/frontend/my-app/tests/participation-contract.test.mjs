import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Story IR.2a + integrity consent: the MSW handlers of the survey runner and
 * consent routes emit exactly the shared `@rescom/schemas` contracts the
 * backend controllers return (the frontend half of the contract test; the
 * backend half is `apps/backend/test/survey-runner-reads.e2e-spec.ts`).
 *
 * The real handler modules run in Node: a resolve hook maps the `@/` alias
 * and extension-less imports, and replaces two browser-only modules with
 * fixed stand-ins — the signed-in user (`mocks/db/session.ts`) and the
 * `?msw=` scenario switch (`mocks/scenarios.ts`: default scenario, no latency).
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
  return globalThis.__participationContractUser ?? null;
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
const { participationHandlers } = await import("../mocks/handlers/participation.ts");
const { internalParticipationHandlers } = await import("../mocks/handlers/participation-internal.ts");
const { externalParticipationHandlers } = await import("../mocks/handlers/participation-external.ts");
const { updateAttempt } = await import("../mocks/data/attempts.ts");
const { creditSurveyReward } = await import("../mocks/data/economy.ts");
const { SURVEY_IDS } = await import("../mocks/data/surveys.ts");
const schemas = await import("@rescom/schemas");

const handlers = [...participationHandlers, ...internalParticipationHandlers, ...externalParticipationHandlers];
const ORIGIN = "http://localhost";

/** Signs a fresh mock user in (the stand-in session) and returns it. */
function signIn() {
  const user = { id: randomUUID(), email: `${randomUUID()}@fpt.edu.vn`, name: "Contract", role: "USER", profileComplete: true };
  globalThis.__participationContractUser = user;
  return user;
}

async function call(method, route, { body, headers = {} } = {}) {
  const init = { method, headers: { ...headers } };
  if (method !== "GET") {
    init.headers["X-CSRF-Token"] = "csrf";
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body ?? {});
  }
  const response = await getResponse(handlers, new Request(`${ORIGIN}/api${route}`, init), { baseUrl: ORIGIN });
  assert.ok(response, `a handler answers ${method} ${route}`);
  return { status: response.status, body: await response.json() };
}

/** 2xx `data` must parse with the shared schema (strict: no extra field). */
function parsed(schema, result, status = 200) {
  assert.equal(result.status, status, JSON.stringify(result.body.error));
  const outcome = schema.safeParse(result.body.data);
  assert.ok(outcome.success, outcome.success ? "" : JSON.stringify(outcome.error.issues));
  return outcome.data;
}

function failed(result, status, code) {
  assert.equal(result.status, status);
  assert.equal(result.body.data, null);
  assert.equal(result.body.error.code, code);
  return result.body.error;
}

async function startAttempt(surveyId) {
  return parsed(schemas.surveyAttemptResponseSchema, await call("POST", `/surveys/${surveyId}/attempts`), 201);
}

const cancelKey = () => ({ "Idempotency-Key": randomUUID() });

test("GET /surveys/:id: the strict public summary; closed and unknown surveys are 404 SURVEY_NOT_FOUND", async () => {
  const summary = parsed(schemas.surveySummarySchema, await call("GET", `/surveys/${SURVEY_IDS.onlineShopping}`));
  assert.equal(summary.status, "PUBLISHED");
  assert.ok(summary.remainingSlots <= summary.expectedCompletions - summary.completedCompletions);

  failed(await call("GET", `/surveys/${SURVEY_IDS.housingNearCampus}`), 404, schemas.SURVEY_NOT_FOUND_CODE);
  failed(await call("GET", `/surveys/${randomUUID()}`), 404, schemas.SURVEY_NOT_FOUND_CODE);
});

test("in-Rescom attempt: the read carries the pinned form; the outcome follows the reward", async () => {
  const user = signIn();
  const started = await startAttempt(SURVEY_IDS.onlineShopping);

  const details = parsed(schemas.surveyAttemptDetailsSchema, await call("GET", `/attempts/${started.attemptId}`));
  assert.equal(details.type, "INTERNAL");
  assert.equal(details.responseId, started.responseId);
  assert.ok(details.form && details.form.blocks.length > 0);
  assert.equal(details.form.formVersionId, details.formVersionId);
  assert.equal(details.timeBarrier.questionCount, details.form.blocks.length);

  const before = parsed(schemas.attemptOutcomeSchema, await call("GET", `/attempts/${started.attemptId}/outcome`));
  assert.equal(before.reward.state, "NOT_COMPLETED");

  // The submit itself is covered elsewhere: complete the attempt and credit it like the submit handler.
  updateAttempt(started.attemptId, (attempt) => {
    attempt.status = "COMPLETED";
    attempt.submittedAt = new Date().toISOString();
  });
  creditSurveyReward(user, {
    amount: 12,
    pending: false,
    surveyId: SURVEY_IDS.onlineShopping,
    attemptId: started.attemptId,
    title: "Contract",
  });
  const after = parsed(schemas.attemptOutcomeSchema, await call("GET", `/attempts/${started.attemptId}/outcome`));
  assert.equal(after.reward.state, "AVAILABLE");
  assert.equal(after.reward.amount, 12);
  assert.equal(after.starterUnlock.activatedByThisAttempt, true);
  assert.equal(after.accountActivated, true);

  const completed = failed(
    await call("POST", `/attempts/${started.attemptId}/cancel`, { headers: cancelKey() }),
    409,
    schemas.ATTEMPT_NOT_IN_PROGRESS_CODE,
  );
  assert.deepEqual(schemas.attemptNotInProgressDetailsSchema.parse(completed.details), {
    status: "COMPLETED",
    closedReason: null,
  });
});

test("Google Forms attempt: cancel needs an Idempotency-Key, replays its closedAt and frees the slot", async () => {
  signIn();
  const started = await startAttempt(SURVEY_IDS.aiStudyHabits);

  const details = parsed(schemas.surveyAttemptDetailsSchema, await call("GET", `/attempts/${started.attemptId}`));
  assert.equal(details.form, null);
  assert.equal(details.responseId, null);
  assert.ok(details.survey.externalUrl);

  failed(await call("POST", `/attempts/${started.attemptId}/cancel`), 400, "INVALID_IDEMPOTENCY_KEY");
  failed(
    await call("POST", `/attempts/${started.attemptId}/cancel`, { headers: { "Idempotency-Key": "short" } }),
    400,
    "INVALID_IDEMPOTENCY_KEY",
  );
  failed(
    await call("POST", `/attempts/${started.attemptId}/cancel`, { body: { reason: "x" }, headers: cancelKey() }),
    400,
    "VALIDATION_ERROR",
  );

  const cancelled = parsed(
    schemas.cancelAttemptResponseSchema,
    await call("POST", `/attempts/${started.attemptId}/cancel`, { headers: cancelKey() }),
  );
  const replay = parsed(
    schemas.cancelAttemptResponseSchema,
    await call("POST", `/attempts/${started.attemptId}/cancel`, { headers: cancelKey() }),
  );
  assert.deepEqual(replay, cancelled);

  const closed = parsed(schemas.surveyAttemptDetailsSchema, await call("GET", `/attempts/${started.attemptId}`));
  assert.equal(closed.status, "ABANDONED");
  assert.equal(closed.closedReason, "CANCELLED");
  assert.equal(closed.closedAt, cancelled.closedAt);

  // The reservation is released: the same account can start again.
  await startAttempt(SURVEY_IDS.aiStudyHabits);
});

test("Google Forms attempt: a verified code reads PENDING with releasesAt", async () => {
  signIn();
  const started = await startAttempt(SURVEY_IDS.aiStudyHabits);
  // Past the mock's 4:12 time barrier.
  updateAttempt(started.attemptId, (attempt) => {
    attempt.startedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  });
  const verified = await call("POST", `/attempts/${started.attemptId}/verify-code`, { body: { completionCode: "482917" } });
  assert.equal(verified.status, 200, JSON.stringify(verified.body.error));

  const outcome = parsed(schemas.attemptOutcomeSchema, await call("GET", `/attempts/${started.attemptId}/outcome`));
  assert.equal(outcome.reward.state, "PENDING");
  assert.equal(outcome.reward.targetAccountClass, "PENDING");
  assert.ok(Date.parse(outcome.reward.releasesAt) > Date.now());
  assert.equal(outcome.accountActivated, false);
});

test("another account gets 404 ATTEMPT_NOT_FOUND on the read, the outcome and the cancel", async () => {
  signIn();
  const started = await startAttempt(SURVEY_IDS.aiStudyHabits);
  signIn();

  const results = await Promise.all([
    call("GET", `/attempts/${started.attemptId}`),
    call("GET", `/attempts/${started.attemptId}/outcome`),
    call("POST", `/attempts/${started.attemptId}/cancel`, { headers: cancelKey() }),
  ]);
  for (const result of results) failed(result, 404, schemas.ATTEMPT_NOT_FOUND_CODE);
});

test("integrity consent: the shared status, one acceptance per notice version, 409 for another version", async () => {
  signIn();
  const initial = parsed(schemas.integrityConsentSchema, await call("GET", "/integrity/consent"));
  assert.deepEqual(initial, {
    currentVersion: schemas.INTEGRITY_CONSENT_NOTICE_VERSION,
    acceptedVersion: null,
    acceptedAt: null,
  });

  const mismatch = failed(
    await call("POST", "/integrity/consent", { body: { noticeVersion: schemas.INTEGRITY_CONSENT_NOTICE_VERSION + 1 } }),
    409,
    schemas.INTEGRITY_CONSENT_VERSION_MISMATCH_CODE,
  );
  assert.ok(schemas.integrityConsentVersionMismatchDetailsSchema.safeParse(mismatch.details).success);
  failed(await call("POST", "/integrity/consent", { body: {} }), 400, "VALIDATION_ERROR");

  const accepted = parsed(
    schemas.integrityConsentSchema,
    await call("POST", "/integrity/consent", { body: { noticeVersion: schemas.INTEGRITY_CONSENT_NOTICE_VERSION } }),
  );
  assert.equal(accepted.acceptedVersion, schemas.INTEGRITY_CONSENT_NOTICE_VERSION);
  const replay = parsed(
    schemas.integrityConsentSchema,
    await call("POST", "/integrity/consent", { body: { noticeVersion: schemas.INTEGRITY_CONSENT_NOTICE_VERSION } }),
  );
  assert.deepEqual(replay, accepted);
  assert.deepEqual(parsed(schemas.integrityConsentSchema, await call("GET", "/integrity/consent")), accepted);
});
