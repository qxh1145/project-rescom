import { StorageService } from './storage.service';
import { InMemoryStorageRepository } from '../infrastructure/in-memory-storage.repository';
import { InMemoryObjectStorageService } from '../infrastructure/in-memory-object-storage.service';
import { StubMalwareScannerService } from '../infrastructure/stub-malware-scanner.service';
import {
  StorageInvalidFileException,
  StorageObjectNotCleanException,
  StorageObjectNotFoundException,
  StorageScannerOutageException,
} from './exceptions/storage.exceptions';

describe('StorageService', () => {
  let service: StorageService;
  let repository: InMemoryStorageRepository;
  let objectStorage: InMemoryObjectStorageService;
  let malwareScanner: StubMalwareScannerService;

  const validRecordId = '22222222-2222-4222-8222-222222222222';

  beforeEach(() => {
    repository = new InMemoryStorageRepository();
    objectStorage = new InMemoryObjectStorageService();
    malwareScanner = new StubMalwareScannerService();

    service = new StorageService(repository, objectStorage, malwareScanner);
  });

  function putPdf(storageKey: string, size: number): void {
    const bytes = Buffer.alloc(size);
    bytes.write('%PDF-1.7');
    objectStorage.putObject(
      'rescom-private-storage',
      storageKey,
      bytes,
      'application/pdf',
    );
  }

  describe('initiateUpload', () => {
    it('should successfully initiate upload and return presigned URL', async () => {
      const result = await service.initiateUpload({
        fileName: 'my_id_card.png',
        fileSize: 1024 * 500,
        mimeType: 'image/png',
        ownerContext: 'participation',
        ownerRecordId: validRecordId,
      });

      expect(result.objectId).toBeDefined();
      expect(result.uploadUrl).toContain('memory://');
      expect(result.storageKey).toContain(`participation/${validRecordId}/`);
      expect(result.storageKey).toContain('my_id_card.png');

      const stored = await repository.findById(result.objectId);
      expect(stored).not.toBeNull();
      expect(stored?.status).toBe('INITIATED');
      expect(stored?.scanStatus).toBe('PENDING');
    });

    it('should reject prohibited executable MIME types', async () => {
      await expect(
        service.initiateUpload({
          fileName: 'payload.exe',
          fileSize: 2048,
          mimeType: 'application/x-msdownload',
          ownerContext: 'participation',
          ownerRecordId: validRecordId,
        }),
      ).rejects.toThrow(StorageInvalidFileException);
    });

    it('should reject file sizes exceeding 50MB limit', async () => {
      await expect(
        service.initiateUpload({
          fileName: 'huge.iso',
          fileSize: 60 * 1024 * 1024,
          mimeType: 'application/octet-stream',
          ownerContext: 'participation',
          ownerRecordId: validRecordId,
        }),
      ).rejects.toThrow(StorageInvalidFileException);
    });

    it('should sanitize path traversal attempts in file name', async () => {
      const result = await service.initiateUpload({
        fileName: '../../../../secret.pdf',
        fileSize: 1024,
        mimeType: 'application/pdf',
        ownerContext: 'participation',
        ownerRecordId: validRecordId,
      });

      expect(result.storageKey).not.toContain('../');
      expect(result.storageKey).toContain('secret.pdf');
    });
  });

  describe('finalizeUpload', () => {
    it('should quarantine and verify clean upload', async () => {
      const init = await service.initiateUpload({
        fileName: 'clean_receipt.pdf',
        fileSize: 1024 * 100,
        mimeType: 'application/pdf',
        ownerContext: 'participation',
        ownerRecordId: validRecordId,
      });
      putPdf(init.storageKey, 1024 * 100);

      const finalized = await service.finalizeUpload(init.objectId);

      expect(finalized.status).toBe('CLEAN');
      expect(finalized.scanStatus).toBe('CLEAN');
      expect(finalized.scannedAt).toBeDefined();
    });

    it('should reject finalization when the object-store PUT never occurred', async () => {
      const init = await service.initiateUpload({
        fileName: 'missing.pdf',
        fileSize: 1024,
        mimeType: 'application/pdf',
        ownerContext: 'participation',
        ownerRecordId: validRecordId,
      });
      await expect(service.finalizeUpload(init.objectId)).rejects.toThrow(
        /not found in private storage/,
      );
    });

    it('should reject a caller checksum that does not match stored bytes', async () => {
      const init = await service.initiateUpload({
        fileName: 'checksum.pdf',
        fileSize: 1024,
        mimeType: 'application/pdf',
        ownerContext: 'participation',
        ownerRecordId: validRecordId,
      });
      putPdf(init.storageKey, 1024);
      await expect(
        service.finalizeUpload(init.objectId, null, '0'.repeat(64)),
      ).rejects.toThrow(/checksum does not match/);
    });

    it('should reject infected files with status REJECTED', async () => {
      const init = await service.initiateUpload({
        fileName: 'test_virus.malware',
        fileSize: 1024,
        mimeType: 'application/pdf',
        ownerContext: 'participation',
        ownerRecordId: validRecordId,
      });
      putPdf(init.storageKey, 1024);

      const finalized = await service.finalizeUpload(init.objectId);

      expect(finalized.status).toBe('REJECTED');
      expect(finalized.scanStatus).toBe('INFECTED');
    });

    it('should fail closed on scanner outage (AD-22)', async () => {
      const init = await service.initiateUpload({
        fileName: 'timeout_test.outage.pdf',
        fileSize: 1024,
        mimeType: 'application/pdf',
        ownerContext: 'participation',
        ownerRecordId: validRecordId,
      });
      putPdf(init.storageKey, 1024);

      await expect(service.finalizeUpload(init.objectId)).rejects.toThrow(
        StorageScannerOutageException,
      );

      const stored = await repository.findById(init.objectId);
      expect(stored?.status).toBe('QUARANTINED');
      expect(stored?.scanStatus).toBe('OUTAGE');
    });

    it('should durably record a thrown scanner failure as OUTAGE', async () => {
      const init = await service.initiateUpload({
        fileName: 'scanner-error.pdf',
        fileSize: 1024,
        mimeType: 'application/pdf',
        ownerContext: 'participation',
        ownerRecordId: validRecordId,
      });
      putPdf(init.storageKey, 1024);
      jest
        .spyOn(malwareScanner, 'scanObject')
        .mockRejectedValueOnce(new Error('connection reset'));

      await expect(service.finalizeUpload(init.objectId)).rejects.toThrow(
        StorageScannerOutageException,
      );
      const stored = await repository.findById(init.objectId);
      expect(stored?.status).toBe('QUARANTINED');
      expect(stored?.scanStatus).toBe('OUTAGE');
    });

    it('should throw StorageObjectNotFoundException if objectId does not exist', async () => {
      await expect(
        service.finalizeUpload('33333333-3333-4333-8333-333333333333'),
      ).rejects.toThrow(StorageObjectNotFoundException);
    });
  });

  describe('getDownloadUrl & attachObject', () => {
    it('should generate download URL only for CLEAN or ATTACHED objects', async () => {
      const init = await service.initiateUpload({
        fileName: 'verified_doc.pdf',
        fileSize: 1024,
        mimeType: 'application/pdf',
        ownerContext: 'participation',
        ownerRecordId: validRecordId,
      });
      putPdf(init.storageKey, 1024);

      // Before finalize: INITIATED -> cannot download
      await expect(service.getDownloadUrl(init.objectId)).rejects.toThrow(
        StorageObjectNotCleanException,
      );

      // Finalize -> CLEAN
      await service.finalizeUpload(init.objectId);

      const download = await service.getDownloadUrl(init.objectId);
      expect(download.downloadUrl).toContain('memory://');
      expect(download.fileName).toBe('verified_doc.pdf');

      // Attach object
      const attached = await service.attachObject(init.objectId);
      expect(attached.status).toBe('ATTACHED');

      // Attached is also downloadable
      const attachedDownload = await service.getDownloadUrl(init.objectId);
      expect(attachedDownload.downloadUrl).toBeDefined();
    });

    it('should prohibit attaching quarantined or infected objects', async () => {
      const init = await service.initiateUpload({
        fileName: 'bad.malware',
        fileSize: 1024,
        mimeType: 'application/pdf',
        ownerContext: 'participation',
        ownerRecordId: validRecordId,
      });
      putPdf(init.storageKey, 1024);

      await service.finalizeUpload(init.objectId);

      await expect(service.attachObject(init.objectId)).rejects.toThrow(
        StorageObjectNotCleanException,
      );
    });
  });
});
