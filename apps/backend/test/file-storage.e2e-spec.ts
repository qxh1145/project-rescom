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
import { USER_REPOSITORY_PORT } from '../src/modules/users/application/ports/user.repository.port';
import { InMemoryUserRepository } from '../src/modules/users/infrastructure/in-memory-user.repository';
import { SESSION_REPOSITORY_PORT } from '../src/modules/auth/application/ports/session-repository.port';
import { InMemorySessionRepository } from '../src/modules/auth/infrastructure/in-memory-session.repository';
import { IDENTITY_AUDIT_PORT } from '../src/modules/auth/application/ports/identity-audit.port';
import { InMemoryIdentityAuditRepository } from '../src/modules/auth/infrastructure/in-memory-identity-audit.repository';
import { SessionService } from '../src/modules/auth/application/session.service';
import { AUTH_COOKIE_NAME } from '../src/modules/auth/presentation/cookie-options.helper';
import { EnvService } from '../src/common/config/env.service';

import { PrismaService } from '../src/common/database/prisma.service';

describe('Story 5.3: File Storage & Validation E2E Tests', () => {
  let app: INestApplication;
  let storageRepo: InMemoryStorageRepository;
  let s3Service: InMemoryObjectStorageService;
  let malwareScanner: StubMalwareScannerService;
  let respondent: { cookie: string; csrf: string };

  const ALLOWED_ORIGIN = 'http://localhost:3000';
  const TEST_JWT_SECRET = 'at_least_32_characters_super_secure_jwt_secret_key!';
  const validRecordId = '44444444-4444-4444-8444-444444444444';
  const uploadInput = (overrides: Record<string, unknown> = {}) => ({
    fileName: 'research_consent.pdf',
    fileSize: 1024,
    mimeType: 'application/pdf',
    ownerContext: 'participation',
    ownerRecordId: validRecordId,
    questionId: 'upload-1',
    ...overrides,
  });

  beforeAll(async () => {
    storageRepo = new InMemoryStorageRepository();
    s3Service = new InMemoryObjectStorageService();
    malwareScanner = new StubMalwareScannerService();
    const userRepo = new InMemoryUserRepository();
    const auditRepo = new InMemoryIdentityAuditRepository();
    const sessionRepo = new InMemorySessionRepository(auditRepo);

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
      .overrideProvider(EnvService)
      .useValue(
        new EnvService({
          NODE_ENV: 'test',
          DATABASE_URL:
            'postgresql://postgres:postgres@localhost:5433/rescom_test',
          JWT_SECRET: TEST_JWT_SECRET,
          FRONTEND_ORIGINS: ALLOWED_ORIGIN,
        }),
      )
      .overrideProvider(USER_REPOSITORY_PORT)
      .useValue(userRepo)
      .overrideProvider(SESSION_REPOSITORY_PORT)
      .useValue(sessionRepo)
      .overrideProvider(IDENTITY_AUDIT_PORT)
      .useValue(auditRepo)
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

    const user = await userRepo.create({
      email: 'storage-student@fpt.edu.vn',
      passwordHash: null,
      role: 'RESPONDENT',
      status: 'ACTIVE',
    });
    const tokens = await moduleFixture
      .get(SessionService)
      .createSession(user.id);
    respondent = {
      cookie: `${AUTH_COOKIE_NAME}=${tokens.accessToken}`,
      csrf: tokens.csrfToken,
    };
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    storageRepo.clear();
    malwareScanner.setSimulateOutage(false);
  });

  /** Guest browser call: allowed Origin, JSON body (AD-20, review P12). */
  function initiate(body: object) {
    return request(app.getHttpServer())
      .post('/api/storage/uploads/initiate')
      .set('Origin', ALLOWED_ORIGIN)
      .set('Content-Type', 'application/json')
      .send(body);
  }

  function finalize(objectId: string, body: object = {}) {
    return request(app.getHttpServer())
      .post(`/api/storage/uploads/${objectId}/finalize`)
      .set('Origin', ALLOWED_ORIGIN)
      .set('Content-Type', 'application/json')
      .send(body);
  }

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
      const res = await initiate(
        uploadInput({
          fileName: 'identity_card.jpg',
          fileSize: 1024 * 500, // 500 KB
          mimeType: 'image/jpeg',
        }),
      ).expect(201);

      expect(res.body.data).toBeDefined();
      expect(res.body.data.objectId).toBeDefined();
      expect(res.body.data.uploadUrl).toBeDefined();
      expect(res.body.data.storageKey).toContain(validRecordId);
      expect(res.body.data.storageKey).toContain('identity_card.jpg');
    });

    it('should reject prohibited executable MIME types with status 400', async () => {
      const res = await initiate(
        uploadInput({
          fileName: 'trojan.exe',
          mimeType: 'application/x-msdownload',
        }),
      ).expect(400);

      expect(res.body.error).toBeDefined();
    });

    it('should reject file sizes exceeding 50MB with status 400', async () => {
      const res = await initiate(
        uploadInput({
          fileName: 'giant_video.mp4',
          fileSize: 55 * 1024 * 1024,
          mimeType: 'video/mp4',
        }),
      ).expect(400);

      expect(res.body.error).toBeDefined();
    });

    it('should require questionId for participation uploads (review P4)', async () => {
      const res = await initiate(uploadInput({ questionId: undefined })).expect(
        400,
      );

      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toContain('questionId is required');
    });
  });

  describe('AD-20 CSRF on storage mutations (review P12)', () => {
    it('rejects a guest mutation without an Origin with 403', async () => {
      const initRes = await request(app.getHttpServer())
        .post('/api/storage/uploads/initiate')
        .set('Content-Type', 'application/json')
        .send(uploadInput())
        .expect(403);
      expect(initRes.body.error.code).toBe('AUTH_FORBIDDEN_ORIGIN');

      const { objectId } = (await initiate(uploadInput()).expect(201)).body
        .data;
      await request(app.getHttpServer())
        .post(`/api/storage/uploads/${objectId}/finalize`)
        .set('Content-Type', 'application/json')
        .send({})
        .expect(403);
      await request(app.getHttpServer())
        .delete(`/api/storage/objects/${objectId}`)
        .expect(403);
      await request(app.getHttpServer())
        .delete(`/api/storage/objects/${objectId}`)
        .set('Origin', 'https://evil.example')
        .expect(403);
      await request(app.getHttpServer())
        .delete(`/api/storage/objects/${objectId}`)
        .set('Origin', ALLOWED_ORIGIN)
        .expect(204);
    });

    it('requires the synchronizer token when a session is present', async () => {
      const missing = await request(app.getHttpServer())
        .post('/api/storage/uploads/initiate')
        .set('Cookie', respondent.cookie)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'application/json')
        .send(uploadInput())
        .expect(403);
      expect(missing.body.error.code).toBe('AUTH_INVALID_CSRF_TOKEN');

      await request(app.getHttpServer())
        .post('/api/storage/uploads/initiate')
        .set('Cookie', respondent.cookie)
        .set('Origin', ALLOWED_ORIGIN)
        .set('x-csrf-token', respondent.csrf)
        .set('Content-Type', 'application/json')
        .send(uploadInput())
        .expect(201);
    });

    it('accepts JSON payloads only', async () => {
      await request(app.getHttpServer())
        .post('/api/storage/uploads/initiate')
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send('fileName=a.pdf')
        .expect(415);
    });

    it('rejects an unknown finalize field with 400 VALIDATION_ERROR', async () => {
      const { objectId, storageKey } = (
        await initiate(uploadInput()).expect(201)
      ).body.data;
      putPdf(storageKey, 1024);

      const res = await finalize(objectId, { status: 'CLEAN' }).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');

      const malformed = await finalize(objectId, {
        checksum: 'not-a-sha256',
      }).expect(400);
      expect(malformed.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('Full Upload & Quarantine Lifecycle: Initiate -> Direct Upload -> Finalize -> Download', () => {
    it('should complete clean file lifecycle successfully', async () => {
      // 1. Initiate
      const initRes = await initiate(
        uploadInput({ fileSize: 1024 * 120 }),
      ).expect(201);

      const { objectId, storageKey } = initRes.body.data;

      // 2. Simulate the private object-store PUT outside the application API.
      putPdf(storageKey, 1024 * 120);

      // 3. Finalize & Scan
      const finalizeRes = await finalize(objectId).expect(200);

      expect(finalizeRes.body.data.status).toBe('CLEAN');
      expect(finalizeRes.body.data.scanStatus).toBe('CLEAN');
      // Downloads use the server-owned verified copy (review P10).
      expect(finalizeRes.body.data.storageKey).toBe(
        `verified/participation/${validRecordId}/${objectId}`,
      );

      // 4. Download URL
      const downloadRes = await request(app.getHttpServer())
        .get(`/api/storage/objects/${objectId}/download-url`)
        .expect(200);

      expect(downloadRes.body.data.downloadUrl).toBeDefined();
      expect(downloadRes.body.data.fileName).toBe('research_consent.pdf');
    });

    it('should reject infected uploads and prevent download with 403', async () => {
      // 1. Initiate infected file
      const initRes = await initiate(
        uploadInput({ fileName: 'eicar_test.malware' }),
      ).expect(201);

      const { objectId, storageKey } = initRes.body.data;
      putPdf(storageKey, 1024);

      // 2. Finalize & Scan
      const finalizeRes = await finalize(objectId).expect(200);

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
      const initRes = await initiate(
        uploadInput({ fileName: 'outage_trigger.outage.pdf' }),
      ).expect(201);

      const { objectId, storageKey } = initRes.body.data;
      putPdf(storageKey, 1024);

      // 2. Finalize -> 503 Service Unavailable
      await finalize(objectId).expect(503);

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
