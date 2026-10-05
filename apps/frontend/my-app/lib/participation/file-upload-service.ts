import {
  initiateUploadResponseSchema,
  listUploadsResponseSchema,
  storedObjectDtoSchema,
  type FileAttachmentAnswer,
  type FileUploadBlock,
  type InitiateUploadInput,
  type InitiateUploadResponse,
  type StoredObjectDto,
} from "@rescom/schemas";
import { ApiError, isApiError } from "../api/api-error.ts";
import { apiRequest } from "../api/client.ts";
import {
  STORAGE_OBJECT_REJECTED_CODE,
  STORAGE_PUT_FAILED_CODE,
  STORAGE_SCAN_PENDING_CODE,
  attachmentOf,
  uploadMimeType,
} from "./file-upload.ts";

/**
 * VERIFIED: direct upload of a `file_upload` answer (AD-22, mock-off Phase 7),
 * `storage.controller.ts` (`/storage/*`, session or guest capability, AD-20
 * CSRF + JSON):
 *
 * 1. `POST /storage/uploads/initiate` `initiateUploadInputSchema`
 *    (`ownerContext: "participation"`, `ownerRecordId` = attempt id,
 *    `questionId` = block id) → 201 `initiateUploadResponseSchema` with a
 *    15-minute presigned `uploadUrl` and the headers it was signed with;
 *    409 `STORAGE_QUESTION_FULL` (`{ questionId, maxFiles }`) when the
 *    question already holds `maxFiles` live uploads.
 * 2. The browser PUTs the bytes STRAIGHT to `uploadUrl` (object storage, not
 *    `/api`): only steps 1 and 3 go through the Next proxy and its 30 s timeout.
 * 3. `POST /storage/uploads/:id/finalize` `{}` → `storedObjectDtoSchema`:
 *    CLEAN (scanned, attachable) or REJECTED (malware); 400
 *    `STORAGE_INVALID_FILE` (size/type/signature mismatch), 503
 *    `STORAGE_SCANNER_OUTAGE` (kept QUARANTINED: finalize again) or 503
 *    `STORAGE_UNAVAILABLE` (storage unreachable before the claim: the object
 *    stays INITIATED, finalize again; same retry and copy rules). A gateway
 *    error or timeout (500/502/504, lost response) is resolved by polling
 *    `GET /storage/objects/:id/status`, never by uploading again.
 * 4. `DELETE /storage/objects/:id` removes an unattached upload (204).
 * 5. `GET /storage/uploads?ownerContext&ownerRecordId&questionId` →
 *    `listUploadsResponseSchema`: the live uploads to re-adopt or clean up.
 *
 * The submit attaches only CLEAN objects of this attempt uploaded for that
 * question (400 `UNCLEAN_ATTACHMENT`, `details.files` names them). Writes need
 * the attempt to be IN_PROGRESS within its reservation window. A signed-in
 * respondent owns the attempt through the session; the `storageCapability`
 * returned when the attempt starts is sent as `X-Storage-Capability` too.
 */

const CAPABILITY_PREFIX = "rescom:storage-capability:";

function sessionStore(): Pick<Storage, "getItem" | "setItem"> | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** Kept for the tab's lifetime (sessionStorage); cleared on logout with the other participation keys. */
export function rememberStorageCapability(attemptId: string, capability: string): void {
  try {
    sessionStore()?.setItem(`${CAPABILITY_PREFIX}${attemptId}`, capability);
  } catch {
    // Best effort: a signed-in respondent is authorized by the session anyway.
  }
}

export function storageCapabilityOf(attemptId: string): string | null {
  try {
    return sessionStore()?.getItem(`${CAPABILITY_PREFIX}${attemptId}`) ?? null;
  } catch {
    return null;
  }
}

function capabilityHeaders(attemptId: string): Record<string, string> {
  const capability = storageCapabilityOf(attemptId);
  return capability ? { "X-Storage-Capability": capability } : {};
}

export function initiateUpload(input: InitiateUploadInput, signal?: AbortSignal): Promise<InitiateUploadResponse> {
  return apiRequest("/storage/uploads/initiate", {
    method: "POST",
    body: input,
    schema: initiateUploadResponseSchema,
    headers: capabilityHeaders(input.ownerRecordId),
    signal,
  });
}

