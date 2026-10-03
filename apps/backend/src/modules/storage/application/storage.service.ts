import * as crypto from 'crypto';
import {
  dangerousFileExtension,
  DISALLOWED_MIME_TYPES,
  ListUploadsQuery,
  GetDownloadUrlResponse,
  InitiateUploadInput,
  InitiateUploadResponse,
  StoredObjectDto,
} from '@rescom/schemas';
import { EnvService } from '../../../common/config/env.service';
import { currentRequestId } from '../../../common/http/request-context';
import { recordStorageOutage } from '../../../common/system/storage-outage-counter';
import { StoredObjectEntity } from '../domain/stored-object.entity';
import {
  StorageInvalidFileException,
  StorageObjectNotCleanException,
  StorageObjectNotFoundException,
  StorageQuestionFullException,
  StorageScannerOutageException,
  StorageUnavailableException,
} from './exceptions/storage.exceptions';
import { MalwareScannerPort } from './ports/malware-scanner.port';
import {
  ObjectPreconditionFailedError,
  ObjectStoragePort,
  StoredObjectMetadata,
} from './ports/object-storage.port';
import {
  FileUploadPolicy,
  StorageAccess,
  StorageOwnerAuthorizationPort,
} from './ports/storage-owner-authorization.port';
import {
  REJECTED_PURGE_BATCH_SIZE,
  STORAGE_CLEANUP_BATCH_SIZE,
  StorageRepositoryPort,
} from './ports/storage-repository.port';

const GLOBAL_MAX_FILE_SIZE = 50 * 1024 * 1024;
const UPLOAD_URL_TTL_SECONDS = 15 * 60;
const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;
/**
 * Grace after an upload window closes (`expiresAt`): a PUT or finalize that
 * started just before the deadline has settled by then, so only afterwards is
 * an INITIATED upload treated as dead for maxFiles, or a REJECTED upload's
 * bytes purged.
 */
const UPLOAD_GRACE_MS = 5 * 60 * 1000;
const PURGE_RETRY_BASE_MS = 60 * 60 * 1000;
const PURGE_RETRY_MAX_MS = 24 * 60 * 60 * 1000;
const MAX_DELETE_ATTEMPTS = 3;
const SNIFF_WINDOW_BYTES = 512;
/** Leading markup comments are skipped within this window before sniffing. */
const MARKUP_COMMENT_WINDOW_BYTES = 64 * 1024;
const LEADING_MARKUP_COMMENTS = /^(?:<!--[\s\S]*?-->\s*)+/;
/** Shared with the runner and the mock (`@rescom/schemas`). */
const ASCII_WHITESPACE = new Set([0x09, 0x0a, 0x0c, 0x0d, 0x20]);
/** Leading markup a browser would render or execute (checked lower-cased). */
const ACTIVE_CONTENT_PREFIXES = [
  '<!doctype html',
  '<!doctype svg',
  '<html',
  '<script',
  '<svg',
  '<?php',
];

export interface StorageCleanupResult {
  /** Objects claimed as EXPIRED whose bytes were removed. */
  expired: number;
  /** REJECTED objects whose leftover bytes were removed (they stay REJECTED). */
  purged: number;
  /** Objects that could not be expired; the batch continued. */
  failures: { objectId: string; reason: string }[];
  /** REJECTED objects whose bytes could not be purged; retried with backoff. */
  purgeFailures: { objectId: string; reason: string }[];
  /** Why the REJECTED purge batch could not be selected at all, if it failed. */
  purgeBatchFailure: string | null;
}

export interface StorageServiceLogger {
  warn(message: string): void;
  error(message: string): void;
}

