import { InitiateUploadInput } from '@rescom/schemas';

export const STORAGE_OWNER_AUTHORIZATION_PORT = Symbol(
  'STORAGE_OWNER_AUTHORIZATION_PORT',
);

export interface FileUploadPolicy {
  maxFileSizeBytes: number;
  allowedMimeTypes: string[];
  maxFiles: number;
}

export interface StorageOwnerAuthorizationPort {
  authorize(
    ownerContext: string,
    ownerRecordId: string,
    callerUserId: string | null,
    ownerCapability?: string | null,
  ): Promise<void>;

  resolveUploadPolicy(
    input: InitiateUploadInput,
    callerUserId: string | null,
    ownerCapability?: string | null,
  ): Promise<FileUploadPolicy>;
}
