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
import { COMPLETION_CODE_PORT } from '../src/modules/forms/application/ports/completion-code.port';
import { CompletionCodeService } from '../src/modules/forms/infrastructure/completion-code.service';
import { SessionService } from '../src/modules/auth/application/session.service';
import { EnvService } from '../src/common/config/env.service';
import { PrismaService } from '../src/common/database/prisma.service';
import { HttpExceptionFilter } from '../src/common/http/http-exception.filter';
import { AUTH_COOKIE_NAME } from '../src/modules/auth/presentation/cookie-options.helper';

describe('Story 4.5: External Survey Setup & Rotation E2E Tests', () => {
  let app: INestApplication;
  let userRepo: InMemoryUserRepository;
  let sessionRepo: InMemorySessionRepository;
  let auditRepo: InMemoryIdentityAuditRepository;
  let formRepo: InMemoryFormRepository;
  let completionCodeService: CompletionCodeService;
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
    completionCodeService = new CompletionCodeService(envService);

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
      // Phase 5 M1/M2: GET /forms and GET /forms/:id read each survey's Escrow.
      .overrideProvider(LEDGER_REPOSITORY_PORT)
      .useValue(new InMemoryLedgerRepository())
      .overrideProvider(COMPLETION_CODE_PORT)
      .useValue(completionCodeService)
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

  describe('POST /forms/external', () => {
    it('creates external survey, auto-generates 6-digit code, and discloses it once', async () => {
      const { tokens } = await createTestUserWithSession(
        'publisher1@example.com',
      );

      const response = await request(app.getHttpServer())
        .post('/forms/external')
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .set('x-csrf-token', tokens.csrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'application/json')
        .send({
          title: 'Google Forms Product Feedback',
          description: 'Survey conducted via Google Forms',
          externalUrl: 'https://docs.google.com/forms/d/e/1FAIpQLSc/viewform',
          rewardPerResponse: 15,
          expectedCompletions: 40,
          autoPublish: false,
        })
        .expect(201);

      expect(response.body.data).toBeDefined();
      expect(response.body.data.id).toBeDefined();
      expect(response.body.data.type).toBe('EXTERNAL');
      expect(response.body.data.title).toBe('Google Forms Product Feedback');
      expect(response.body.data.status).toBe('DRAFT');
      expect(response.body.data.currentVersion.externalUrl).toBe(
        'https://docs.google.com/forms/d/e/1FAIpQLSc/viewform',
      );

      // AC2 & AC3: Plaintext 6-digit code returned exactly once in creation response
      const plaintextCode = response.body.data.plaintextCompletionCode;
      expect(plaintextCode).toMatch(/^\d{6}$/);
      expect(response.body.data.hasCompletionCode).toBe(true);

      // In response DTO, currentVersion.completionCode is null
      expect(response.body.data.currentVersion.completionCode).toBeNull();
      expect(response.body.data.currentVersion.hasCompletionCode).toBe(true);

      // AC4: Repository persists only keyed verifier, NOT plaintext
      const stored = await formRepo.findById(response.body.data.id);
      expect(stored).not.toBeNull();
      const rawStoredCode = stored!.currentVersion.completionCode;
      expect(rawStoredCode).toMatch(/^v1:[a-f0-9]{64}$/);
      expect(rawStoredCode).not.toContain(plaintextCode);

      // AC5: Constant-time verification passes with stored verifier
      expect(
        completionCodeService.verifyCode(
          stored!.currentVersion.id,
          plaintextCode,
          rawStoredCode,
        ),
      ).toBe(true);
    });

    it('rejects external survey with insecure HTTP URL (must be HTTPS)', async () => {
      const { tokens } = await createTestUserWithSession(
        'publisher2@example.com',
      );

      const response = await request(app.getHttpServer())
        .post('/forms/external')
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .set('x-csrf-token', tokens.csrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'application/json')
        .send({
          title: 'Insecure Survey',
          externalUrl: 'http://docs.google.com/forms/d/e/1FAIpQLSc/viewform',
        })
        .expect(400);

      expect(response.body.error).toBeDefined();
    });

    it('subsequent GET /forms/:id never reveals plaintext completion code or verifier hash', async () => {
      const { tokens } = await createTestUserWithSession(
        'publisher3@example.com',
      );

      const createRes = await request(app.getHttpServer())
        .post('/forms/external')
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .set('x-csrf-token', tokens.csrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'application/json')
        .send({
          title: 'Hidden Code Test',
          externalUrl: 'https://forms.gle/shortLinkTest',
        })
        .expect(201);

      const formId = createRes.body.data.id;

      // Now GET the form detail
      const getRes = await request(app.getHttpServer())
        .get(`/forms/${formId}`)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .expect(200);

      expect(getRes.body.data.id).toBe(formId);
      expect(getRes.body.data.type).toBe('EXTERNAL');
      expect(getRes.body.data.currentVersion.completionCode).toBeNull();
      expect(getRes.body.data.currentVersion.hasCompletionCode).toBe(true);
      expect(getRes.body.data.plaintextCompletionCode).toBeUndefined();
    });
  });

  describe('POST /forms/external with Idempotency-Key (Phase 5 C6)', () => {
    const body = {
      title: 'Idempotent Google Form',
      externalUrl: 'https://docs.google.com/forms/d/e/idempotent/viewform',
      rewardPerResponse: 15,
      expectedCompletions: 40,
      autoPublish: false,
    };

    function create(
      tokens: { accessToken: string; csrfToken: string },
      payload: object,
      key?: string,
    ) {
      const req = request(app.getHttpServer())
        .post('/forms/external')
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .set('x-csrf-token', tokens.csrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'application/json');
      if (key !== undefined) req.set('Idempotency-Key', key);
      return req.send(payload);
    }

    it('replays the created survey (201, same id and code, idempotentReplay) for a retried key', async () => {
      const { user, tokens } = await createTestUserWithSession(
        'idempotent-publisher@example.com',
      );

      const first = await create(tokens, body, 'wizard-draft-1').expect(201);
      const replay = await create(tokens, body, 'wizard-draft-1').expect(201);

      expect(first.body.data.idempotentReplay).toBeUndefined();
      expect(replay.body.data.idempotentReplay).toBe(true);
      expect(replay.body.data.id).toBe(first.body.data.id);
      expect(replay.body.data.plaintextCompletionCode).toBe(
        first.body.data.plaintextCompletionCode,
      );
      const { total } = await formRepo.findManyByPublisher({
        publisherId: user.id,
        page: 1,
        limit: 10,
      });
      expect(total).toBe(1);
    });

    it('answers 409 IDEMPOTENCY_KEY_CONFLICT when the key is reused with another body', async () => {
      const { tokens } = await createTestUserWithSession(
        'idempotent-conflict@example.com',
      );
      const first = await create(tokens, body, 'wizard-draft-2').expect(201);

      const res = await create(
        tokens,
        { ...body, expectedCompletions: 41 },
        'wizard-draft-2',
      ).expect(409);

      expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_CONFLICT');
      expect(res.body.error.details).toEqual({
        reason: 'DIFFERENT_REQUEST',
        formId: first.body.data.id,
      });
    });

    it('rejects a malformed key with 400 INVALID_IDEMPOTENCY_KEY and creates nothing', async () => {
      const { user, tokens } = await createTestUserWithSession(
        'idempotent-invalid@example.com',
      );

      const res = await create(tokens, body, 'short').expect(400);

      expect(res.body.error.code).toBe('INVALID_IDEMPOTENCY_KEY');
      const { total } = await formRepo.findManyByPublisher({
        publisherId: user.id,
        page: 1,
        limit: 10,
      });
      expect(total).toBe(0);
    });

    it('lists the survey with closeKind and completedCompletions (Phase 5 M2)', async () => {
      const { tokens } = await createTestUserWithSession(
        'list-fields@example.com',
      );
      const created = await create(tokens, body).expect(201);

      const res = await request(app.getHttpServer())
        .get('/forms')
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .expect(200);

      expect(res.body.data.forms[0]).toMatchObject({
        id: created.body.data.id,
        closeKind: null,
        completedCompletions: 0,
      });
      expect(res.body.data.forms[0]).toHaveProperty('escrowLocked');
    });
  });

  describe('POST /forms/:id/rotate-code', () => {
    it('creates a new immutable FormVersion with a new completion code and preserves prior version', async () => {
      const { tokens } = await createTestUserWithSession(
        'publisher4@example.com',
      );

      // Create external survey
      const createRes = await request(app.getHttpServer())
        .post('/forms/external')
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .set('x-csrf-token', tokens.csrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'application/json')
        .send({
          title: 'Rotatable Survey',
          externalUrl: 'https://docs.google.com/forms/d/e/1FAIpQLSc/viewform',
        })
        .expect(201);

      const formId = createRes.body.data.id;
      const v1Code = createRes.body.data.plaintextCompletionCode;
      const v1VersionId = createRes.body.data.currentVersion.id;

      // Rotate completion code
      const rotateRes = await request(app.getHttpServer())
        .post(`/forms/${formId}/rotate-code`)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .set('x-csrf-token', tokens.csrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'application/json')
        .send({ reason: 'Accidental leak of completion code' })
        .expect(200);

      expect(rotateRes.body.data.id).toBe(formId);
      expect(rotateRes.body.data.currentVersion.versionNumber).toBe(2);
      expect(rotateRes.body.data.currentVersion.id).not.toBe(v1VersionId);

      const v2Code = rotateRes.body.data.plaintextCompletionCode;
      expect(v2Code).toMatch(/^\d{6}$/);
      expect(rotateRes.body.data.hasCompletionCode).toBe(true);

      // Check DB repository: both versions exist and their HMAC verifiers are preserved
      const stored = await formRepo.findById(formId);
      expect(stored!.versions).toHaveLength(2);

      const v1 = stored!.versions!.find((v) => v.versionNumber === 1)!;
      const v2 = stored!.versions!.find((v) => v.versionNumber === 2)!;

      expect(v1.completionCode).toMatch(/^v1:[a-f0-9]{64}$/);
      expect(v2.completionCode).toMatch(/^v1:[a-f0-9]{64}$/);
      expect(v1.completionCode).not.toBe(v2.completionCode);

      // Verify V1 code validates only with V1
      expect(
        completionCodeService.verifyCode(v1.id, v1Code, v1.completionCode),
      ).toBe(true);
      // Verify V2 code validates only with V2
      expect(
        completionCodeService.verifyCode(v2.id, v2Code, v2.completionCode),
      ).toBe(true);
      // Cross-verification fails
      expect(
        completionCodeService.verifyCode(v2.id, v1Code, v2.completionCode),
      ).toBe(false);
    });

    it('rejects rotation by another user with 403 Forbidden', async () => {
      const { tokens: ownerTokens } =
        await createTestUserWithSession('owner@example.com');
      const { tokens: otherTokens } =
        await createTestUserWithSession('other@example.com');

      const createRes = await request(app.getHttpServer())
        .post('/forms/external')
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${ownerTokens.accessToken}`])
        .set('x-csrf-token', ownerTokens.csrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'application/json')
        .send({
          title: 'Protected Form',
          externalUrl: 'https://forms.gle/xyz',
        })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/forms/${createRes.body.data.id}/rotate-code`)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${otherTokens.accessToken}`])
        .set('x-csrf-token', otherTokens.csrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'application/json')
        .send({})
        .expect(403);
    });
  });
});
