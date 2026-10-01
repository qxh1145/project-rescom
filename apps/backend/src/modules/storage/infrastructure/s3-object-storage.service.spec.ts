import { S3ObjectStorageService } from './s3-object-storage.service';
import { ObjectPreconditionFailedError } from '../application/ports/object-storage.port';

describe('S3ObjectStorageService', () => {
  let service: S3ObjectStorageService;
  let send: jest.Mock;

  const awsError = (name: string, httpStatusCode: number) =>
    Object.assign(new Error(name), { name, $metadata: { httpStatusCode } });

  const env = {
    storageRegion: 'us-east-1',
    storageEndpoint: 'http://localhost:9000',
    storageForcePathStyle: true,
    storageAccessKeyId: 'key',
    storageSecretAccessKey: 'secret',
  } as any;

  beforeEach(() => {
    service = new S3ObjectStorageService(env);
    send = jest.fn();
    (service as any).client = { send };
  });

  describe('generateUploadUrl (mock-off Phase 7)', () => {
    // Presigning is local: the real client signs offline, no network call.
    it('presigns a PUT without an SDK checksum of the empty body', async () => {
      const real = new S3ObjectStorageService(env);
      const { uploadUrl, headers } = await real.generateUploadUrl(
        'rescom-private-storage',
        'participation/attempt/object-photo.png',
        'image/png',
        900,
      );
      const params = new URL(uploadUrl).searchParams;
      expect(uploadUrl.toLowerCase()).not.toContain('x-amz-checksum');
      expect(params.has('x-amz-sdk-checksum-algorithm')).toBe(false);
      expect(params.get('X-Amz-Expires')).toBe('900');
      expect(params.get('X-Amz-SignedHeaders')).not.toMatch(/checksum/);
      expect(new URL(uploadUrl).pathname).toBe(
        '/rescom-private-storage/participation/attempt/object-photo.png',
      );
      expect(headers).toEqual({ 'Content-Type': 'image/png' });
    });
  });

  describe('deleteObject (BE-11)', () => {
    it('treats a missing key as already deleted', async () => {
      send.mockRejectedValue(awsError('NoSuchKey', 404));
      await expect(
        service.deleteObject('bucket', 'key'),
      ).resolves.toBeUndefined();
    });

    it('surfaces any other failure', async () => {
      send.mockRejectedValue(awsError('InternalError', 500));
      await expect(service.deleteObject('bucket', 'key')).rejects.toThrow(
        'InternalError',
      );
    });
  });

  describe('readObject', () => {
    it('sends If-Match and maps a precondition failure', async () => {
      send.mockRejectedValue(awsError('PreconditionFailed', 412));
      await expect(
        service.readObject('bucket', 'key', '"etag"'),
      ).rejects.toBeInstanceOf(ObjectPreconditionFailedError);
      expect(send.mock.calls[0][0].input).toEqual({
        Bucket: 'bucket',
        Key: 'key',
        IfMatch: '"etag"',
      });
    });

    it('maps a key removed since inspection to a precondition failure', async () => {
      send.mockRejectedValue(awsError('NoSuchKey', 404));
      await expect(
        service.readObject('bucket', 'key', '"etag"'),
      ).rejects.toBeInstanceOf(ObjectPreconditionFailedError);
    });

    it('keeps unconditional read errors as they are', async () => {
      send.mockRejectedValue(awsError('NoSuchKey', 404));
      await expect(service.readObject('bucket', 'key')).rejects.toThrow(
        'NoSuchKey',
      );
    });

    it('returns the object bytes', async () => {
      send.mockResolvedValue({
        Body: { transformToByteArray: async () => Uint8Array.from([1, 2]) },
      });
      await expect(
        service.readObject('bucket', 'key', '"etag"'),
      ).resolves.toEqual(Uint8Array.from([1, 2]));
    });
  });
});
