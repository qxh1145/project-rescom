import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Phase 7: `file_upload` answers in the in-Rescom runner — the pure rules
 * (`lib/participation/file-upload.ts`), the upload pipeline
 * (`file-upload-service.ts`: initiate → PUT straight to storage → finalize)
 * and the MSW storage handlers, which must emit the shared `@rescom/schemas`
 * contracts of `storage.controller.ts` and attach files at submit like the
 * backend (CLEAN, same attempt, same question). The handler modules run in
 * Node with the same resolve-hook harness as `participation-contract.test.mjs`.
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
const { internalParticipationHandlers } = await import("../mocks/handlers/participation-internal.ts");
const { participationHandlers } = await import("../mocks/handlers/participation.ts");
const { storageHandlers } = await import("../mocks/handlers/storage.ts");
const { updateAttempt } = await import("../mocks/data/attempts.ts");
const { SURVEY_IDS } = await import("../mocks/data/surveys.ts");
const schemas = await import("@rescom/schemas");
const rules = await import("../lib/participation/file-upload.ts");
const service = await import("../lib/participation/file-upload-service.ts");
const form = await import("../lib/participation/survey-form.ts");
const { ApiError } = await import("../lib/api/api-error.ts");
const { FileUploadController } = await import("../lib/participation/file-upload-controller.ts");
const { storedObjects } = await import("../mocks/data/stored-objects.ts");
const { formsAiHandlers } = await import("../mocks/handlers/forms-ai.ts");

const handlers = [...participationHandlers, ...internalParticipationHandlers, ...storageHandlers, ...formsAiHandlers];
const ORIGIN = "http://localhost";

const block = {
  id: "file1",
  order: 0,
  type: "file_upload",
  title: "Minh chứng",
  required: true,
  maxFileSizeMb: 5,
  allowedMimeTypes: ["image/png", "image/jpeg", "application/pdf"],
  maxFiles: 2,
};
const MB = 1024 * 1024;
const http = (status, code) => new ApiError({ kind: "http", status, code, message: code ?? "x" });

test("local checks mirror the backend upload policy, in Vietnamese", () => {
  assert.equal(rules.maxFileBytes(block), 5 * MB);
  assert.equal(rules.maxFileBytes({ maxFileSizeMb: 80 }), 50 * MB);
  assert.equal(rules.mimeAllowed("image/png", ["image/*"]), true);
  assert.equal(rules.mimeAllowed("application/pdf", ["image/*"]), false);
  assert.equal(rules.mimeAllowed("anything/x", []), true);

  const ok = { name: "a.png", size: 1000, type: "image/png" };
  assert.equal(rules.checkFileForQuestion(block, ok, 0), null);
  assert.equal(rules.checkFileForQuestion(block, { ...ok, type: "application/pdf" }, 1), null);
  assert.match(rules.checkFileForQuestion(block, ok, 2), /tối đa 2 tệp/);
  assert.match(rules.checkFileForQuestion(block, { ...ok, size: 0 }, 0), /trống/);
  assert.match(rules.checkFileForQuestion(block, { ...ok, size: 5 * MB + 1 }, 0), /vượt quá giới hạn 5 MB/);
  assert.match(rules.checkFileForQuestion(block, { ...ok, name: "a.svg", type: "image/svg+xml" }, 0), /mã chạy được/);
  // Shared file-name rules (`uploadFileNameProblem`): dangerous extension, path, length.
  assert.match(rules.checkFileForQuestion(block, { ...ok, name: "virus.exe. ", type: "image/png" }, 0), /mã chạy được/);
  assert.match(rules.checkFileForQuestion(block, { ...ok, name: "../a.png" }, 0), /không hợp lệ/);
  assert.match(rules.checkFileForQuestion(block, { ...ok, name: `${"a".repeat(256)}.png` }, 0), /quá dài/);
  assert.match(rules.checkFileForQuestion(block, { ...ok, type: "text/plain", name: "a.txt" }, 0), /không được nhận/);
  assert.match(rules.checkFileForQuestion(block, { ...ok, name: "a.doc", type: "" }, 0), /PDF/);
  assert.equal(rules.uploadMimeType({ type: "" }), "application/octet-stream");
  assert.equal(rules.formatFileSize(2.5 * MB), "2,5 MB");
  assert.equal(rules.formatFileSize(5 * MB), "5 MB");
  assert.equal(rules.formatFileSize(512), "512 B");
});

