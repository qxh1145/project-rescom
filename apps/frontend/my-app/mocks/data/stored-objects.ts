import type { StoredObjectDto } from "@rescom/schemas";
import { createCollection } from "../db/store";

/**
 * MOCK-ONLY private storage (Phase 7): one row per direct upload, keyed by
 * object id. `receivedBytes` stands in for the object the browser PUT to the
 * presigned URL (`null` until then); the bytes themselves are not kept.
 */
export interface MockStoredObject {
  id: string;
  attemptId: string;
  questionId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  status: StoredObjectDto["status"];
  scanStatus: StoredObjectDto["scanStatus"];
  receivedBytes: number | null;
  receivedType: string | null;
  createdAt: string;
  expiresAt: string;
  uploadedAt: string | null;
  scannedAt: string | null;
  attachedAt: string | null;
}

export const storedObjects = createCollection<Record<string, MockStoredObject>>("stored-objects", () => ({}));

export function findStoredObject(id: string): MockStoredObject | undefined {
  return storedObjects.get()[id];
}

export function updateStoredObject(id: string, mutate: (object: MockStoredObject) => void): void {
  storedObjects.update((all) => {
    const object = all[id];
    if (object) mutate(object);
  });
}

/** `storedObjectDtoSchema` of a row (same key layout as `StorageService`). */
export function storedObjectDtoOf(object: MockStoredObject): StoredObjectDto {
  const key =
    object.status === "CLEAN" || object.status === "ATTACHED"
      ? `verified/participation/${object.attemptId}/${object.id}`
      : `participation/${object.attemptId}/${object.id}-${object.fileName}`;
  return {
    id: object.id,
    ownerContext: "participation",
    ownerRecordId: object.attemptId,
    dataClass: "SURVEY_ATTACHMENT",
    storageKey: key,
    fileName: object.fileName,
    fileSize: object.fileSize,
    mimeType: object.mimeType,
    status: object.status,
    scanStatus: object.scanStatus,
    checksum: null,
    createdAt: object.createdAt,
    uploadedAt: object.uploadedAt,
    scannedAt: object.scannedAt,
    attachedAt: object.attachedAt,
  };
}
