import { Test, TestingModule } from '@nestjs/testing';
import { StorageController } from './storage.controller';
import { StorageService } from '../application/storage.service';
import { InMemoryObjectStorageService } from '../infrastructure/in-memory-object-storage.service';
import { InMemoryStorageRepository } from '../infrastructure/in-memory-storage.repository';
import { StubMalwareScannerService } from '../infrastructure/stub-malware-scanner.service';
import { STORAGE_REPOSITORY_PORT } from '../application/ports/storage-repository.port';
import { OBJECT_STORAGE_PORT } from '../application/ports/object-storage.port';
import { MALWARE_SCANNER_PORT } from '../application/ports/malware-scanner.port';
import { SessionService } from '../../auth/application/session.service';
import { EnvService } from '../../../common/config/env.service';

describe('StorageController', () => {
  let controller: StorageController;
  let service: StorageService;
  let s3Service: InMemoryObjectStorageService;

  const validRecordId = '33333333-3333-4333-8333-333333333333';

  beforeEach(async () => {
    const repository = new InMemoryStorageRepository();
    s3Service = new InMemoryObjectStorageService();
    const malwareScanner = new StubMalwareScannerService();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StorageController],
      providers: [
        {
          provide: STORAGE_REPOSITORY_PORT,
          useValue: repository,
        },
        {
          provide: OBJECT_STORAGE_PORT,
          useValue: s3Service,
        },
        {
          provide: MALWARE_SCANNER_PORT,
          useValue: malwareScanner,
        },
        {
          provide: SessionService,
          useValue: {
            validateSession: jest.fn(),
          },
        },
        {
          provide: EnvService,
          useValue: {
            jwtSecret: 'test-secret',
          },
        },
        {
          provide: StorageService,
          useFactory: () =>
            new StorageService(repository, s3Service, malwareScanner),
        },
      ],
    }).compile();

    controller = module.get<StorageController>(StorageController);
    service = module.get<StorageService>(StorageService);
  });

  function putObject(
    storageKey: string,
    size: number,
    mimeType: 'application/pdf' | 'image/png',
  ): void {
    const bytes = Buffer.alloc(size);
    if (mimeType === 'application/pdf') bytes.write('%PDF-1.7');
    else Buffer.from([0x89, 0x50, 0x4e, 0x47]).copy(bytes);
    s3Service.putObject('rescom-private-storage', storageKey, bytes, mimeType);
  }

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should initiate upload and wrap in standard success envelope', async () => {
    const res = await controller.initiateUpload(
      {
        fileName: 'passport.jpg',
        fileSize: 1024 * 300,
        mimeType: 'image/jpeg',
        ownerContext: 'participation',
        ownerRecordId: validRecordId,
      },
      null,
    );

    expect(res.data).toBeDefined();
    expect(res.data!.objectId).toBeDefined();
    expect(res.data!.uploadUrl).toBeDefined();
    expect(res.data!.storageKey).toContain(validRecordId);
  });

  it('should finalize upload and return verified clean object DTO', async () => {
    const init = await service.initiateUpload({
      fileName: 'answers_sheet.pdf',
      fileSize: 1024 * 150,
      mimeType: 'application/pdf',
      ownerContext: 'participation',
      ownerRecordId: validRecordId,
    });
    putObject(init.storageKey, 1024 * 150, 'application/pdf');

    const res = await controller.finalizeUpload(init.objectId, {}, null);
    expect(res.data).toBeDefined();
    expect(res.data!.status).toBe('CLEAN');
    expect(res.data!.scanStatus).toBe('CLEAN');
  });

  it('should return download URL for clean object', async () => {
    const init = await service.initiateUpload({
      fileName: 'verified.png',
      fileSize: 1024 * 50,
      mimeType: 'image/png',
      ownerContext: 'participation',
      ownerRecordId: validRecordId,
    });
    putObject(init.storageKey, 1024 * 50, 'image/png');

    await service.finalizeUpload(init.objectId);

    const res = await controller.getDownloadUrl(init.objectId, null);
    expect(res.data).toBeDefined();
    expect(res.data!.downloadUrl).toBeDefined();
    expect(res.data!.fileName).toBe('verified.png');
  });

  it('should get object status metadata', async () => {
    const init = await service.initiateUpload({
      fileName: 'status_check.pdf',
      fileSize: 1024 * 50,
      mimeType: 'application/pdf',
      ownerContext: 'participation',
      ownerRecordId: validRecordId,
    });

    const res = await controller.getObjectStatus(init.objectId, null);
    expect(res.data).toBeDefined();
    expect(res.data!.id).toBe(init.objectId);
    expect(res.data!.status).toBe('INITIATED');
  });

  it('should reject malformed finalize checksums', async () => {
    await expect(
      controller.finalizeUpload(
        '33333333-3333-4333-8333-333333333333',
        { checksum: 'not-a-sha256' },
        null,
      ),
    ).rejects.toThrow(/Checksum must be/);
  });
});
