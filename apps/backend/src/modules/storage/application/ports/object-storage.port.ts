export const OBJECT_STORAGE_PORT = Symbol('OBJECT_STORAGE_PORT');

export interface StoredObjectMetadata {
  contentLength: number;
  contentType: string | null;
  checksumSha256: string | null;
  /** Provider entity tag of the current bytes; changes whenever the key is re-written. */
  etag: string | null;
}

/**
 * Outcome of a conditional server-side copy (Epic 5 review P10).
 * - `COPIED`: the destination now holds exactly the bytes the ETag named.
 * - `PRECONDITION_FAILED`: the source was re-written after it was inspected.
 * - `SOURCE_NOT_FOUND`: the source key no longer exists.
 */
export type CopyObjectOutcome =
  'COPIED' | 'PRECONDITION_FAILED' | 'SOURCE_NOT_FOUND';

export interface ObjectStoragePort {
  /**
   * Generates a time-limited scoped presigned URL for direct client upload (PUT).
   */
  generateUploadUrl(
    bucket: string,
    storageKey: string,
    mimeType: string,
    expiresInSeconds: number,
  ): Promise<{ uploadUrl: string; headers?: Record<string, string> }>;

  /**
   * Generates a time-limited scoped presigned URL for file downloading (GET).
   */
  generateDownloadUrl(
    bucket: string,
    storageKey: string,
    fileName: string,
    expiresInSeconds: number,
  ): Promise<string>;

  /**
   * Verifies whether an object actually exists in the private bucket.
   */
  getObjectMetadata(
    bucket: string,
    storageKey: string,
  ): Promise<StoredObjectMetadata | null>;

  /**
   * Copies `sourceKey` to `destinationKey` inside `bucket` only if the source
   * still carries `ifMatchEtag` (S3 `x-amz-copy-source-if-match`).
   */
  copyObject(
    bucket: string,
    sourceKey: string,
    destinationKey: string,
    ifMatchEtag: string,
  ): Promise<CopyObjectOutcome>;

  /** Reads quarantined bytes for malware inspection. */
  readObject(bucket: string, storageKey: string): Promise<Uint8Array>;

  /**
   * Removes an object from the private bucket.
   */
  deleteObject(bucket: string, storageKey: string): Promise<void>;
}
