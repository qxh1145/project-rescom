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
import { DEMOGRAPHIC_PROFILE_REPOSITORY_PORT } from '../src/modules/users/application/ports/demographic-profile.repository.port';
import { InMemoryDemographicProfileRepository } from '../src/modules/users/infrastructure/in-memory-demographic-profile.repository';
import { seedCompleteDemographicProfile } from './fixtures/demographic-profile.fixture';
import { backdateAttempt } from './fixtures/participation.fixture';
import { PARTICIPATION_REPOSITORY_PORT } from '../src/modules/participation/application/ports/participation-repository.port';
import { InMemoryParticipationRepository } from '../src/modules/participation/infrastructure/in-memory-participation.repository';
import { SessionService } from '../src/modules/auth/application/session.service';
import { EnvService } from '../src/common/config/env.service';
import { PrismaService } from '../src/common/database/prisma.service';
import { HttpExceptionFilter } from '../src/common/http/http-exception.filter';
import { AUTH_COOKIE_NAME } from '../src/modules/auth/presentation/cookie-options.helper';
import { FormEntity } from '../src/modules/forms/domain/form.entity';
import { FormVersionEntity } from '../src/modules/forms/domain/form-version.entity';
import { LedgerService } from '../src/modules/economy/application/ledger.service';
import { InMemoryLedgerRepository } from '../src/modules/economy/infrastructure/in-memory-ledger.repository';
import { NOTIFICATION_REPOSITORY_PORT } from '../src/modules/notifications/application/ports/notification-repository.port';
import { InMemoryNotificationRepository } from '../src/modules/notifications/infrastructure/in-memory-notification.repository';
import { LEDGER_REPOSITORY_PORT } from '../src/modules/economy/application/ports/ledger-repository.port';
import { STARTER_POINTS_DATA_PROVIDER } from '../src/modules/economy/economy.module';

