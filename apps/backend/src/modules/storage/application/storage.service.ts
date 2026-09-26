import * as crypto from 'crypto';
import {
  DISALLOWED_MIME_TYPES,
  GetDownloadUrlResponse,
  InitiateUploadInput,
  InitiateUploadResponse,
  StoredObjectDto,
} from '@rescom/schemas';
import { EnvService } from '../../../common/config/env.service';
import { StoredObjectEntity } from '../domain/stored-object.entity';
import {
  StorageInvalidFileException,
  StorageObjectNotCleanException,
  StorageObjectNotFoundException,
  StorageScannerOutageException,
} from './exceptions/storage.exceptions';
import { MalwareScannerPort } from './ports/malware-scanner.port';
import { ObjectStoragePort } from './ports/object-storage.port';
import {
  StorageAccess,
  StorageOwnerAuthorizationPort,
} from './ports/storage-owner-authorization.port';
import { StorageRepositoryPort } from './ports/storage-repository.port';

const GLOBAL_MAX_FILE_SIZE = 50 * 1024 * 1024;
const UPLOAD_URL_TTL_SECONDS = 15 * 60;
const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;
const STORAGE_CLEANUP_BATCH_SIZE = 200;
const MAX_DELETE_ATTEMPTS = 3;
const SNIFF_WINDOW_BYTES = 512;
const DANGEROUS_EXTENSIONS = new Set([
  '.exe',
  '.dll',
  '.msi',
  '.msc',
  '.com',
  '.scr',
  '.bat',
  '.cmd',
  '.ps1',
  '.lnk',
  '.hta',
  '.jar',
  '.sh',
  '.csh',
  '.vbs',
  '.vbe',
  '.js',
  '.jse',
  '.mjs',
  '.wsf',
  '.php',
  '.phtml',
  '.html',
  '.htm',
  '.xhtml',
  '.shtml',
  '.svg',
  '.svgz',
]);
const ASCII_WHITESPACE = new Set([0x09, 0x0a, 0x0c, 0x0d, 0x20]);
/** Leading markup a browser would render or execute (checked lower-cased). */
const ACTIVE_CONTENT_PREFIXES = [
  '<!doctype html',
  '<html',
  '<script',
  '<svg',
  '<?php',
];

export interface StorageCleanupResult {
  /** Objects claimed as EXPIRED whose bytes were removed. */
  expired: number;
  /** Objects that could not be claimed or purged; the batch continued. */
  failures: { objectId: string; reason: string }[];
}

export class StorageService {
  constructor(
    private readonly storageRepository: StorageRepositoryPort,
    private readonly objectStorage: ObjectStoragePort,
    private readonly malwareScanner: MalwareScannerPort,
    private readonly ownerAuthorization?: StorageOwnerAuthorizationPort,
    private readonly envService?: EnvService,
  ) {}

