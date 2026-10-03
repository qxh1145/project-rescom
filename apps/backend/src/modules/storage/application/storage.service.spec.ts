import { StorageQuestionFullException } from './exceptions/storage.exceptions';
import { InitiateUploadInput, InitiateUploadResponse } from '@rescom/schemas';
import { StorageService } from './storage.service';
import { runWithRequestId } from '../../../common/http/request-context';
import { storageOutagesSinceBoot } from '../../../common/system/storage-outage-counter';
import { InMemoryStorageRepository } from '../infrastructure/in-memory-storage.repository';
import { InMemoryObjectStorageService } from '../infrastructure/in-memory-object-storage.service';
import { StubMalwareScannerService } from '../infrastructure/stub-malware-scanner.service';
import { StorageOwnerAuthorizationPort } from './ports/storage-owner-authorization.port';
import {
  StorageInvalidFileException,
  StorageObjectNotCleanException,
  StorageObjectNotFoundException,
  StorageScannerOutageException,
  StorageUnavailableException,
} from './exceptions/storage.exceptions';

describe('StorageService', () => {
  let service: StorageService;
  let repository: InMemoryStorageRepository;
  let objectStorage: InMemoryObjectStorageService;
  let malwareScanner: StubMalwareScannerService;

  const bucket = 'rescom-private-storage';
  const validRecordId = '22222222-2222-4222-8222-222222222222';

  beforeEach(() => {
    repository = new InMemoryStorageRepository();
    objectStorage = new InMemoryObjectStorageService();
    malwareScanner = new StubMalwareScannerService();

    service = new StorageService(repository, objectStorage, malwareScanner);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function pdfBytes(size: number): Buffer {
    const bytes = Buffer.alloc(size);
    bytes.write('%PDF-1.7');
    return bytes;
  }

  function putPdf(storageKey: string, size: number): Buffer {
    const bytes = pdfBytes(size);
    objectStorage.putObject(bucket, storageKey, bytes, 'application/pdf');
    return bytes;
  }

  function initiate(overrides: Partial<InitiateUploadInput> = {}) {
    return service.initiateUpload({
      fileName: 'document.pdf',
      fileSize: 1024,
      mimeType: 'application/pdf',
      ownerContext: 'participation',
      ownerRecordId: validRecordId,
      questionId: 'upload-1',
      ...overrides,
    });
  }

  function verifiedKeyOf(objectId: string): string {
    return `verified/participation/${validRecordId}/${objectId}`;
  }

  describe('initiateUpload', () => {
    it('should successfully initiate upload and return presigned URL', async () => {
      const result = await initiate({
        fileName: 'my_id_card.png',
        fileSize: 1024 * 500,
        mimeType: 'image/png',
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
        initiate({
          fileName: 'payload.bin',
          mimeType: 'application/x-msdownload',
        }),
      ).rejects.toThrow(StorageInvalidFileException);
    });

    it.each([
      'image/svg+xml',
      'application/x-httpd-php',
      'application/java-archive',
    ])('should reject the %s MIME type (P17)', async (mimeType) => {
      await expect(
        initiate({ fileName: 'upload.bin', mimeType }),
      ).rejects.toThrow(/prohibited for security reasons/);
    });

    it.each([
      'payload.ps1',
      'tool.jar',
      'app.hta',
      'shell.php',
      'page.phtml',
      'console.msc',
      'shortcut.lnk',
      'macro.vbe',
      'script.jse',
      'job.wsf',
      'page.xhtml',
      'page.shtml',
      'vector.svgz',
      'EVIL.PS1',
      'evil.exe.',
      'evil.exe ',
      'evil.exe. . ',
    ])('should reject the dangerous file name "%s" (P17)', async (fileName) => {
      await expect(
        initiate({ fileName, mimeType: 'application/octet-stream' }),
      ).rejects.toThrow(/are prohibited/);
    });

    it('should reject file sizes exceeding 50MB limit', async () => {
      await expect(
        initiate({
          fileName: 'huge.iso',
          fileSize: 60 * 1024 * 1024,
          mimeType: 'application/octet-stream',
        }),
      ).rejects.toThrow(StorageInvalidFileException);
    });

    it('should sanitize path traversal attempts in file name', async () => {
      const result = await initiate({ fileName: '../../../../secret.pdf' });

      expect(result.storageKey).not.toContain('../');
      expect(result.storageKey).toContain('secret.pdf');
    });
  });

  describe('finalizeUpload', () => {
    it('should quarantine and verify clean upload', async () => {
      const init = await initiate({
        fileName: 'clean_receipt.pdf',
        fileSize: 1024 * 100,
      });
      putPdf(init.storageKey, 1024 * 100);

      const finalized = await service.finalizeUpload(init.objectId);

      expect(finalized.status).toBe('CLEAN');
      expect(finalized.scanStatus).toBe('CLEAN');
      expect(finalized.scannedAt).toBeDefined();
      expect(finalized.checksum).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should reject finalization when the object-store PUT never occurred', async () => {
      const init = await initiate({ fileName: 'missing.pdf' });
      await expect(service.finalizeUpload(init.objectId)).rejects.toThrow(
        /not found in private storage/,
      );
      // Nothing was claimed: the client can still PUT and retry.
      expect((await repository.findById(init.objectId))?.status).toBe(
        'INITIATED',
      );
    });

    it('should reject a caller checksum that does not match stored bytes', async () => {
      const init = await initiate({ fileName: 'checksum.pdf' });
      putPdf(init.storageKey, 1024);
      await expect(
        service.finalizeUpload(init.objectId, null, '0'.repeat(64)),
      ).rejects.toThrow(/checksum does not match/);

      const stored = await repository.findById(init.objectId);
      expect(stored?.status).toBe('REJECTED');
      expect(stored?.scanStatus).toBe('SKIPPED');
      await expect(
        service.finalizeUpload(init.objectId),
      ).resolves.toMatchObject({ status: 'REJECTED' });
    });

    it('should reject infected files with status REJECTED', async () => {
      const init = await initiate({ fileName: 'test_virus.malware' });
      putPdf(init.storageKey, 1024);

      const finalized = await service.finalizeUpload(init.objectId);

      expect(finalized.status).toBe('REJECTED');
      expect(finalized.scanStatus).toBe('INFECTED');
    });

    it('should fail closed on scanner outage (AD-22)', async () => {
      const init = await initiate({ fileName: 'timeout_test.outage.pdf' });
      putPdf(init.storageKey, 1024);

      await expect(service.finalizeUpload(init.objectId)).rejects.toThrow(
        StorageScannerOutageException,
      );

      const stored = await repository.findById(init.objectId);
      expect(stored?.status).toBe('QUARANTINED');
      expect(stored?.scanStatus).toBe('OUTAGE');
    });

    it('should durably record a thrown scanner failure as OUTAGE', async () => {
      const init = await initiate({ fileName: 'scanner-error.pdf' });
      putPdf(init.storageKey, 1024);
      jest
        .spyOn(malwareScanner, 'scanBytes')
        .mockRejectedValueOnce(new Error('connection reset'));

      await expect(service.finalizeUpload(init.objectId)).rejects.toThrow(
        StorageScannerOutageException,
      );
      const stored = await repository.findById(init.objectId);
      expect(stored?.status).toBe('QUARANTINED');
      expect(stored?.scanStatus).toBe('OUTAGE');
    });

    it('logs one structured scan_outage event with the request id and no key (IR.5 C3)', async () => {
      const logger = { warn: jest.fn(), error: jest.fn() };
      service = new StorageService(
        repository,
        objectStorage,
        malwareScanner,
        undefined,
        undefined,
        logger,
      );
      const init = await initiate({ fileName: 'secret-name.outage.pdf' });
      putPdf(init.storageKey, 1024);
      const before = storageOutagesSinceBoot();
      const requestId = '7d5b0b32-6a43-4d63-9d7e-2f0e8f3a6c11';

      await expect(
        runWithRequestId(requestId, () =>
          service.finalizeUpload(init.objectId),
        ),
      ).rejects.toThrow(StorageScannerOutageException);

      expect(logger.error).toHaveBeenCalledTimes(1);
      const raw = logger.error.mock.calls[0][0] as string;
      expect(JSON.parse(raw)).toEqual({
        event: 'storage.scan_outage',
        objectId: init.objectId,
        requestId,
        reason: expect.any(String),
      });
      expect(raw).not.toContain(init.storageKey);
      expect(raw).not.toContain('secret-name');
      expect(storageOutagesSinceBoot()).toBe(before + 1);
    });

    it('maps a pre-claim storage failure to StorageUnavailableException and keeps INITIATED (IR.5 C2.1)', async () => {
      const logger = { warn: jest.fn(), error: jest.fn() };
      service = new StorageService(
        repository,
        objectStorage,
        malwareScanner,
        undefined,
        undefined,
        logger,
      );
      const init = await initiate();
      putPdf(init.storageKey, 1024);
      jest
        .spyOn(objectStorage, 'getObjectMetadata')
        .mockRejectedValueOnce(new Error('connect ECONNREFUSED'));

      await expect(service.finalizeUpload(init.objectId)).rejects.toThrow(
        StorageUnavailableException,
      );
      expect((await repository.findById(init.objectId))?.status).toBe(
        'INITIATED',
      );
      expect(JSON.parse(logger.error.mock.calls[0][0])).toMatchObject({
        event: 'storage.unavailable',
        objectId: init.objectId,
      });

      // Retryable once storage is back.
      await expect(
        service.finalizeUpload(init.objectId),
      ).resolves.toMatchObject({ status: 'CLEAN' });
    });

    it('should throw StorageObjectNotFoundException if objectId does not exist', async () => {
      await expect(
        service.finalizeUpload('33333333-3333-4333-8333-333333333333'),
      ).rejects.toThrow(StorageObjectNotFoundException);
    });

    describe('active-content sniffing (P17)', () => {
      const cases: [string, string][] = [
        ['BOM + whitespace + doctype', '﻿ \r\n\t<!DOCTYPE html><p>hi</p>'],
        ['upper-case script tag', '   <SCRIPT>alert(1)</SCRIPT>'],
        ['html root', '<html><body></body></html>'],
        ['svg root', '<svg xmlns="http://www.w3.org/2000/svg"/>'],
        ['php opener', '<?php echo 1;'],
        [
          'xml prolog wrapping svg',
          '<?xml version="1.0"?>\n<!-- a comment -->\n<svg onload="alert(1)"/>',
        ],
        ['svg doctype', '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN">'],
        ['comment before svg', '<!-- hi --><svg onload="alert(1)"/>'],
        [
          'several comments before a script',
          '\uFEFF <!-- a -->\n<!--\nb\n-->  <script>alert(1)</script>',
        ],
        [
          'comment padded past the sniff window',
          `<!--${'x'.repeat(2048)}--><html><script>alert(1)</script></html>`,
        ],
      ];

      it.each(cases)('should reject %s', async (_label, content) => {
        const bytes = Buffer.from(content, 'utf8');
        const init = await initiate({
          fileName: 'notes.txt',
          fileSize: bytes.byteLength,
          mimeType: 'text/plain',
        });
        objectStorage.putObject(bucket, init.storageKey, bytes, 'text/plain');

        await expect(service.finalizeUpload(init.objectId)).rejects.toThrow(
          'Executable or active content is prohibited.',
        );
        expect((await repository.findById(init.objectId))?.status).toBe(
          'REJECTED',
        );
      });

      it.each([
        ['plain xml without svg', '<?xml version="1.0"?><note>hi</note>'],
        ['csv text', 'name,score\nAn,9\n'],
        ['comment before plain text', '<!-- notes -->\njust some text'],
      ])('should accept %s', async (_label, content) => {
        const bytes = Buffer.from(content, 'utf8');
        const init = await initiate({
          fileName: 'data.txt',
          fileSize: bytes.byteLength,
          mimeType: 'text/plain',
        });
        objectStorage.putObject(bucket, init.storageKey, bytes, 'text/plain');

        await expect(
          service.finalizeUpload(init.objectId),
        ).resolves.toMatchObject({ status: 'CLEAN' });
      });
    });

    describe('upload window at the claim', () => {
      it('refuses the claim when the window closes during the pre-claim checks', async () => {
        const init = await initiate();
        putPdf(init.storageKey, 1024);
        const stored = await repository.findById(init.objectId);
        const closesAt = stored!.expiresAt!.getTime();
        const realHead = objectStorage.getObjectMetadata.bind(objectStorage);
        jest
          .spyOn(objectStorage, 'getObjectMetadata')
          .mockImplementationOnce(async (b, key) => {
            // The slow HEAD finishes just after the upload window closed.
            jest.spyOn(Date, 'now').mockReturnValue(closesAt + 10);
            return realHead(b, key);
          });
        const readSpy = jest.spyOn(objectStorage, 'readObject');

        await expect(service.finalizeUpload(init.objectId)).rejects.toThrow(
          'The upload session has expired.',
        );

        expect((await repository.findById(init.objectId))?.status).toBe(
          'INITIATED',
        );
        expect(readSpy).not.toHaveBeenCalled();
      });

      it('treats expiresAt === now as closed, like the claim', async () => {
        const init = await initiate();
        putPdf(init.storageKey, 1024);
        const stored = await repository.findById(init.objectId);
        jest.spyOn(Date, 'now').mockReturnValue(stored!.expiresAt!.getTime());

        await expect(service.finalizeUpload(init.objectId)).rejects.toThrow(
          'The upload session has expired.',
        );
        expect((await repository.findById(init.objectId))?.status).toBe(
          'EXPIRED',
        );
      });
    });

    describe('verified copy (P10)', () => {
      it('serves and scans a server-owned copy that a re-PUT cannot change', async () => {
        const init = await initiate();
        const original = putPdf(init.storageKey, 1024);
        const verifiedKey = verifiedKeyOf(init.objectId);
        const readSpy = jest.spyOn(objectStorage, 'readObject');
        const scanObjectSpy = jest.spyOn(malwareScanner, 'scanObject');
        let verifiedExistedDuringScan: boolean | undefined;
        const scanSpy = jest
          .spyOn(malwareScanner, 'scanBytes')
          .mockImplementationOnce(async () => {
            verifiedExistedDuringScan = objectStorage.hasObject(
              bucket,
              verifiedKey,
            );
            return { isClean: true, scanPolicy: 'test-policy' };
          });

        const finalized = await service.finalizeUpload(init.objectId);

        expect(finalized.status).toBe('CLEAN');
        expect(finalized.storageKey).toBe(verifiedKey);
        // Scanned at the upload key, from the single read (BE-3, BE-11).
        expect(verifiedExistedDuringScan).toBe(false);
        expect(readSpy).toHaveBeenCalledTimes(1);
        expect(readSpy.mock.calls[0][1]).toBe(init.storageKey);
        expect(scanObjectSpy).not.toHaveBeenCalled();
        expect(scanSpy).toHaveBeenCalledWith(
          Uint8Array.from(original),
          'application/pdf',
          'document.pdf',
        );
        expect(objectStorage.hasObject(bucket, init.storageKey)).toBe(false);

        // The presigned PUT is still valid: the uploader writes new bytes.
        objectStorage.putObject(
          bucket,
          init.storageKey,
          Buffer.from('<script>alert(1)</script>'),
          'application/pdf',
        );

        const download = await service.getDownloadUrl(init.objectId);
        expect(download.downloadUrl).toContain(encodeURIComponent(verifiedKey));
        expect(
          Buffer.from(await objectStorage.readObject(bucket, verifiedKey)),
        ).toEqual(original);
        // A repeated finalize returns the settled DTO without re-reading.
        await expect(
          service.finalizeUpload(init.objectId),
        ).resolves.toMatchObject({ status: 'CLEAN', storageKey: verifiedKey });
      });

      it('rejects when the upload is re-written between inspection and copy', async () => {
        const init = await initiate();
        putPdf(init.storageKey, 1024);
        const realHead = objectStorage.getObjectMetadata.bind(objectStorage);
        jest
          .spyOn(objectStorage, 'getObjectMetadata')
          .mockImplementationOnce(async (b, key) => {
            const inspected = await realHead(b, key);
            const swapped = pdfBytes(1024);
            swapped.write('MZ-payload', 512);
            objectStorage.putObject(b, key, swapped, 'application/pdf');
            return inspected;
          });
        const scanSpy = jest.spyOn(malwareScanner, 'scanBytes');

        await expect(service.finalizeUpload(init.objectId)).rejects.toThrow(
          'Object changed during finalization.',
        );

        const stored = await repository.findById(init.objectId);
        expect(stored?.status).toBe('REJECTED');
        expect(scanSpy).not.toHaveBeenCalled();
        expect(
          objectStorage.hasObject(bucket, verifiedKeyOf(init.objectId)),
        ).toBe(false);
        await expect(
          service.getDownloadUrl(init.objectId),
        ).rejects.toBeInstanceOf(StorageObjectNotCleanException);
      });

      it('never promotes bytes re-written after the scanned read', async () => {
        const init = await initiate();
        putPdf(init.storageKey, 1024);
        jest
          .spyOn(malwareScanner, 'scanBytes')
          .mockImplementationOnce(async () => {
            const swapped = pdfBytes(1024);
            swapped.write('<script>alert(1)</script>', 512);
            objectStorage.putObject(
              bucket,
              init.storageKey,
              swapped,
              'application/pdf',
            );
            return { isClean: true, scanPolicy: 'test-policy' };
          });

        await expect(service.finalizeUpload(init.objectId)).rejects.toThrow(
          'Object changed during finalization.',
        );

        expect((await repository.findById(init.objectId))?.status).toBe(
          'REJECTED',
        );
        expect(
          objectStorage.hasObject(bucket, verifiedKeyOf(init.objectId)),
        ).toBe(false);
        expect(objectStorage.hasObject(bucket, init.storageKey)).toBe(false);
      });

      it('refuses a concurrent finalize while the first is scanning', async () => {
        const init = await initiate();
        putPdf(init.storageKey, 1024);
        let concurrent: Promise<unknown> | undefined;
        jest
          .spyOn(malwareScanner, 'scanBytes')
          .mockImplementationOnce(async () => {
            concurrent = service.finalizeUpload(init.objectId);
            await concurrent.catch(() => undefined);
            return { isClean: true, scanPolicy: 'test-policy' };
          });

        await expect(
          service.finalizeUpload(init.objectId),
        ).resolves.toMatchObject({ status: 'CLEAN' });
        await expect(concurrent).rejects.toThrow(
          'Upload is already being finalized.',
        );
      });

      it('returns the winner outcome when a racing finalize claims first', async () => {
        const init = await initiate();
        putPdf(init.storageKey, 1024);
        const realClaim = repository.claimForFinalization.bind(repository);
        jest
          .spyOn(repository, 'claimForFinalization')
          .mockImplementationOnce(async (id, entity, now) => {
            // Another request finalizes the object to CLEAN in between.
            await service.finalizeUpload(init.objectId);
            return realClaim(id, entity, now);
          });

        await expect(
          service.finalizeUpload(init.objectId),
        ).resolves.toMatchObject({ status: 'CLEAN' });
      });
    });
  });

  describe('compare-and-set transitions (P18)', () => {
    it('keeps an object deleted during its scan DELETED, without bytes', async () => {
      const init = await initiate();
      putPdf(init.storageKey, 1024);
      jest
        .spyOn(malwareScanner, 'scanBytes')
        .mockImplementationOnce(async () => {
          await service.deleteObject(init.objectId);
          return { isClean: true, scanPolicy: 'test-policy' };
        });

      const result = await service.finalizeUpload(init.objectId);

      expect(result.status).toBe('DELETED');
      const stored = await repository.findById(init.objectId);
      expect(stored?.status).toBe('DELETED');
      expect(
        objectStorage.hasObject(bucket, verifiedKeyOf(init.objectId)),
      ).toBe(false);
      expect(objectStorage.hasObject(bucket, init.storageKey)).toBe(false);
      await expect(
        service.getDownloadUrl(init.objectId),
      ).rejects.toBeInstanceOf(StorageObjectNotCleanException);
      // It no longer counts toward the per-question maxFiles (1 here).
      await expect(initiate({ fileName: 'replacement.pdf' })).resolves.toEqual(
        expect.objectContaining({ objectId: expect.any(String) }),
      );
    });

    it('refuses to delete an object that became ATTACHED concurrently', async () => {
      const init = await initiate();
      putPdf(init.storageKey, 1024);
      await service.finalizeUpload(init.objectId);
      const realTransition = repository.transition.bind(repository);
      jest
        .spyOn(repository, 'transition')
        .mockImplementationOnce(async (id, expected, entity) => {
          await service.attachObject(init.objectId);
          return realTransition(id, expected, entity);
        });

      await expect(service.deleteObject(init.objectId)).rejects.toThrow(
        'Attached objects cannot be deleted.',
      );
      expect((await repository.findById(init.objectId))?.status).toBe(
        'ATTACHED',
      );
      expect(
        objectStorage.hasObject(bucket, verifiedKeyOf(init.objectId)),
      ).toBe(true);
    });

    it('deletes idempotently and purges the upload and verified keys', async () => {
      const init = await initiate();
      putPdf(init.storageKey, 1024);
      await service.finalizeUpload(init.objectId);
      objectStorage.putObject(
        bucket,
        init.storageKey,
        pdfBytes(1024),
        'application/pdf',
      );

      await service.deleteObject(init.objectId);
      await service.deleteObject(init.objectId);

      expect((await repository.findById(init.objectId))?.status).toBe(
        'DELETED',
      );
      expect(objectStorage.hasObject(bucket, init.storageKey)).toBe(false);
      expect(
        objectStorage.hasObject(bucket, verifiedKeyOf(init.objectId)),
      ).toBe(false);
    });
  });

  describe('scanner outage recovery (BE-3)', () => {
    it('keeps an outage object at its upload key, then a retry succeeds', async () => {
      const init = await initiate();
      const original = putPdf(init.storageKey, 1024);
      malwareScanner.setSimulateOutage(true);

      await expect(service.finalizeUpload(init.objectId)).rejects.toThrow(
        StorageScannerOutageException,
      );

      const outage = await repository.findById(init.objectId);
      expect(outage?.status).toBe('QUARANTINED');
      expect(outage?.scanStatus).toBe('OUTAGE');
      expect(outage?.storageKey).toBe(init.storageKey);
      expect(objectStorage.hasObject(bucket, init.storageKey)).toBe(true);
      expect(
        objectStorage.hasObject(bucket, verifiedKeyOf(init.objectId)),
      ).toBe(false);

      malwareScanner.setSimulateOutage(false);
      const retried = await service.finalizeUpload(init.objectId);

      expect(retried).toMatchObject({
        status: 'CLEAN',
        scanStatus: 'CLEAN',
        storageKey: verifiedKeyOf(init.objectId),
      });
      expect(objectStorage.hasObject(bucket, init.storageKey)).toBe(false);
      expect(
        Buffer.from(
          await objectStorage.readObject(bucket, verifiedKeyOf(init.objectId)),
        ),
      ).toEqual(original);
    });

    it('retries after a thrown scanner failure as well', async () => {
      const init = await initiate();
      putPdf(init.storageKey, 1024);
      jest
        .spyOn(malwareScanner, 'scanBytes')
        .mockRejectedValueOnce(new Error('connection reset'));

      await expect(service.finalizeUpload(init.objectId)).rejects.toThrow(
        StorageScannerOutageException,
      );
      expect((await repository.findById(init.objectId))?.storageKey).toBe(
        init.storageKey,
      );

      await expect(
        service.finalizeUpload(init.objectId),
      ).resolves.toMatchObject({ status: 'CLEAN' });
    });

    it('lets only one retry claim an outage object', async () => {
      const init = await initiate();
      putPdf(init.storageKey, 1024);
      malwareScanner.setSimulateOutage(true);
      await expect(service.finalizeUpload(init.objectId)).rejects.toThrow(
        StorageScannerOutageException,
      );
      malwareScanner.setSimulateOutage(false);
      let concurrent: Promise<unknown> | undefined;
      jest
        .spyOn(malwareScanner, 'scanBytes')
        .mockImplementationOnce(async () => {
          concurrent = service.finalizeUpload(init.objectId);
          await concurrent.catch(() => undefined);
          return { isClean: true, scanPolicy: 'test-policy' };
        });

      await expect(
        service.finalizeUpload(init.objectId),
      ).resolves.toMatchObject({ status: 'CLEAN' });
      await expect(concurrent).rejects.toThrow(
        'Upload is already being finalized.',
      );
    });

    describe('maxFiles on retry (F3)', () => {
      async function outageUpload(fileName = 'document.pdf') {
        const init = await initiate({ fileName });
        putPdf(init.storageKey, 1024);
        malwareScanner.setSimulateOutage(true);
        await expect(service.finalizeUpload(init.objectId)).rejects.toThrow(
          StorageScannerOutageException,
        );
        malwareScanner.setSimulateOutage(false);
        return init;
      }

      it('refuses a retry once a replacement filled the question', async () => {
        const outage = await outageUpload();
        const replacement = await initiate({ fileName: 'replacement.pdf' });
        putPdf(replacement.storageKey, 1024);
        await service.finalizeUpload(replacement.objectId);
        const claimSpy = jest.spyOn(repository, 'claimForFinalization');

        await expect(service.finalizeUpload(outage.objectId)).rejects.toThrow(
          'This question allows at most 1 uploaded file(s).',
        );

        expect(claimSpy).not.toHaveBeenCalled();
        const stored = await repository.findById(outage.objectId);
        expect(stored?.status).toBe('QUARANTINED');
        expect(stored?.scanStatus).toBe('OUTAGE');
        await expect(
          service.getDownloadUrl(outage.objectId),
        ).rejects.toBeInstanceOf(StorageObjectNotCleanException);
      });

      it('allows the retry again once the replacement is deleted', async () => {
        const outage = await outageUpload();
        const replacement = await initiate({ fileName: 'replacement.pdf' });
        await service.deleteObject(replacement.objectId);

        await expect(
          service.finalizeUpload(outage.objectId),
        ).resolves.toMatchObject({ status: 'CLEAN' });
      });

      it('does not count other OUTAGE objects or other questions', async () => {
        const outage = await outageUpload();
        await outageUpload('second.pdf');
        const other = await initiate({ questionId: 'upload-2' });
        putPdf(other.storageKey, 1024);
        await service.finalizeUpload(other.objectId);

        await expect(
          service.finalizeUpload(outage.objectId),
        ).resolves.toMatchObject({ status: 'CLEAN' });
      });

      it("recounts against the question's own policy", async () => {
        const authorization: jest.Mocked<StorageOwnerAuthorizationPort> = {
          authorize: jest.fn().mockResolvedValue(undefined),
          resolveUploadPolicy: jest.fn().mockResolvedValue({
            maxFileSizeBytes: 10 * 1024 * 1024,
            allowedMimeTypes: [],
            maxFiles: 2,
          }),
        };
        service = new StorageService(
          repository,
          objectStorage,
          malwareScanner,
          authorization,
        );
        const outage = await outageUpload();
        const replacement = await initiate({ fileName: 'replacement.pdf' });
        putPdf(replacement.storageKey, 1024);
        await service.finalizeUpload(replacement.objectId);

        await expect(
          service.finalizeUpload(outage.objectId, null, undefined, 'cap'),
        ).resolves.toMatchObject({ status: 'CLEAN' });
        expect(authorization.resolveUploadPolicy).toHaveBeenLastCalledWith(
          expect.objectContaining({
            ownerContext: 'participation',
            ownerRecordId: validRecordId,
            questionId: 'upload-1',
          }),
          null,
          'cap',
        );
      });
    });

    it('still counts an INITIATED upload just after its window closes', async () => {
      await initiate();
      // 15-minute upload window + 1 minute: inside the 5-minute grace, where
      // a finalize that passed its expiry check may still be claiming.
      jest
        .spyOn(Date, 'now')
        .mockReturnValue(new Date().getTime() + 16 * 60 * 1000);

      await expect(initiate({ fileName: 'second.pdf' })).rejects.toThrow(
        'This question allows at most 1 uploaded file(s).',
      );
    });

    it('does not count an INITIATED upload past its window and grace', async () => {
      const lapsed = await initiate();
      jest
        .spyOn(Date, 'now')
        .mockReturnValue(new Date().getTime() + 21 * 60 * 1000);

      // maxFiles is 1 here; the lapsed upload can never be finalized.
      await expect(initiate({ fileName: 'replacement.pdf' })).resolves.toEqual(
        expect.objectContaining({ objectId: expect.any(String) }),
      );
      await expect(service.finalizeUpload(lapsed.objectId)).rejects.toThrow(
        'The upload session has expired.',
      );
    });

    it('still counts an INITIATED upload inside its window', async () => {
      await initiate();
      await expect(initiate({ fileName: 'second.pdf' })).rejects.toThrow(
        'This question allows at most 1 uploaded file(s).',
      );
    });

    it('refuses a full question with its own code and details (Phase 7)', async () => {
      await initiate();
      await expect(initiate({ fileName: 'second.pdf' })).rejects.toMatchObject({
        code: 'STORAGE_QUESTION_FULL',
        questionId: 'upload-1',
        maxFiles: 1,
      });
      await expect(initiate({ fileName: 'second.pdf' })).rejects.toBeInstanceOf(
        StorageQuestionFullException,
      );
    });

    it('does not count an outage object toward maxFiles', async () => {
      const init = await initiate();
      putPdf(init.storageKey, 1024);
      malwareScanner.setSimulateOutage(true);
      await expect(service.finalizeUpload(init.objectId)).rejects.toThrow(
        StorageScannerOutageException,
      );

      // maxFiles is 1 here: a replacement upload is still accepted.
      await expect(initiate({ fileName: 'replacement.pdf' })).resolves.toEqual(
        expect.objectContaining({ objectId: expect.any(String) }),
      );
    });
  });

  describe('rejected bytes (BE-11)', () => {
    let logger: { warn: jest.Mock; error: jest.Mock };

    beforeEach(() => {
      logger = { warn: jest.fn(), error: jest.fn() };
      service = new StorageService(
        repository,
        objectStorage,
        malwareScanner,
        undefined,
        undefined,
        logger,
      );
    });

    it('deletes the upload when its magic bytes do not match', async () => {
      const init = await initiate();
      objectStorage.putObject(
        bucket,
        init.storageKey,
        Buffer.alloc(1024, 0x41),
        'application/pdf',
      );

      await expect(service.finalizeUpload(init.objectId)).rejects.toThrow(
        'Uploaded bytes do not match the declared MIME signature.',
      );

      expect((await repository.findById(init.objectId))?.status).toBe(
        'REJECTED',
      );
      expect(objectStorage.hasObject(bucket, init.storageKey)).toBe(false);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('deletes an infected upload without promoting it', async () => {
      const init = await initiate({ fileName: 'test_virus.malware' });
      putPdf(init.storageKey, 1024);

      const finalized = await service.finalizeUpload(init.objectId);

      expect(finalized).toMatchObject({
        status: 'REJECTED',
        scanStatus: 'INFECTED',
      });
      expect(objectStorage.hasObject(bucket, init.storageKey)).toBe(false);
      expect(
        objectStorage.hasObject(bucket, verifiedKeyOf(init.objectId)),
      ).toBe(false);
    });

    it('keeps the rejection and logs when the deletion fails', async () => {
      const init = await initiate({ fileName: 'test_virus.malware' });
      putPdf(init.storageKey, 1024);
      jest
        .spyOn(objectStorage, 'deleteObject')
        .mockRejectedValue(new Error('storage unavailable'));

      await expect(
        service.finalizeUpload(init.objectId),
      ).resolves.toMatchObject({ status: 'REJECTED', scanStatus: 'INFECTED' });

      expect((await repository.findById(init.objectId))?.status).toBe(
        'REJECTED',
      );
      expect(logger.warn).toHaveBeenCalledWith(
        `Failed to delete bytes of stored object ${init.objectId}: storage unavailable`,
      );
    });

    it('keeps a magic-byte rejection when the deletion fails', async () => {
      const init = await initiate();
      objectStorage.putObject(
        bucket,
        init.storageKey,
        Buffer.alloc(1024, 0x41),
        'application/pdf',
      );
      jest
        .spyOn(objectStorage, 'deleteObject')
        .mockRejectedValue(new Error('storage unavailable'));

      await expect(service.finalizeUpload(init.objectId)).rejects.toThrow(
        StorageInvalidFileException,
      );
      expect((await repository.findById(init.objectId))?.status).toBe(
        'REJECTED',
      );
      expect(logger.warn).toHaveBeenCalledTimes(1);
    });
  });

  describe('listUploads (Phase 7 re-adopt)', () => {
    it('lists the live uploads of the owner record, per question, oldest first', async () => {
      const first = await initiate();
      putPdf(first.storageKey, 1024);
      await service.finalizeUpload(first.objectId);
      const other = await initiate({ questionId: 'upload-2' });
      const rejected = await initiate({
        questionId: 'upload-3',
        fileName: 'eicar.pdf',
      });
      putPdf(rejected.storageKey, 1024);
      await service.finalizeUpload(rejected.objectId);

      const all = await service.listUploads({
        ownerContext: 'participation',
        ownerRecordId: validRecordId,
      });
      expect(all.map((object) => [object.id, object.status])).toEqual([
        [first.objectId, 'CLEAN'],
        [other.objectId, 'INITIATED'],
      ]);
      const one = await service.listUploads({
        ownerContext: 'participation',
        ownerRecordId: validRecordId,
        questionId: 'upload-2',
      });
      expect(one.map((object) => object.id)).toEqual([other.objectId]);
    });

    it('authorizes the read like status and download', async () => {
      const authorize = jest.fn().mockResolvedValue(undefined);
      const guarded = new StorageService(
        repository,
        objectStorage,
        malwareScanner,
        {
          authorize,
          resolveUploadPolicy: jest.fn(),
        },
      );
      await guarded.listUploads(
        { ownerContext: 'participation', ownerRecordId: validRecordId },
        'user-1',
        'cap',
      );
      expect(authorize).toHaveBeenCalledWith(
        'participation',
        validRecordId,
        'user-1',
        'cap',
        'read',
      );
    });
  });

  describe('getDownloadUrl & attachObject', () => {
    it('should generate download URL only for CLEAN or ATTACHED objects', async () => {
      const init = await initiate({ fileName: 'verified_doc.pdf' });
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
      const init = await initiate({ fileName: 'bad.malware' });
      putPdf(init.storageKey, 1024);

      await service.finalizeUpload(init.objectId);

      await expect(service.attachObject(init.objectId)).rejects.toThrow(
        StorageObjectNotCleanException,
      );
    });
  });

  describe('owner authorization access mode (P16)', () => {
    it('authorizes mutations as write and status/download as read', async () => {
      const authorization: jest.Mocked<StorageOwnerAuthorizationPort> = {
        authorize: jest.fn().mockResolvedValue(undefined),
        resolveUploadPolicy: jest.fn().mockResolvedValue({
          maxFileSizeBytes: 10 * 1024 * 1024,
          allowedMimeTypes: [],
          maxFiles: 5,
        }),
      };
      service = new StorageService(
        repository,
        objectStorage,
        malwareScanner,
        authorization,
      );
      const userId = '55555555-5555-4555-8555-555555555555';

      const kept = await initiate();
      putPdf(kept.storageKey, 1024);
      await service.finalizeUpload(kept.objectId, userId);
      await service.getObjectStatus(kept.objectId, userId);
      await service.getDownloadUrl(kept.objectId, userId);
      await service.attachObject(kept.objectId, userId);
      const dropped = await initiate({ fileName: 'dropped.pdf' });
      await service.deleteObject(dropped.objectId, userId, 'capability');

      expect(authorization.resolveUploadPolicy).toHaveBeenCalledTimes(2);
      expect(
        authorization.authorize.mock.calls.map((call) => [call[2], call[4]]),
      ).toEqual([
        [userId, 'write'],
        [userId, 'read'],
        [userId, 'read'],
        [userId, 'write'],
        [userId, 'write'],
      ]);
      expect(authorization.authorize.mock.calls[4][3]).toBe('capability');
    });
  });

  describe('cleanupExpired (P11)', () => {
    const afterUploadWindow = () => new Date(Date.now() + 16 * 60 * 1000);

    it('continues past a failing byte deletion and reports it', async () => {
      const uploads: InitiateUploadResponse[] = [];
      for (const questionId of ['q-1', 'q-2', 'q-3']) {
        const init = await initiate({ questionId });
        putPdf(init.storageKey, 1024);
        uploads.push(init);
      }
      const realDelete = objectStorage.deleteObject.bind(objectStorage);
      jest
        .spyOn(objectStorage, 'deleteObject')
        .mockImplementation(async (b, key) => {
          if (key === uploads[1].storageKey) {
            throw new Error('storage unavailable');
          }
          return realDelete(b, key);
        });

      const result = await service.cleanupExpired(afterUploadWindow());

      expect(result.expired).toBe(2);
      expect(result.failures).toEqual([
        { objectId: uploads[1].objectId, reason: 'storage unavailable' },
      ]);
      for (const upload of uploads) {
        expect((await repository.findById(upload.objectId))?.status).toBe(
          'EXPIRED',
        );
      }
      expect(objectStorage.hasObject(bucket, uploads[0].storageKey)).toBe(
        false,
      );
      expect(objectStorage.hasObject(bucket, uploads[2].storageKey)).toBe(
        false,
      );
    });

    it('processes at most one batch per run', async () => {
      for (const questionId of ['q-1', 'q-2', 'q-3']) {
        await initiate({ questionId });
      }

      const first = await service.cleanupExpired(afterUploadWindow(), 2);
      const second = await service.cleanupExpired(afterUploadWindow(), 2);

      expect(first.expired).toBe(2);
      expect(second.expired).toBe(1);
    });

    describe('lapsed REJECTED objects (F1)', () => {
      const minutes = (count: number) =>
        new Date(Date.now() + count * 60 * 1000);
      /** Upload window (15 min) plus the purge margin (5 min) has passed. */
      const afterPurgeMargin = () => minutes(21);
      const empty = {
        expired: 0,
        purged: 0,
        failures: [],
        purgeFailures: [],
        purgeBatchFailure: null,
      };

      async function rejectedWithLeftoverBytes(fileName = 'test.malware') {
        const init = await initiate({ fileName, questionId: fileName });
        putPdf(init.storageKey, 1024);
        await service.finalizeUpload(init.objectId);
        // A re-PUT before the upload URL expired, and a legacy verified copy.
        putPdf(init.storageKey, 1024);
        putPdf(verifiedKeyOf(init.objectId), 1024);
        return init;
      }

      it('purges the bytes but keeps the object REJECTED', async () => {
        const init = await rejectedWithLeftoverBytes();

        const result = await service.cleanupExpired(afterPurgeMargin());

        expect(result).toEqual({ ...empty, purged: 1 });
        const stored = await repository.findById(init.objectId);
        expect(stored?.status).toBe('REJECTED');
        expect(stored?.scanStatus).toBe('INFECTED');
        expect(stored?.expiresAt).toBeNull();
        expect(objectStorage.hasObject(bucket, init.storageKey)).toBe(false);
        expect(
          objectStorage.hasObject(bucket, verifiedKeyOf(init.objectId)),
        ).toBe(false);
      });

      it('waits for the margin after the upload window before purging', async () => {
        const init = await rejectedWithLeftoverBytes();

        await expect(service.cleanupExpired(minutes(19))).resolves.toEqual(
          empty,
        );
        expect(objectStorage.hasObject(bucket, init.storageKey)).toBe(true);

        await expect(
          service.cleanupExpired(afterPurgeMargin()),
        ).resolves.toEqual({ ...empty, purged: 1 });
      });

      it('does not select a purged object again', async () => {
        await rejectedWithLeftoverBytes();
        await service.cleanupExpired(afterPurgeMargin());
        const deleteSpy = jest.spyOn(objectStorage, 'deleteObject');

        const second = await service.cleanupExpired(afterPurgeMargin());

        expect(second).toEqual(empty);
        expect(deleteSpy).not.toHaveBeenCalled();
      });

      it('backs a failed purge off with a growing delay, then retries it', async () => {
        const init = await rejectedWithLeftoverBytes();
        const realDelete = objectStorage.deleteObject.bind(objectStorage);
        const deleteSpy = jest
          .spyOn(objectStorage, 'deleteObject')
          .mockRejectedValue(new Error('AccessDenied'));
        const runAt = afterPurgeMargin();

        const first = await service.cleanupExpired(runAt);

        expect(first).toEqual({
          ...empty,
          purgeFailures: [{ objectId: init.objectId, reason: 'AccessDenied' }],
        });
        const pending = await repository.findById(init.objectId);
        expect(pending?.status).toBe('REJECTED');
        expect(pending?.scanResult).toMatchObject({ purgeAttempts: 1 });
        expect(pending?.expiresAt?.getTime()).toBe(
          runAt.getTime() + 60 * 60 * 1000,
        );

        // Not reselected by the next run at the same time.
        deleteSpy.mockClear();
        await expect(service.cleanupExpired(runAt)).resolves.toEqual(empty);
        expect(deleteSpy).not.toHaveBeenCalled();

        // Due again after 1h + margin; a second failure doubles the delay.
        const secondRun = new Date(runAt.getTime() + 66 * 60 * 1000);
        await service.cleanupExpired(secondRun);
        const backedOff = await repository.findById(init.objectId);
        expect(backedOff?.scanResult).toMatchObject({ purgeAttempts: 2 });
        expect(backedOff?.expiresAt?.getTime()).toBe(
          secondRun.getTime() + 2 * 60 * 60 * 1000,
        );

        deleteSpy.mockImplementation(realDelete);
        const thirdRun = new Date(secondRun.getTime() + 126 * 60 * 1000);
        await expect(service.cleanupExpired(thirdRun)).resolves.toEqual({
          ...empty,
          purged: 1,
        });
        expect(objectStorage.hasObject(bucket, init.storageKey)).toBe(false);
        const purged = await repository.findById(init.objectId);
        expect(purged?.status).toBe('REJECTED');
        expect(purged?.expiresAt).toBeNull();
      });

      it('keeps expiring while REJECTED rows exceed the batch', async () => {
        for (const name of ['a.malware', 'b.malware', 'c.malware']) {
          await rejectedWithLeftoverBytes(name);
        }
        const lapsedUpload = await initiate({ questionId: 'q-live' });

        // Expiry and purge budgets of 2 each: the 3 older REJECTED rows
        // must not keep the lapsed INITIATED upload from expiring.
        const result = await service.cleanupExpired(afterPurgeMargin(), 2, 2);

        expect(result).toMatchObject({ expired: 1, purged: 2 });
        expect((await repository.findById(lapsedUpload.objectId))?.status).toBe(
          'EXPIRED',
        );
        await expect(
          service.cleanupExpired(afterPurgeMargin(), 2, 2),
        ).resolves.toMatchObject({ expired: 0, purged: 1 });
      });

      it('reports one failure when both the purge and its record fail', async () => {
        const init = await rejectedWithLeftoverBytes();
        jest
          .spyOn(objectStorage, 'deleteObject')
          .mockRejectedValue(new Error('AccessDenied'));
        jest
          .spyOn(repository, 'recordRejectedPurge')
          .mockRejectedValue(new Error('database unavailable'));

        await expect(
          service.cleanupExpired(afterPurgeMargin()),
        ).resolves.toEqual({
          ...empty,
          purgeFailures: [{ objectId: init.objectId, reason: 'AccessDenied' }],
        });
      });

      it('reports a failed record once, after a successful purge', async () => {
        const init = await rejectedWithLeftoverBytes();
        jest
          .spyOn(repository, 'recordRejectedPurge')
          .mockRejectedValue(new Error('database unavailable'));

        await expect(
          service.cleanupExpired(afterPurgeMargin()),
        ).resolves.toEqual({
          ...empty,
          purgeFailures: [
            { objectId: init.objectId, reason: 'database unavailable' },
          ],
        });
      });

      it('keeps the expiry results when the purge batch cannot be selected', async () => {
        const lapsedUpload = await initiate({ questionId: 'q-live' });
        jest
          .spyOn(repository, 'findRejectedPendingPurge')
          .mockRejectedValue(new Error('database unavailable'));

        await expect(
          service.cleanupExpired(afterPurgeMargin()),
        ).resolves.toEqual({
          ...empty,
          expired: 1,
          purgeBatchFailure: 'database unavailable',
        });
        expect((await repository.findById(lapsedUpload.objectId))?.status).toBe(
          'EXPIRED',
        );
      });

      it('counts a purge only once when two runs race', async () => {
        const init = await rejectedWithLeftoverBytes();
        const stale = await repository.findById(init.objectId);
        await service.cleanupExpired(afterPurgeMargin());
        jest
          .spyOn(repository, 'findRejectedPendingPurge')
          .mockResolvedValueOnce(stale ? [stale] : []);

        await expect(
          service.cleanupExpired(afterPurgeMargin()),
        ).resolves.toEqual(empty);
      });
    });

    it('claims before purging, so an object attached meanwhile keeps its bytes', async () => {
      const init = await initiate();
      putPdf(init.storageKey, 1024);
      await service.finalizeUpload(init.objectId);
      const stale = await repository.findById(init.objectId);
      await service.attachObject(init.objectId);
      jest
        .spyOn(repository, 'findExpiredUnattached')
        .mockResolvedValueOnce(stale ? [stale] : []);

      const result = await service.cleanupExpired(
        new Date(Date.now() + 25 * 60 * 60 * 1000),
      );

      expect(result).toEqual({
        expired: 0,
        purged: 0,
        failures: [],
        purgeFailures: [],
        purgeBatchFailure: null,
      });
      expect((await repository.findById(init.objectId))?.status).toBe(
        'ATTACHED',
      );
      expect(
        objectStorage.hasObject(bucket, verifiedKeyOf(init.objectId)),
      ).toBe(true);
    });
  });
});
