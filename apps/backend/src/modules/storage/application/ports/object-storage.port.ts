export const OBJECT_STORAGE_PORT = Symbol('OBJECT_STORAGE_PORT');

export interface StoredObjectMetadata {
  contentLength: number;
  contentType: string | null;
  checksumSha256: string | null;
}

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

  /** Reads quarantined bytes for malware inspection. */
  readObject(bucket: string, storageKey: string): Promise<Uint8Array>;

  /**
   * Removes an object from the private bucket.
   */
  deleteObject(bucket: string, storageKey: string): Promise<void>;
}