  async initiateUpload(
    input: InitiateUploadInput,
    callerUserId: string | null = null,
    ownerCapability?: string | null,
  ): Promise<InitiateUploadResponse> {
    const sanitizedFileName = input.fileName
      .replace(/[\/\\]/g, '')
      .replace(/^\.+/, '')
      .trim();
    if (!sanitizedFileName) {
      throw new StorageInvalidFileException('Invalid or empty file name.');
    }
    this.assertSafeExtension(sanitizedFileName);

    const normalizedMime = input.mimeType.toLowerCase().trim();
    if (DISALLOWED_MIME_TYPES.includes(normalizedMime)) {
      throw new StorageInvalidFileException(
        `MIME type "${normalizedMime}" is prohibited for security reasons.`,
      );
    }

    const policy = this.ownerAuthorization
      ? await this.ownerAuthorization.resolveUploadPolicy(
          input,
          callerUserId,
          ownerCapability,
        )
      : {
          maxFileSizeBytes: 10 * 1024 * 1024,
          allowedMimeTypes: [] as string[],
          maxFiles: 1,
        };
    const effectiveMax = Math.min(
      policy.maxFileSizeBytes,
      GLOBAL_MAX_FILE_SIZE,
    );
    if (input.fileSize <= 0 || input.fileSize > effectiveMax) {
      throw new StorageInvalidFileException(
        `File size must be between 1 byte and ${Math.floor(effectiveMax / (1024 * 1024))}MB.`,
      );
    }
    if (
      policy.allowedMimeTypes.length > 0 &&
      !policy.allowedMimeTypes.some((allowed) =>
        this.mimeMatches(normalizedMime, allowed),
      )
    ) {
      throw new StorageInvalidFileException(
        `MIME type "${normalizedMime}" is not allowed for this question.`,
      );
    }

    const existing = await this.storageRepository.findByOwner(
      input.ownerContext,
      input.ownerRecordId,
    );
    const activeForQuestion = existing.filter(
      (object) =>
        object.questionId === (input.questionId ?? null) &&
        !['REJECTED', 'EXPIRED', 'DELETED'].includes(object.status),
    ).length;
    if (activeForQuestion >= policy.maxFiles) {
      throw new StorageInvalidFileException(
        `This question allows at most ${policy.maxFiles} uploaded file(s).`,
      );
    }

    const objectId = crypto.randomUUID();
    const storageKey = this.uploadKeyFor({
      id: objectId,
      ownerContext: input.ownerContext,
      ownerRecordId: input.ownerRecordId,
      fileName: sanitizedFileName,
    });
    const expiresAt = new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000);
    const bucket = this.envService?.storageBucket ?? 'rescom-private-storage';
    const { uploadUrl, headers } = await this.objectStorage.generateUploadUrl(
      bucket,
      storageKey,
      normalizedMime,
      UPLOAD_URL_TTL_SECONDS,
    );

    await this.storageRepository.save(
      new StoredObjectEntity(
        objectId,
        input.ownerContext,
        input.ownerRecordId,
        'SURVEY_ATTACHMENT',
        storageKey,
        bucket,
        sanitizedFileName,
        input.fileSize,
        normalizedMime,
        input.checksum ?? null,
        'INITIATED',
        'PENDING',
        null,
        null,
        null,
        null,
        null,
        expiresAt,
        new Date(),
        new Date(),
        input.questionId ?? null,
      ),
    );

