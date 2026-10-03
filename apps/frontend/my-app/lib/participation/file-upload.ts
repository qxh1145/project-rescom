import {
  DISALLOWED_MIME_TYPES,
  STORAGE_QUESTION_FULL_CODE,
  fileAttachmentAnswerSchema,
  uncleanAttachmentDetailsSchema,
  uploadFileNameProblem,
  type FileAttachmentAnswer,
  type FileUploadBlock,
  type UncleanAttachmentDetails,
} from "@rescom/schemas";
import { isApiError } from "../api/api-error.ts";

/**
 * Pure rules of a `file_upload` question in the in-Rescom runner (mock-off
 * Phase 7). The backend decides (`storage.service.ts` initiate/finalize and
 * the submit-time attach in `prisma-participation.repository.ts`); these
 * rules only give early Vietnamese feedback with the same limits:
 *
 * - name: `uploadFileNameProblem` (shared: no path, ≤ 255 chars, no
 *   dangerous extension such as `.exe`, `.html`, `.svg`);
 * - size: 1 byte … min(`maxFileSizeMb`, 50) MB (`resolveUploadPolicy`);
 * - type: one of the question's `allowedMimeTypes` (`type/*` wildcards), never
 *   a `DISALLOWED_MIME_TYPES` entry;
 * - count: at most `maxFiles` live files per question (answered, uploading,
 *   being deleted, or failed but still holding a server object);
 * - answer: a list of CLEAN `FileAttachmentAnswer` (only a finalized, scanned
 *   upload can be attached; the submit rolls back otherwise).
 */

/** Hard cap of any upload (`GLOBAL_MAX_FILE_SIZE`, `initiateUploadInputSchema`). */
export const FILE_UPLOAD_HARD_LIMIT_MB = 50;
const MB = 1024 * 1024;
/** Finalize retries after a scanner outage before the runner stops offering them. */
export const MAX_OUTAGE_RETRIES = 3;

export interface LocalFileInfo {
  name: string;
  size: number;
  type: string;
}

/** The byte limit the backend applies to this question. */
export function maxFileBytes(block: Pick<FileUploadBlock, "maxFileSizeMb">): number {
  return Math.min(block.maxFileSizeMb ?? 10, FILE_UPLOAD_HARD_LIMIT_MB) * MB;
}

/** Same matching as `StorageService.mimeMatches` (exact, or `image/*`). */
export function mimeAllowed(mimeType: string, allowed: readonly string[]): boolean {
  const actual = mimeType.toLowerCase().trim();
  if (allowed.length === 0) return true;
  return allowed.some((entry) => {
    const normalized = entry.toLowerCase().trim();
    return normalized.endsWith("/*") ? actual.startsWith(normalized.slice(0, -1)) : actual === normalized;
  });
}

/** MIME type sent to the backend: the browser's, or a generic binary type when it has none. */
export function uploadMimeType(file: Pick<LocalFileInfo, "type">): string {
  return file.type.trim() || "application/octet-stream";
}

/** "2,5 MB", "820 KB", "12 B" (Vietnamese decimal comma). */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** index;
  const shown = index === 0 ? String(Math.round(value)) : value.toFixed(value < 10 ? 1 : 0).replace(".", ",");
  return `${shown.replace(/,0$/, "")} ${units[index]}`;
}

/** Human list of the accepted types: "PDF, PNG, ảnh". */
export function allowedTypesLabel(allowed: readonly string[]): string {
  const label = (mime: string) => {
    const normalized = mime.toLowerCase().trim();
    if (normalized === "image/*") return "ảnh";
    if (normalized === "video/*") return "video";
    if (normalized === "audio/*") return "âm thanh";
    const subtype = normalized.split("/")[1] ?? normalized;
    return subtype.replace(/^vnd\.openxmlformats-officedocument\.[a-z]+ml\./, "").replace(/^x-/, "").toUpperCase();
  };
  return [...new Set(allowed.map(label))].join(", ");
}

/** "Câu này chỉ nhận tối đa 2 tệp…" — also the 409 `STORAGE_QUESTION_FULL` copy. */
export function questionFullMessage(maxFiles: number): string {
  return `Câu này chỉ nhận tối đa ${maxFiles} tệp. Hãy xoá bớt một tệp (hoặc bỏ tệp tải lỗi) rồi chọn lại.`;
}