test("upload failures read in Vietnamese; only a scanner outage retries finalize", () => {
  assert.equal(rules.uploadErrorMessage(http(400, "STORAGE_INVALID_FILE")), rules.UPLOAD_MESSAGES.invalidFile);
  assert.equal(rules.uploadErrorMessage(http(503, "STORAGE_SCANNER_OUTAGE")), rules.UPLOAD_MESSAGES.scannerOutage);
  assert.equal(rules.uploadErrorMessage(http(403, "STORAGE_UNAUTHORIZED")), rules.UPLOAD_MESSAGES.notAllowed);
  assert.equal(rules.uploadErrorMessage(http(403, rules.STORAGE_PUT_FAILED_CODE)), rules.UPLOAD_MESSAGES.storageFailed);
  assert.equal(rules.uploadErrorMessage(http(200, rules.STORAGE_OBJECT_REJECTED_CODE)), rules.UPLOAD_MESSAGES.rejected);
  assert.equal(rules.uploadErrorMessage(new ApiError({ kind: "network", message: "x" })), rules.UPLOAD_MESSAGES.network);
  assert.match(rules.uploadErrorMessage(new ApiError({ kind: "http", status: 429, message: "x", retryAfterSeconds: 9 })), /9 giây/);
  assert.equal(rules.uploadErrorMessage(new Error("boom")), rules.UPLOAD_MESSAGES.generic);
  assert.equal(rules.isRetryableFinalize(http(503, "STORAGE_SCANNER_OUTAGE")), true);
  // IR.5 C2: storage unreachable before the scan (503 STORAGE_UNAVAILABLE) is retried like a scanner outage, with its own copy.
  assert.equal(rules.uploadErrorMessage(http(503, rules.STORAGE_UNAVAILABLE_CODE)), rules.UPLOAD_MESSAGES.storageUnavailable);
  assert.equal(rules.isRetryableFinalize(http(503, rules.STORAGE_UNAVAILABLE_CODE)), true);
  assert.equal(rules.isScannerOutage(http(503, rules.STORAGE_UNAVAILABLE_CODE)), true);
  assert.equal(rules.outageExhaustedMessage(http(503, rules.STORAGE_UNAVAILABLE_CODE)), rules.UPLOAD_MESSAGES.storageDown);
  assert.equal(rules.outageExhaustedMessage(http(503, "STORAGE_SCANNER_OUTAGE")), rules.UPLOAD_MESSAGES.scannerDown);
  assert.equal(rules.isRetryableFinalize(http(400, "STORAGE_INVALID_FILE")), false);
  for (const status of [500, 502, 504]) assert.equal(rules.isRetryableFinalize(http(status, null)), true);
  assert.match(rules.uploadErrorMessage(new ApiError({ kind: "http", status: 409, code: "STORAGE_QUESTION_FULL", message: "x", details: { questionId: "q", maxFiles: 2 } })), /tối đa 2 tệp.*xoá bớt/);
  assert.deepEqual(
    rules.uncleanAttachmentFiles(new ApiError({ kind: "http", status: 400, code: "UNCLEAN_ATTACHMENT", message: "x", details: { files: [{ questionId: "q", objectId: "o" }] } })),
    [{ questionId: "q", objectId: "o" }],
  );
  assert.deepEqual(rules.uncleanAttachmentFiles(http(400, "UNCLEAN_ATTACHMENT")), []);
});

test("pipeline: initiate (bound to attempt + question) → PUT with the signed headers → finalize", async () => {
  const calls = [];
  const progress = [];
  const attemptId = randomUUID();
  const objectId = randomUUID();
  const deps = {
    initiate: async (input) => {
      calls.push(["initiate", input]);
      assert.equal(schemas.initiateUploadInputSchema.safeParse(input).success, true);
      return { objectId, uploadUrl: "http://localhost:9000/bucket/key?X-Amz-Signature=s", storageKey: "k", expiresAt: "x", headers: { "Content-Type": "image/png" } };
    },
    put: async (url, file, headers, onProgress) => {
      calls.push(["put", url, headers]);
      onProgress(50, 100);
      onProgress(100, 100);
    },
    finalize: async (attempt, id) => {
      calls.push(["finalize", attempt, id]);
      return { id, ownerContext: "participation", ownerRecordId: attempt, dataClass: "SURVEY_ATTACHMENT", storageKey: "verified/x", fileName: "a.png", fileSize: 4, mimeType: "image/png", status: "CLEAN", scanStatus: "CLEAN", createdAt: "x" };
    },
  };
  const file = new File([new Uint8Array([1, 2, 3, 4])], "a.png", { type: "image/png" });
  const answer = await service.uploadQuestionFile({ attemptId, block, file, onProgress: (p) => progress.push(p) }, deps);
  assert.deepEqual(answer, { objectId, fileName: "a.png", fileSize: 4, mimeType: "image/png", status: "CLEAN" });
  assert.deepEqual(calls[0][1], {
    fileName: "a.png",
    fileSize: 4,
    mimeType: "image/png",
    ownerContext: "participation",
    ownerRecordId: attemptId,
    questionId: "file1",
  });
  assert.deepEqual(calls[1].slice(1), ["http://localhost:9000/bucket/key?X-Amz-Signature=s", { "Content-Type": "image/png" }]);
  assert.deepEqual(calls[2].slice(1), [attemptId, objectId]);
  assert.deepEqual(progress.map((p) => p.stage), ["initiating", "uploading", "uploading", "uploading", "scanning"]);
  assert.ok(progress.every((p, i) => i === 0 || p.percent >= progress[i - 1].percent));
  // The finalized answer is accepted by the submit validator.
  assert.equal(form.validateAnswer(block, [answer]), null);
});