export class StorageService {
  constructor(
    private readonly storageRepository: StorageRepositoryPort,
    private readonly objectStorage: ObjectStoragePort,
    private readonly malwareScanner: MalwareScannerPort,
    private readonly ownerAuthorization?: StorageOwnerAuthorizationPort,
    private readonly envService?: EnvService,
    private readonly logger?: StorageServiceLogger,
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

    const policy = await this.uploadPolicy(
      input,
      callerUserId,
      ownerCapability,
    );
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

    await this.assertQuestionHasRoom(
      input.ownerContext,
      input.ownerRecordId,
      input.questionId ?? null,
      policy,
    );

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
   * INITIATED -> QUARANTINED, or a retry after a scanner OUTAGE), reads the
   * upload key only if its ETag still matches the inspected one, and runs
   * signature, checksum and malware checks on those bytes. Only clean bytes
   * are copied — again conditional on that ETag — to a server-owned
   * `verified/` key, which downloads only ever use and no presigned URL can
   * write. On an OUTAGE the object stays at its upload key, retryable.
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
    const retryingOutage =
      current.status === 'QUARANTINED' && current.scanStatus === 'OUTAGE';
    if (current.status !== 'INITIATED' && !retryingOutage) {
      throw new StorageInvalidFileException(
        current.status === 'QUARANTINED' || current.status === 'UPLOADED'
          ? 'Upload is already being finalized.'
          : `Object cannot be finalized from status ${current.status}.`,
      );
    }
    // An upload window is closed once `expiresAt <= now`, as in the claim.
    if (current.expiresAt && current.expiresAt.getTime() <= Date.now()) {
      const expectedStatus = current.status;
      current.markExpired();
      if (
        await this.storageRepository.transition(
          objectId,
          expectedStatus,
          current,
        )
      ) {
        await this.purgeBytesQuietly(current);
      }
      throw new StorageInvalidFileException('The upload session has expired.');
    }
    if (retryingOutage) {
      // An OUTAGE object stopped counting toward maxFiles, so a replacement
      // may have filled the question since; the retry must not exceed it.
      // Refusing leaves the object QUARANTINED/OUTAGE and never downloadable:
      // the respondent can delete it, and cleanup expires it after its window.
      await this.assertQuestionHasRoom(
        current.ownerContext,
        current.ownerRecordId,
        current.questionId,
        await this.uploadPolicy(
          {
            fileName: current.fileName,
            fileSize: current.fileSize,
            mimeType: current.mimeType,
            ownerContext:
              current.ownerContext as InitiateUploadInput['ownerContext'],
            ownerRecordId: current.ownerRecordId,
            questionId: current.questionId ?? undefined,
          },
          callerUserId,
          ownerCapability,
        ),
        current.id,
      );
    }

    // Pre-claim checks leave the object unclaimed so the client can re-PUT.
    let metadata: StoredObjectMetadata | null;
    try {
      metadata = await this.objectStorage.getObjectMetadata(
        current.bucket,
        current.storageKey,
      );
    } catch (error) {
      // Storage unreachable before the claim: the row stays INITIATED, so a
      // retry after recovery is a plain finalize (IR.5 C2.1).
      this.recordOutage('storage.unavailable', current, error);
      throw new StorageUnavailableException();
    }
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
    object.markQuarantined();
    // The claim re-checks the upload window atomically: the checks above can
    // take a while, and an INITIATED row that has expired meanwhile may
    // already have stopped counting toward maxFiles.
    const claimedAt = new Date(Date.now());
    if (
      !(await this.storageRepository.claimForFinalization(
        objectId,
        object,
        claimedAt,
      ))
    ) {
      const latest = await this.storageRepository.findById(objectId);
      if (latest && ['CLEAN', 'REJECTED'].includes(latest.status)) {
        return this.toDto(latest);
      }
      if (
        latest?.status === 'INITIATED' &&
        latest.expiresAt &&
        latest.expiresAt.getTime() <= claimedAt.getTime()
      ) {
        throw new StorageInvalidFileException(
          'The upload session has expired.',
        );
      }
      throw new StorageInvalidFileException(
        'Upload is already being finalized or is no longer eligible.',
      );
    }