export function finalizeUpload(attemptId: string, objectId: string, signal?: AbortSignal): Promise<StoredObjectDto> {
  return apiRequest(`/storage/uploads/${encodeURIComponent(objectId)}/finalize`, {
    method: "POST",
    body: {},
    schema: storedObjectDtoSchema,
    headers: capabilityHeaders(attemptId),
    signal,
  });
}

export function getUploadStatus(attemptId: string, objectId: string, signal?: AbortSignal): Promise<StoredObjectDto> {
  return apiRequest(`/storage/objects/${encodeURIComponent(objectId)}/status`, {
    schema: storedObjectDtoSchema,
    headers: capabilityHeaders(attemptId),
    signal,
  });
}

export async function listUploads(attemptId: string, questionId: string, signal?: AbortSignal): Promise<StoredObjectDto[]> {
  const query = new URLSearchParams({ ownerContext: "participation", ownerRecordId: attemptId, questionId });
  const result = await apiRequest(`/storage/uploads?${query.toString()}`, {
    schema: listUploadsResponseSchema,
    headers: capabilityHeaders(attemptId),
    signal,
  });
  return result.objects;
}

export function deleteUpload(attemptId: string, objectId: string): Promise<void> {
  return apiRequest(`/storage/objects/${encodeURIComponent(objectId)}`, {
    method: "DELETE",
    headers: capabilityHeaders(attemptId),
  });
}

function abortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}

export function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { name?: unknown }).name === "AbortError";
}

/**
 * PUT of the raw bytes to the presigned URL with upload progress (`fetch`
 * has none). No cookies or CSRF: the signature is the authorization.
 */
export function putFileToStorage(
  url: string,
  file: Blob,
  headers: Record<string, string>,
  onProgress: (loaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    for (const [name, value] of Object.entries(headers)) request.setRequestHeader(name, value);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded, event.total);
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) resolve();
      else
        reject(
          new ApiError({
            kind: "http",
            status: request.status,
            code: STORAGE_PUT_FAILED_CODE,
            message: `Direct storage upload failed with ${request.status}`,
          }),
        );
    };
    request.onerror = () => reject(new ApiError({ kind: "network", message: "Direct storage upload failed" }));
    request.onabort = () => reject(abortError());
    signal?.addEventListener("abort", () => request.abort(), { once: true });
    request.send(file);
  });
}

export interface UploadDeps {
  initiate: typeof initiateUpload;
  put: typeof putFileToStorage;
  finalize: typeof finalizeUpload;
  status: typeof getUploadStatus;
  /** Waits between status polls (injectable for tests). */
  sleep: (ms: number) => Promise<void>;
}