test("pipeline failures keep the stage and the object to retry or delete", async () => {
  const file = new File([new Uint8Array([1])], "a.png", { type: "image/png" });
  const objectId = randomUUID();
  const initiated = async () => ({ objectId, uploadUrl: "u", storageKey: "k", expiresAt: "x" });
  const put = async () => {};

  await assert.rejects(
    service.uploadQuestionFile({ attemptId: randomUUID(), block, file }, {
      initiate: async () => {
        throw http(400, "STORAGE_INVALID_FILE");
      },
      put,
      finalize: async () => assert.fail("not reached"),
    }),
    (error) => error instanceof service.FileUploadError && error.stage === "initiating" && error.objectId === null,
  );
  await assert.rejects(
    service.uploadQuestionFile({ attemptId: randomUUID(), block, file }, {
      initiate: initiated,
      put: async (_u, _f, headers) => {
        // No headers from initiate: the content type is still signed.
        assert.deepEqual(headers, { "Content-Type": "image/png" });
        throw http(403, rules.STORAGE_PUT_FAILED_CODE);
      },
      finalize: async () => assert.fail("not reached"),
    }),
    (error) => error.stage === "uploading" && error.objectId === objectId,
  );
  await assert.rejects(
    service.uploadQuestionFile({ attemptId: randomUUID(), block, file }, {
      initiate: initiated,
      put,
      finalize: async () => {
        throw http(503, "STORAGE_SCANNER_OUTAGE");
      },
    }),
    (error) => error.stage === "scanning" && error.objectId === objectId && rules.isRetryableFinalize(error.failure),
  );
  await assert.rejects(
    service.uploadQuestionFile({ attemptId: randomUUID(), block, file }, {
      initiate: initiated,
      put,
      finalize: async () => {
        throw http(503, rules.STORAGE_UNAVAILABLE_CODE);
      },
    }),
    (error) =>
      error.stage === "scanning" &&
      error.objectId === objectId &&
      rules.isRetryableFinalize(error.failure) &&
      rules.uploadErrorMessage(error.failure) === rules.UPLOAD_MESSAGES.storageUnavailable,
  );
  await assert.rejects(
    service.uploadQuestionFile({ attemptId: randomUUID(), block, file }, {
      initiate: initiated,
      put,
      finalize: async (attempt, id) => ({ id, ownerContext: "participation", ownerRecordId: attempt, dataClass: "SURVEY_ATTACHMENT", storageKey: "k", fileName: "eicar.png", fileSize: 1, mimeType: "image/png", status: "REJECTED", scanStatus: "INFECTED", createdAt: "x" }),
    }),
    (error) => rules.uploadErrorMessage(error.failure) === rules.UPLOAD_MESSAGES.rejected,
  );
});

