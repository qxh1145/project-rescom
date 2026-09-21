import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { STORAGE_REPOSITORY_PORT } from '../src/modules/storage/application/ports/storage-repository.port';
import { InMemoryStorageRepository } from '../src/modules/storage/infrastructure/in-memory-storage.repository';
import { OBJECT_STORAGE_PORT } from '../src/modules/storage/application/ports/object-storage.port';
import { InMemoryObjectStorageService } from '../src/modules/storage/infrastructure/in-memory-object-storage.service';
import { MALWARE_SCANNER_PORT } from '../src/modules/storage/application/ports/malware-scanner.port';
import { StubMalwareScannerService } from '../src/modules/storage/infrastructure/stub-malware-scanner.service';
import { HttpExceptionFilter } from '../src/common/http/http-exception.filter';
import { STORAGE_OWNER_AUTHORIZATION_PORT } from '../src/modules/storage/application/ports/storage-owner-authorization.port';

import { PrismaService } from '../src/common/database/prisma.service';

describe('Story 5.3: File Storage & Validation E2E Tests', () => {
  let app: INestApplication;
  let storageRepo: InMemoryStorageRepository;
  let s3Service: InMemoryObjectStorageService;
  let malwareScanner: StubMalwareScannerService;

  const validRecordId = '44444444-4444-4444-8444-444444444444';

  beforeAll(async () => {
    storageRepo = new InMemoryStorageRepository();
    s3Service = new InMemoryObjectStorageService();
    malwareScanner = new StubMalwareScannerService();

    const mockPrisma: any = {
      $connect: jest.fn(),
      $disconnect: jest.fn(),
      $transaction: jest.fn((cb) => cb(mockPrisma)),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(mockPrisma)
      .overrideProvider(STORAGE_REPOSITORY_PORT)
      .useValue(storageRepo)
      .overrideProvider(OBJECT_STORAGE_PORT)
      .useValue(s3Service)
      .overrideProvider(MALWARE_SCANNER_PORT)
      .useValue(malwareScanner)
      .overrideProvider(STORAGE_OWNER_AUTHORIZATION_PORT)
      .useValue({
        authorize: jest.fn(),
        resolveUploadPolicy: jest.fn().mockResolvedValue({
          maxFileSizeBytes: 50 * 1024 * 1024,
          allowedMimeTypes: [],
          maxFiles: 10,
        }),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    storageRepo.clear();
    malwareScanner.setSimulateOutage(false);
  });

  function putPdf(storageKey: string, size: number): void {
    const bytes = Buffer.alloc(size);
    bytes.write('%PDF-1.7');
    s3Service.putObject(
      'rescom-private-storage',
      storageKey,
      bytes,
      'application/pdf',
    );
  }

  describe('POST /api/storage/uploads/initiate', () => {
    it('should initiate upload and return presigned URL with status 201', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/storage/uploads/initiate')
        .send({
          fileName: 'identity_card.jpg',
          fileSize: 1024 * 500, // 500 KB
          mimeType: 'image/jpeg',
          ownerContext: 'participation',
          ownerRecordId: validRecordId,
        })
        .expect(201);

      expect(res.body.data).toBeDefined();
      expect(res.body.data.objectId).toBeDefined();
      expect(res.body.data.uploadUrl).toBeDefined();
      expect(res.body.data.storageKey).toContain(validRecordId);
      expect(res.body.data.storageKey).toContain('identity_card.jpg');
    });

    it('should reject prohibited executable MIME types with status 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/storage/uploads/initiate')
        .send({
          fileName: 'trojan.exe',
          fileSize: 1024,
          mimeType: 'application/x-msdownload',
          ownerContext: 'participation',
          ownerRecordId: validRecordId,
        })
        .expect(400);

      expect(res.body.error).toBeDefined();
    });

    it('should reject file sizes exceeding 50MB with status 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/storage/uploads/initiate')
        .send({
          fileName: 'giant_video.mp4',
          fileSize: 55 * 1024 * 1024,
          mimeType: 'video/mp4',
          ownerContext: 'participation',
          ownerRecordId: validRecordId,
        })
        .expect(400);

      expect(res.body.error).toBeDefined();
    });
  });

  describe('Full Upload & Quarantine Lifecycle: Initiate -> Direct Upload -> Finalize -> Download', () => {
    it('should complete clean file lifecycle successfully', async () => {
      // 1. Initiate
      const initRes = await request(app.getHttpServer())
        .post('/api/storage/uploads/initiate')
        .send({
          fileName: 'research_consent.pdf',
          fileSize: 1024 * 120,
          mimeType: 'application/pdf',
          ownerContext: 'participation',
          ownerRecordId: validRecordId,
        })
        .expect(201);

      const { objectId, storageKey } = initRes.body.data;

      // 2. Simulate the private object-store PUT outside the application API.
      putPdf(storageKey, 1024 * 120);

      // 3. Finalize & Scan
      const finalizeRes = await request(app.getHttpServer())
        .post(`/api/storage/uploads/${objectId}/finalize`)
        .send({})
        .expect(200);

      expect(finalizeRes.body.data.status).toBe('CLEAN');
      expect(finalizeRes.body.data.scanStatus).toBe('CLEAN');

      // 4. Download URL
      const downloadRes = await request(app.getHttpServer())
        .get(`/api/storage/objects/${objectId}/download-url`)
        .expect(200);

      expect(downloadRes.body.data.downloadUrl).toBeDefined();
      expect(downloadRes.body.data.fileName).toBe('research_consent.pdf');
    });

    it('should reject infected uploads and prevent download with 403', async () => {
      // 1. Initiate infected file
      const initRes = await request(app.getHttpServer())
        .post('/api/storage/uploads/initiate')
        .send({
          fileName: 'eicar_test.malware',
          fileSize: 1024,
          mimeType: 'application/pdf',
          ownerContext: 'participation',
          ownerRecordId: validRecordId,
        })
        .expect(201);

      const { objectId, storageKey } = initRes.body.data;
      putPdf(storageKey, 1024);

      // 2. Finalize & Scan
      const finalizeRes = await request(app.getHttpServer())
        .post(`/api/storage/uploads/${objectId}/finalize`)
        .send({})
        .expect(200);

      expect(finalizeRes.body.data.status).toBe('REJECTED');
      expect(finalizeRes.body.data.scanStatus).toBe('INFECTED');

      // 3. Attempt to download rejected file -> 403 Forbidden
      const downloadRes = await request(app.getHttpServer())
        .get(`/api/storage/objects/${objectId}/download-url`)
        .expect(403);

      expect(downloadRes.body.error.code).toBe('STORAGE_OBJECT_NOT_CLEAN');
    });

    it('should fail closed on scanner outage with 503 and keep object QUARANTINED (AD-22)', async () => {
      // 1. Initiate file with .outage in name
      const initRes = await request(app.getHttpServer())
        .post('/api/storage/uploads/initiate')
        .send({
          fileName: 'outage_trigger.outage.pdf',
          fileSize: 1024,
          mimeType: 'application/pdf',
          ownerContext: 'participation',
          ownerRecordId: validRecordId,
        })
        .expect(201);

      const { objectId, storageKey } = initRes.body.data;
      putPdf(storageKey, 1024);

      // 2. Finalize -> 503 Service Unavailable
      await request(app.getHttpServer())
        .post(`/api/storage/uploads/${objectId}/finalize`)
        .send({})
        .expect(503);

      // 3. Status check -> QUARANTINED / OUTAGE
      const statusRes = await request(app.getHttpServer())
        .get(`/api/storage/objects/${objectId}/status`)
        .expect(200);

      expect(statusRes.body.data.status).toBe('QUARANTINED');
      expect(statusRes.body.data.scanStatus).toBe('OUTAGE');

      // 4. Download attempt -> 403 Forbidden (fail closed!)
      await request(app.getHttpServer())
        .get(`/api/storage/objects/${objectId}/download-url`)
        .expect(403);
    });
  });
});
