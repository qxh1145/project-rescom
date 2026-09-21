import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { USER_REPOSITORY_PORT } from '../src/modules/users/application/ports/user.repository.port';
import { InMemoryUserRepository } from '../src/modules/users/infrastructure/in-memory-user.repository';
import { SESSION_REPOSITORY_PORT } from '../src/modules/auth/application/ports/session-repository.port';
import { InMemorySessionRepository } from '../src/modules/auth/infrastructure/in-memory-session.repository';
import { IDENTITY_AUDIT_PORT } from '../src/modules/auth/application/ports/identity-audit.port';
import { InMemoryIdentityAuditRepository } from '../src/modules/auth/infrastructure/in-memory-identity-audit.repository';
import { FORM_REPOSITORY_PORT } from '../src/modules/forms/application/ports/form-repository.port';
import { InMemoryFormRepository } from '../src/modules/forms/infrastructure/in-memory-form.repository';
import { SessionService } from '../src/modules/auth/application/session.service';
import { EnvService } from '../src/common/config/env.service';
import { PrismaService } from '../src/common/database/prisma.service';
import { HttpExceptionFilter } from '../src/common/http/http-exception.filter';
import { AUTH_COOKIE_NAME } from '../src/modules/auth/presentation/cookie-options.helper';

describe('Story 2.7: Form Versioning E2E Tests', () => {
  let app: INestApplication;
  let userRepo: InMemoryUserRepository;
  let sessionRepo: InMemorySessionRepository;
  let auditRepo: InMemoryIdentityAuditRepository;
  let formRepo: InMemoryFormRepository;
  let sessionService: SessionService;
  let envService: EnvService;

  const TEST_JWT_SECRET = 'at_least_32_characters_super_secure_jwt_secret_key!';
  const ALLOWED_ORIGIN = 'http://localhost:3000';

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ||
      'postgresql://postgres:postgres@localhost:5433/rescom_test';

    userRepo = new InMemoryUserRepository();
    auditRepo = new InMemoryIdentityAuditRepository();
    sessionRepo = new InMemorySessionRepository(auditRepo);
    formRepo = new InMemoryFormRepository();

    envService = new EnvService({
      NODE_ENV: 'test',
      PORT: 4000,
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5433/rescom_test',
      JWT_SECRET: TEST_JWT_SECRET,
      JWT_ACCESS_TTL_SECONDS: 900,
      BCRYPT_ROUNDS: 12,
      FRONTEND_ORIGINS: ALLOWED_ORIGIN,
    });

    const mockPrisma = {
      $connect: jest.fn().mockResolvedValue(undefined),
      $disconnect: jest.fn().mockResolvedValue(undefined),
      form: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        count: jest.fn(),
      },
      formVersion: {
        create: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(mockPrisma)
      .overrideProvider(USER_REPOSITORY_PORT)
      .useValue(userRepo)
      .overrideProvider(SESSION_REPOSITORY_PORT)
      .useValue(sessionRepo)
      .overrideProvider(IDENTITY_AUDIT_PORT)
      .useValue(auditRepo)
      .overrideProvider(FORM_REPOSITORY_PORT)
      .useValue(formRepo)
      .overrideProvider(EnvService)
      .useValue(envService)
      .compile();

    sessionService = moduleFixture.get(SessionService);

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalFilters(new HttpExceptionFilter());

    app.enableCors({
      origin: (origin, callback) => {
        if (!origin || envService.frontendOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(null, false);
        }
      },
      credentials: true,
    });

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    userRepo.clear();
    sessionRepo.clear();
    auditRepo.clear();
    formRepo.clear();
  });

  async function createTestUserWithSession(
    email: string,
    role: 'ADMIN' | 'PUBLISHER' | 'RESPONDENT' = 'PUBLISHER',
  ) {
    const user = await userRepo.create({
      email,
      passwordHash: '$2a$12$someHashedPassword',
      role,
      status: 'ACTIVE',
    });
    const tokens = await sessionService.createSession(user.id);
    return { user, tokens };
  }

  const validQuestionBlock = {
    id: 'block-q1',
    type: 'text',
    order: 0,
    title: 'Initial question for v1',
    required: true,
  };

  async function createPublishedForm(tokens: {
    accessToken: string;
    csrfToken: string;
  }) {
    const draftRes = await request(app.getHttpServer())
      .post('/forms')
      .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
      .set('X-CSRF-Token', tokens.csrfToken)
      .set('Origin', ALLOWED_ORIGIN)
      .set('Content-Type', 'application/json')
      .send({
        title: 'Original Published Survey',
        type: 'INTERNAL',
        rewardPerResponse: 0,
        schema: {
          schemaVersion: 1,
          title: 'Original Published Survey',
          blocks: [validQuestionBlock],
        },
      });

    const formId = draftRes.body.data.id;

    const publishRes = await request(app.getHttpServer())
      .post(`/forms/${formId}/publish`)
      .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
      .set('X-CSRF-Token', tokens.csrfToken)
      .set('Origin', ALLOWED_ORIGIN)
      .set('Content-Type', 'application/json')
      .send();

    expect(publishRes.status).toBe(200);
    expect(publishRes.body.data.status).toBe('PUBLISHED');

    return formId;
  }

  describe('AC1 & AC3: POST /forms/:id/versions', () => {
    it('successfully creates a new draft version from a published form', async () => {
      const { tokens } = await createTestUserWithSession(
        'publisher@example.com',
      );
      const formId = await createPublishedForm(tokens);

      const res = await request(app.getHttpServer())
        .post(`/forms/${formId}/versions`)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .set('X-CSRF-Token', tokens.csrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'application/json')
        .send();

      expect(res.status).toBe(201);
      expect(res.body.error).toBeNull();
      expect(res.body.data.id).toBe(formId);
      expect(res.body.data.status).toBe('DRAFT');
      expect(res.body.data.currentVersion.versionNumber).toBe(2);
      expect(res.body.data.currentVersion.isPublished).toBe(false);
      expect(res.body.data.currentVersion.publishedAt).toBeNull();
      expect(res.body.data.currentVersion.schemaJson.blocks).toEqual([
        validQuestionBlock,
      ]);
      expect(res.body.meta.message).toContain(
        'New form version created successfully',
      );
    });

    it('rejects version creation if form is not in PUBLISHED status (e.g. still DRAFT)', async () => {
      const { tokens } = await createTestUserWithSession(
        'publisher@example.com',
      );

      const draftRes = await request(app.getHttpServer())
        .post('/forms')
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .set('X-CSRF-Token', tokens.csrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'application/json')
        .send({
          title: 'Unpublished Draft',
        });

      const formId = draftRes.body.data.id;

      const res = await request(app.getHttpServer())
        .post(`/forms/${formId}/versions`)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .set('X-CSRF-Token', tokens.csrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'application/json')
        .send();

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('FORM_NOT_PUBLISHED');
      expect(res.body.error.message).toContain('must be in PUBLISHED status');
    });

    it('rejects version creation by unauthorized non-owner user with 403', async () => {
      const { tokens: ownerTokens } =
        await createTestUserWithSession('owner@example.com');
      const { tokens: intruderTokens } = await createTestUserWithSession(
        'intruder@example.com',
      );
      const formId = await createPublishedForm(ownerTokens);

      const res = await request(app.getHttpServer())
        .post(`/forms/${formId}/versions`)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${intruderTokens.accessToken}`])
        .set('X-CSRF-Token', intruderTokens.csrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'application/json')
        .send();

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORM_FORBIDDEN');
    });

    it('allows ADMIN to create a new version of any published form', async () => {
      const { tokens: ownerTokens } =
        await createTestUserWithSession('owner@example.com');
      const { tokens: adminTokens } = await createTestUserWithSession(
        'admin@example.com',
        'ADMIN',
      );
      const formId = await createPublishedForm(ownerTokens);

      const res = await request(app.getHttpServer())
        .post(`/forms/${formId}/versions`)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${adminTokens.accessToken}`])
        .set('X-CSRF-Token', adminTokens.csrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'application/json')
        .send();

      expect(res.status).toBe(201);
      expect(res.body.data.currentVersion.versionNumber).toBe(2);
    });

    it('returns 404 for non-existent form ID', async () => {
      const { tokens } = await createTestUserWithSession(
        'publisher@example.com',
      );

      const res = await request(app.getHttpServer())
        .post('/forms/00000000-0000-4000-8000-000000000000/versions')
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .set('X-CSRF-Token', tokens.csrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'application/json')
        .send();

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('FORM_NOT_FOUND');
    });
  });

  describe('AC2: Complete version edit and re-publish lifecycle', () => {
    it('allows editing the new draft version, preserves v1 immutability, and publishes v2', async () => {
      const { tokens } = await createTestUserWithSession(
        'publisher@example.com',
      );
      const formId = await createPublishedForm(tokens);

      // 1. Create v2
      const v2Res = await request(app.getHttpServer())
        .post(`/forms/${formId}/versions`)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .set('X-CSRF-Token', tokens.csrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'application/json')
        .send();

      expect(v2Res.status).toBe(201);
      const v2UpdatedAt = v2Res.body.data.updatedAt;

      // 2. Edit v2 draft by adding a second question
      const newBlock = {
        id: 'block-q2',
        type: 'text',
        order: 1,
        title: 'New question added in v2',
        required: false,
      };

      const patchRes = await request(app.getHttpServer())
        .patch(`/forms/${formId}/draft`)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .set('X-CSRF-Token', tokens.csrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'application/json')
        .send({
          clientUpdatedAt: v2UpdatedAt,
          title: 'Survey v2 Updated Title',
          schema: {
            schemaVersion: 1,
            title: 'Survey v2 Updated Title',
            blocks: [validQuestionBlock, newBlock],
          },
        });

      expect(patchRes.status).toBe(200);
      expect(patchRes.body.data.title).toBe('Survey v2 Updated Title');
      expect(patchRes.body.data.currentVersion.versionNumber).toBe(2);
      expect(patchRes.body.data.currentVersion.schemaJson.blocks).toHaveLength(
        2,
      );

      // 3. Publish v2
      const publishV2Res = await request(app.getHttpServer())
        .post(`/forms/${formId}/publish`)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .set('X-CSRF-Token', tokens.csrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'application/json')
        .send();

      expect(publishV2Res.status).toBe(200);
      expect(publishV2Res.body.data.status).toBe('PUBLISHED');
      expect(publishV2Res.body.data.currentVersion.versionNumber).toBe(2);
      expect(publishV2Res.body.data.currentVersion.isPublished).toBe(true);

      // 4. Verify version history shows both versions
      const versionsRes = await request(app.getHttpServer())
        .get(`/forms/${formId}/versions`)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .send();

      expect(versionsRes.status).toBe(200);
      expect(versionsRes.body.data).toHaveLength(2);
      expect(versionsRes.body.data[0].versionNumber).toBe(1);
      expect(versionsRes.body.data[0].isPublished).toBe(true);
      expect(versionsRes.body.data[1].versionNumber).toBe(2);
      expect(versionsRes.body.data[1].isPublished).toBe(true);
    });
  });

  describe('AC4: GET /forms/:id/versions', () => {
    it('lists all versions ordered ascending for the form owner', async () => {
      const { tokens } = await createTestUserWithSession(
        'publisher@example.com',
      );
      const formId = await createPublishedForm(tokens);

      // Initially has 1 version
      const res1 = await request(app.getHttpServer())
        .get(`/forms/${formId}/versions`)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .send();

      expect(res1.status).toBe(200);
      expect(res1.body.data).toHaveLength(1);
      expect(res1.body.data[0].versionNumber).toBe(1);
      expect(res1.body.data[0].isPublished).toBe(true);
      expect(res1.body.data[0].publishedAt).toBeDefined();

      // Create v2
      await request(app.getHttpServer())
        .post(`/forms/${formId}/versions`)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .set('X-CSRF-Token', tokens.csrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'application/json')
        .send();

      const res2 = await request(app.getHttpServer())
        .get(`/forms/${formId}/versions`)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .send();

      expect(res2.status).toBe(200);
      expect(res2.body.data).toHaveLength(2);
      expect(res2.body.data[0].versionNumber).toBe(1);
      expect(res2.body.data[1].versionNumber).toBe(2);
      expect(res2.body.data[1].isPublished).toBe(false);
    });

    it('rejects version list request from unauthorized user with 403', async () => {
      const { tokens: ownerTokens } =
        await createTestUserWithSession('owner@example.com');
      const { tokens: otherTokens } =
        await createTestUserWithSession('other@example.com');
      const formId = await createPublishedForm(ownerTokens);

      const res = await request(app.getHttpServer())
        .get(`/forms/${formId}/versions`)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${otherTokens.accessToken}`])
        .send();

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORM_FORBIDDEN');
    });
  });
});