test("storage requests: /api routes with CSRF, the attempt's capability header and the shared schemas", async (t) => {
  const store = new Map();
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  globalThis.window = { sessionStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) } };
  t.after(() => {
    globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  });
  const attemptId = randomUUID();
  const objectId = randomUUID();
  service.rememberStorageCapability(attemptId, "cap-".padEnd(43, "x"));
  assert.equal(service.storageCapabilityOf(attemptId), "cap-".padEnd(43, "x"));

  const sent = [];
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  globalThis.fetch = async (url, init = {}) => {
    if (String(url) === "/api/auth/csrf") return json(200, { data: { csrfToken: "csrf" } });
    sent.push({ url: String(url), init });
    if (String(url).endsWith("/initiate")) {
      return json(201, { data: { objectId, uploadUrl: "http://localhost:9000/b/k", storageKey: "k", expiresAt: new Date().toISOString(), headers: { "Content-Type": "image/png" } }, error: null, meta: {} });
    }
    if (String(url).endsWith("/finalize")) {
      return json(200, { data: { id: objectId, ownerContext: "participation", ownerRecordId: attemptId, dataClass: "SURVEY_ATTACHMENT", storageKey: "verified/k", fileName: "a.png", fileSize: 1, mimeType: "image/png", status: "CLEAN", scanStatus: "CLEAN", createdAt: new Date().toISOString() }, error: null, meta: {} });
    }
    return new Response(null, { status: 204 });
  };

  await service.initiateUpload({ fileName: "a.png", fileSize: 1, mimeType: "image/png", ownerContext: "participation", ownerRecordId: attemptId, questionId: "file1" });
  await service.finalizeUpload(attemptId, objectId);
  await service.deleteUpload(attemptId, objectId);
  assert.deepEqual(
    sent.map(({ url, init }) => `${init.method} ${url}`),
    [
      "POST /api/storage/uploads/initiate",
      `POST /api/storage/uploads/${objectId}/finalize`,
      `DELETE /api/storage/objects/${objectId}`,
    ],
  );
  for (const { init } of sent) {
    assert.ok(init.headers["X-CSRF-Token"]);
    assert.equal(init.headers["X-Storage-Capability"], "cap-".padEnd(43, "x"));
  }
  assert.deepEqual(JSON.parse(sent[1].init.body), {});
  assert.equal(schemas.finalizeUploadBodySchema.safeParse(JSON.parse(sent[1].init.body)).success, true);
});

// --- MSW parity: the storage handlers and the submit-time attach ---

function signIn() {
  const user = { id: randomUUID(), email: `${randomUUID()}@fpt.edu.vn`, name: "Upload", role: "USER", profileComplete: true };
  globalThis.__participationContractUser = user;
  return user;
}

