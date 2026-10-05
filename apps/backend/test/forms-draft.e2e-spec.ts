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
import { LEDGER_REPOSITORY_PORT } from '../src/modules/economy/application/ports/ledger-repository.port';
import { InMemoryLedgerRepository } from '../src/modules/economy/infrastructure/in-memory-ledger.repository';
import { SessionService } from '../src/modules/auth/application/session.service';
import { EnvService } from '../src/common/config/env.service';
import { PrismaService } from '../src/common/database/prisma.service';
import { HttpExceptionFilter } from '../src/common/http/http-exception.filter';
import { AUTH_COOKIE_NAME } from '../src/modules/auth/presentation/cookie-options.helper';
import {
  formDetailSchema,
  formListSchema,
  deletedFormSchema,
} from '@rescom/schemas';

describe('Form Draft Creation & Lifecycle E2E Tests (Story 2.2)', () => {
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
      // Phase 5 M1/M2: GET /forms and GET /forms/:id read each survey's Escrow.
      .overrideProvider(LEDGER_REPOSITORY_PORT)
      .useValue(new InMemoryLedgerRepository())
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

  describe('AC1: Draft Survey Creation (POST /forms)', () => {
    it('rejects unauthenticated request with 401', async () => {
      const res = await request(app.getHttpServer())
        .post('/forms')
        .set('Origin', ALLOWED_ORIGIN)
        .send({ title: 'My Survey' })
        .expect(401);

      expect(res.body.error.code).toBe('AUTH_UNAUTHORIZED');
    });

    it('rejects request without CSRF token with 403', async () => {
      const { tokens } = await createTestUserWithSession('user1@example.com');

      const res = await request(app.getHttpServer())
        .post('/forms')
        .set('Origin', ALLOWED_ORIGIN)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .set('Content-Type', 'application/json')
        .send({ title: 'My Survey' })
        .expect(403);

      expect(res.body.error.code).toBe('AUTH_INVALID_CSRF_TOKEN');
    });

    it('rejects request from untrusted origin with 403 AUTH_FORBIDDEN_ORIGIN', async () => {
      const { tokens } = await createTestUserWithSession('user1@example.com');

      const res = await request(app.getHttpServer())
        .post('/forms')
        .set('Origin', 'http://evil-attacker.com')
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .set('X-CSRF-Token', tokens.csrfToken)
        .set('Content-Type', 'application/json')
        .send({ title: 'My Survey' })
        .expect(403);

      expect(res.body.error.code).toBe('AUTH_FORBIDDEN_ORIGIN');
    });

    it('creates a draft with default values and returns HTTP 201 envelope', async () => {
      const { user, tokens } = await createTestUserWithSession(
        'publisher@example.com',
      );

      const res = await request(app.getHttpServer())
        .post('/forms')
        .set('Origin', ALLOWED_ORIGIN)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .set('X-CSRF-Token', tokens.csrfToken)
        .set('Content-Type', 'application/json')
        .send({})
        .expect(201);

      expect(res.body.error).toBeNull();
      expect(formDetailSchema.parse(res.body.data).type).toBe('INTERNAL');
      expect(res.body.data).toBeDefined();
      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.publisherId).toBe(user.id);
      expect(res.body.data.title).toBe('Untitled Survey');
      expect(res.body.data.status).toBe('DRAFT');
      expect(res.body.data.type).toBe('INTERNAL');
      expect(res.body.data.rewardPerResponse).toBe(10);
      expect(res.body.data.expectedCompletions).toBe(50);
      expect(res.body.data.currentVersion).toBeDefined();
      expect(res.body.data.currentVersion.versionNumber).toBe(1);
      expect(res.body.data.currentVersion.isPublished).toBe(false);
      expect(res.body.data.currentVersion.schemaJson.blocks).toEqual([]);
      expect(res.body.meta.message).toBe('Form draft created successfully');
    });

    it('allows any active authenticated user (even RESPONDENT) to create surveys per FR-ADD-12', async () => {
      const { user, tokens } = await createTestUserWithSession(
        'respondent@example.com',
        'RESPONDENT',
      );

      const res = await request(app.getHttpServer())
        .post('/forms')
        .set('Origin', ALLOWED_ORIGIN)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .set('X-CSRF-Token', tokens.csrfToken)
        .set('Content-Type', 'application/json')
        .send({ title: 'Student Survey' })
        .expect(201);

      expect(res.body.data.publisherId).toBe(user.id);
      expect(res.body.data.title).toBe('Student Survey');
    });

    it('rejects invalid payload boundaries (e.g. negative reward)', async () => {
      const { tokens } = await createTestUserWithSession('user@example.com');

      const res = await request(app.getHttpServer())
        .post('/forms')
        .set('Origin', ALLOWED_ORIGIN)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .set('X-CSRF-Token', tokens.csrfToken)
        .set('Content-Type', 'application/json')
        .send({ rewardPerResponse: -5 })
        .expect(400);

      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('AC2: Draft Retrieval & Listing (GET /forms/:id & GET /forms)', () => {
    it('returns form details for the owner with HTTP 200', async () => {
      const { tokens } = await createTestUserWithSession('owner@example.com');

      const createRes = await request(app.getHttpServer())
        .post('/forms')
        .set('Origin', ALLOWED_ORIGIN)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .set('X-CSRF-Token', tokens.csrfToken)
        .set('Content-Type', 'application/json')
        .send({ title: 'Survey for Retrieval' })
        .expect(201);

      const formId = createRes.body.data.id;

      const getRes = await request(app.getHttpServer())
        .get(`/forms/${formId}`)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .expect(200);

      expect(getRes.body.error).toBeNull();
      expect(formDetailSchema.parse(getRes.body.data).id).toBe(formId);
      expect(getRes.body.data.title).toBe('Survey for Retrieval');
      expect(getRes.body.data.currentVersion).toBeDefined();
    });

    it('allows ADMIN to access any draft form', async () => {
      const { tokens: publisherTokens } = await createTestUserWithSession(
        'author@example.com',
        'PUBLISHER',
      );
      const { tokens: adminTokens } = await createTestUserWithSession(
        'admin@example.com',
        'ADMIN',
      );

      const createRes = await request(app.getHttpServer())
        .post('/forms')
        .set('Origin', ALLOWED_ORIGIN)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${publisherTokens.accessToken}`])
        .set('X-CSRF-Token', publisherTokens.csrfToken)
        .set('Content-Type', 'application/json')
        .send({ title: 'Author Survey' })
        .expect(201);

      const formId = createRes.body.data.id;

      const adminRes = await request(app.getHttpServer())
        .get(`/forms/${formId}`)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${adminTokens.accessToken}`])
        .expect(200);

      expect(adminRes.body.data.id).toBe(formId);
    });

    it('rejects access from non-owner and non-admin with 403 FORM_FORBIDDEN', async () => {
      const { tokens: ownerTokens } =
        await createTestUserWithSession('owner@example.com');
      const { tokens: attackerTokens } = await createTestUserWithSession(
        'stranger@example.com',
      );

      const createRes = await request(app.getHttpServer())
        .post('/forms')
        .set('Origin', ALLOWED_ORIGIN)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${ownerTokens.accessToken}`])
        .set('X-CSRF-Token', ownerTokens.csrfToken)
        .set('Content-Type', 'application/json')
        .send({ title: 'Secret Survey' })
        .expect(201);

      const formId = createRes.body.data.id;

      const res = await request(app.getHttpServer())
        .get(`/forms/${formId}`)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${attackerTokens.accessToken}`])
        .expect(403);

      expect(res.body.error.code).toBe('FORM_FORBIDDEN');
    });

    it('returns 404 FORM_NOT_FOUND when form does not exist', async () => {
      const { tokens } = await createTestUserWithSession('user@example.com');

      const res = await request(app.getHttpServer())
        .get('/forms/00000000-0000-4000-8000-000000000000')
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .expect(404);

      expect(res.body.error.code).toBe('FORM_NOT_FOUND');
    });

    it('lists only forms belonging to authenticated user', async () => {
      const { tokens: user1Tokens } =
        await createTestUserWithSession('user1@example.com');
      const { tokens: user2Tokens } =
        await createTestUserWithSession('user2@example.com');

      await request(app.getHttpServer())
        .post('/forms')
        .set('Origin', ALLOWED_ORIGIN)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${user1Tokens.accessToken}`])
        .set('X-CSRF-Token', user1Tokens.csrfToken)
        .set('Content-Type', 'application/json')
        .send({ title: 'User 1 Survey A' })
        .expect(201);

      await request(app.getHttpServer())
        .post('/forms')
        .set('Origin', ALLOWED_ORIGIN)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${user1Tokens.accessToken}`])
        .set('X-CSRF-Token', user1Tokens.csrfToken)
        .set('Content-Type', 'application/json')
        .send({ title: 'User 1 Survey B' })
        .expect(201);

      await request(app.getHttpServer())
        .post('/forms')
        .set('Origin', ALLOWED_ORIGIN)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${user2Tokens.accessToken}`])
        .set('X-CSRF-Token', user2Tokens.csrfToken)
        .set('Content-Type', 'application/json')
        .send({ title: 'User 2 Survey' })
        .expect(201);

      const listRes = await request(app.getHttpServer())
        .get('/forms?page=1&limit=10')
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${user1Tokens.accessToken}`])
        .expect(200);

      expect(formListSchema.parse(listRes.body.data).total).toBe(2);
      expect(listRes.body.data.forms).toHaveLength(2);
    });
  });

  describe('AC3: Autosave & Incremental Draft Updates (PATCH /forms/:id/draft)', () => {
    it('updates draft title, description, and schema blocks successfully', async () => {
      const { tokens } = await createTestUserWithSession('author@example.com');

      const createRes = await request(app.getHttpServer())
        .post('/forms')
        .set('Origin', ALLOWED_ORIGIN)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .set('X-CSRF-Token', tokens.csrfToken)
        .set('Content-Type', 'application/json')
        .send({ title: 'Draft V1' })
        .expect(201);

      const formId = createRes.body.data.id;

      const autosavePayload = {
        clientUpdatedAt:
          createRes.body.data.updatedAt || new Date().toISOString(),
        title: 'Draft V1 - Renamed',
        description: 'Autosaved draft description',
        rewardPerResponse: 25,
        schema: {
          schemaVersion: 1,
          title: 'Draft V1 - Renamed',
          blocks: [
            {
              id: 'blk-1',
              type: 'text',
              order: 0,
              title: 'What is your feedback?',
              required: true,
            },
          ],
          settings: {
            shuffleBlocks: false,
            progressBar: true,
            requireAuth: false,
            submitButtonText: 'Send',
          },
          metadata: {
            expectedEffortSeconds: 60,
            minTimeBarrierSeconds: 15,
          },
        },
      };

      const patchRes = await request(app.getHttpServer())
        .patch(`/forms/${formId}/draft`)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .set('X-CSRF-Token', tokens.csrfToken)
        .set('Content-Type', 'application/json')
        .send(autosavePayload)
        .expect(200);

      expect(patchRes.body.error).toBeNull();
      formDetailSchema.parse(patchRes.body.data);
      expect(patchRes.body.data.title).toBe('Draft V1 - Renamed');
      expect(patchRes.body.data.description).toBe(
        'Autosaved draft description',
      );
      expect(patchRes.body.data.rewardPerResponse).toBe(25);
      expect(patchRes.body.data.currentVersion.schemaJson.blocks).toHaveLength(
        1,
      );
      expect(patchRes.body.data.currentVersion.schemaJson.blocks[0].id).toBe(
        'blk-1',
      );
      expect(patchRes.body.meta.message).toBe(
        'Form draft autosaved successfully',
      );
    });

    it('Story 4.1: saves valid demographic targeting criteria during draft autosave', async () => {
      const { tokens } = await createTestUserWithSession(
        'targeting_author@example.com',
      );

      const createRes = await request(app.getHttpServer())
        .post('/forms')
        .set('Origin', ALLOWED_ORIGIN)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .set('X-CSRF-Token', tokens.csrfToken)
        .set('Content-Type', 'application/json')
        .send({ title: 'Targeted Survey E2E' })
        .expect(201);

      const formId = createRes.body.data.id;

      const patchRes = await request(app.getHttpServer())
        .patch(`/forms/${formId}/draft`)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .set('X-CSRF-Token', tokens.csrfToken)
        .set('Content-Type', 'application/json')
        .send({
          clientUpdatedAt: createRes.body.data.updatedAt,
          targetingJson: {
            ageRange: { min: 18, max: 30 },
            locations: ['Hanoi', 'Ho Chi Minh City'],
            genders: ['FEMALE', 'OTHER'],
            occupations: ['Student', 'Designer'],
            fieldOfStudy: ['Computer Science'],
          },
        })
        .expect(200);

      expect(patchRes.body.error).toBeNull();
      expect(patchRes.body.data.currentVersion.targetingJson).toEqual({
        ageRange: { min: 18, max: 30 },
        locations: ['Hanoi', 'Ho Chi Minh City'],
        genders: ['FEMALE', 'OTHER'],
        occupations: ['Student', 'Designer'],
        fieldOfStudy: ['Computer Science'],
      });
    });

    it('Story 4.1: rejects invalid targeting criteria with HTTP 422 and TARGETING_VALIDATION_ERROR', async () => {
      const { tokens } = await createTestUserWithSession(
        'invalid_targeting@example.com',
      );

      const createRes = await request(app.getHttpServer())
        .post('/forms')
        .set('Origin', ALLOWED_ORIGIN)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .set('X-CSRF-Token', tokens.csrfToken)
        .set('Content-Type', 'application/json')
        .send({ title: 'Invalid Targeting Survey E2E' })
        .expect(201);

      const formId = createRes.body.data.id;

      const patchRes = await request(app.getHttpServer())
        .patch(`/forms/${formId}/draft`)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .set('X-CSRF-Token', tokens.csrfToken)
        .set('Content-Type', 'application/json')
        .send({
          clientUpdatedAt: createRes.body.data.updatedAt,
          targetingJson: {
            ageRange: { min: 45, max: 20 },
          },
        })
        .expect(422);

      expect(patchRes.body.data).toBeNull();
      expect(patchRes.body.error.code).toBe('TARGETING_VALIDATION_ERROR');
      expect(patchRes.body.error.message).toMatch(
        /min must be less than or equal to/i,
      );
    });

    it('strictly rejects edits with 409 FORM_NOT_IN_DRAFT_STATUS when form is not in DRAFT (immutability)', async () => {
      const { tokens } = await createTestUserWithSession('author@example.com');

      const createRes = await request(app.getHttpServer())
        .post('/forms')
        .set('Origin', ALLOWED_ORIGIN)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .set('X-CSRF-Token', tokens.csrfToken)
        .set('Content-Type', 'application/json')
        .send({ title: 'Form to Publish' })
        .expect(201);

      const formId = createRes.body.data.id;

      // Simulate published state in repo
      const existing = await formRepo.findById(formId);
      await formRepo.update(existing!.form.copyWith({ status: 'PUBLISHED' }));

      const patchRes = await request(app.getHttpServer())
        .patch(`/forms/${formId}/draft`)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .set('X-CSRF-Token', tokens.csrfToken)
        .set('Content-Type', 'application/json')
        .send({
          clientUpdatedAt: new Date().toISOString(),
          title: 'Attempted edit on published',
        })
        .expect(409);

      expect(patchRes.body.error.code).toBe('FORM_NOT_IN_DRAFT_STATUS');
    });

    it('rejects autosave attempt by unauthorized user with 403', async () => {
      const { tokens: ownerTokens } =
        await createTestUserWithSession('owner@example.com');
      const { tokens: attackerTokens } = await createTestUserWithSession(
        'attacker@example.com',
      );

      const createRes = await request(app.getHttpServer())
        .post('/forms')
        .set('Origin', ALLOWED_ORIGIN)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${ownerTokens.accessToken}`])
        .set('X-CSRF-Token', ownerTokens.csrfToken)
        .set('Content-Type', 'application/json')
        .send({ title: 'My Survey' })
        .expect(201);

      const formId = createRes.body.data.id;

      const patchRes = await request(app.getHttpServer())
        .patch(`/forms/${formId}/draft`)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${attackerTokens.accessToken}`])
        .set('X-CSRF-Token', attackerTokens.csrfToken)
        .set('Content-Type', 'application/json')
        .send({
          clientUpdatedAt: new Date().toISOString(),
          title: 'Tampered Title',
        })
        .expect(403);

      expect(patchRes.body.error.code).toBe('FORM_FORBIDDEN');
    });
  });

  describe('AC4: Draft Deletion (DELETE /forms/:id)', () => {
    it('deletes a form draft and returns HTTP 200', async () => {
      const { tokens } = await createTestUserWithSession('author@example.com');

      const createRes = await request(app.getHttpServer())
        .post('/forms')
        .set('Origin', ALLOWED_ORIGIN)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .set('X-CSRF-Token', tokens.csrfToken)
        .set('Content-Type', 'application/json')
        .send({ title: 'Trash Survey' })
        .expect(201);

      const formId = createRes.body.data.id;

      const deleteRes = await request(app.getHttpServer())
        .delete(`/forms/${formId}`)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .set('X-CSRF-Token', tokens.csrfToken)
        .expect(200);

      expect(deleteRes.body.error).toBeNull();
      expect(deletedFormSchema.parse(deleteRes.body.data).id).toBe(formId);
      expect(deleteRes.body.meta.message).toBe(
        'Form draft deleted successfully',
      );

      await request(app.getHttpServer())
        .get(`/forms/${formId}`)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .expect(404);
    });

    it('rejects deletion of a non-draft form with 409', async () => {
      const { tokens } = await createTestUserWithSession('author@example.com');

      const createRes = await request(app.getHttpServer())
        .post('/forms')
        .set('Origin', ALLOWED_ORIGIN)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .set('X-CSRF-Token', tokens.csrfToken)
        .set('Content-Type', 'application/json')
        .send({ title: 'Permanent Form' })
        .expect(201);

      const formId = createRes.body.data.id;

      const existing = await formRepo.findById(formId);
      await formRepo.update(existing!.form.copyWith({ status: 'PUBLISHED' }));

      const res = await request(app.getHttpServer())
        .delete(`/forms/${formId}`)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .set('X-CSRF-Token', tokens.csrfToken)
        .expect(409);

      expect(res.body.error.code).toBe('FORM_NOT_IN_DRAFT_STATUS');
    });
  });
});
