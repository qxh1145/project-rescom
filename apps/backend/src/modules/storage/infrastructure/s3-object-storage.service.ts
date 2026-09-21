import { Injectable } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { EnvService } from '../../../common/config/env.service';
import {
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
      };
    } catch (error: any) {
      const status = error?.$metadata?.httpStatusCode;
      if (
        status === 404 ||
        error?.name === 'NotFound' ||
        error?.name === 'NoSuchKey'
      ) {
        return null;
      }
      throw error;
    }
  }

  async readObject(bucket: string, storageKey: string): Promise<Uint8Array> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: bucket, Key: storageKey }),
    );
    if (!result.Body) throw new Error('Object body is empty');
    return result.Body.transformToByteArray();
  }

  async deleteObject(bucket: string, storageKey: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: bucket, Key: storageKey }),
    );
  }
}