async function call(method, route, { body, raw, headers = {} } = {}) {
  const init = { method, headers: { ...headers } };
  if (raw !== undefined) {
    init.body = raw;
  } else if (method !== "GET") {
    init.headers["X-CSRF-Token"] = "csrf";
    init.headers["Content-Type"] = "application/json";
    if (method !== "DELETE") init.body = JSON.stringify(body ?? {});
  }
  const response = await getResponse(handlers, new Request(`${ORIGIN}/api${route}`, init), { baseUrl: ORIGIN });
  assert.ok(response, `a handler answers ${method} ${route}`);
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

function parsed(schema, result, status = 200) {
  assert.equal(result.status, status, JSON.stringify(result.body?.error));
  const outcome = schema.safeParse(result.body.data);
  assert.ok(outcome.success, outcome.success ? "" : JSON.stringify(outcome.error.issues));
  return outcome.data;
}

function failed(result, status, code) {
  assert.equal(result.status, status, JSON.stringify(result.body));
  assert.equal(result.body.error.code, code);
}

async function uploadOne(attemptId, fileName, bytes = 4, mimeType = "image/png") {
  const initiated = parsed(
    schemas.initiateUploadResponseSchema,
    await call("POST", "/storage/uploads/initiate", {
      body: { fileName, fileSize: bytes, mimeType, ownerContext: "participation", ownerRecordId: attemptId, questionId: "lib-q6" },
    }),
    201,
  );
  assert.ok(initiated.uploadUrl.startsWith("/api/storage/mock-uploads/"));
  const put = await getResponse(
    handlers,
    new Request(`${ORIGIN}${initiated.uploadUrl}`, { method: "PUT", headers: initiated.headers, body: new Uint8Array(bytes) }),
    { baseUrl: ORIGIN },
  );
  assert.equal(put.status, 200);
  return initiated.objectId;
}

test("MSW: initiate → PUT → finalize CLEAN → submit attaches; REJECTED and foreign files are refused", async () => {
  signIn();
  const started = parsed(schemas.surveyAttemptResponseSchema, await call("POST", `/surveys/${SURVEY_IDS.librarySatisfaction}/attempts`), 201);
  const attemptId = started.attemptId;

  // Policy: wrong type, too big, not a file question.
  const base = { fileName: "a.png", fileSize: 4, mimeType: "image/png", ownerContext: "participation", ownerRecordId: attemptId };
  failed(await call("POST", "/storage/uploads/initiate", { body: { ...base, questionId: "lib-q6", mimeType: "text/plain" } }), 400, "STORAGE_INVALID_FILE");
  failed(await call("POST", "/storage/uploads/initiate", { body: { ...base, questionId: "lib-q6", fileSize: 6 * MB } }), 400, "STORAGE_INVALID_FILE");
  failed(await call("POST", "/storage/uploads/initiate", { body: { ...base, questionId: "lib-q1" } }), 400, "STORAGE_INVALID_FILE");
  failed(await call("POST", "/storage/uploads/initiate", { body: { ...base } }), 400, "VALIDATION_ERROR");

  // Finalize before the PUT: nothing in storage yet.
  const early = parsed(
    schemas.initiateUploadResponseSchema,
    await call("POST", "/storage/uploads/initiate", { body: { ...base, questionId: "lib-q6" } }),
    201,
  );
  failed(await call("POST", `/storage/uploads/${early.objectId}/finalize`), 400, "STORAGE_INVALID_FILE");
  assert.equal((await call("DELETE", `/storage/objects/${early.objectId}`)).status, 204);

  const cleanId = await uploadOne(attemptId, "goc-hoc.png");
  const clean = parsed(schemas.storedObjectDtoSchema, await call("POST", `/storage/uploads/${cleanId}/finalize`));
  assert.equal(clean.status, "CLEAN");
  // Finalizing again replays the result.
  assert.equal(parsed(schemas.storedObjectDtoSchema, await call("POST", `/storage/uploads/${cleanId}/finalize`)).status, "CLEAN");

  const infectedId = await uploadOne(attemptId, "eicar.png");
  assert.equal(parsed(schemas.storedObjectDtoSchema, await call("POST", `/storage/uploads/${infectedId}/finalize`)).status, "REJECTED");

  const outageId = await uploadOne(attemptId, "scan.outage.png");
  failed(await call("POST", `/storage/uploads/${outageId}/finalize`), 503, "STORAGE_SCANNER_OUTAGE");

  // Another account can neither finalize nor delete these objects.
  const owner = globalThis.__participationContractUser;
  signIn();
  failed(await call("POST", `/storage/uploads/${cleanId}/finalize`), 403, "STORAGE_UNAUTHORIZED");
  failed(await call("DELETE", `/storage/objects/${cleanId}`), 403, "STORAGE_UNAUTHORIZED");
  globalThis.__participationContractUser = owner;

  updateAttempt(attemptId, (attempt) => {
    attempt.startedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  });
  const answers = { "lib-q1": "Hiếm khi", "lib-q2": ["Tự học"], "lib-q3": 4, "lib-q4": 5 };
  const toFile = (objectId) => ({ objectId, fileName: "x.png", fileSize: 4, mimeType: "image/png", status: "CLEAN" });

  // A REJECTED object is refused and nothing is submitted.
  failed(
    await call("POST", `/responses/${started.responseId}/submit`, { body: { attemptId, answers: { ...answers, "lib-q6": [toFile(infectedId)] } } }),
    400,
    "UNCLEAN_ATTACHMENT",
  );
  const submitted = parsed(
    schemas.internalFormSubmissionResponseSchema,
    await call("POST", `/responses/${started.responseId}/submit`, { body: { attemptId, answers: { ...answers, "lib-q6": [toFile(cleanId)] } } }),
  );
  assert.equal(submitted.status, "VALIDATED");
  // Attached files cannot be deleted any more.
  failed(await call("DELETE", `/storage/objects/${cleanId}`), 403, "STORAGE_UNAUTHORIZED");
});

// --- Phase 7 review fixes ---

const dto = (id, status, scanStatus = status === "CLEAN" ? "CLEAN" : "PENDING") => ({
  id,
  ownerContext: "participation",
  ownerRecordId: "00000000-0000-4000-8000-000000000001",
  dataClass: "SURVEY_ATTACHMENT",
  storageKey: "k",
  fileName: "a.png",
  fileSize: 1,
  mimeType: "image/png",
  status,
  scanStatus,
  createdAt: new Date().toISOString(),
});

test("finalize behind a proxy timeout polls the status instead of re-uploading", async () => {
  const objectId = randomUUID();
  const calls = [];
  const sleep = async () => calls.push("sleep");
  const statuses = [dto(objectId, "QUARANTINED"), dto(objectId, "CLEAN")];
  const answer = await service.finalizeToAttachment(randomUUID(), objectId, {
    finalize: async () => {
      calls.push("finalize");
      throw http(504, null);
    },
    status: async () => {
      calls.push("status");
      return statuses.shift();
    },
    sleep,
  });
  assert.equal(answer.objectId, objectId);
  assert.deepEqual(calls, ["finalize", "sleep", "status", "sleep", "status"]);

  // The finalize never reached the server (still INITIATED): finalize once more.
  const again = [];
  await service.finalizeToAttachment(randomUUID(), objectId, {
    finalize: async () => {
      again.push("finalize");
      if (again.length === 1) throw new ApiError({ kind: "network", message: "lost" });
      return dto(objectId, "CLEAN");
    },
    status: async () => dto(objectId, "INITIATED"),
    sleep: async () => {},
  });
  assert.deepEqual(again, ["finalize", "finalize"]);

  // Still scanning after the whole budget: a retryable "still scanning" failure on the same object.
  await assert.rejects(
    service.finalizeToAttachment(randomUUID(), objectId, {
      finalize: async () => {
        throw http(502, null);
      },
      status: async () => dto(objectId, "QUARANTINED"),
      sleep: async () => {},
    }),
    (error) =>
      error.objectId === objectId &&
      rules.isRetryableFinalize(error.failure) &&
      rules.uploadErrorMessage(error.failure) === rules.UPLOAD_MESSAGES.stillScanning,
  );
  // An outage found while polling is an outage.
  await assert.rejects(
    service.finalizeToAttachment(randomUUID(), objectId, {
      finalize: async () => {
        throw http(500, null);
      },
      status: async () => dto(objectId, "QUARANTINED", "OUTAGE"),
      sleep: async () => {},
    }),
    (error) => rules.isScannerOutage(error.failure),
  );
});

test("aborts: an already aborted PUT rejects at once; a scan in flight finishes before the abort is reported", async () => {
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(service.putFileToStorage("http://x", new Blob([]), {}, () => {}, aborted.signal), (error) => error.name === "AbortError");

  const objectId = randomUUID();
  const controller = new AbortController();
  const file = new File([new Uint8Array([1])], "a.png", { type: "image/png" });
  let finalized = false;
  await assert.rejects(
    service.uploadQuestionFile(
      { attemptId: randomUUID(), block, file, signal: controller.signal },
      {
        initiate: async () => ({ objectId, uploadUrl: "u", storageKey: "k", expiresAt: "x" }),
        put: async () => {},
        finalize: async (_attempt, id) => {
          controller.abort();
          finalized = true;
          return dto(id, "CLEAN");
        },
        status: async () => assert.fail("not polled"),
        sleep: async () => {},
      },
    ),
    (error) => error instanceof service.FileUploadError && error.aborted && error.objectId === objectId,
  );
  assert.equal(finalized, true);
});

/** A controller wired to fake deps; `uploads` resolve or reject when the test says so. */
function harness({ maxFiles = 2 } = {}) {
  const fileBlock = { ...block, maxFiles };
  const answers = new Map();
  const calls = [];
  const pendingUploads = [];
  const host = {
    attemptId: "attempt-1",
    getFiles: (id) => answers.get(id) ?? [],
    setFiles: (blk, files, options) => {
      calls.push(["setFiles", files.map((file) => file.objectId), options?.immediate ?? false]);
      answers.set(blk.id, files);
    },
  };
  const deps = {
    upload: (input) =>
      new Promise((resolve, reject) => {
        calls.push(["upload", input.file.name]);
        input.signal.addEventListener("abort", () =>
          reject(new service.FileUploadError(new DOMException("aborted", "AbortError"), "uploading", "obj-aborted")),
        );
        pendingUploads.push({ resolve, reject, input });
      }),
    finalize: async (_attempt, objectId) => {
      calls.push(["finalize", objectId]);
      return deps.finalizeResult(objectId);
    },
    finalizeResult: (objectId) => ({ objectId, fileName: "a.png", fileSize: 1, mimeType: "image/png", status: "CLEAN" }),
    remove: async (_attempt, objectId) => {
      calls.push(["delete", objectId]);
      if (deps.deleteFails) throw http(500, null);
    },
    list: async () => deps.listed ?? [],
    deleteFails: false,
    listed: null,
  };
  const controller = new FileUploadController(host, deps);
  return { controller, fileBlock, answers, calls, pendingUploads, deps };
}

const png = (name) => new File([new Uint8Array([1])], name, { type: "image/png" });
const tick = () => new Promise((resolve) => setImmediate(resolve));
const attachmentFor = (objectId) => ({ objectId, fileName: "a.png", fileSize: 1, mimeType: "image/png", status: "CLEAN" });

test("controller: a finished upload joins the answer; a failed one holding an object counts until dismissed", async () => {
  const { controller, fileBlock, calls, pendingUploads, deps } = harness();
  controller.choose(fileBlock, [png("a.png"), png("b.png")]);
  assert.equal(controller.isBusy(fileBlock.id), true);
  assert.equal(controller.liveCount(fileBlock.id), 2);
  // Over the limit locally: refused with the distinct "full" message.
  controller.choose(fileBlock, [png("c.png")]);
  assert.match(controller.noticeOf(fileBlock.id), /tối đa 2 tệp/);

  pendingUploads[0].resolve(attachmentFor("obj-a"));
  pendingUploads[1].reject(new service.FileUploadError(http(400, "STORAGE_INVALID_FILE"), "scanning", "obj-b"));
  await tick();
  assert.deepEqual(calls.filter(([name]) => name === "setFiles"), [["setFiles", ["obj-a"], false]]);
  const failed = controller.itemsOf(fileBlock.id)[0];
  assert.equal(failed.state, "failed");
  assert.equal(controller.isBusy(fileBlock.id), false);
  assert.equal(controller.liveCount(fileBlock.id), 2, "the failed item still holds obj-b");

  // A delete that fails keeps the item (and says so); the next one drops it.
  deps.deleteFails = true;
  await controller.dismiss(failed.key);
  assert.equal(controller.itemsOf(fileBlock.id)[0].message, rules.UPLOAD_MESSAGES.deleteFailed);
  deps.deleteFails = false;
  await controller.dismiss(failed.key);
  assert.equal(controller.itemsOf(fileBlock.id).length, 0);
  assert.equal(controller.liveCount(fileBlock.id), 1);
});

test("controller: retry deletes the old object first; outage retries stop after the limit", async () => {
  const { controller, fileBlock, calls, pendingUploads, deps } = harness();
  controller.choose(fileBlock, [png("a.png")]);
  pendingUploads[0].reject(new service.FileUploadError(http(403, rules.STORAGE_PUT_FAILED_CODE), "uploading", "obj-old"));
  await tick();
  const key = controller.itemsOf(fileBlock.id)[0].key;
  calls.length = 0;
  await controller.retry(fileBlock, key);
  assert.deepEqual(calls.slice(0, 2), [["delete", "obj-old"], ["upload", "a.png"]]);

  // The new upload hits a scanner outage: only finalize is retried, MAX_OUTAGE_RETRIES times.
  pendingUploads[1].reject(new service.FileUploadError(http(503, "STORAGE_SCANNER_OUTAGE"), "scanning", "obj-new"));
  await tick();
  deps.finalizeResult = () => {
    throw new service.FileUploadError(http(503, "STORAGE_SCANNER_OUTAGE"), "scanning", "obj-new");
  };
  for (let i = 0; i < rules.MAX_OUTAGE_RETRIES; i += 1) {
    assert.equal(controller.itemsOf(fileBlock.id)[0].retryExhausted, false);
    await controller.retry(fileBlock, key);
  }
  const item = controller.itemsOf(fileBlock.id)[0];
  assert.equal(item.retryExhausted, true);
  assert.equal(item.message, rules.UPLOAD_MESSAGES.scannerDown);
  calls.length = 0;
  await controller.retry(fileBlock, key);
  assert.deepEqual(calls, [], "no retry once exhausted");
});

test("controller: removing a file deletes it first, then saves the answer at once", async () => {
  const { controller, fileBlock, answers, calls, deps } = harness();
  answers.set(fileBlock.id, [attachmentFor("obj-a"), attachmentFor("obj-b")]);
  deps.deleteFails = true;
  await controller.remove(fileBlock, attachmentFor("obj-a"));
  assert.equal(answers.get(fileBlock.id).length, 2, "kept: the server still holds it");
  assert.equal(controller.noticeOf(fileBlock.id), rules.UPLOAD_MESSAGES.deleteFailed);
  deps.deleteFails = false;
  const removal = controller.remove(fileBlock, attachmentFor("obj-a"));
  assert.equal(controller.itemsOf(fileBlock.id)[0].state, "deleting");
  await removal;
  assert.deepEqual(calls.at(-1), ["setFiles", ["obj-b"], true]);
});

test("controller: a full question re-adopts lost CLEAN uploads and deletes half-done ones", async () => {
  const { controller, fileBlock, answers, calls, pendingUploads, deps } = harness({ maxFiles: 2 });
  deps.listed = [dto("obj-lost", "CLEAN"), dto("obj-stale", "INITIATED")];
  controller.choose(fileBlock, [png("a.png")]);
  pendingUploads[0].reject(
    new service.FileUploadError(
      new ApiError({ kind: "http", status: 409, code: "STORAGE_QUESTION_FULL", message: "full", details: { questionId: "file1", maxFiles: 2 } }),
      "initiating",
      null,
    ),
  );
  await tick();
  await tick();
  assert.deepEqual(answers.get(fileBlock.id).map((file) => file.objectId), ["obj-lost"]);
  assert.ok(calls.some(([name, id]) => name === "delete" && id === "obj-stale"));
  assert.match(controller.noticeOf(fileBlock.id), /khôi phục 1 tệp/);
});

test("controller: leaving the attempt aborts uploads and deletes their objects", async () => {
  const { controller, fileBlock, calls } = harness();
  controller.choose(fileBlock, [png("a.png")]);
  controller.dispose();
  await tick();
  assert.ok(calls.some(([name, id]) => name === "delete" && id === "obj-aborted"));
});

test("MSW: full question (409 + details), live-upload list, status, lapsed uploads, duplicates and UNCLEAN details", async () => {
  signIn();
  const started = parsed(schemas.surveyAttemptResponseSchema, await call("POST", `/surveys/${SURVEY_IDS.librarySatisfaction}/attempts`), 201);
  const attemptId = started.attemptId;
  const input = (fileName) => ({ fileName, fileSize: 4, mimeType: "image/png", ownerContext: "participation", ownerRecordId: attemptId, questionId: "lib-q6" });

  failed(await call("POST", "/storage/uploads/initiate", { body: input("virus.exe.png.exe") }), 400, "STORAGE_INVALID_FILE");
  const first = await uploadOne(attemptId, "one.png");
  parsed(schemas.storedObjectDtoSchema, await call("POST", `/storage/uploads/${first}/finalize`));
  const second = parsed(schemas.initiateUploadResponseSchema, await call("POST", "/storage/uploads/initiate", { body: input("two.png") }), 201);
  const full = await call("POST", "/storage/uploads/initiate", { body: input("three.png") });
  failed(full, 409, "STORAGE_QUESTION_FULL");
  assert.deepEqual(schemas.storageQuestionFullDetailsSchema.parse(full.body.error.details), { questionId: "lib-q6", maxFiles: 2 });

  const listed = parsed(
    schemas.listUploadsResponseSchema,
    await call("GET", `/storage/uploads?ownerContext=participation&ownerRecordId=${attemptId}&questionId=lib-q6`),
  );
  assert.deepEqual(listed.objects.map((object) => [object.id, object.status]), [[first, "CLEAN"], [second.objectId, "INITIATED"]]);
  assert.equal(parsed(schemas.storedObjectDtoSchema, await call("GET", `/storage/objects/${first}/status`)).status, "CLEAN");

  // An INITIATED upload past its window + grace stops counting toward maxFiles.
  storedObjects.update((all) => {
    all[second.objectId].expiresAt = new Date(Date.now() - 6 * 60 * 1000).toISOString();
  });
  parsed(schemas.initiateUploadResponseSchema, await call("POST", "/storage/uploads/initiate", { body: input("three.png") }), 201);

  updateAttempt(attemptId, (attempt) => {
    attempt.startedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  });
  const answers = { "lib-q1": "Hiếm khi", "lib-q2": ["Tự học"], "lib-q3": 4, "lib-q4": 5 };
  const toFile = (objectId) => ({ objectId, fileName: "x.png", fileSize: 4, mimeType: "image/png", status: "CLEAN" });
  failed(
    await call("POST", `/responses/${started.responseId}/submit`, { body: { attemptId, answers: { ...answers, "lib-q6": [toFile(first), toFile(first)] } } }),
    400,
    "INVALID_FORM_SUBMISSION",
  );
  const unclean = await call("POST", `/responses/${started.responseId}/submit`, {
    body: { attemptId, answers: { ...answers, "lib-q6": [toFile(first), toFile(second.objectId)] } },
  });
  failed(unclean, 400, "UNCLEAN_ATTACHMENT");
  assert.deepEqual(schemas.uncleanAttachmentDetailsSchema.parse(unclean.body.error.details), {
    files: [{ questionId: "lib-q6", objectId: second.objectId }],
  });
});

test("MSW AI handlers are self-contained: no mock session, any UUID form id", { timeout: 30_000 }, async () => {
  globalThis.__participationContractUser = null;
  const formId = randomUUID();
  failed(await call("GET", `/forms/${formId}/ai/conversation`), 404, "AI_CONVERSATION_NOT_FOUND");
  failed(await call("POST", `/forms/${formId}/ai/conversation`, { body: { conversationId: "missing" } }), 404, "AI_CONVERSATION_NOT_FOUND");
  const { aiNewChatSchema, aiConversationSchema } = await import("../lib/forms/builder-ai.ts");
  const chat = parsed(
    aiNewChatSchema,
    await call("POST", "/forms/ai/messages", { body: { message: "Khảo sát căng tin", options: { duration: "UNDER_5", suggestAttentionChecks: false } } }),
  );
  const adopted = parsed(aiConversationSchema, await call("POST", `/forms/${formId}/ai/conversation`, { body: { conversationId: chat.conversationId } }));
  assert.equal(adopted.formId, formId);
  failed(await call("POST", `/forms/${formId}/ai/conversation`, { body: { conversationId: chat.conversationId } }), 409, "AI_CONVERSATION_EXISTS");
  assert.equal(parsed(aiConversationSchema, await call("GET", `/forms/${formId}/ai/conversation`)).messages.length, adopted.messages.length);
});