    return {
      objectId,
      uploadUrl,
      storageKey,
      expiresAt: expiresAt.toISOString(),
      headers,
    };
  }

  /**
   * Verifies and scans a direct upload (AD-22, Epic 5 review P10/P18).
   *
   * The presigned PUT stays usable until it expires, so the upload key is
   * never trusted after inspection: finalization claims the object (CAS
   * INITIATED -> QUARANTINED, recording a server-owned `verified/` key), then
   * copies the upload key there only if its ETag still matches the inspected
   * one. Signature, checksum and malware scan run on the verified copy, and
   * downloads only ever use it — no presigned URL can write that key.
   */
  async finalizeUpload(
    objectId: string,
    callerUserId: string | null = null,
    checksum?: string,
    ownerCapability?: string | null,
  ): Promise<StoredObjectDto> {
    const current = await this.requireAuthorizedObject(
      objectId,
      callerUserId,
      ownerCapability,
      'write',
    );
    if (current.status === 'CLEAN' || current.status === 'REJECTED') {
      return this.toDto(current);
    }
    if (current.status !== 'INITIATED') {
      throw new StorageInvalidFileException(
        current.status === 'QUARANTINED' || current.status === 'UPLOADED'
          ? 'Upload is already being finalized.'
          : `Object cannot be finalized from status ${current.status}.`,
      );
    }
    if (current.expiresAt && current.expiresAt.getTime() < Date.now()) {
      current.markExpired();
      if (
        await this.storageRepository.transition(objectId, 'INITIATED', current)
      ) {
        await this.purgeBytesQuietly(current);
      }
      throw new StorageInvalidFileException('The upload session has expired.');
    }

    // Pre-claim checks leave the object INITIATED so the client can re-PUT.
    const uploadKey = current.storageKey;
    const metadata = await this.objectStorage.getObjectMetadata(
      current.bucket,
      uploadKey,
    );
    if (!metadata) {
      throw new StorageInvalidFileException(
        'Uploaded object was not found in private storage.',
      );
    }
    if (metadata.contentLength !== current.fileSize) {
      throw new StorageInvalidFileException(
        `Uploaded size ${metadata.contentLength} does not match declared size ${current.fileSize}.`,
      );
    }
    if (
      metadata.contentType &&
      metadata.contentType.toLowerCase() !== current.mimeType.toLowerCase()
    ) {
      throw new StorageInvalidFileException(
        'Uploaded content type does not match the initiated upload.',
      );
    }
    const inspectedEtag = metadata.etag;
    if (!inspectedEtag) {
      throw new StorageInvalidFileException(
        'Uploaded object has no entity tag and cannot be verified.',
      );
    }

    const object = current;
    object.markQuarantined(this.verifiedKeyFor(object));
    if (
      !(await this.storageRepository.transition(objectId, 'INITIATED', object))
    ) {
      const latest = await this.storageRepository.findById(objectId);
      if (latest && ['CLEAN', 'REJECTED'].includes(latest.status)) {
        return this.toDto(latest);
      }
      throw new StorageInvalidFileException(
        'Upload is already being finalized or is no longer eligible.',
      );
    }

    try {
      return await this.verifyAndScanClaimed(
        object,
        uploadKey,
        inspectedEtag,
        metadata.checksumSha256,
        checksum,
      );
    } catch (error) {
      if (
        error instanceof StorageInvalidFileException ||
        error instanceof StorageScannerOutageException
      ) {
        throw error;
      }
      // Copy, read or scanner failure after the claim: fail closed (AD-22).
      object.markScanOutage(
        'scanner-error',
        error instanceof Error ? error.message : 'Malware scanner failed',
      );
      if (
        !(await this.storageRepository.transition(
          objectId,
          'QUARANTINED',
          object,
        ))
      ) {
        return this.latestAfterLostRace(objectId);
      }
      throw new StorageScannerOutageException();
    }
  }

  async getDownloadUrl(
    objectId: string,
    callerUserId: string | null = null,
    ownerCapability?: string | null,
  ): Promise<GetDownloadUrlResponse> {
    const object = await this.requireAuthorizedObject(
      objectId,
      callerUserId,
      ownerCapability,
      'read',
    );
    if (!object.isDownloadable()) {
      throw new StorageObjectNotCleanException();
    }
    return {
      objectId: object.id,
      downloadUrl: await this.objectStorage.generateDownloadUrl(
        object.bucket,
        object.storageKey,
        object.fileName,
        DOWNLOAD_URL_TTL_SECONDS,
      ),
      expiresAt: new Date(
        Date.now() + DOWNLOAD_URL_TTL_SECONDS * 1000,
      ).toISOString(),
      fileName: object.fileName,
    };
  }

  async getObjectStatus(
    objectId: string,
    callerUserId: string | null = null,
    ownerCapability?: string | null,
  ): Promise<StoredObjectDto> {
    return this.toDto(
      await this.requireAuthorizedObject(
        objectId,
        callerUserId,
        ownerCapability,
        'read',
      ),
    );
  }

  async attachObject(
    objectId: string,
    callerUserId: string | null = null,
    ownerCapability?: string | null,
  ): Promise<StoredObjectDto> {
    const object = await this.requireAuthorizedObject(
      objectId,
      callerUserId,
      ownerCapability,
      'write',
    );
    if (object.status !== 'CLEAN') {
      throw new StorageObjectNotCleanException();
    }
    object.markAttached();
    if (!(await this.storageRepository.transition(objectId, 'CLEAN', object))) {
      const latest = await this.storageRepository.findById(objectId);
      if (latest?.status === 'ATTACHED') return this.toDto(latest);
      throw new StorageObjectNotCleanException();
    }
    return this.toDto(object);
  }

  /**
   * Deletes an unattached object. The DELETED status is claimed with a
   * compare-and-set before any bytes are removed, so an object that became
   * ATTACHED concurrently is refused and a scan finishing afterwards cannot
   * resurrect it (Epic 5 review P18). Repeating the call re-purges the bytes.
   */
  async deleteObject(
    objectId: string,
    callerUserId: string | null = null,
    ownerCapability?: string | null,
  ): Promise<void> {
    let object = await this.requireAuthorizedObject(
      objectId,
      callerUserId,
      ownerCapability,
      'write',
    );
    for (let attempt = 1; ; attempt += 1) {
      if (object.status === 'ATTACHED') {
        throw new StorageInvalidFileException(
          'Attached objects cannot be deleted.',
        );
      }
      if (object.status === 'DELETED') break;
      const expectedStatus = object.status;
      object.markDeleted();
      if (
        await this.storageRepository.transition(
          objectId,
          expectedStatus,
          object,
        )
      ) {
        break;
      }
      if (attempt >= MAX_DELETE_ATTEMPTS) {
        throw new StorageInvalidFileException(
          'The object changed concurrently; retry the deletion.',
        );
      }
      const latest = await this.storageRepository.findById(objectId);
      if (!latest) throw new StorageObjectNotFoundException();
      object = latest;
    }
    await this.purgeBytes(object);
  }

  /**
   * Expires one bounded batch of lapsed, unattached objects (Epic 5 review
   * P11). Each object is claimed as EXPIRED (compare-and-set) before its
   * bytes are removed, and a failure is recorded without aborting the batch.
   * A byte deletion that fails after the claim leaves orphaned bytes: the row
   * is already EXPIRED and is not selected again, so the caller must log the
   * failure (a bucket lifecycle rule is the backstop).
   */
  async cleanupExpired(
    now = new Date(),
    limit = STORAGE_CLEANUP_BATCH_SIZE,
  ): Promise<StorageCleanupResult> {
    const candidates = await this.storageRepository.findExpiredUnattached(
      now,
      limit,
    );
    const result: StorageCleanupResult = { expired: 0, failures: [] };
    for (const object of candidates) {
      try {
        const expectedStatus = object.status;
        object.markExpired();
        if (
          object.status !== 'EXPIRED' ||
          !(await this.storageRepository.transition(
            object.id,
            expectedStatus,
            object,
          ))
        ) {
          continue;
        }
        await this.purgeBytes(object);
        result.expired += 1;
      } catch (error) {
        result.failures.push({
          objectId: object.id,
          reason: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
    return result;
  }

  private async verifyAndScanClaimed(
    object: StoredObjectEntity,
    uploadKey: string,
    inspectedEtag: string,
    providerChecksum: string | null,
    callerChecksum: string | undefined,
  ): Promise<StoredObjectDto> {
    const copy = await this.objectStorage.copyObject(
      object.bucket,
      uploadKey,
      object.storageKey,
      inspectedEtag,
    );
    if (copy !== 'COPIED') {
      return this.rejectClaimed(object, 'Object changed during finalization.');
    }
    await this.deleteQuietly(object.bucket, uploadKey);

    const bytes = await this.objectStorage.readObject(
      object.bucket,
      object.storageKey,
    );
    const observedChecksum = crypto
      .createHash('sha256')
      .update(bytes)
      .digest('hex');
    const problem = this.verificationProblem(
      object,
      bytes,
      observedChecksum,
      callerChecksum ?? object.checksum,
      providerChecksum,
    );
    if (problem) return this.rejectClaimed(object, problem);
    object.checksum = observedChecksum;

    const scanResult = await this.malwareScanner.scanObject(
      object.bucket,
      object.storageKey,
      object.mimeType,
      object.fileName,
    );
    if (scanResult.isOutage) {
      object.markScanOutage(
        scanResult.scanPolicy,
        scanResult.reason || 'Malware scanner unavailable',
      );
      if (
        !(await this.storageRepository.transition(
          object.id,
          'QUARANTINED',
          object,
        ))
      ) {
        return this.latestAfterLostRace(object.id);
      }
      throw new StorageScannerOutageException(scanResult.reason);
    }
    if (scanResult.isClean) {
      object.markClean(scanResult.scanPolicy, { verifiedClean: true });
    } else {
      object.markInfected(
        scanResult.scanPolicy,
        scanResult.reason || 'Malicious content detected',
      );
    }
    if (
      !(await this.storageRepository.transition(
        object.id,
        'QUARANTINED',
        object,
      ))
    ) {
      return this.latestAfterLostRace(object.id);
    }
    return this.toDto(object);
  }

  /** Rejects a claimed object whose verified bytes failed a check (400). */
  private async rejectClaimed(
    object: StoredObjectEntity,
    reason: string,
  ): Promise<StoredObjectDto> {
    object.markRejected(reason);
    if (
      !(await this.storageRepository.transition(
        object.id,
        'QUARANTINED',
        object,
      ))
    ) {
      return this.latestAfterLostRace(object.id);
    }
    throw new StorageInvalidFileException(reason);
  }

  /**
   * A concurrent delete or cleanup won the compare-and-set: its outcome
   * stands. It may have purged before our verified copy landed, so purge
   * again for terminal states.
   */
  private async latestAfterLostRace(
    objectId: string,
  ): Promise<StoredObjectDto> {
    const latest = await this.storageRepository.findById(objectId);
    if (!latest) throw new StorageObjectNotFoundException();
    if (latest.status === 'DELETED' || latest.status === 'EXPIRED') {
      await this.purgeBytesQuietly(latest);
    }
    return this.toDto(latest);
  }

  private verificationProblem(
    object: StoredObjectEntity,
    bytes: Uint8Array,
    observedChecksum: string,
    expectedChecksum: string | null,
    providerChecksum: string | null,
  ): string | null {
    if (bytes.byteLength !== object.fileSize) {
      return `Uploaded size ${bytes.byteLength} does not match declared size ${object.fileSize}.`;
    }
    const signatureProblem = this.contentSignatureProblem(
      object.mimeType,
      bytes,
    );
    if (signatureProblem) return signatureProblem;
    if (
      expectedChecksum &&
      observedChecksum.toLowerCase() !== expectedChecksum.toLowerCase()
    ) {
      return 'Uploaded checksum does not match.';
    }
    if (
      providerChecksum &&
      providerChecksum.toLowerCase() !== observedChecksum.toLowerCase()
    ) {
      return 'Storage-provider checksum does not match uploaded content.';
    }
    return null;
  }

  private async requireAuthorizedObject(
    objectId: string,
    callerUserId: string | null,
    ownerCapability: string | null | undefined,
    access: StorageAccess,
  ): Promise<StoredObjectEntity> {
    const object = await this.storageRepository.findById(objectId);
    if (!object) throw new StorageObjectNotFoundException();
    if (this.ownerAuthorization) {
      await this.ownerAuthorization.authorize(
        object.ownerContext,
        object.ownerRecordId,
        callerUserId,
        ownerCapability,
        access,
      );
    }
    return object;
  }

  /** Client-writable key the presigned PUT targets. */
  private uploadKeyFor(object: {
    id: string;
    ownerContext: string;
    ownerRecordId: string;
    fileName: string;
  }): string {
    return `${object.ownerContext}/${object.ownerRecordId}/${object.id}-${object.fileName}`;
  }

  /** Server-owned key no presigned URL is ever issued for (P10). */
  private verifiedKeyFor(object: {
    id: string;
    ownerContext: string;
    ownerRecordId: string;
  }): string {
    return `verified/${object.ownerContext}/${object.ownerRecordId}/${object.id}`;
  }

  /** Removes every key the object's bytes may live under (idempotent). */
  private async purgeBytes(object: StoredObjectEntity): Promise<void> {
    const keys = new Set([
      object.storageKey,
      this.uploadKeyFor(object),
      this.verifiedKeyFor(object),
    ]);
    for (const key of keys) {
      await this.objectStorage.deleteObject(object.bucket, key);
    }
  }

  private async purgeBytesQuietly(object: StoredObjectEntity): Promise<void> {
    try {
      await this.purgeBytes(object);
    } catch {
      // Best effort: the state transition already happened and is what counts.
    }
  }

  private async deleteQuietly(bucket: string, key: string): Promise<void> {
    try {
      await this.objectStorage.deleteObject(bucket, key);
    } catch {
      // Best effort: the upload key is never read or served after the copy.
    }
  }

  private mimeMatches(actual: string, allowed: string): boolean {
    const normalized = allowed.toLowerCase().trim();
    return normalized.endsWith('/*')
      ? actual.startsWith(normalized.slice(0, -1))
      : actual === normalized;
  }

  private assertSafeExtension(fileName: string): void {
    // Windows drops trailing dots and spaces, so `evil.exe.` runs as `.exe`.
    const normalized = fileName.toLowerCase().replace(/[.\s]+$/, '');
    for (const extension of DANGEROUS_EXTENSIONS) {
      if (normalized.endsWith(extension)) {
        throw new StorageInvalidFileException(
          `Files ending in ${extension} are prohibited.`,
        );
      }
    }
  }

  private contentSignatureProblem(
    mimeType: string,
    bytes: Uint8Array,
  ): string | null {
    const startsWith = (...signature: number[]) =>
      signature.every((byte, index) => bytes[index] === byte);
    const valid =
      mimeType === 'application/pdf'
        ? startsWith(0x25, 0x50, 0x44, 0x46)
        : mimeType === 'image/png'
          ? startsWith(0x89, 0x50, 0x4e, 0x47)
          : mimeType === 'image/jpeg'
            ? startsWith(0xff, 0xd8, 0xff)
            : true;
    if (!valid) {
      return 'Uploaded bytes do not match the declared MIME signature.';
    }
    if (
      startsWith(0x4d, 0x5a) ||
      startsWith(0x23, 0x21) ||
      this.startsWithActiveMarkup(bytes)
    ) {
      return 'Executable or active content is prohibited.';
    }
    return null;
  }

  /**
   * Sniffs the first 512 bytes after a UTF-8 BOM and leading whitespace, the
   * way a browser would, for markup it could render or execute (P17).
   */
  private startsWithActiveMarkup(bytes: Uint8Array): boolean {
    let start =
      bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
    while (start < bytes.length && ASCII_WHITESPACE.has(bytes[start])) {
      start += 1;
    }
    const head = Buffer.from(bytes.subarray(start, start + SNIFF_WINDOW_BYTES))
      .toString('latin1')
      .toLowerCase();
    return (
      ACTIVE_CONTENT_PREFIXES.some((prefix) => head.startsWith(prefix)) ||
      (head.startsWith('<?xml') && head.includes('<svg'))
    );
  }

  private toDto(entity: StoredObjectEntity): StoredObjectDto {
    return {
      id: entity.id,
      ownerContext: entity.ownerContext,
      ownerRecordId: entity.ownerRecordId,
      dataClass: entity.dataClass,
      storageKey: entity.storageKey,
      fileName: entity.fileName,
      fileSize: entity.fileSize,
      mimeType: entity.mimeType,
      status: entity.status,
      scanStatus: entity.scanStatus,
      checksum: entity.checksum,
      createdAt: entity.createdAt.toISOString(),
      uploadedAt: entity.uploadedAt?.toISOString() ?? null,
      scannedAt: entity.scannedAt?.toISOString() ?? null,
      attachedAt: entity.attachedAt?.toISOString() ?? null,
    };
  }
}