/**
 * Vietnamese reason a chosen file cannot be uploaded to this question, or
 * null. `liveFiles` = files that still count toward `maxFiles` (see above).
 */
export function checkFileForQuestion(
  block: Pick<FileUploadBlock, "maxFileSizeMb" | "allowedMimeTypes" | "maxFiles">,
  file: LocalFileInfo,
  liveFiles: number,
): string | null {
  if (liveFiles >= block.maxFiles) return questionFullMessage(block.maxFiles);
  switch (uploadFileNameProblem(file.name)) {
    case "EMPTY":
    case "PATH":
      return `Tên tệp “${file.name}” không hợp lệ. Hãy đổi tên tệp rồi chọn lại.`;
    case "TOO_LONG":
      return "Tên tệp quá dài (tối đa 255 ký tự). Hãy đổi tên tệp rồi chọn lại.";
    case "DANGEROUS_EXTENSION":
      return `Không nhận tệp “${file.name}” vì có thể chứa mã chạy được. Hãy chọn tệp khác.`;
    default:
      break;
  }
  if (!Number.isInteger(file.size) || file.size <= 0) {
    return `Tệp “${file.name}” trống. Hãy chọn tệp khác.`;
  }
  const limit = maxFileBytes(block);
  if (file.size > limit) {
    return `Tệp “${file.name}” (${formatFileSize(file.size)}) vượt quá giới hạn ${formatFileSize(limit)}.`;
  }
  const mime = uploadMimeType(file).toLowerCase();
  if (DISALLOWED_MIME_TYPES.includes(mime) || !mimeAllowed(mime, block.allowedMimeTypes ?? [])) {
    return `Định dạng của “${file.name}” không được nhận. Câu này nhận: ${allowedTypesLabel(block.allowedMimeTypes ?? [])}.`;
  }
  return null;
}

/** True for a well-formed list of CLEAN attachments (the only uploadable answer). */
export function isFileAttachmentList(value: unknown): value is FileAttachmentAnswer[] {
  return Array.isArray(value) && value.every((file) => fileAttachmentAnswerSchema.safeParse(file).success);
}

/** The attachment answer the submit sends for a finalized object. */
export function attachmentOf(object: {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
}): FileAttachmentAnswer {
  return {
    objectId: object.id,
    fileName: object.fileName,
    fileSize: object.fileSize,
    mimeType: object.mimeType,
    status: "CLEAN",
  };
}

/** Client-side codes: the browser PUT to the presigned URL failed / finalize returned REJECTED. */
export const STORAGE_PUT_FAILED_CODE = "STORAGE_PUT_FAILED";
export const STORAGE_OBJECT_REJECTED_CODE = "STORAGE_OBJECT_REJECTED";
/** 503 from finalize (IR.5 C2): object storage is unreachable before the scan starts; the object stays INITIATED, finalize again. */
export const STORAGE_UNAVAILABLE_CODE = "STORAGE_UNAVAILABLE";
/** Client-side code: finalize did not answer in time and the status still reads "scanning". */
export const STORAGE_SCAN_PENDING_CODE = "STORAGE_SCAN_PENDING";

export const UPLOAD_MESSAGES = {
  network: "Mất kết nối khi tải tệp. Kiểm tra mạng rồi thử lại.",
  storageFailed: "Không tải được tệp lên kho lưu trữ. Vui lòng thử lại.",
  invalidFile: "Tệp không được chấp nhận (sai định dạng, quá dung lượng hoặc nội dung không khớp). Hãy chọn tệp khác.",
  scannerOutage: "Hệ thống quét virus đang tạm gián đoạn. Tệp đã được giữ lại an toàn — hãy thử lại sau ít phút.",
  storageUnavailable: "Kho lưu trữ tệp đang tạm gián đoạn. Hãy thử lại sau ít phút, tệp của bạn chưa bị mất.",
  storageDown: "Kho lưu trữ tệp vẫn chưa hoạt động lại. Hãy thử lại sau hoặc nộp bài mà không đính kèm nếu câu này không bắt buộc.",
  scannerDown:
    "Hệ thống quét virus vẫn chưa hoạt động lại. Hãy bỏ tệp này và nộp bài sau, hoặc báo người đăng khảo sát nếu câu này bắt buộc.",
  rejected: "Tệp bị từ chối vì không vượt qua kiểm tra an toàn. Hãy chọn tệp khác.",
  notAllowed: "Lượt làm đã hết hạn hoặc không còn quyền tải tệp. Hãy mở lại khảo sát.",
  notReady: "Tệp chưa được xác minh xong. Vui lòng thử lại.",
  stillScanning: "Máy chủ vẫn đang quét tệp. Bấm “Thử lại” sau ít giây để xem kết quả.",
  deleteFailed: "Chưa xoá được tệp trên máy chủ. Vui lòng thử lại.",
  generic: "Không tải được tệp. Vui lòng thử lại.",
} as const;

