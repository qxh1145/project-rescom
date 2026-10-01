import { Injectable } from '@nestjs/common';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { EnvService } from '../../../common/config/env.service';
import {
  CopyObjectOutcome,
  ObjectPreconditionFailedError,
  ObjectStoragePort,
  StoredObjectMetadata,
} from '../application/ports/object-storage.port';

@Injectable()
export class S3ObjectStorageService implements ObjectStoragePort {
  private readonly client: S3Client;

  constructor(private readonly envService: EnvService) {
    this.client = new S3Client({
      region: envService.storageRegion,
      endpoint: envService.storageEndpoint,
      forcePathStyle: envService.storageForcePathStyle,
      credentials: {
        accessKeyId: envService.storageAccessKeyId,
        secretAccessKey: envService.storageSecretAccessKey,
      },
      // SDK >= 3.729 adds a flexible checksum to every request by default. A
      // presigned PUT then signs `x-amz-checksum-crc32` of the EMPTY body
      // (`AAAAAA==`), so the browser's real upload fails verification. Only
      // send/validate checksums when the operation requires one; finalize
      // computes its own SHA-256 over the uploaded bytes (AD-22).
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  async generateUploadUrl(
    bucket: string,
    storageKey: string,
    mimeType: string,
    expiresInSeconds: number,
  ): Promise<{ uploadUrl: string; headers?: Record<string, string> }> {
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: storageKey,
      ContentType: mimeType,
    });
    return {
      uploadUrl: await getSignedUrl(this.client, command, {
        expiresIn: expiresInSeconds,
      }),
      headers: { 'Content-Type': mimeType },
    };
  }

  async generateDownloadUrl(
    bucket: string,
    storageKey: string,
    fileName: string,
    expiresInSeconds: number,
  ): Promise<string> {
    const safeName = fileName.replace(/[\r\n"]/g, '_');
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: bucket,
        Key: storageKey,
        ResponseContentDisposition: `attachment; filename="${safeName}"`,
      }),
      { expiresIn: expiresInSeconds },
    );
  }

  async getObjectMetadata(
    bucket: string,
    storageKey: string,
  ): Promise<StoredObjectMetadata | null> {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: bucket, Key: storageKey }),
      );
      return {
        contentLength: result.ContentLength ?? -1,
        contentType: result.ContentType ?? null,
        checksumSha256: result.ChecksumSHA256
          ? Buffer.from(result.ChecksumSHA256, 'base64').toString('hex')
          : null,
        etag: result.ETag ?? null,
      };
    } catch (error: any) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async copyObject(
    bucket: string,
    sourceKey: string,
    destinationKey: string,
    ifMatchEtag: string,
  ): Promise<CopyObjectOutcome> {
    try {
      await this.client.send(
        new CopyObjectCommand({
          Bucket: bucket,
          Key: destinationKey,
          // CopySource must be URL-encoded; keep the key's `/` separators.
          CopySource: `${bucket}/${sourceKey
            .split('/')
            .map(encodeURIComponent)
            .join('/')}`,
          CopySourceIfMatch: ifMatchEtag,
          MetadataDirective: 'COPY',
        }),
      );
      return 'COPIED';
    } catch (error: any) {
      if (isPreconditionFailed(error)) return 'PRECONDITION_FAILED';
      if (isNotFound(error)) return 'SOURCE_NOT_FOUND';
      throw error;
    }
  }

  async readObject(
    bucket: string,
    storageKey: string,
    ifMatchEtag?: string,
  ): Promise<Uint8Array> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: storageKey,
          IfMatch: ifMatchEtag,
        }),
      );
      if (!result.Body) throw new Error('Object body is empty');
      return await result.Body.transformToByteArray();
    } catch (error: any) {
      // A conditional read of a re-written or removed key: the bytes changed.
      if (ifMatchEtag && (isPreconditionFailed(error) || isNotFound(error))) {
        throw new ObjectPreconditionFailedError();
      }
      throw error;
    }
  }

  async deleteObject(bucket: string, storageKey: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: bucket, Key: storageKey }),
      );
    } catch (error: any) {
      if (!isNotFound(error)) throw error;
    }
  }
}

function isPreconditionFailed(error: any): boolean {
  return (
    error?.$metadata?.httpStatusCode === 412 ||
    error?.name === 'PreconditionFailed'
  );
}

function isNotFound(error: any): boolean {
  return (
    error?.$metadata?.httpStatusCode === 404 ||
    error?.name === 'NotFound' ||
    error?.name === 'NoSuchKey'
  );
}
