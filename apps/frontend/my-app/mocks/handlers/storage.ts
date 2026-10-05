import { HttpResponse, http, type RequestHandler } from "msw";
import {
  DISALLOWED_MIME_TYPES,
  STORAGE_QUESTION_FULL_CODE,
  dangerousFileExtension,
  finalizeUploadBodySchema,
  initiateUploadInputSchema,
  listUploadsQuerySchema,
  type FileUploadBlock,
} from "@rescom/schemas";
import { apiUrl } from "@/lib/api/config";
import { findAttempt, type MockAttempt } from "../data/attempts";
import {
  findStoredObject,
  storedObjectDtoOf,
  storedObjects,
  updateStoredObject,
  type MockStoredObject,
} from "../data/stored-objects";
import { surveyContentOf } from "../data/survey-content";
import { getMockSessionUser } from "../db/session";
import { mockId, nowIso } from "../db/store";
import { fail, missingCsrf, ok, unauthorized } from "../envelope";
import { applyScenario } from "../scenarios";

/**
 * Phase 7 direct uploads, mirroring `storage.controller.ts` /
 * `storage.service.ts` for a signed-in respondent's `file_upload` answer:
 * initiate → PUT to the "presigned" URL → finalize → (submit attaches) →
 * delete. Response bodies are the shared `initiateUploadResponseSchema` /
 * `storedObjectDtoSchema`.
 *
 * MOCK-ONLY: the presigned URL is `PUT /api/storage/mock-uploads/:id` (the
 * real one points at object storage, outside `/api`). The malware verdict
 * follows the backend's local `StubMalwareScannerService` markers: a file name
 * containing `.outage` → 503 `STORAGE_SCANNER_OUTAGE` (retry finalize),
 * `eicar` / `.malware` / `.infected` → REJECTED; everything else is CLEAN.
 */

const MB = 1024 * 1024;
const UPLOAD_URL_TTL_MS = 15 * 60 * 1000;
const DEAD_STATUSES = new Set(["REJECTED", "EXPIRED", "DELETED"]);
/** `UPLOAD_GRACE_MS`: an INITIATED upload stops counting this long after its window closed. */
const UPLOAD_GRACE_MS = 5 * 60 * 1000;

/** `StorageService.assertQuestionHasRoom`: what still counts toward `maxFiles`. */
function countsTowardMaxFiles(object: MockStoredObject, now: number): boolean {
  if (DEAD_STATUSES.has(object.status) || object.scanStatus === "OUTAGE") return false;
  return !(object.status === "INITIATED" && Date.parse(object.expiresAt) + UPLOAD_GRACE_MS <= now);
}

