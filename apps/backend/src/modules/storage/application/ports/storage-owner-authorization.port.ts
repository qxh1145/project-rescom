import { InitiateUploadInput } from '@rescom/schemas';

export const STORAGE_OWNER_AUTHORIZATION_PORT = Symbol(
  'STORAGE_OWNER_AUTHORIZATION_PORT',
);

export interface FileUploadPolicy {
  maxFileSizeBytes: number;
  allowedMimeTypes: string[];
  maxFiles: number;
}

/**
 * `write` (initiate, finalize, attach, delete) requires a live, unexpired
 * owner record; `read` (status, download URL) also admits a completed one.
 */
export type StorageAccess = 'read' | 'write';

export interface StorageOwnerAuthorizationPort {
  authorize(
    ownerContext: string,
    ownerRecordId: string,
    callerUserId: string | null,
    ownerCapability: string | null | undefined,
    access: StorageAccess,
  ): Promise<void>;

  resolveUploadPolicy(
    input: InitiateUploadInput,
    callerUserId: string | null,
    ownerCapability?: string | null,
  ): Promise<FileUploadPolicy>;
}