const DEFAULT_DEPS: UploadDeps = {
  initiate: initiateUpload,
  put: putFileToStorage,
  finalize: finalizeUpload,
  status: getUploadStatus,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export type UploadStage = "initiating" | "uploading" | "scanning";

export interface UploadProgress {
  stage: UploadStage;
  /** 0–100 over the whole pipeline (PUT bytes = 5–90). */
  percent: number;
  /** Known once the upload was initiated: needed to retry finalize or delete it. */
  objectId?: string;
}

/** Thrown by the pipeline: the failure (an `ApiError` or an `AbortError`) and the object it left behind. */
export class FileUploadError extends Error {
  /** The underlying `ApiError` (or `AbortError`) — what `uploadErrorMessage` reads. */
  readonly failure: unknown;
  readonly objectId: string | null;
  readonly stage: UploadStage;

  constructor(failure: unknown, stage: UploadStage, objectId: string | null) {
    super(failure instanceof Error ? failure.message : "Upload failed");
    this.name = "FileUploadError";
    this.failure = failure;
    this.stage = stage;
    this.objectId = objectId;
  }

  get aborted(): boolean {
    return isAbortError(this.failure);
  }
}

/** Status polls after a lost finalize response (30 s budget: the proxy timeout). */
export const FINALIZE_POLL_ATTEMPTS = 10;
export const FINALIZE_POLL_INTERVAL_MS = 3000;

function gatewayFailure(error: unknown): boolean {
  return (
    isApiError(error) &&
    (error.kind === "network" || error.status === 500 || error.status === 502 || error.status === 504)
  );
}

function outcomeOf(objectId: string, object: StoredObjectDto): FileAttachmentAnswer {
  if (object.status === "CLEAN" || object.status === "ATTACHED") return attachmentOf(object);
  const code = object.status === "REJECTED" ? STORAGE_OBJECT_REJECTED_CODE : "STORAGE_OBJECT_NOT_CLEAN";
  throw new FileUploadError(
    new ApiError({ kind: "http", status: 200, code, message: `Finalized object is ${object.status}` }),
    "scanning",
    objectId,
  );
}

/**
 * Finalize (or finalize again after a scanner outage) and turn the result
 * into the answer. Finalize is never aborted half-way: the server finishes
 * its scan either way, so a cancelled upload is deleted only after it.
 * A gateway error or a lost response polls the status instead of failing
 * the upload: the scan may well have completed behind a proxy timeout.
 */
export async function finalizeToAttachment(
  attemptId: string,
  objectId: string,
  deps: Pick<UploadDeps, "finalize" | "status" | "sleep"> = DEFAULT_DEPS,
): Promise<FileAttachmentAnswer> {
  let lastError: unknown;
  try {
    return outcomeOf(objectId, await deps.finalize(attemptId, objectId));
  } catch (error) {
    if (error instanceof FileUploadError) throw error;
    if (!gatewayFailure(error)) throw new FileUploadError(error, "scanning", objectId);
    lastError = error;
  }
  let refinalized = false;
  for (let poll = 0; poll < FINALIZE_POLL_ATTEMPTS; poll += 1) {
    await deps.sleep(FINALIZE_POLL_INTERVAL_MS);
    let object: StoredObjectDto;
    try {
      object = await deps.status(attemptId, objectId);
    } catch (error) {
      lastError = error;
      continue;
    }
    if (object.status === "QUARANTINED" && object.scanStatus === "OUTAGE") {
      throw new FileUploadError(
        new ApiError({ kind: "http", status: 503, code: "STORAGE_SCANNER_OUTAGE", message: "Scanner outage" }),
        "scanning",
        objectId,
      );
    }
    if (object.status === "INITIATED" && !refinalized) {
      // The finalize never reached the server (or failed before its claim): once more.
      refinalized = true;
      try {
        return outcomeOf(objectId, await deps.finalize(attemptId, objectId));
      } catch (error) {
        if (error instanceof FileUploadError) throw error;
        if (!gatewayFailure(error)) throw new FileUploadError(error, "scanning", objectId);
        lastError = error;
        continue;
      }
    }
    if (object.status === "INITIATED" || object.status === "QUARANTINED" || object.status === "UPLOADED") continue;
    return outcomeOf(objectId, object);
  }
  throw new FileUploadError(
    isApiError(lastError) && lastError.kind === "network"
      ? lastError
      : new ApiError({ kind: "http", status: 504, code: STORAGE_SCAN_PENDING_CODE, message: "Scan still pending" }),
    "scanning",
    objectId,
  );
}

/** initiate → PUT straight to storage → finalize, for one file of one question. */
export async function uploadQuestionFile(
  input: {
    attemptId: string;
    block: Pick<FileUploadBlock, "id">;
    file: File;
    onProgress?: (progress: UploadProgress) => void;
    signal?: AbortSignal;
  },
  deps: UploadDeps = DEFAULT_DEPS,
): Promise<FileAttachmentAnswer> {
  const { attemptId, block, file, onProgress, signal } = input;
  const mimeType = uploadMimeType(file);
  onProgress?.({ stage: "initiating", percent: 2 });
  let initiated: InitiateUploadResponse;
  try {
    if (signal?.aborted) throw abortError();
    initiated = await deps.initiate(
      {
        fileName: file.name,
        fileSize: file.size,
        mimeType,
        ownerContext: "participation",
        ownerRecordId: attemptId,
        questionId: block.id,
      },
      signal,
    );
  } catch (cause) {
    throw new FileUploadError(cause, "initiating", null);
  }

  const objectId = initiated.objectId;
  onProgress?.({ stage: "uploading", percent: 5, objectId });
  try {
    await deps.put(
      initiated.uploadUrl,
      file,
      initiated.headers ?? { "Content-Type": mimeType },
      (loaded, total) =>
        onProgress?.({ stage: "uploading", percent: 5 + Math.round((loaded / Math.max(1, total)) * 85), objectId }),
      signal,
    );
    if (signal?.aborted) throw abortError();
  } catch (cause) {
    throw new FileUploadError(cause, "uploading", objectId);
  }

  onProgress?.({ stage: "scanning", percent: 92, objectId });
  const answer = await finalizeToAttachment(attemptId, objectId, deps);
  // Cancelled while scanning: the caller deletes the finalized object.
  if (signal?.aborted) throw new FileUploadError(abortError(), "scanning", objectId);
  return answer;
}