/** Owner of the attempt (signed-in respondent), for reads of its uploads. */
function readableAttempt(attemptId: string, userId: string): MockAttempt | null {
  const attempt = findAttempt(attemptId);
  return attempt && attempt.userId === userId && (attempt.status === "IN_PROGRESS" || attempt.status === "COMPLETED")
    ? attempt
    : null;
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

const invalidFile = (message: string) => fail(400, "STORAGE_INVALID_FILE", message);
const notAuthorized = () => fail(403, "STORAGE_UNAUTHORIZED", "Unauthorized access to requested object.");

/** `PrismaStorageOwnerAuthorizationService.authorize` for the attempt's own respondent. */
function writableAttempt(attemptId: string, userId: string): MockAttempt | null {
  const attempt = findAttempt(attemptId);
  if (!attempt || attempt.userId !== userId) return null;
  return attempt.status === "IN_PROGRESS" && Date.parse(attempt.expiresAt) > Date.now() ? attempt : null;
}

function mimeMatches(actual: string, allowed: string): boolean {
  const normalized = allowed.toLowerCase().trim();
  return normalized.endsWith("/*") ? actual.startsWith(normalized.slice(0, -1)) : actual === normalized;
}

function verdict(fileName: string): "CLEAN" | "INFECTED" | "OUTAGE" {
  const name = fileName.toLowerCase();
  if (name.includes(".outage")) return "OUTAGE";
  if (name.includes("eicar") || name.includes(".malware") || name.includes(".infected")) return "INFECTED";
  return "CLEAN";
}

export const storageHandlers: RequestHandler[] = [
  // VERIFIED: POST /storage/uploads/initiate → 201 initiateUploadResponseSchema.
  http.post(apiUrl("/storage/uploads/initiate"), async ({ request }) => {
    const forced = await applyScenario("storage");
    if (forced) return forced;
    const user = await getMockSessionUser();
    if (!user) return unauthorized();
    const csrf = missingCsrf(request);
    if (csrf) return csrf;
    const body = initiateUploadInputSchema.safeParse(await readJson(request));
    if (!body.success) {
      return fail(400, "VALIDATION_ERROR", body.error.errors[0]?.message ?? "Validation failed", {
        details: body.error.format(),
      });
    }
    const input = body.data;
    const extension = dangerousFileExtension(input.fileName);
    if (extension) return invalidFile(`Files ending in ${extension} are prohibited.`);
    if (input.ownerContext !== "participation") return notAuthorized();
    const attempt = writableAttempt(input.ownerRecordId, user.id);
    if (!attempt) return notAuthorized();
    const block = surveyContentOf(attempt.surveyId)?.blocks.find((candidate) => candidate.id === input.questionId);
    if (!block || block.type !== "file_upload") {
      return invalidFile("The requested question is not a file-upload block in the pinned form version.");
    }
    const policy = block as FileUploadBlock;
    const mimeType = input.mimeType.toLowerCase().trim();
    const maxBytes = Math.min(policy.maxFileSizeMb ?? 10, 50) * MB;
    if (input.fileSize <= 0 || input.fileSize > maxBytes) {
      return invalidFile(`File size must be between 1 byte and ${Math.floor(maxBytes / MB)}MB.`);
    }
    if (
      DISALLOWED_MIME_TYPES.includes(mimeType) ||
      (policy.allowedMimeTypes.length > 0 && !policy.allowedMimeTypes.some((allowed) => mimeMatches(mimeType, allowed)))
    ) {
      return invalidFile(`MIME type "${mimeType}" is not allowed for this question.`);
    }
    const now = Date.now();
    const live = Object.values(storedObjects.get()).filter(
      (object) =>
        object.attemptId === attempt.attemptId && object.questionId === policy.id && countsTowardMaxFiles(object, now),
    ).length;
    if (live >= policy.maxFiles) {
      return fail(409, STORAGE_QUESTION_FULL_CODE, `This question allows at most ${policy.maxFiles} uploaded file(s).`, {
        details: { questionId: policy.id, maxFiles: policy.maxFiles },
      });
    }

    const id = mockId();
    const createdAt = nowIso();
    const expiresAt = new Date(Date.now() + UPLOAD_URL_TTL_MS).toISOString();
    storedObjects.update((all) => {
      all[id] = {
        id,
        attemptId: attempt.attemptId,
        questionId: policy.id,
        fileName: input.fileName.replace(/[/\\]/g, "").trim(),
        fileSize: input.fileSize,
        mimeType,
        status: "INITIATED",
        scanStatus: "PENDING",
        receivedBytes: null,
        receivedType: null,
        createdAt,
        expiresAt,
        uploadedAt: null,
        scannedAt: null,
        attachedAt: null,
      };
    });
    return ok(
      {
        objectId: id,
        uploadUrl: apiUrl(`/storage/mock-uploads/${id}`),
        storageKey: `participation/${attempt.attemptId}/${id}-${input.fileName}`,
        expiresAt,
        headers: { "Content-Type": mimeType },
      },
      201,
    );
  }),

  // MOCK-ONLY: stands in for the presigned PUT to object storage (no session, no CSRF).
  http.put(apiUrl("/storage/mock-uploads/:id"), async ({ request, params }) => {
    const object = findStoredObject(String(params.id));
    if (!object || object.status !== "INITIATED" || Date.parse(object.expiresAt) <= Date.now()) {
      return new HttpResponse(null, { status: 403 });
    }
    const bytes = (await request.arrayBuffer()).byteLength;
    updateStoredObject(object.id, (target) => {
      target.receivedBytes = bytes;
      target.receivedType = request.headers.get("Content-Type");
    });
    return new HttpResponse(null, { status: 200 });
  }),

  // VERIFIED: POST /storage/uploads/:id/finalize → storedObjectDtoSchema (CLEAN / REJECTED), 400, 503.
  http.post(apiUrl("/storage/uploads/:id/finalize"), async ({ request, params }) => {
    const forced = await applyScenario("storage");
    if (forced) return forced;
    const user = await getMockSessionUser();
    if (!user) return unauthorized();
    const csrf = missingCsrf(request);
    if (csrf) return csrf;
    if (!finalizeUploadBodySchema.safeParse(await readJson(request)).success) {
      return fail(400, "VALIDATION_ERROR", "Invalid finalize body.");
    }
    const object = findStoredObject(String(params.id));
    if (!object) return fail(404, "STORAGE_OBJECT_NOT_FOUND", "Stored object not found.");
    if (!writableAttempt(object.attemptId, user.id)) return notAuthorized();
    if (object.status === "CLEAN" || object.status === "REJECTED") return ok(storedObjectDtoOf(object));
    const retryingOutage = object.status === "QUARANTINED" && object.scanStatus === "OUTAGE";
    if (object.status !== "INITIATED" && !retryingOutage) {
      return invalidFile(`Object cannot be finalized from status ${object.status}.`);
    }
    if (object.receivedBytes === null) return invalidFile("Uploaded object was not found in private storage.");
    if (object.receivedBytes !== object.fileSize) {
      return invalidFile(`Uploaded size ${object.receivedBytes} does not match declared size ${object.fileSize}.`);
    }
    if (object.receivedType && object.receivedType.toLowerCase() !== object.mimeType) {
      return invalidFile("Uploaded content type does not match the initiated upload.");
    }
    const result = verdict(object.fileName);
    const scannedAt = nowIso();
    updateStoredObject(object.id, (target) => {
      target.uploadedAt ??= scannedAt;
      target.scannedAt = scannedAt;
      if (result === "OUTAGE") {
        target.status = "QUARANTINED";
        target.scanStatus = "OUTAGE";
      } else if (result === "INFECTED") {
        target.status = "REJECTED";
        target.scanStatus = "INFECTED";
      } else {
        target.status = "CLEAN";
        target.scanStatus = "CLEAN";
      }
    });
    if (result === "OUTAGE") {
      return fail(503, "STORAGE_SCANNER_OUTAGE", "Malware scanner outage. Upload remains quarantined and fails closed per security policy.");
    }
    return ok(storedObjectDtoOf(findStoredObject(object.id) ?? object));
  }),

  // VERIFIED: GET /storage/uploads → listUploadsResponseSchema (live uploads of one attempt question).
  http.get(apiUrl("/storage/uploads"), async ({ request }) => {
    const forced = await applyScenario("storage");
    if (forced) return forced;
    const user = await getMockSessionUser();
    if (!user) return unauthorized();
    const url = new URL(request.url);
    const query = listUploadsQuerySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!query.success) return fail(400, "VALIDATION_ERROR", "Invalid query.", { details: query.error.format() });
    if (query.data.ownerContext !== "participation" || !readableAttempt(query.data.ownerRecordId, user.id)) {
      return notAuthorized();
    }
    const objects = Object.values(storedObjects.get())
      .filter(
        (object) =>
          object.attemptId === query.data.ownerRecordId &&
          (query.data.questionId === undefined || object.questionId === query.data.questionId) &&
          !DEAD_STATUSES.has(object.status),
      )
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
      .map(storedObjectDtoOf);
    return ok({ objects });
  }),

  // VERIFIED: GET /storage/objects/:id/status → storedObjectDtoSchema (finalize polling after a lost response).
  http.get(apiUrl("/storage/objects/:id/status"), async ({ params }) => {
    const forced = await applyScenario("storage");
    if (forced) return forced;
    const user = await getMockSessionUser();
    if (!user) return unauthorized();
    const object = findStoredObject(String(params.id));
    if (!object) return fail(404, "STORAGE_OBJECT_NOT_FOUND", "Stored object not found.");
    if (!readableAttempt(object.attemptId, user.id)) return notAuthorized();
    return ok(storedObjectDtoOf(object));
  }),

  // VERIFIED: DELETE /storage/objects/:id → 204; an ATTACHED object is 400.
  http.delete(apiUrl("/storage/objects/:id"), async ({ request, params }) => {
    const forced = await applyScenario("storage");
    if (forced) return forced;
    const user = await getMockSessionUser();
    if (!user) return unauthorized();
    const csrf = missingCsrf(request);
    if (csrf) return csrf;
    const object = findStoredObject(String(params.id));
    if (!object) return fail(404, "STORAGE_OBJECT_NOT_FOUND", "Stored object not found.");
    if (!writableAttempt(object.attemptId, user.id)) return notAuthorized();
    if (object.status === "ATTACHED") return invalidFile("Attached objects cannot be deleted.");
    updateStoredObject(object.id, (target) => {
      target.status = "DELETED";
    });
    return new HttpResponse(null, { status: 204 });
  }),
];