    try {
      return await this.verifyAndScanClaimed(
        object,
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
      // Read, scanner or copy failure after the claim: fail closed (AD-22).
      this.recordOutage('storage.scan_outage', object, error);
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

  /**
   * The live uploads of one owner record (and question): what a runner that
   * lost its local state (reload, crash) re-adopts or cleans up, so a
   * question is never left full of uploads the respondent cannot see.
   * Terminal objects (REJECTED, EXPIRED, DELETED) are left out.
   */
  async listUploads(
    query: ListUploadsQuery,
    callerUserId: string | null = null,
    ownerCapability?: string | null,
  ): Promise<StoredObjectDto[]> {
    if (this.ownerAuthorization) {
      await this.ownerAuthorization.authorize(
        query.ownerContext,
        query.ownerRecordId,
        callerUserId,
        ownerCapability,
        'read',
      );
    }
    const objects = await this.storageRepository.findByOwner(
      query.ownerContext,
      query.ownerRecordId,
    );
    return objects
      .filter(
        (object) =>
          !['REJECTED', 'EXPIRED', 'DELETED'].includes(object.status) &&
          (query.questionId === undefined ||
            object.questionId === query.questionId),
      )
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((object) => this.toDto(object));
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
   *
   * Lapsed REJECTED objects are purged in their own batch afterwards (see
   * `purgeRejected`), so neither kind of work can starve the other.
   */
  async cleanupExpired(
    now = new Date(),
    limit = STORAGE_CLEANUP_BATCH_SIZE,
    purgeLimit = REJECTED_PURGE_BATCH_SIZE,
  ): Promise<StorageCleanupResult> {
    const candidates = await this.storageRepository.findExpiredUnattached(
      now,
      limit,
    );
    const result: StorageCleanupResult = {
      expired: 0,
      purged: 0,
      failures: [],
      purgeFailures: [],
      purgeBatchFailure: null,
    };
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
    await this.purgeRejected(now, purgeLimit, result);
    return result;
  }

  /**
   * A lapsed REJECTED object stays REJECTED, but its bytes (a failed
   * immediate delete, a re-PUT before the upload URL expired, or a legacy
   * verified copy) are purged once its upload window plus a margin has
   * passed; it is then marked purged and never selected again. A failed purge
   * pushes `expiresAt` out with a growing backoff, so a persistently failing
   * row drops behind the others instead of holding the head of the batch.
   */
  private async purgeRejected(
    now: Date,
    limit: number,
    result: StorageCleanupResult,
  ): Promise<void> {
    let candidates: StoredObjectEntity[];
    try {
      candidates = await this.storageRepository.findRejectedPendingPurge(
        new Date(now.getTime() - UPLOAD_GRACE_MS),
        limit,
      );
    } catch (error) {
      // The expiry batch already ran; its results must still be reported.
      result.purgeBatchFailure =
        error instanceof Error ? error.message : 'Unknown error';
      return;
    }
    for (const object of candidates) {
      const selectedExpiresAt = object.expiresAt;
      if (!selectedExpiresAt) continue;
      // At most one failure entry per object, whichever step failed first.
      let failure: string | null = null;
      try {
        await this.purgeBytes(object);
        object.markBytesPurged();
      } catch (error) {
        failure = error instanceof Error ? error.message : 'Unknown error';
        object.markBytesPurgeFailed(
          new Date(
            now.getTime() +
              Math.min(
                PURGE_RETRY_BASE_MS * 2 ** object.purgeAttempts,
                PURGE_RETRY_MAX_MS,
              ),
          ),
        );
      }
      try {
        const recorded = await this.storageRepository.recordRejectedPurge(
          object.id,
          selectedExpiresAt,
          object,
        );
        if (recorded && failure === null) result.purged += 1;
      } catch (error) {
        failure ??= error instanceof Error ? error.message : 'Unknown error';
      }
      if (failure !== null) {
        result.purgeFailures.push({ objectId: object.id, reason: failure });
      }
    }
  }

  private async verifyAndScanClaimed(
    object: StoredObjectEntity,
    inspectedEtag: string,
    providerChecksum: string | null,
    callerChecksum: string | undefined,
  ): Promise<StoredObjectDto> {
    let bytes: Uint8Array;
    try {
      bytes = await this.objectStorage.readObject(
        object.bucket,
        object.storageKey,
        inspectedEtag,
      );
    } catch (error) {
      if (error instanceof ObjectPreconditionFailedError) {
        return this.rejectClaimed(
          object,
          'Object changed during finalization.',
        );
      }
      throw error;
    }
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

    const scanResult = await this.malwareScanner.scanBytes(
      bytes,
      object.mimeType,
      object.fileName,
    );
    if (scanResult.isOutage) {
      this.recordOutage('storage.scan_outage', object, scanResult.reason);
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
    if (!scanResult.isClean) {
      object.markInfected(
        scanResult.scanPolicy,
        scanResult.reason || 'Malicious content detected',
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
      await this.deleteQuietly(object, object.storageKey);
      return this.toDto(object);
    }

    // Promote the scanned bytes: the copy is pinned to the same ETag as the
    // read, so a re-PUT since then cannot reach the verified key. A retry
    // whose earlier attempt already promoted the bytes skips the copy.
    const verifiedKey = this.verifiedKeyFor(object);
    if (object.storageKey !== verifiedKey) {
      const copy = await this.objectStorage.copyObject(
        object.bucket,
        object.storageKey,
        verifiedKey,
        inspectedEtag,
      );
      if (copy !== 'COPIED') {
        return this.rejectClaimed(
          object,
          'Object changed during finalization.',
        );
      }
      await this.deleteQuietly(object, object.storageKey);
      object.storageKey = verifiedKey;
    }
    object.markClean(scanResult.scanPolicy, { verifiedClean: true });
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

  /**
   * Rejects a claimed object whose bytes failed a check (400), then discards
   * those bytes; the rejection stands even if the deletion fails.
   */
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
    await this.deleteQuietly(object, object.storageKey);
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

  private async uploadPolicy(
    input: InitiateUploadInput,
    callerUserId: string | null,
    ownerCapability: string | null | undefined,
  ): Promise<FileUploadPolicy> {
    return this.ownerAuthorization
      ? this.ownerAuthorization.resolveUploadPolicy(
          input,
          callerUserId,
          ownerCapability,
        )
      : {
          maxFileSizeBytes: 10 * 1024 * 1024,
          allowedMimeTypes: [],
          maxFiles: 1,
        };
  }

  /**
   * Enforces the question's maxFiles over its live objects. A scanner OUTAGE
   * must not wedge the question, so OUTAGE objects do not count: the
   * respondent may retry one or upload a replacement. Nor does an INITIATED
   * upload whose window closed more than the grace period ago: the claim
   * refuses it, so it can never be finalized and only awaits the cleanup
   * sweep. `excludeId` leaves out the object being retried.
   */
  private async assertQuestionHasRoom(
    ownerContext: string,
    ownerRecordId: string,
    questionId: string | null,
    policy: FileUploadPolicy,
    excludeId?: string,
  ): Promise<void> {
    const existing = await this.storageRepository.findByOwner(
      ownerContext,
      ownerRecordId,
    );
    const now = Date.now();
    const activeForQuestion = existing.filter(
      (object) =>
        object.id !== excludeId &&
        object.questionId === questionId &&
        !['REJECTED', 'EXPIRED', 'DELETED'].includes(object.status) &&
        object.scanStatus !== 'OUTAGE' &&
        !this.isLapsedUpload(object, now),
    ).length;
    if (activeForQuestion >= policy.maxFiles) {
      throw new StorageQuestionFullException(questionId, policy.maxFiles);
    }
  }

  /**
   * Same `expiresAt <= now` comparison as finalization and the claim, shifted
   * by the grace period so a finalize racing the deadline has settled first.
   */
  private isLapsedUpload(object: StoredObjectEntity, now: number): boolean {
    return (
      object.status === 'INITIATED' &&
      object.expiresAt !== null &&
      object.expiresAt.getTime() + UPLOAD_GRACE_MS <= now
    );
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

  /**
   * IR.5 C3: one alertable structured error event per outage plus the
   * `/system/metrics` counter. By object id and request id only: never the
   * storage key or file name, which are also scrubbed from the reason.
   */
  private recordOutage(
    event: 'storage.scan_outage' | 'storage.unavailable',
    object: StoredObjectEntity,
    cause: unknown,
  ): void {
    recordStorageOutage();
    let reason =
      cause instanceof Error ? cause.message : String(cause ?? 'unknown');
    for (const secret of [object.storageKey, object.fileName]) {
      if (secret) reason = reason.split(secret).join('[redacted]');
    }
    this.logger?.error(
      JSON.stringify({
        event,
        objectId: object.id,
        requestId: currentRequestId() ?? null,
        reason: reason.slice(0, 300),
      }),
    );
  }

  /**
   * Best effort: runs after the state transition is persisted, which a failed
   * deletion never undoes. A missing key is not an error (port contract);
   * anything else is logged by object id — never the storage key.
   */
  private async deleteQuietly(
    object: StoredObjectEntity,
    key: string,
  ): Promise<void> {
    try {
      await this.objectStorage.deleteObject(object.bucket, key);
    } catch (error) {
      this.logger?.warn(
        `Failed to delete bytes of stored object ${object.id}: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
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
    const extension = dangerousFileExtension(fileName);
    if (extension) {
      throw new StorageInvalidFileException(
        `Files ending in ${extension} are prohibited.`,
      );
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
   * Sniffs the first 512 bytes after a UTF-8 BOM, leading whitespace and
   * leading HTML/XML comments, the way a browser would, for markup it could
   * render or execute (P17). Comments are skipped over a wider window so
   * padding them out cannot push the markup past the sniffed bytes.
   */
  private startsWithActiveMarkup(bytes: Uint8Array): boolean {
    let start =
      bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
    while (start < bytes.length && ASCII_WHITESPACE.has(bytes[start])) {
      start += 1;
    }
    const head = Buffer.from(
      bytes.subarray(start, start + MARKUP_COMMENT_WINDOW_BYTES),
    )
      .toString('latin1')
      .toLowerCase()
      .replace(LEADING_MARKUP_COMMENTS, '')
      .slice(0, SNIFF_WINDOW_BYTES);
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
