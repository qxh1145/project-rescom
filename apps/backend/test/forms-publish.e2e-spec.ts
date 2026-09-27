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
import { LedgerService } from '../src/modules/economy/application/ledger.service';
import { SessionService } from '../src/modules/auth/application/session.service';
import { EnvService } from '../src/common/config/env.service';
import { PrismaService } from '../src/common/database/prisma.service';
import { HttpExceptionFilter } from '../src/common/http/http-exception.filter';
import { AUTH_COOKIE_NAME } from '../src/modules/auth/presentation/cookie-options.helper';
import {
  PassThroughUnitOfWork,
  UNIT_OF_WORK_PORT,
} from '../src/common/database/unit-of-work.port';
import { ADMIN_CAPABILITY_PORT } from '../src/modules/economy/application/ports/admin-capability.port';
import { InMemoryAdminCapabilityRepository } from '../src/modules/economy/infrastructure/in-memory-admin-capability.repository';
import { SURVEY_MODERATION_REPOSITORY_PORT } from '../src/modules/moderation/application/ports/survey-moderation-repository.port';
import { InMemorySurveyModerationRepository } from '../src/modules/moderation/infrastructure/in-memory-survey-moderation.repository';
import { NOTIFICATION_REPOSITORY_PORT } from '../src/modules/notifications/application/ports/notification-repository.port';
import { InMemoryNotificationRepository } from '../src/modules/notifications/infrastructure/in-memory-notification.repository';

