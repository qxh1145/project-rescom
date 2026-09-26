import * as crypto from 'crypto';
import {
  CopyObjectOutcome,
  ObjectPreconditionFailedError,
  ObjectStoragePort,
  StoredObjectMetadata,
} from '../application/ports/object-storage.port';

interface MemoryObject {
  bytes: Uint8Array;
  contentType: string;
  checksumSha256: string;
  /** Like S3 single-part uploads: the quoted MD5 of the content. */
  etag: string;
}

/** Test-only object storage adapter. It is never selected by StorageModule. */
export class InMemoryObjectStorageService implements ObjectStoragePort {
  private readonly objects = new Map<string, MemoryObject>();

  async generateUploadUrl(
    bucket: string,
    storageKey: string,
    mimeType: string,
    expiresInSeconds: number,
  ): Promise<{ uploadUrl: string; headers?: Record<string, string> }> {
    return {
      uploadUrl: `memory://${encodeURIComponent(bucket)}/${encodeURIComponent(storageKey)}?expiresIn=${expiresInSeconds}`,
      headers: { 'Content-Type': mimeType },
    };
  }

  async generateDownloadUrl(
    bucket: string,
    storageKey: string,
    _fileName: string,
    expiresInSeconds: number,
  ): Promise<string> {
    return `memory://${encodeURIComponent(bucket)}/${encodeURIComponent(storageKey)}?download=1&expiresIn=${expiresInSeconds}`;
  }

  async getObjectMetadata(
    bucket: string,
    storageKey: string,
  ): Promise<StoredObjectMetadata | null> {
    const object = this.objects.get(`${bucket}:${storageKey}`);
    if (!object) return null;
    return {
      contentLength: object.bytes.byteLength,
      contentType: object.contentType,
      checksumSha256: object.checksumSha256,
      etag: object.etag,
    };
  }

  async copyObject(
    bucket: string,
    sourceKey: string,
    destinationKey: string,
    ifMatchEtag: string,
  ): Promise<CopyObjectOutcome> {
    const source = this.objects.get(`${bucket}:${sourceKey}`);
    if (!source) return 'SOURCE_NOT_FOUND';
    if (source.etag !== ifMatchEtag) return 'PRECONDITION_FAILED';
    this.objects.set(`${bucket}:${destinationKey}`, {
      ...source,
      bytes: Uint8Array.from(source.bytes),
    });
    return 'COPIED';
  }

  async readObject(
    bucket: string,
    storageKey: string,
    ifMatchEtag?: string,
  ): Promise<Uint8Array> {
    const object = this.objects.get(`${bucket}:${storageKey}`);
    if (ifMatchEtag && object?.etag !== ifMatchEtag) {
      throw new ObjectPreconditionFailedError();
    }
    if (!object) throw new Error('Object not found');
    return Uint8Array.from(object.bytes);
  }

  async deleteObject(bucket: string, storageKey: string): Promise<void> {
    this.objects.delete(`${bucket}:${storageKey}`);
  }

  putObject(
    bucket: string,
    storageKey: string,
    bytes: Uint8Array | string,
    contentType: string,
  ): void {
    const body = Uint8Array.from(
      typeof bytes === 'string' ? Buffer.from(bytes) : bytes,
    );
    this.objects.set(`${bucket}:${storageKey}`, {
      bytes: body,
      contentType,
      checksumSha256: crypto.createHash('sha256').update(body).digest('hex'),
      etag: `"${crypto.createHash('md5').update(body).digest('hex')}"`,
    });
  }

  hasObject(bucket: string, storageKey: string): boolean {
    return this.objects.has(`${bucket}:${storageKey}`);
  }
}