describe('Story 5.4: Internal Form Submission E2E Tests', () => {
  let app: INestApplication;
  let userRepo: InMemoryUserRepository;
  let sessionRepo: InMemorySessionRepository;
  let auditRepo: InMemoryIdentityAuditRepository;
  let formRepo: InMemoryFormRepository;
  let demoRepo: InMemoryDemographicProfileRepository;
  let partRepo: InMemoryParticipationRepository;
  let ledgerRepo: InMemoryLedgerRepository;
  let sessionService: SessionService;
  let envService: EnvService;

  const TEST_JWT_SECRET = 'at_least_32_characters_super_secure_jwt_secret_key!';
  const ALLOWED_ORIGIN = 'http://localhost:3000';

  const publisherId = '22222222-2222-4222-8222-222222222222';
  const internalFormId = '33333333-3333-4333-8333-333333333333';
  const formVersionId = '55555555-5555-4555-8555-555555555555';

  let authCookie: string;
  let csrfToken: string;
  let _respondentUserId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ||
      'postgresql://postgres:postgres@localhost:5433/rescom_test';

    userRepo = new InMemoryUserRepository();
    auditRepo = new InMemoryIdentityAuditRepository();
    sessionRepo = new InMemorySessionRepository(auditRepo);
    formRepo = new InMemoryFormRepository();
    demoRepo = new InMemoryDemographicProfileRepository();
    partRepo = new InMemoryParticipationRepository();
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
      .overrideProvider(USER_REPOSITORY_PORT)
      .useValue(userRepo)
      .overrideProvider(SESSION_REPOSITORY_PORT)
      .useValue(sessionRepo)
      .overrideProvider(IDENTITY_AUDIT_PORT)
      .useValue(auditRepo)
      .overrideProvider(FORM_REPOSITORY_PORT)
      .useValue(formRepo)
      .overrideProvider(DEMOGRAPHIC_PROFILE_REPOSITORY_PORT)
      .useValue(demoRepo)
      .overrideProvider(PARTICIPATION_REPOSITORY_PORT)
      .useValue(partRepo)
      .overrideProvider(LEDGER_REPOSITORY_PORT)
      .useValue(ledgerRepo)
      .overrideProvider(NOTIFICATION_REPOSITORY_PORT)
      .useValue(new InMemoryNotificationRepository())
      .overrideProvider(STARTER_POINTS_DATA_PROVIDER)
      .useValue({
        getUserRegistrationDate: jest.fn(async () => new Date()),
        isDemographicComplete: jest.fn(async () => false),
        findActivationSurveyCompletions: jest.fn(async () => []),
        findUsersForExpiry: jest.fn(async () => []),
      })
      .overrideProvider(EnvService)
      .useValue(envService)
      .compile();

    sessionService = moduleFixture.get(SessionService);

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    // 1. Create publisher & fund escrow account for reward payout
    await userRepo.create({
      id: publisherId,
      email: 'publisher@rescom.test',
      passwordHash: 'hashed_pw',
      role: 'PUBLISHER',
      status: 'ACTIVE',
    });

    const ledgerService = moduleFixture.get(LedgerService);
    const publisherEscrow = await ledgerService.getOrCreateAccount(
      publisherId,
      'ESCROW',
    );
    const systemIssuance = await ledgerService.getOrCreateAccount(
      null,
      'SYSTEM_ISSUANCE',
    );
    await ledgerService.postJournal({
      idempotencyKey: 'seed-escrow-balance-e2e',
      description: 'Seed escrow balance',
      entries: [
        { accountId: systemIssuance.id, amount: -1000 },
        { accountId: publisherEscrow.id, amount: 1000 },
      ],
    });

    // 2. Create respondent user
    const respondent = await userRepo.create({
      id: '66666666-6666-4666-8666-666666666666',
      email: 'student@fpt.edu.vn',
      passwordHash: 'hashed_pw',
      role: 'RESPONDENT',
      status: 'ACTIVE',
    });
    _respondentUserId = respondent.id;
    // Story 7.1: starting attempts requires a completed demographic survey.
    await seedCompleteDemographicProfile(demoRepo, respondent.id);

    // Issue auth session
    const sessionRes = await sessionService.createSession(respondent.id);
    authCookie = `${AUTH_COOKIE_NAME}=${sessionRes.accessToken}`;
    csrfToken = sessionRes.csrfToken;

    // 3. Create published internal Form with form blocks
    const internalForm = new FormEntity(
      internalFormId,
      publisherId,
      'INTERNAL',
      'PUBLISHED',
      'Student Experience Survey',
      'Internal research feedback survey',
      50, // reward: 50 points
      10, // 10 completions
      new Date(),
      new Date(),
    );

    const version = new FormVersionEntity(
      formVersionId,
      internalFormId,
      1,
      {
        title: 'Student Experience Survey',
        settings: {
          requireAuth: false,
          allowPublicAccess: true,
        },
        metadata: {
          expectedEffortSeconds: 30,
          minTimeBarrierSeconds: 1, // Story 8.2: effective barrier = 2 questions x 2 s = 4 s
        },
        blocks: [
          {
            id: 'block-q1',
            order: 0,
            title: 'Your Major',
            type: 'text',
            required: true,
            minLength: 2,
          },
          {
            id: 'block-q2',
            order: 1,
            title: 'Campus Satisfaction',
            type: 'rating',
            required: false,
            maxRating: 5,
          },
        ],
      } as any,
      null, // open targeting
      true,
      null,
      null,
      new Date(),
      new Date(),
    );
    await formRepo.create(internalForm, version);
  });

  afterAll(async () => {
    await app.close();
  });

  it('should initialize attempt and submit internal response successfully with instant reward', async () => {
    // Step 1: Start Attempt
    const startRes = await request(app.getHttpServer())
      .post(`/forms/${internalFormId}/attempts`)
      .set('Cookie', authCookie)
      .set('x-csrf-token', csrfToken)
      .set('Origin', ALLOWED_ORIGIN)
      .send({});

    expect(startRes.status).toBe(201);
    const { attemptId, responseId } = startRes.body.data;
    expect(attemptId).toBeDefined();
    expect(responseId).toBeDefined();

    // Story 8.2: 2 questions -> 4 s Time Barrier; move the server start back.
    backdateAttempt(partRepo, attemptId, 5);

    // Step 2: Submit Completed Form Answers
    const submitRes = await request(app.getHttpServer())
      .post(`/responses/${responseId}/submit`)
      .set('Cookie', authCookie)
      .set('x-csrf-token', csrfToken)
      .set('Origin', ALLOWED_ORIGIN)
      .send({
        answers: {
          'block-q1': 'Software Engineering',
          'block-q2': 5,
        },
      });

    expect(submitRes.status).toBe(200);
    expect(submitRes.body.data).toMatchObject({
      responseId,
      attemptId,
      formId: internalFormId,
      status: 'VALIDATED',
      policyMode: 'SHADOW',
      reward: {
        status: 'SETTLED',
        amount: 50,
        targetAccountClass: 'USER_AVAILABLE',
      },
    });

    // Verify Outbox Events emitted
    expect(partRepo.outboxEvents.length).toBe(2);
    const rewardEvent = partRepo.outboxEvents.find(
      (e) => e.eventType === 'InternalRewardRequested',
    );
    const assessmentEvent = partRepo.outboxEvents.find(
      (e) => e.eventType === 'IntegrityAssessmentRequested',
    );
    expect(rewardEvent).toBeDefined();
    expect(rewardEvent?.idempotencyKey).toBe(`internal-reward:${responseId}`);
    expect(assessmentEvent).toBeDefined();

    // Verify Idempotent submission retry
    const retryRes = await request(app.getHttpServer())
      .post(`/responses/${responseId}/submit`)
      .set('Cookie', authCookie)
      .set('x-csrf-token', csrfToken)
      .set('Origin', ALLOWED_ORIGIN)
      .send({
        answers: {
          'block-q1': 'Software Engineering',
        },
      });

    // Decision E5-D3 (option A, Story 5.4 AC2.1/AC6.2 amended): an
    // idempotent 200 with the ORIGINAL result, never a 409 and nothing new.
    expect(retryRes.status).toBe(200);
    expect(retryRes.body.data).toEqual({
      ...submitRes.body.data,
      reward: expect.objectContaining({
        status: 'SETTLED',
        journalId: submitRes.body.data.reward.journalId,
        amount: 50,
      }),
    });
    expect(retryRes.body.data.submittedAt).toBe(
      submitRes.body.data.submittedAt,
    );
    expect(partRepo.outboxEvents.length).toBe(2);
  });

  it('decision E9-D2: an Internal instant credit shows one REWARD_EARNED notice in GET /notifications, never duplicated by a retry', async () => {
    const earner = await userRepo.create({
      email: 'earner@fpt.edu.vn',
      passwordHash: 'hashed_pw',
      role: 'RESPONDENT',
      status: 'ACTIVE',
    });
    await seedCompleteDemographicProfile(demoRepo, earner.id);
    const session = await sessionService.createSession(earner.id);
    const cookie = `${AUTH_COOKIE_NAME}=${session.accessToken}`;
    const listNotifications = () =>
      request(app.getHttpServer())
        .get('/notifications')
        .set('Cookie', cookie)
        .set('Origin', ALLOWED_ORIGIN);

    const before = await listNotifications();
    expect(before.status).toBe(200);
    expect(before.body.data.total).toBe(0);

    const startRes = await request(app.getHttpServer())
      .post(`/forms/${internalFormId}/attempts`)
      .set('Cookie', cookie)
      .set('x-csrf-token', session.csrfToken)
      .set('Origin', ALLOWED_ORIGIN)
      .send({});
    expect(startRes.status).toBe(201);
    const { attemptId, responseId } = startRes.body.data;
    backdateAttempt(partRepo, attemptId, 5);

    const submit = () =>
      request(app.getHttpServer())
        .post(`/responses/${responseId}/submit`)
        .set('Cookie', cookie)
        .set('x-csrf-token', session.csrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .send({ answers: { 'block-q1': 'Business Administration' } });

    const submitRes = await submit();
    expect(submitRes.status).toBe(200);
    expect(submitRes.body.data.reward).toMatchObject({
      status: 'SETTLED',
      amount: 50,
    });

    const after = await listNotifications();
    expect(after.status).toBe(200);
    expect(after.body.data.unreadCount).toBe(1);
    expect(after.body.data.items).toEqual([
      expect.objectContaining({
        type: 'REWARD_EARNED',
        isRead: false,
        readAt: null,
      }),
    ]);
    // Decision E6-D1: the notice carries the full credited reward.
    expect(after.body.data.items[0].message).toMatch(/^50 points/);

    const retry = await submit();
    expect(retry.status).toBe(200);
    expect(retry.body.data.reward.journalId).toBe(
      submitRes.body.data.reward.journalId,
    );
    const afterRetry = await listNotifications();
    expect(afterRetry.body.data.total).toBe(1);
    expect(afterRetry.body.data.items[0].id).toBe(after.body.data.items[0].id);
  });

  it('should reject submission with missing required questions', async () => {
    const respondent2 = await userRepo.create({
      email: 'student2@fpt.edu.vn',
      passwordHash: 'hashed_pw',
      role: 'RESPONDENT',
      status: 'ACTIVE',
    });
    await seedCompleteDemographicProfile(demoRepo, respondent2.id);
    const sessionRes2 = await sessionService.createSession(respondent2.id);
    const authCookie2 = `${AUTH_COOKIE_NAME}=${sessionRes2.accessToken}`;
    const csrfToken2 = sessionRes2.csrfToken;

    // Start attempt
    const startRes = await request(app.getHttpServer())
      .post(`/forms/${internalFormId}/attempts`)
      .set('Cookie', authCookie2)
      .set('x-csrf-token', csrfToken2)
      .set('Origin', ALLOWED_ORIGIN)
      .send({});

    expect(startRes.status).toBe(201);
    const { attemptId, responseId } = startRes.body.data;

    // Story 8.2: pass the 4 s Time Barrier without sleeping.
    backdateAttempt(partRepo, attemptId, 5);

    // Epic 5 review P12 (AD-20): a session submission needs its CSRF token.
    const noToken = await request(app.getHttpServer())
      .post(`/responses/${responseId}/submit`)
      .set('Cookie', authCookie2)
      .set('Origin', ALLOWED_ORIGIN)
      .send({ answers: { 'block-q1': 'Software Engineering' } });
    expect(noToken.status).toBe(403);
    expect(noToken.body.error.code).toBe('AUTH_INVALID_CSRF_TOKEN');

    // Submit with missing block-q1
    const invalidRes = await request(app.getHttpServer())
      .post(`/responses/${responseId}/submit`)
      .set('Cookie', authCookie2)
      .set('x-csrf-token', csrfToken2)
      .set('Origin', ALLOWED_ORIGIN)
      .send({
        answers: {},
      });

    expect(invalidRes.status).toBe(400);
    expect(invalidRes.body.error.code).toBe('INVALID_FORM_SUBMISSION');
  });

  it('should support guest internal submission (skips reward, emits assessment outbox only)', async () => {
    const guestAttemptId = 'guest-att-9999-9999-9999-999999999999';
    const guestCreated = await partRepo.createAttemptWithResponse({
      attemptId: guestAttemptId,
      formId: internalFormId,
      formVersionId,
      respondentId: null,
      isGuest: true,
      formType: 'INTERNAL',
      ipAddress: '127.0.0.1',
      startedAt: new Date(Date.now() - 5000), // 5 seconds ago
    });
    const guestResponseId = guestCreated.response!.id;

    // Epic 5 review P12: a guest submission must come from an allowed Origin.
    const noOrigin = await request(app.getHttpServer())
      .post(`/responses/${guestResponseId}/submit`)
      .send({ answers: { 'block-q1': 'Guest Major' } });
    expect(noOrigin.status).toBe(403);

    const guestRes = await request(app.getHttpServer())
      .post(`/responses/${guestResponseId}/submit`)
      .set('Origin', ALLOWED_ORIGIN)
      .send({
        answers: {
          'block-q1': 'Guest Major',
        },
      });

    expect(guestRes.status).toBe(200);
    expect(guestRes.body.data.status).toBe('VALIDATED');
    expect(guestRes.body.data.reward?.status).toBe('SKIPPED_GUEST');
  });
});