/** Vietnamese copy for a failed initiate / PUT / finalize (codes: `storage.exceptions.ts`). */
export function uploadErrorMessage(error: unknown): string {
  if (!isApiError(error)) return UPLOAD_MESSAGES.generic;
  if (error.kind === "network") return UPLOAD_MESSAGES.network;
  if (error.status === 429) {
    return error.retryAfterSeconds
      ? `Bạn thao tác quá nhanh. Vui lòng thử lại sau ${error.retryAfterSeconds} giây.`
      : "Bạn thao tác quá nhanh. Vui lòng thử lại sau ít phút.";
  }
  switch (error.code) {
    case STORAGE_QUESTION_FULL_CODE: {
      const max = (error.details as { maxFiles?: unknown } | null | undefined)?.maxFiles;
      return questionFullMessage(typeof max === "number" ? max : 1);
    }
    case "STORAGE_INVALID_FILE":
    case "VALIDATION_ERROR":
      return UPLOAD_MESSAGES.invalidFile;
    case "STORAGE_SCANNER_OUTAGE":
      return UPLOAD_MESSAGES.scannerOutage;
    case STORAGE_UNAVAILABLE_CODE:
      return UPLOAD_MESSAGES.storageUnavailable;
    case "STORAGE_UNAUTHORIZED":
    case "STORAGE_OBJECT_NOT_FOUND":
      return UPLOAD_MESSAGES.notAllowed;
    case "STORAGE_OBJECT_NOT_CLEAN":
      return UPLOAD_MESSAGES.notReady;
    case STORAGE_PUT_FAILED_CODE:
      return UPLOAD_MESSAGES.storageFailed;
    case STORAGE_OBJECT_REJECTED_CODE:
      return UPLOAD_MESSAGES.rejected;
    case STORAGE_SCAN_PENDING_CODE:
      return UPLOAD_MESSAGES.stillScanning;
    default:
      return UPLOAD_MESSAGES.generic;
  }
}

/** Copy once `MAX_OUTAGE_RETRIES` finalize retries hit a scanner or storage outage. */
export function outageExhaustedMessage(error: unknown): string {
  return isApiError(error) && error.code === STORAGE_UNAVAILABLE_CODE ? UPLOAD_MESSAGES.storageDown : UPLOAD_MESSAGES.scannerDown;
}

/**
 * Failures after which only finalize is retried (the bytes are already in
 * storage): a scanner or storage outage (503), a proxy/gateway error or timeout
 * (500/502/504) or a lost response, and a scan still running.
 */
export function isRetryableFinalize(error: unknown): boolean {
  if (!isApiError(error)) return false;
  if (error.kind === "network") return true;
  if (error.code === "STORAGE_SCANNER_OUTAGE" || error.code === STORAGE_UNAVAILABLE_CODE || error.code === STORAGE_SCAN_PENDING_CODE) return true;
  return error.status === 500 || error.status === 502 || error.status === 503 || error.status === 504;
}

/** A scanner or storage outage (503): counted against `MAX_OUTAGE_RETRIES`. */
export function isScannerOutage(error: unknown): boolean {
  return isApiError(error) && (error.code === "STORAGE_SCANNER_OUTAGE" || error.code === STORAGE_UNAVAILABLE_CODE || error.status === 503);
}

export function isQuestionFullError(error: unknown): boolean {
  return isApiError(error) && error.code === STORAGE_QUESTION_FULL_CODE;
}

/** The files a 400 `UNCLEAN_ATTACHMENT` names (empty for other errors). */
export function uncleanAttachmentFiles(error: unknown): UncleanAttachmentDetails["files"] {
  if (!isApiError(error) || error.code !== "UNCLEAN_ATTACHMENT") return [];
  const parsed = uncleanAttachmentDetailsSchema.safeParse(error.details);
  return parsed.success ? parsed.data.files : [];
}
