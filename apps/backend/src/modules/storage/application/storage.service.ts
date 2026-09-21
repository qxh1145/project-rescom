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
import { StorageOwnerAuthorizationPort } from './ports/storage-owner-authorization.port';
import { StorageRepositoryPort } from './ports/storage-repository.port';

const GLOBAL_MAX_FILE_SIZE = 50 * 1024 * 1024;
const DANGEROUS_EXTENSIONS = new Set([
  '.exe', '.dll', '.msi', '.com', '.scr', '.bat', '.cmd', '.sh', '.csh',
  '.vbs', '.js', '.mjs', '.html', '.htm', '.svg',
]);

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
    const effectiveMax = Math.min(policy.maxFileSizeBytes, GLOBAL_MAX_FILE_SIZE);
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
    const storageKey = `${input.ownerContext}/${input.ownerRecordId}/${objectId}-${sanitizedFileName}`;
    const expiresInSeconds = 15 * 60;
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);
    const bucket = this.envService?.storageBucket ?? 'rescom-private-storage';
    const { uploadUrl, headers } = await this.objectStorage.generateUploadUrl(
      bucket,
      storageKey,
      normalizedMime,
      expiresInSeconds,
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
    );
    if (current.status === 'CLEAN' || current.status === 'REJECTED') {
      return this.toDto(current);
    }
    if (current.status !== 'INITIATED') {
      throw new StorageInvalidFileException(
        `Object cannot be finalized from status ${current.status}.`,
      );
    }
    if (current.expiresAt && current.expiresAt.getTime() < Date.now()) {
      current.markExpired();
      await this.storageRepository.save(current);
      throw new StorageInvalidFileException('The upload session has expired.');
    }

    const metadata = await this.objectStorage.getObjectMetadata(
      current.bucket,
      current.storageKey,
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

    const bytes = await this.objectStorage.readObject(
      current.bucket,
      current.storageKey,
    );
    this.assertContentSignature(current.mimeType, bytes);
    const observedChecksum = crypto
      .createHash('sha256')
      .update(bytes)
      .digest('hex');
    const expectedChecksum = checksum ?? current.checksum;
    if (
      expectedChecksum &&
      observedChecksum.toLowerCase() !== expectedChecksum.toLowerCase()
    ) {
      throw new StorageInvalidFileException('Uploaded checksum does not match.');
    }
    if (
      metadata.checksumSha256 &&
      metadata.checksumSha256.toLowerCase() !== observedChecksum.toLowerCase()
    ) {
      throw new StorageInvalidFileException(
        'Storage-provider checksum does not match uploaded content.',
      );
    }

    const object = await this.storageRepository.claimForScan(
      objectId,
      observedChecksum,
    );
    if (!object) {
      const latest = await this.storageRepository.findById(objectId);
      if (latest && ['CLEAN', 'REJECTED'].includes(latest.status)) {
        return this.toDto(latest);
      }
      throw new StorageInvalidFileException(
        'Upload is already being finalized or is no longer eligible.',
      );
    }

    try {
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
        await this.storageRepository.save(object);
        throw new StorageScannerOutageException(scanResult.reason);
      }
      if (!scanResult.isClean) {
        object.markInfected(
          scanResult.scanPolicy,
          scanResult.reason || 'Malicious content detected',
        );
        await this.storageRepository.save(object);
        return this.toDto(object);
      }
      object.markClean(scanResult.scanPolicy, { verifiedClean: true });
      await this.storageRepository.save(object);
      return this.toDto(object);
    } catch (error) {
      if (error instanceof StorageScannerOutageException) throw error;
      object.markScanOutage(
        'scanner-error',
        error instanceof Error ? error.message : 'Malware scanner failed',
      );
      await this.storageRepository.save(object);
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
    );
    if (!object.isDownloadable()) {
      throw new StorageObjectNotCleanException();
    }
    const expiresInSeconds = 5 * 60;
    return {
      objectId: object.id,
      downloadUrl: await this.objectStorage.generateDownloadUrl(
        object.bucket,
        object.storageKey,
        object.fileName,
        expiresInSeconds,
      ),
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
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
    );
    if (object.status !== 'CLEAN') {
      throw new StorageObjectNotCleanException();
    }
    object.markAttached();
    await this.storageRepository.save(object);
    return this.toDto(object);
  }

  async deleteObject(
    objectId: string,
    callerUserId: string | null = null,
    ownerCapability?: string | null,
  ): Promise<void> {
    const object = await this.requireAuthorizedObject(
      objectId,
      callerUserId,
      ownerCapability,
    );
    if (object.status === 'ATTACHED') {
      throw new StorageInvalidFileException('Attached objects cannot be deleted.');
    }
    await this.objectStorage.deleteObject(object.bucket, object.storageKey);
    object.markDeleted();
    await this.storageRepository.save(object);
  }

  async cleanupExpired(now = new Date()): Promise<number> {
    const expired = await this.storageRepository.findExpiredUnattached(now);
    for (const object of expired) {
      await this.objectStorage.deleteObject(object.bucket, object.storageKey);
      object.markExpired();
      await this.storageRepository.save(object);
    }
    return expired.length;
  }

  private async requireAuthorizedObject(
    objectId: string,
    callerUserId: string | null,
    ownerCapability?: string | null,
  ): Promise<StoredObjectEntity> {
    const object = await this.storageRepository.findById(objectId);
    if (!object) throw new StorageObjectNotFoundException();
    if (this.ownerAuthorization) {
      await this.ownerAuthorization.authorize(
        object.ownerContext,
        object.ownerRecordId,
        callerUserId,
        ownerCapability,
      );
    }
    return object;
  }

  private mimeMatches(actual: string, allowed: string): boolean {
    const normalized = allowed.toLowerCase().trim();
    return normalized.endsWith('/*')
      ? actual.startsWith(normalized.slice(0, -1))
      : actual === normalized;
  }

  private assertSafeExtension(fileName: string): void {
    const lower = fileName.toLowerCase();
    for (const extension of DANGEROUS_EXTENSIONS) {
      if (lower.endsWith(extension)) {
        throw new StorageInvalidFileException(
          `Files ending in ${extension} are prohibited.`,
        );
      }
    }
  }

  private assertContentSignature(mimeType: string, bytes: Uint8Array): void {
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
      throw new StorageInvalidFileException(
        'Uploaded bytes do not match the declared MIME signature.',
      );
    }
    if (
      startsWith(0x4d, 0x5a) ||
      startsWith(0x23, 0x21) ||
      Buffer.from(bytes.subarray(0, 256))
        .toString('utf8')
        .trimStart()
        .toLowerCase()
        .startsWith('<html')
    ) {
      throw new StorageInvalidFileException(
        'Executable or active content is prohibited.',
      );
    }
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
