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

describe('Story 2.6: Form Publish Lifecycle & Immutability E2E Tests', () => {
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
    title: 'What is your research major?',
    required: true,
  };

  async function createDraft(
    tokens: { accessToken: string; csrfToken: string },
    payload: Record<string, unknown>,
  ) {
    return request(app.getHttpServer())
      .post('/forms')
      .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
      .set('X-CSRF-Token', tokens.csrfToken)
      .set('Origin', ALLOWED_ORIGIN)
      .set('Content-Type', 'application/json')
      .send(payload);
  }

  describe('AC1 & AC3: POST /forms/:id/publish', () => {
    it('successfully publishes internal non-reward survey directly to PUBLISHED status', async () => {
      const { tokens } = await createTestUserWithSession('pub@example.com');
      const draftRes = await createDraft(tokens, {
        title: 'Academic Survey',
        type: 'INTERNAL',
        rewardPerResponse: 0,
        schema: {
          schemaVersion: 1,
          title: 'Academic Survey',
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
        .send({});

      expect(publishRes.status).toBe(200);
      expect(publishRes.body.error).toBeNull();
      expect(publishRes.body.data.status).toBe('PUBLISHED');
      expect(publishRes.body.data.currentVersion.isPublished).toBe(true);
      expect(publishRes.body.data.currentVersion.publishedAt).toBeDefined();
      expect(publishRes.body.meta.message).toBe('Form published successfully');
    });

    it('transitions survey with rewards (> 0 points) to ESCROW_LOCKED status', async () => {
      const { tokens } = await createTestUserWithSession('pub2@example.com');
      const draftRes = await createDraft(tokens, {
        title: 'Rewarded Feedback Survey',
        type: 'INTERNAL',
        rewardPerResponse: 25,
        expectedCompletions: 50,
        schema: {
          schemaVersion: 1,
          title: 'Rewarded Feedback Survey',
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
        .send({});

      expect(publishRes.status).toBe(200);
      expect(publishRes.body.data.status).toBe('ESCROW_LOCKED');
      expect(publishRes.body.data.currentVersion.isPublished).toBe(false);
    });

    it('transitions external survey with valid URL to ESCROW_LOCKED status', async () => {
      const { tokens } = await createTestUserWithSession('pub3@example.com');
      const draftRes = await createDraft(tokens, {
        title: 'External Research Survey',
        type: 'EXTERNAL',
        rewardPerResponse: 10,
        externalUrl: 'https://docs.google.com/forms/d/e/123/viewform',
        schema: {
          schemaVersion: 1,
          title: 'External Research Survey',
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
        .send({});

      expect(publishRes.status).toBe(200);
      expect(publishRes.body.data.status).toBe('ESCROW_LOCKED');
      expect(publishRes.body.data.type).toBe('EXTERNAL');
    });

    it('rejects publishing an empty form (0 blocks) with 422 FORM_VALIDATION_ERROR', async () => {
      const { tokens } = await createTestUserWithSession('pub4@example.com');
      const draftRes = await createDraft(tokens, {
        title: 'Empty Draft',
        schema: {
          schemaVersion: 1,
          title: 'Empty Draft',
          blocks: [], // Empty blocks
        },
      });

      const formId = draftRes.body.data.id;

      const publishRes = await request(app.getHttpServer())
        .post(`/forms/${formId}/publish`)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .set('X-CSRF-Token', tokens.csrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'application/json')
        .send({});

      expect(publishRes.status).toBe(422);
      expect(publishRes.body.error.code).toBe('FORM_VALIDATION_ERROR');
      expect(publishRes.body.error.message).toContain(
        'Form must contain at least one question block',
      );
    });

    it('rejects publishing external survey without externalUrl with 422', async () => {
      const { tokens } = await createTestUserWithSession('pub5@example.com');
      const draftRes = await createDraft(tokens, {
        title: 'Missing URL External Survey',
        type: 'EXTERNAL',
        rewardPerResponse: 10,
        schema: {
          schemaVersion: 1,
          title: 'Missing URL External Survey',
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
        .send({});

      expect(publishRes.status).toBe(422);
      expect(publishRes.body.error.code).toBe('FORM_VALIDATION_ERROR');
      expect(publishRes.body.error.message).toContain(
        'External surveys require a valid externalUrl',
      );
    });

    it('rejects publishing when form is already in PUBLISHED status with 409', async () => {
      const { tokens } = await createTestUserWithSession('pub6@example.com');
      const draftRes = await createDraft(tokens, {
        title: 'Survey',
        type: 'INTERNAL',
        rewardPerResponse: 0,
        schema: {
          schemaVersion: 1,
          title: 'Survey',
          blocks: [validQuestionBlock],
        },
      });

      const formId = draftRes.body.data.id;

      // First publish
      await request(app.getHttpServer())
        .post(`/forms/${formId}/publish`)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .set('X-CSRF-Token', tokens.csrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'application/json')
        .send({});

      // Second publish
      const publishRes = await request(app.getHttpServer())
        .post(`/forms/${formId}/publish`)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .set('X-CSRF-Token', tokens.csrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'application/json')
        .send({});

      expect(publishRes.status).toBe(409);
      expect(publishRes.body.error.code).toBe('FORM_NOT_IN_DRAFT_STATUS');
    });

    it('rejects publishing by unauthorized user with 403 FORM_FORBIDDEN', async () => {
      const { tokens: ownerTokens } =
        await createTestUserWithSession('owner@example.com');
      const { tokens: otherTokens } = await createTestUserWithSession(
        'intruder@example.com',
      );

      const draftRes = await createDraft(ownerTokens, {
        title: 'Survey',
        type: 'INTERNAL',
        rewardPerResponse: 0,
        schema: {
          schemaVersion: 1,
          title: 'Survey',
          blocks: [validQuestionBlock],
        },
      });

      const formId = draftRes.body.data.id;

      const publishRes = await request(app.getHttpServer())
        .post(`/forms/${formId}/publish`)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${otherTokens.accessToken}`])
        .set('X-CSRF-Token', otherTokens.csrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'application/json')
        .send({});

      expect(publishRes.status).toBe(403);
      expect(publishRes.body.error.code).toBe('FORM_FORBIDDEN');
    });
  });

  describe('AC5: Strict Immutability Guarding (Outside DRAFT)', () => {
    it('strictly rejects PATCH /forms/:id/draft after publication with 409 Conflict', async () => {
      const { tokens } = await createTestUserWithSession('pub7@example.com');
      const draftRes = await createDraft(tokens, {
        title: 'Published Survey',
        type: 'INTERNAL',
        rewardPerResponse: 0,
        schema: {
          schemaVersion: 1,
          title: 'Published Survey',
          blocks: [validQuestionBlock],
        },
      });

      const formId = draftRes.body.data.id;

      await request(app.getHttpServer())
        .post(`/forms/${formId}/publish`)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .set('X-CSRF-Token', tokens.csrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'application/json')
        .send({});

      const patchRes = await request(app.getHttpServer())
        .patch(`/forms/${formId}/draft`)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .set('X-CSRF-Token', tokens.csrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'application/json')
        .send({
          clientUpdatedAt: draftRes.body.data.updatedAt,
          title: 'Tampered Title After Publish',
        });

      expect(patchRes.status).toBe(409);
      expect(patchRes.body.error.code).toBe('FORM_NOT_IN_DRAFT_STATUS');
    });

    it('strictly rejects DELETE /forms/:id after publication with 409 Conflict', async () => {
      const { tokens } = await createTestUserWithSession('pub8@example.com');
      const draftRes = await createDraft(tokens, {
        title: 'Published Survey',
        type: 'INTERNAL',
        rewardPerResponse: 0,
        schema: {
          schemaVersion: 1,
          title: 'Published Survey',
          blocks: [validQuestionBlock],
        },
      });

      const formId = draftRes.body.data.id;

      await request(app.getHttpServer())
        .post(`/forms/${formId}/publish`)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .set('X-CSRF-Token', tokens.csrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'application/json')
        .send({});

      const deleteRes = await request(app.getHttpServer())
        .delete(`/forms/${formId}`)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .set('X-CSRF-Token', tokens.csrfToken)
        .set('Origin', ALLOWED_ORIGIN);

      expect(deleteRes.status).toBe(409);
      expect(deleteRes.body.error.code).toBe('FORM_NOT_IN_DRAFT_STATUS');
    });
  });

  describe('AC4: POST /forms/:id/close', () => {
    it('successfully closes a PUBLISHED form', async () => {
      const { tokens } = await createTestUserWithSession('pub9@example.com');
      const draftRes = await createDraft(tokens, {
        title: 'Survey to Close',
        type: 'INTERNAL',
        rewardPerResponse: 0,
        schema: {
          schemaVersion: 1,
          title: 'Survey to Close',
          blocks: [validQuestionBlock],
        },
      });

      const formId = draftRes.body.data.id;

      await request(app.getHttpServer())
        .post(`/forms/${formId}/publish`)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .set('X-CSRF-Token', tokens.csrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'application/json')
        .send({});

      const closeRes = await request(app.getHttpServer())
        .post(`/forms/${formId}/close`)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .set('X-CSRF-Token', tokens.csrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'application/json')
        .send({ reason: 'Survey target reached' });

      expect(closeRes.status).toBe(200);
      expect(closeRes.body.data.status).toBe('CLOSED');
      expect(closeRes.body.meta.message).toBe('Form closed successfully');
    });

    it('rejects closing a DRAFT form with 400 INVALID_STATUS_TRANSITION', async () => {
      const { tokens } = await createTestUserWithSession('pub10@example.com');
      const draftRes = await createDraft(tokens, {
        title: 'Draft Form',
      });

      const formId = draftRes.body.data.id;

      const closeRes = await request(app.getHttpServer())
        .post(`/forms/${formId}/close`)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .set('X-CSRF-Token', tokens.csrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'application/json')
        .send({});

      expect(closeRes.status).toBe(400);
      expect(closeRes.body.error.code).toBe('INVALID_STATUS_TRANSITION');
    });
  });

  describe('AC2: POST /forms/:id/status (Lifecycle Progression)', () => {
    it('allows valid transition ESCROW_LOCKED -> MODERATION_QUEUE -> PUBLISHED by Admin', async () => {
      const { tokens: pubTokens } =
        await createTestUserWithSession('pub11@example.com');
      const { tokens: admTokens } = await createTestUserWithSession(
        'admin1@example.com',
        'ADMIN',
      );

      const draftRes = await createDraft(pubTokens, {
        title: 'Lifecycle Form',
        type: 'INTERNAL',
        rewardPerResponse: 10,
        schema: {
          schemaVersion: 1,
          title: 'Lifecycle Form',
          blocks: [validQuestionBlock],
        },
      });

      const formId = draftRes.body.data.id;

      // Publish moves to ESCROW_LOCKED
      await request(app.getHttpServer())
        .post(`/forms/${formId}/publish`)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${pubTokens.accessToken}`])
        .set('X-CSRF-Token', pubTokens.csrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'application/json')
        .send({});

      // Move to MODERATION_QUEUE
      const modRes = await request(app.getHttpServer())
        .post(`/forms/${formId}/status`)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${admTokens.accessToken}`])
        .set('X-CSRF-Token', admTokens.csrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'application/json')
        .send({ targetStatus: 'MODERATION_QUEUE' });

      expect(modRes.status).toBe(200);
      expect(modRes.body.data.status).toBe('MODERATION_QUEUE');

      // Admin approves -> moves to PUBLISHED
      const pubRes = await request(app.getHttpServer())
        .post(`/forms/${formId}/status`)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${admTokens.accessToken}`])
        .set('X-CSRF-Token', admTokens.csrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'application/json')
        .send({ targetStatus: 'PUBLISHED' });

      expect(pubRes.status).toBe(200);
      expect(pubRes.body.data.status).toBe('PUBLISHED');
      expect(pubRes.body.data.currentVersion.isPublished).toBe(true);
    });

    it('rejects invalid transition PUBLISHED -> DRAFT with 400', async () => {
      const { tokens: pubTokens } =
        await createTestUserWithSession('pub12@example.com');
      const { tokens: admTokens } = await createTestUserWithSession(
        'admin2@example.com',
        'ADMIN',
      );

      const draftRes = await createDraft(pubTokens, {
        title: 'Form',
        type: 'INTERNAL',
        rewardPerResponse: 0,
        schema: {
          schemaVersion: 1,
          title: 'Form',
          blocks: [validQuestionBlock],
        },
      });

      const formId = draftRes.body.data.id;

      await request(app.getHttpServer())
        .post(`/forms/${formId}/publish`)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${pubTokens.accessToken}`])
        .set('X-CSRF-Token', pubTokens.csrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'application/json')
        .send({});

      const invalidRes = await request(app.getHttpServer())
        .post(`/forms/${formId}/status`)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${admTokens.accessToken}`])
        .set('X-CSRF-Token', admTokens.csrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'application/json')
        .send({ targetStatus: 'DRAFT' });

      expect(invalidRes.status).toBe(400);
      expect(invalidRes.body.error.code).toBe('INVALID_STATUS_TRANSITION');
    });
  });
});
