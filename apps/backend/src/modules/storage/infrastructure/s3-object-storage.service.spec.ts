import { S3ObjectStorageService } from './s3-object-storage.service';
import { ObjectPreconditionFailedError } from '../application/ports/object-storage.port';

describe('S3ObjectStorageService', () => {
  let service: S3ObjectStorageService;
  let send: jest.Mock;

  const awsError = (name: string, httpStatusCode: number) =>
    Object.assign(new Error(name), { name, $metadata: { httpStatusCode } });

  beforeEach(() => {
    service = new S3ObjectStorageService({
      storageRegion: 'us-east-1',
      storageEndpoint: 'http://localhost:9000',
      storageForcePathStyle: true,
      storageAccessKeyId: 'key',
      storageSecretAccessKey: 'secret',
    } as any);
    send = jest.fn();
    (service as any).client = { send };
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
