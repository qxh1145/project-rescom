import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, Logger } from '@nestjs/common';
import request from 'supertest';
import {
  listUploadsResponseSchema,
  storageQuestionFullDetailsSchema,
} from '@rescom/schemas';
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

  afterEach(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    storageRepo.clear();
    malwareScanner.setSimulateOutage(false);
  });

  /** The structured `storage.*` error events StorageService logged. */
  function storageLogEvents(logSpy: jest.SpyInstance): unknown[] {
    return logSpy.mock.calls
      .map(([message]) => String(message))
      .filter((message) => message.startsWith('{"event":"storage.'))
      .map((message) => JSON.parse(message));
  }

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

      // 2. Finalize -> 503 Service Unavailable, alertable and correlated
      // (IR.5 C3/C6): one structured event carrying the response's request id.
      const logSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      const outage = await finalize(objectId).expect(503);
      expect(outage.body.error.code).toBe('STORAGE_SCANNER_OUTAGE');
      expect(outage.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
      expect(outage.body.error.requestId).toBe(outage.headers['x-request-id']);
      expect(storageLogEvents(logSpy)).toEqual([
        {
          event: 'storage.scan_outage',
          objectId,
          requestId: outage.headers['x-request-id'],
          reason: expect.any(String),
        },
      ]);
      expect(JSON.stringify(storageLogEvents(logSpy))).not.toContain(
        storageKey,
      );

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
  describe('IR.5 C2/C6: private storage outage fails closed', () => {
    it('answers 503 STORAGE_UNAVAILABLE, keeps the object INITIATED and stays retryable', async () => {
      const { objectId, storageKey } = (
        await initiate(uploadInput()).expect(201)
      ).body.data;
      putPdf(storageKey, 1024);
      const metadataSpy = jest
        .spyOn(s3Service, 'getObjectMetadata')
        .mockRejectedValueOnce(new Error('connect ECONNREFUSED 127.0.0.1:1'));
      const logSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      const res = await finalize(objectId)
        .set('X-Request-Id', '7d5b0b32-6a43-4d63-9d7e-2f0e8f3a6c11')
        .expect(503);

      expect(metadataSpy).toHaveBeenCalledTimes(1);
      expect(res.body.error.code).toBe('STORAGE_UNAVAILABLE');
      // A well-formed inbound id is honoured end to end.
      expect(res.headers['x-request-id']).toBe(
        '7d5b0b32-6a43-4d63-9d7e-2f0e8f3a6c11',
      );
      expect(res.body.error.requestId).toBe(
        '7d5b0b32-6a43-4d63-9d7e-2f0e8f3a6c11',
      );
      expect(storageLogEvents(logSpy)).toEqual([
        {
          event: 'storage.unavailable',
          objectId,
          requestId: '7d5b0b32-6a43-4d63-9d7e-2f0e8f3a6c11',
          reason: expect.any(String),
        },
      ]);

      const status = await request(app.getHttpServer())
        .get(`/api/storage/objects/${objectId}/status`)
        .expect(200);
      expect(status.body.data.status).toBe('INITIATED');
      await request(app.getHttpServer())
        .get(`/api/storage/objects/${objectId}/download-url`)
        .expect(403);

      // Storage is back: the same object finalizes.
      const retried = await finalize(objectId).expect(200);
      expect(retried.body.data.status).toBe('CLEAN');
    });

    it('replaces a malformed inbound X-Request-Id', async () => {
      const res = await finalize('00000000-0000-4000-8000-000000000000')
        .set('X-Request-Id', 'not a uuid; DROP TABLE')
        .expect(404);
      expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
      expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
    });
  });

  describe('Phase 7: full question and re-adoptable uploads', () => {
    it('refuses an upload past maxFiles with 409 STORAGE_QUESTION_FULL and details', async () => {
      for (let i = 0; i < 10; i += 1) {
        await initiate(uploadInput({ fileName: `file-${i}.pdf` })).expect(201);
      }
      const res = await initiate(
        uploadInput({ fileName: 'one-too-many.pdf' }),
      ).expect(409);
      expect(res.body.error.code).toBe('STORAGE_QUESTION_FULL');
      expect(
        storageQuestionFullDetailsSchema.parse(res.body.error.details),
      ).toEqual({ questionId: 'upload-1', maxFiles: 10 });
    });

    it('lists the live uploads of an attempt question (GET /storage/uploads)', async () => {
      const first = await initiate(uploadInput()).expect(201);
      putPdf(first.body.data.storageKey, 1024);
      await finalize(first.body.data.objectId).expect(200);
      const other = await initiate(
        uploadInput({ questionId: 'upload-2' }),
      ).expect(201);

      const res = await request(app.getHttpServer())
        .get('/api/storage/uploads')
        .query({
          ownerContext: 'participation',
          ownerRecordId: validRecordId,
          questionId: 'upload-1',
        })
        .expect(200);
      const listed = listUploadsResponseSchema.parse(res.body.data);
      expect(
        listed.objects.map((object) => [object.id, object.status]),
      ).toEqual([[first.body.data.objectId, 'CLEAN']]);

      const all = await request(app.getHttpServer())
        .get('/storage/uploads')
        .query({ ownerContext: 'participation', ownerRecordId: validRecordId })
        .expect(200);
      expect(
        all.body.data.objects.map((object: { id: string }) => object.id),
      ).toEqual([first.body.data.objectId, other.body.data.objectId]);

      const invalid = await request(app.getHttpServer())
        .get('/api/storage/uploads')
        .query({ ownerContext: 'participation', ownerRecordId: 'nope' })
        .expect(400);
      expect(invalid.body.error.code).toBe('VALIDATION_ERROR');
    });
  });
});