/**
 * Submit-time attach (`prisma-participation.repository.ts` step 3): every file
 * answer must be a CLEAN object of this attempt uploaded for that question;
 * they become ATTACHED. Returns the rejected response, or null when attached.
 */
export function attachSubmittedFiles(
  attemptId: string,
  fileAnswers: Array<{ questionId: string; objectId: string }>,
): Response | null {
  // `participation.service.ts`: one object may answer one question once.
  const seen = new Set<string>();
  for (const { questionId, objectId } of fileAnswers) {
    if (seen.has(objectId)) {
      return fail(400, "INVALID_FORM_SUBMISSION", "Each uploaded file may be referenced only once.", {
        details: { [questionId]: "Duplicate file reference" },
      });
    }
    seen.add(objectId);
  }
  const all = storedObjects.get();
  const offenders = fileAnswers.filter(({ questionId, objectId }) => {
    const object = all[objectId];
    return !(object?.attemptId === attemptId && object.questionId === questionId && object.status === "CLEAN");
  });
  if (offenders.length > 0) {
    return fail(400, "UNCLEAN_ATTACHMENT", "Attached file has not passed malware scanning or was rejected.", {
      details: { files: offenders },
    });
  }
  const attachedAt = nowIso();
  storedObjects.update((objects) => {
    for (const { objectId } of fileAnswers) {
      const object = objects[objectId];
      if (object) {
        object.status = "ATTACHED";
        object.attachedAt = attachedAt;
      }
    }
  });
  return null;
}