describe('Story 2.6: Form Publish Lifecycle & Immutability E2E Tests', () => {
  let app: INestApplication;
  let userRepo: InMemoryUserRepository;
  let sessionRepo: InMemorySessionRepository;
  let auditRepo: InMemoryIdentityAuditRepository;
  let formRepo: InMemoryFormRepository;
  let ledgerRepo: InMemoryLedgerRepository;
  let ledgerService: LedgerService;
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
    ledgerRepo = new InMemoryLedgerRepository();

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
      .overrideProvider(LEDGER_REPOSITORY_PORT)
      .useValue(ledgerRepo)
      .overrideProvider(EnvService)
      .useValue(envService)
      // Story 8.1: publish/close run under the shared Unit of Work, and the
      // moderation approval used below needs in-memory adapters.
      .overrideProvider(UNIT_OF_WORK_PORT)
      .useValue(new PassThroughUnitOfWork())
      .overrideProvider(ADMIN_CAPABILITY_PORT)
      .useValue(
        new InMemoryAdminCapabilityRepository((id) => userRepo.findById(id)),
      )
      .overrideProvider(SURVEY_MODERATION_REPOSITORY_PORT)
      .useValue(new InMemorySurveyModerationRepository())
      .overrideProvider(NOTIFICATION_REPOSITORY_PORT)
      .useValue(new InMemoryNotificationRepository())
      .compile();

    sessionService = moduleFixture.get(SessionService);
    ledgerService = moduleFixture.get(LedgerService);

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
    ledgerRepo.clear();
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

    if (role === 'PUBLISHER' || role === 'ADMIN') {
      const sys = await ledgerService.getOrCreateAccount(
        null,
        'SYSTEM_ISSUANCE',
      );
      const userAcc = await ledgerService.getOrCreateAccount(
        user.id,
        'USER_AVAILABLE',
      );
      await ledgerService.postJournal({
        idempotencyKey: `seed-user-${user.id}-${Date.now()}-${Math.random()}`,
        entries: [
          { accountId: sys.id, amount: -10000 },
          { accountId: userAcc.id, amount: 10000 },
        ],
      });
    }

    const tokens = await sessionService.createSession(user.id);
    return { user, tokens };
  }

  let moderatorCount = 0;

  /**
   * Story 8.1: publishing only queues a survey; a (different) Admin approves
   * it through the moderation endpoint to make it PUBLISHED.
   */
  async function approveViaModeration(formId: string) {
    moderatorCount += 1;
    const { tokens } = await createTestUserWithSession(
      `moderator${moderatorCount}@example.com`,
      'ADMIN',
    );
    const stored = await formRepo.findById(formId);
    const res = await request(app.getHttpServer())
      .post(`/admin/moderation/surveys/${formId}/approve`)
      .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
      .set('X-CSRF-Token', tokens.csrfToken)
      .set('Origin', ALLOWED_ORIGIN)
      .set('Content-Type', 'application/json')
      .send({ formVersionId: stored!.currentVersion.id });
    expect(res.status).toBe(200);
    expect(res.body.data.form.status).toBe('PUBLISHED');
    return res;
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
    it('queues an internal non-reward survey for moderation; only approval publishes it (Story 8.1)', async () => {
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
      expect(publishRes.body.data.status).toBe('MODERATION_QUEUE');
      expect(publishRes.body.data.currentVersion.isPublished).toBe(false);
      expect(publishRes.body.data.currentVersion.publishedAt).toBeNull();
      expect(publishRes.body.meta.message).toBe('Form published successfully');

      await approveViaModeration(formId);

      const getRes = await request(app.getHttpServer())
        .get(`/forms/${formId}`)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`]);
      expect(getRes.body.data.status).toBe('PUBLISHED');
      expect(getRes.body.data.currentVersion.isPublished).toBe(true);
      expect(getRes.body.data.currentVersion.publishedAt).not.toBeNull();
    });

    it('rejects a publisher-requested targetStatus that bypasses moderation with 400', async () => {
      const { tokens } = await createTestUserWithSession('bypass@example.com');
      const draftRes = await createDraft(tokens, {
        title: 'Bypass Survey',
        type: 'INTERNAL',
        rewardPerResponse: 0,
        schema: {
          schemaVersion: 1,
          title: 'Bypass Survey',
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
        .send({ targetStatus: 'PUBLISHED' });

      expect(publishRes.status).toBe(400);
      expect(publishRes.body.error.code).toBe('INVALID_STATUS_TRANSITION');
      expect((await formRepo.findById(formId))!.form.status).toBe('DRAFT');
    });

    it('queues a survey with rewards (> 0 points) for moderation after locking escrow', async () => {
      const { tokens } = await createTestUserWithSession('pub2@example.com');
      const draftRes = await createDraft(tokens, {
        title: 'Rewarded Feedback Survey',
        type: 'INTERNAL',
        rewardPerResponse: 25,
        estimatedDurationMinutes: 12, // FR-14 band 15–25 (E6-D2)
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
      expect(publishRes.body.data.status).toBe('MODERATION_QUEUE');
      expect(publishRes.body.data.currentVersion.isPublished).toBe(false);
      // 50 completions x 20 effective points (25 - 20% internal discount)
      expect(
        await ledgerService.getEscrowReservation(
          publishRes.body.data.currentVersion.id,
        ),
      ).toBe(1000);
    });

    it('enforces the FR-14 pricing band at publish only: 400 PRICING_REWARD_OUT_OF_BAND with the band, 422 without a duration (decision E6-D2)', async () => {
      const { tokens } = await createTestUserWithSession(
        'pub-pricing-band@example.com',
      );
      const draftRes = await createDraft(tokens, {
        title: 'Overpriced Survey',
        type: 'INTERNAL',
        rewardPerResponse: 60, // drafts accept anything up to 10,000
        expectedCompletions: 5,
        schema: {
          schemaVersion: 1,
          title: 'Overpriced Survey',
          blocks: [validQuestionBlock],
        },
      });
      expect(draftRes.status).toBe(201);
      const formId = draftRes.body.data.id;
      const publish = (body: Record<string, unknown>) =>
        request(app.getHttpServer())
          .post(`/forms/${formId}/publish`)
          .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
          .set('X-CSRF-Token', tokens.csrfToken)
          .set('Origin', ALLOWED_ORIGIN)
          .set('Content-Type', 'application/json')
          .send(body);

      const noDuration = await publish({});
      expect(noDuration.status).toBe(422);
      expect(noDuration.body.error.code).toBe('ESTIMATED_DURATION_REQUIRED');

      const outOfBand = await publish({ estimatedDurationMinutes: 20 });
      expect(outOfBand.status).toBe(400);
      expect(outOfBand.body.error.code).toBe('PRICING_REWARD_OUT_OF_BAND');
      expect(outOfBand.body.error.details).toEqual({
        min: 20,
        max: 40,
        suggested: 20,
      });

      const quote = await request(app.getHttpServer())
        .get(`/forms/${formId}/pricing-quote`)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .expect(200);
      // A rejected publish stores nothing: the draft still has no duration.
      expect(quote.body.data).toMatchObject({
        estimatedDurationMinutes: null,
        pricingBand: null,
        bandCheck: 'DURATION_REQUIRED',
      });

      // Still a draft: the Publisher lowers the reward, then publishes.
      const current = await request(app.getHttpServer())
        .get(`/forms/${formId}`)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .expect(200);
      expect(current.body.data.status).toBe('DRAFT');
      await request(app.getHttpServer())
        .patch(`/forms/${formId}/draft`)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .set('X-CSRF-Token', tokens.csrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'application/json')
        .send({
          clientUpdatedAt: current.body.data.updatedAt,
          rewardPerResponse: 40,
          estimatedDurationMinutes: 20,
        })
        .expect(200);

      const published = await publish({});
      expect(published.status).toBe(200);
      expect(published.body.data.status).toBe('MODERATION_QUEUE');
      expect(published.body.data.estimatedDurationMinutes).toBe(20);
    });

    it('queues an external survey with valid URL for moderation', async () => {
      const { tokens } = await createTestUserWithSession('pub3@example.com');
      const draftRes = await createDraft(tokens, {
        title: 'External Research Survey',
        type: 'EXTERNAL',
        rewardPerResponse: 10,
        estimatedDurationMinutes: 8,
        externalUrl: 'https://docs.google.com/forms/d/e/123/viewform',
        schema: {
          schemaVersion: 1,
          title: 'External Research Survey',
          blocks: [validQuestionBlock],
        },
      });

      const formId = draftRes.body.data.id;
      const publish = () =>
        request(app.getHttpServer())
          .post(`/forms/${formId}/publish`)
          .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
          .set('X-CSRF-Token', tokens.csrfToken)
          .set('Origin', ALLOWED_ORIGIN)
          .set('Content-Type', 'application/json')
          .send({});

      // Epic 4 review P2: publishing never mints an invisible completion
      // code; the publisher must generate (rotate) one first.
      const blocked = await publish();
      expect(blocked.status).toBe(422);
      expect(blocked.body.error.code).toBe('EXTERNAL_COMPLETION_CODE_REQUIRED');

      const rotateRes = await request(app.getHttpServer())
        .post(`/forms/${formId}/rotate-code`)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .set('X-CSRF-Token', tokens.csrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'application/json')
        .send({});
      expect(rotateRes.status).toBe(200);
      expect(rotateRes.body.data.plaintextCompletionCode).toMatch(/^\d{6}$/);

      const publishRes = await publish();

      expect(publishRes.status).toBe(200);
      expect(publishRes.body.data.status).toBe('MODERATION_QUEUE');
      expect(publishRes.body.data.type).toBe('EXTERNAL');
      expect(publishRes.body.data.currentVersion.hasCompletionCode).toBe(true);
    });

    it('publishes an External draft created without auto-publish (no question blocks) through the standard path (review P1)', async () => {
      const { tokens } = await createTestUserWithSession(
        'pub-external-draft@example.com',
      );
      const createRes = await request(app.getHttpServer())
        .post('/forms/external')
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .set('X-CSRF-Token', tokens.csrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'application/json')
        .send({
          title: 'External Draft Survey',
          externalUrl: 'https://forms.gle/external-draft',
          rewardPerResponse: 5,
          estimatedDurationMinutes: 3,
          expectedCompletions: 2,
          autoPublish: false,
        });
      expect(createRes.status).toBe(201);
      expect(createRes.body.data.currentVersion.schemaJson.blocks).toEqual([]);

      const publishRes = await request(app.getHttpServer())
        .post(`/forms/${createRes.body.data.id}/publish`)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .set('X-CSRF-Token', tokens.csrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'application/json')
        .send({});

      expect(publishRes.status).toBe(200);
      expect(publishRes.body.data.status).toBe('MODERATION_QUEUE');
      expect(publishRes.body.data.currentVersion.hasCompletionCode).toBe(true);
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

    it('decision E5-D2: refuses a survey longer than the 30-minute attempt reservation with 422 SURVEY_DURATION_EXCEEDS_RESERVATION', async () => {
      const { tokens } = await createTestUserWithSession(
        'pub-e5d2@example.com',
      );
      const draftRes = await createDraft(tokens, {
        title: 'Very Long Survey',
        rewardPerResponse: 0,
        schema: {
          schemaVersion: 1,
          title: 'Very Long Survey',
          blocks: [
            {
              id: 'block-q1',
              type: 'text',
              order: 0,
              title: 'Question',
              required: true,
            },
          ],
          // A 30-minute minimum can never be met inside a 30-minute attempt.
          metadata: {
            expectedEffortSeconds: 3600,
            minTimeBarrierSeconds: 1800,
          },
        },
      });
      expect(draftRes.status).toBe(201);
      const formId = draftRes.body.data.id;

      const publishRes = await request(app.getHttpServer())
        .post(`/forms/${formId}/publish`)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .set('X-CSRF-Token', tokens.csrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'application/json')
        .send({});

      expect(publishRes.status).toBe(422);
      expect(publishRes.body.error.code).toBe(
        'SURVEY_DURATION_EXCEEDS_RESERVATION',
      );
      expect(publishRes.body.error.message).toContain(
        'Phase 1 does not support surveys longer than 30 minutes',
      );
      expect(
        publishRes.body.error.details.map((v: { rule: string }) => v.rule),
      ).toEqual(['TIME_BARRIER', 'EXPECTED_EFFORT']);
      expect((await formRepo.findById(formId))!.form.status).toBe('DRAFT');
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

      // First publish (queued), then approved by moderation
      await request(app.getHttpServer())
        .post(`/forms/${formId}/publish`)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .set('X-CSRF-Token', tokens.csrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'application/json')
        .send({});
      await approveViaModeration(formId);

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
      await approveViaModeration(formId);

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
    it('refuses to move a queued survey out of the queue with 409 FORM_MODERATION_REQUIRED (Story 8.1)', async () => {
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
        estimatedDurationMinutes: 8,
        schema: {
          schemaVersion: 1,
          title: 'Lifecycle Form',
          blocks: [validQuestionBlock],
        },
      });

      const formId = draftRes.body.data.id;

      // Publish moves to MODERATION_QUEUE
      await request(app.getHttpServer())
        .post(`/forms/${formId}/publish`)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${pubTokens.accessToken}`])
        .set('X-CSRF-Token', pubTokens.csrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'application/json')
        .send({});

      for (const targetStatus of ['PUBLISHED', 'CLOSED']) {
        const res = await request(app.getHttpServer())
          .post(`/forms/${formId}/status`)
          .set('Cookie', [`${AUTH_COOKIE_NAME}=${admTokens.accessToken}`])
          .set('X-CSRF-Token', admTokens.csrfToken)
          .set('Origin', ALLOWED_ORIGIN)
          .set('Content-Type', 'application/json')
          .send({ targetStatus });

        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('FORM_MODERATION_REQUIRED');
      }
      expect((await formRepo.findById(formId))!.form.status).toBe(
        'MODERATION_QUEUE',
      );

      // The moderation endpoint is the only way to publish it.
      await approveViaModeration(formId);
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
      await approveViaModeration(formId);

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
