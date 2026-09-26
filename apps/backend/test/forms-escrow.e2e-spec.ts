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
import { LedgerService } from '../src/modules/economy/application/ledger.service';
import { ADMIN_CAPABILITY_PORT } from '../src/modules/economy/application/ports/admin-capability.port';
import { InMemoryAdminCapabilityRepository } from '../src/modules/economy/infrastructure/in-memory-admin-capability.repository';
import { SURVEY_MODERATION_REPOSITORY_PORT } from '../src/modules/moderation/application/ports/survey-moderation-repository.port';
import { InMemorySurveyModerationRepository } from '../src/modules/moderation/infrastructure/in-memory-survey-moderation.repository';
import { NOTIFICATION_REPOSITORY_PORT } from '../src/modules/notifications/application/ports/notification-repository.port';
import { InMemoryNotificationRepository } from '../src/modules/notifications/infrastructure/in-memory-notification.repository';
import { PARTICIPATION_REPOSITORY_PORT } from '../src/modules/participation/application/ports/participation-repository.port';
import { InMemoryParticipationRepository } from '../src/modules/participation/infrastructure/in-memory-participation.repository';
import { STARTER_POINTS_DATA_PROVIDER } from '../src/modules/economy/economy.module';
import { DEMOGRAPHIC_PROFILE_REPOSITORY_PORT } from '../src/modules/users/application/ports/demographic-profile.repository.port';
import { InMemoryDemographicProfileRepository } from '../src/modules/users/infrastructure/in-memory-demographic-profile.repository';
import { seedCompleteDemographicProfile } from './fixtures/demographic-profile.fixture';
import { backdateAttempt } from './fixtures/participation.fixture';
import { SurveyAttemptEntity } from '../src/modules/participation/domain/survey-attempt.entity';
import { ResponseEntity } from '../src/modules/participation/domain/response.entity';
import { randomUUID } from 'crypto';

describe('Story 6.3: Escrow Lock, Release & Refund E2E Tests (FR-14, FR-15, FR-19, FR-32, FR-33)', () => {
  let app: INestApplication;
  let userRepo: InMemoryUserRepository;
  let sessionRepo: InMemorySessionRepository;
  let auditRepo: InMemoryIdentityAuditRepository;
  let formRepo: InMemoryFormRepository;
  let partRepo: InMemoryParticipationRepository;
  let ledgerRepo: InMemoryLedgerRepository;
  let demoRepo: InMemoryDemographicProfileRepository;
  let ledgerService: LedgerService;
  let sessionService: SessionService;
  let envService: EnvService;

  const TEST_JWT_SECRET = 'at_least_32_characters_super_secure_jwt_secret_key!';
  const ALLOWED_ORIGIN = 'http://localhost:3000';

  let authCookie: string;
  let csrfToken: string;
  let publisherId: string;
  let adminCookie: string;
  let adminCsrfToken: string;

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ||
      'postgresql://postgres:postgres@localhost:5433/rescom_test';

    userRepo = new InMemoryUserRepository();
    auditRepo = new InMemoryIdentityAuditRepository();
    sessionRepo = new InMemorySessionRepository(auditRepo);
    formRepo = new InMemoryFormRepository();
    partRepo = new InMemoryParticipationRepository();
    // Epic 6 review P4/P17: the close refund reads the real completions.
    formRepo.useCompletionSource((formId) =>
      partRepo.completionRefsFor(formId),
    );
    ledgerRepo = new InMemoryLedgerRepository();
    // Decision E6-D1 e2e: respondents submit through the real endpoints.
    demoRepo = new InMemoryDemographicProfileRepository();

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
      .overrideProvider(PARTICIPATION_REPOSITORY_PORT)
      .useValue(partRepo)
      .overrideProvider(DEMOGRAPHIC_PROFILE_REPOSITORY_PORT)
      .useValue(demoRepo)
      .overrideProvider(STARTER_POINTS_DATA_PROVIDER)
      .useValue({
        getUserRegistrationDate: jest.fn(async () => null),
        isDemographicComplete: jest.fn(async () => false),
        findActivationSurveyCompletions: jest.fn(async () => []),
        findUsersForExpiry: jest.fn(async () => []),
      })
      .overrideProvider(LEDGER_REPOSITORY_PORT)
      .useValue(ledgerRepo)
      .overrideProvider(EnvService)
      .useValue(envService)
      // Story 8.1: the survey goes live through the moderation endpoint.
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

    // Create publisher user
    const user = await userRepo.create({
      email: 'publisher-escrow-e2e@rescom.test',
      passwordHash: '$2a$12$someHashedPassword',
      role: 'PUBLISHER',
      status: 'ACTIVE',
    });
    publisherId = user.id;

    // Seed publisher with 1000 available points
    const system = await ledgerService.getOrCreateAccount(
      null,
      'SYSTEM_ISSUANCE',
    );
    const pubAvail = await ledgerService.getOrCreateAccount(
      publisherId,
      'USER_AVAILABLE',
    );
    await ledgerService.transfer({
      fromAccountId: system.id,
      toAccountId: pubAvail.id,
      amount: 1000,
      idempotencyKey: 'seed-e2e-escrow-1000',
      description: 'Initial seed for E2E tests',
    });

    const tokens = await sessionService.createSession(user.id);
    authCookie = `${AUTH_COOKIE_NAME}=${tokens.accessToken}`;
    csrfToken = tokens.csrfToken;

    const admin = await userRepo.create({
      email: 'moderator-escrow-e2e@rescom.test',
      passwordHash: '$2a$12$someHashedPassword',
      role: 'ADMIN',
      status: 'ACTIVE',
    });
    const adminTokens = await sessionService.createSession(admin.id);
    adminCookie = `${AUTH_COOKIE_NAME}=${adminTokens.accessToken}`;
    adminCsrfToken = adminTokens.csrfToken;
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  /** A VALIDATED non-guest Internal response (reward not yet settled). */
  function seedValidatedResponse(formId: string, versionId: string): string {
    const attemptId = randomUUID();
    const responseId = randomUUID();
    const respondentId = randomUUID();
    partRepo.attempts.set(
      attemptId,
      new SurveyAttemptEntity(
        attemptId,
        formId,
        versionId,
        respondentId,
        'COMPLETED',
        false,
        new Date(),
        new Date(),
        null,
        new Date(),
        new Date(),
      ),
    );
    partRepo.responses.set(
      responseId,
      new ResponseEntity(
        responseId,
        formId,
        versionId,
        attemptId,
        respondentId,
        'VALIDATED',
        {},
        '127.0.0.1',
        false,
        new Date(),
        new Date(),
        new Date(),
      ),
    );
    return responseId;
  }

  /** A COMPLETED External attempt (its Pending credit is paid separately). */
  function seedCompletedAttempt(
    formId: string,
    versionId: string,
    respondentId: string = randomUUID(),
    status: 'COMPLETED' | 'IN_PROGRESS' = 'COMPLETED',
  ): string {
    const attemptId = randomUUID();
    partRepo.attempts.set(
      attemptId,
      new SurveyAttemptEntity(
        attemptId,
        formId,
        versionId,
        respondentId,
        status,
        false,
        new Date(Date.now() - 60_000),
        status === 'COMPLETED' ? new Date() : null,
        null,
        new Date(),
        new Date(),
      ),
    );
    return attemptId;
  }

  function post(path: string, cookie: string, csrf: string, body = {}) {
    return request(app.getHttpServer())
      .post(path)
      .set('Cookie', cookie)
      .set('x-csrf-token', csrf)
      .set('Origin', ALLOWED_ORIGIN)
      .set('Content-Type', 'application/json')
      .send(body);
  }

  async function publisherBalance() {
    const res = await request(app.getHttpServer())
      .get('/economy/wallet')
      .set('Cookie', authCookie)
      .expect(200);
    return res.body.data.balance;
  }

  describe('Full Escrow Lifecycle E2E', () => {
    let formId: string;

    it('1. Creates an internal draft and checks pricing quote with 20% discount (FR-14, FR-19)', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/forms')
        .set('Cookie', authCookie)
        .set('x-csrf-token', csrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'application/json')
        .send({
          title: 'Campus Lifestyle Survey',
          type: 'INTERNAL',
          rewardPerResponse: 10,
          expectedCompletions: 50,
          estimatedDurationMinutes: 8, // FR-14 band 10–20 (E6-D2)
          schema: {
            schemaVersion: 1,
            title: 'Campus Lifestyle Survey',
            blocks: [
              {
                id: 'b-1',
                type: 'text',
                title: 'What is your major?',
                order: 0,
                required: true,
              },
            ],
          },
        })
        .expect(201);

      expect(createRes.body.data.id).toBeDefined();
      formId = createRes.body.data.id;

      // Request pricing quote
      const quoteRes = await request(app.getHttpServer())
        .get(`/forms/${formId}/pricing-quote`)
        .set('Cookie', authCookie)
        .expect(200);

      expect(quoteRes.body.data).toEqual({
        type: 'INTERNAL',
        expectedCompletions: 50,
        baseRewardPerResponse: 10,
        effectiveRewardPerResponse: 8,
        baseCost: 500,
        effectiveCost: 400,
        discountPercent: 20,
        discountAmount: 100,
        // Decision E6-D2: the FR-14 band of the estimated duration.
        estimatedDurationMinutes: 8,
        pricingBand: {
          min: 10,
          max: 20,
          suggested: 10,
          durationBand: '5–10 min',
        },
        bandCheck: 'WITHIN_BAND',
      });
    });

    it('2. Publishes the survey, locking 400 points into Escrow (FR-15)', async () => {
      const publishRes = await request(app.getHttpServer())
        .post(`/forms/${formId}/publish`)
        .set('Cookie', authCookie)
        .set('x-csrf-token', csrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'application/json')
        .send({})
        .expect(200);

      // Story 8.1: escrow is locked and the survey waits for moderation.
      expect(publishRes.body.data.status).toBe('MODERATION_QUEUE');

      // Verify wallet reflects 400 points in escrow and 600 available
      const walletRes = await request(app.getHttpServer())
        .get('/economy/wallet')
        .set('Cookie', authCookie)
        .expect(200);

      expect(walletRes.body.data.balance.available).toBe(600);
      expect(walletRes.body.data.balance.escrow).toBe(400);
      expect(walletRes.body.data.balance.total).toBe(1000);
    });

    it('2b. Admin approval publishes the survey without moving escrow (Story 8.1)', async () => {
      const stored = await formRepo.findById(formId);
      const approveRes = await request(app.getHttpServer())
        .post(`/admin/moderation/surveys/${formId}/approve`)
        .set('Cookie', adminCookie)
        .set('x-csrf-token', adminCsrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'application/json')
        .send({ formVersionId: stored!.currentVersion.id })
        .expect(200);

      expect(approveRes.body.data.form.status).toBe('PUBLISHED');

      const walletRes = await request(app.getHttpServer())
        .get('/economy/wallet')
        .set('Cookie', authCookie)
        .expect(200);
      expect(walletRes.body.data.balance.available).toBe(600);
      expect(walletRes.body.data.balance.escrow).toBe(400);
    });

    it('3. Rejects publishing another survey that exceeds available balance (FR-15)', async () => {
      // Create expensive survey: 50 completions * 20 reward = 1000 points > 600 available
      const expensiveRes = await request(app.getHttpServer())
        .post('/forms')
        .set('Cookie', authCookie)
        .set('x-csrf-token', csrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'application/json')
        .send({
          title: 'Expensive External Survey',
          type: 'EXTERNAL',
          rewardPerResponse: 20,
          expectedCompletions: 50,
          estimatedDurationMinutes: 8,
          schema: {
            schemaVersion: 1,
            title: 'Expensive Survey',
            blocks: [
              {
                id: 'b-exp',
                type: 'text',
                title: 'Question',
                order: 0,
                required: true,
              },
            ],
          },
        })
        .expect(201);

      const expFormId = expensiveRes.body.data.id;

      // An External version needs a completion code before it can publish.
      await request(app.getHttpServer())
        .post(`/forms/${expFormId}/rotate-code`)
        .set('Cookie', authCookie)
        .set('x-csrf-token', csrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'application/json')
        .send({})
        .expect(200);

      const failedPublish = await request(app.getHttpServer())
        .post(`/forms/${expFormId}/publish`)
        .set('Cookie', authCookie)
        .set('x-csrf-token', csrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'application/json')
        .send({
          externalUrl: 'https://docs.google.com/forms/d/xyz/viewform',
        })
        .expect(409);

      expect(failedPublish.body.error.code).toBe('INSUFFICIENT_ESCROW_BALANCE');
      expect(failedPublish.body.error.details.availableBalance).toBe(600);
      expect(failedPublish.body.error.details.requiredAmount).toBe(1000);
    });

    it('4. Closes survey with partial completions and automatically refunds unused escrow (FR-32)', async () => {
      // 35 real VALIDATED responses out of 50 (15 unused). Their rewards are
      // still owed (settlement pending), so their 35 x 8 stays in Escrow and
      // only the unused 15 x 8 = 120 points are refunded (Epic 6 review P4).
      const stored = await formRepo.findById(formId);
      for (let i = 0; i < 35; i++) {
        seedValidatedResponse(formId, stored!.currentVersion.id);
      }

      const closeRes = await request(app.getHttpServer())
        .post(`/forms/${formId}/close`)
        .set('Cookie', authCookie)
        .set('x-csrf-token', csrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'application/json')
        .send({ reason: 'Target achieved early' })
        .expect(200);

      expect(closeRes.body.data.status).toBe('CLOSED');

      // Verify wallet: available balance increased by 120 (from 600 to 720), escrow decreased to 280
      const walletRes = await request(app.getHttpServer())
        .get('/economy/wallet')
        .set('Cookie', authCookie)
        .expect(200);

      expect(walletRes.body.data.balance.available).toBe(720);
      expect(walletRes.body.data.balance.escrow).toBe(280);
    });

    it('5. Reopens closed survey with additional quota and locks additional escrow (FR-33)', async () => {
      // Reopen with 20 additional completions -> 20 * 8 = 160 points
      const reopenRes = await request(app.getHttpServer())
        .post(`/forms/${formId}/reopen`)
        .set('Cookie', authCookie)
        .set('x-csrf-token', csrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'application/json')
        .send({ additionalCompletions: 20 })
        .expect(200);

      expect(reopenRes.body.data.status).toBe('PUBLISHED');
      expect(reopenRes.body.data.expectedCompletions).toBe(70); // 50 + 20

      // Verify wallet: available decreased by 160 (from 720 to 560), escrow increased by 160 (to 440)
      const walletRes = await request(app.getHttpServer())
        .get('/economy/wallet')
        .set('Cookie', authCookie)
        .expect(200);

      expect(walletRes.body.data.balance.available).toBe(560);
      expect(walletRes.body.data.balance.escrow).toBe(440);
      expect(walletRes.body.data.balance.total).toBe(1000);
    });
  });
  describe('External survey with real paid completions (Epic 6 review P3/P4/P6)', () => {
    let externalId: string;
    let versionId: string;
    let plaintextCode: string;

    it('publishes and approves a 20 x 10 External survey (200 in Escrow)', async () => {
      const created = await post('/forms', authCookie, csrfToken, {
        title: 'Paid External Survey',
        type: 'EXTERNAL',
        rewardPerResponse: 10,
        expectedCompletions: 20,
        estimatedDurationMinutes: 8,
        schema: {
          schemaVersion: 1,
          title: 'Paid External Survey',
          blocks: [],
        },
      }).expect(201);
      externalId = created.body.data.id;

      const rotated = await post(
        `/forms/${externalId}/rotate-code`,
        authCookie,
        csrfToken,
      ).expect(200);
      plaintextCode = rotated.body.data.plaintextCompletionCode;

      await post(`/forms/${externalId}/publish`, authCookie, csrfToken, {
        externalUrl: 'https://docs.google.com/forms/d/paid/viewform',
      }).expect(200);
      const stored = await formRepo.findById(externalId);
      versionId = stored!.currentVersion.id;
      await post(
        `/admin/moderation/surveys/${externalId}/approve`,
        adminCookie,
        adminCsrfToken,
        { formVersionId: versionId },
      ).expect(200);

      const balance = await publisherBalance();
      expect(balance.escrow).toBe(640); // 440 (Internal survey) + 200
      expect(balance.available).toBe(360);
    });

    it('refunds exactly the unused quota after 5 paid completions, leaving the other survey untouched', async () => {
      for (let i = 0; i < 5; i++) {
        const attemptId = seedCompletedAttempt(externalId, versionId);
        await post(
          `/economy/rewards/external/${attemptId}`,
          adminCookie,
          adminCsrfToken,
        ).expect(200);
      }
      expect((await publisherBalance()).escrow).toBe(590);

      await post(`/forms/${externalId}/close`, authCookie, csrfToken, {
        reason: 'Enough data',
      }).expect(200);

      const balance = await publisherBalance();
      // (20 - 5) x 10 = 150 refunded; the Internal survey keeps its 440.
      expect(balance.available).toBe(510);
      expect(balance.escrow).toBe(440);
      expect(
        await ledgerService.findJournalByIdempotencyKey(
          `close-refund:${externalId}:c1`,
        ),
      ).not.toBeNull();
    });

    it('rejects a completion code verified after the close, burning nothing (P6)', async () => {
      const respondent = await userRepo.create({
        email: 'late-respondent@rescom.test',
        passwordHash: '$2a$12$someHashedPassword',
        role: 'RESPONDENT',
        status: 'ACTIVE',
      });
      const tokens = await sessionService.createSession(respondent.id);
      const attemptId = seedCompletedAttempt(
        externalId,
        versionId,
        respondent.id,
        'IN_PROGRESS',
      );

      const res = await post(
        `/forms/${externalId}/attempts/${attemptId}/verify-code`,
        `${AUTH_COOKIE_NAME}=${tokens.accessToken}`,
        tokens.csrfToken,
        { completionCode: plaintextCode },
      );

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('SURVEY_NOT_AVAILABLE');
      expect(partRepo.attempts.get(attemptId)?.status).toBe('IN_PROGRESS');
      expect(
        await ledgerService.findJournalByIdempotencyKey(
          `external-completion:${attemptId}`,
        ),
      ).toBeNull();
      expect((await publisherBalance()).escrow).toBe(440);
    });

    it('funds a second reopen and refunds a second close with their own journals (P3)', async () => {
      await post(`/forms/${externalId}/reopen`, authCookie, csrfToken, {
        additionalCompletions: 10,
      }).expect(200); // +100
      for (let i = 0; i < 2; i++) {
        const attemptId = seedCompletedAttempt(externalId, versionId);
        await post(
          `/economy/rewards/external/${attemptId}`,
          adminCookie,
          adminCsrfToken,
        ).expect(200);
      }
      await post(`/forms/${externalId}/close`, authCookie, csrfToken, {
        reason: 'Second close',
      }).expect(200); // refunds the 8 unused reopened slots = 80

      await post(`/forms/${externalId}/reopen`, authCookie, csrfToken, {
        additionalCompletions: 5,
      }).expect(200); // +50, funded by its own journal
      const closed = await post(
        `/forms/${externalId}/close`,
        authCookie,
        csrfToken,
        { reason: 'Third close' },
      ).expect(200); // refunds 50

      expect(closed.body.data.expectedCompletions).toBe(35);
      for (const key of [
        `reopen-escrow:${externalId}:c1`,
        `close-refund:${externalId}:c2`,
        `reopen-escrow:${externalId}:c2`,
        `close-refund:${externalId}:c3`,
      ]) {
        expect(await ledgerService.findJournalByIdempotencyKey(key)).not.toBe(
          null,
        );
      }
      const balance = await publisherBalance();
      // 7 completions x 10 were paid out; everything else came back.
      expect(balance.escrow).toBe(440);
      expect(balance.available).toBe(490);
    });
  });
  describe('Internal survey paid in full through real submissions (decision E6-D1)', () => {
    it('pays every slot the advertised reward, drains exactly its own Escrow and replays idempotently', async () => {
      const before = await publisherBalance();
      const questionId = 'q-major';
      const created = await post('/forms', authCookie, csrfToken, {
        title: 'Fully Paid Internal Survey',
        type: 'INTERNAL',
        rewardPerResponse: 25,
        expectedCompletions: 3,
        estimatedDurationMinutes: 12, // FR-14 band 15–25
        schema: {
          schemaVersion: 1,
          title: 'Fully Paid Internal Survey',
          blocks: [
            {
              id: questionId,
              type: 'text',
              title: 'What is your major?',
              order: 0,
              required: true,
            },
          ],
        },
      }).expect(201);
      const internalId = created.body.data.id;

      // Publish reserves 3 x round(0.8 x 25) = 60; approval makes it live.
      await post(`/forms/${internalId}/publish`, authCookie, csrfToken).expect(
        200,
      );
      const stored = await formRepo.findById(internalId);
      await post(
        `/admin/moderation/surveys/${internalId}/approve`,
        adminCookie,
        adminCsrfToken,
        { formVersionId: stored!.currentVersion.id },
      ).expect(200);
      expect((await publisherBalance()).escrow).toBe(before.escrow + 60);
      const issuanceBefore = (
        await ledgerService.getOrCreateAccount(null, 'SYSTEM_ISSUANCE')
      ).balance;

      for (let slot = 0; slot < 3; slot++) {
        const respondent = await userRepo.create({
          email: `full-quota-${slot}@rescom.test`,
          passwordHash: '$2a$12$someHashedPassword',
          role: 'RESPONDENT',
          status: 'ACTIVE',
        });
        await seedCompleteDemographicProfile(demoRepo, respondent.id);
        const tokens = await sessionService.createSession(respondent.id);
        const cookie = `${AUTH_COOKIE_NAME}=${tokens.accessToken}`;

        const started = await post(
          `/forms/${internalId}/attempts`,
          cookie,
          tokens.csrfToken,
        ).expect(201);
        const { attemptId, responseId } = started.body.data;
        // Story 8.2 Time Barrier: move the server-recorded start back.
        backdateAttempt(partRepo, attemptId, 120);

        const answers = { answers: { [questionId]: 'Economics' } };
        const submitted = await post(
          `/responses/${responseId}/submit`,
          cookie,
          tokens.csrfToken,
          answers,
        ).expect(200);
        expect(submitted.body.data.reward).toMatchObject({
          status: 'SETTLED',
          amount: 25,
          targetAccountClass: 'USER_AVAILABLE',
        });

        // An idempotent replay returns the same single journal.
        const replay = await post(
          `/responses/${responseId}/submit`,
          cookie,
          tokens.csrfToken,
          answers,
        ).expect(200);
        expect(replay.body.data.reward.journalId).toBe(
          submitted.body.data.reward.journalId,
        );
        expect(
          await ledgerRepo.findJournalsByIdempotencyKeyPrefix(
            `internal-reward:${responseId}`,
          ),
        ).toHaveLength(1);

        const wallet = await request(app.getHttpServer())
          .get('/economy/wallet')
          .set('Cookie', cookie)
          .expect(200);
        expect(wallet.body.data.balance.available).toBe(25);
      }

      // Every slot paid: exactly the form's 60 left Escrow (3 x 20), the
      // platform minted the 3 x 5 discount, other surveys are untouched.
      const after = await publisherBalance();
      expect(after.escrow).toBe(before.escrow);
      expect(after.available).toBe(before.available - 60);
      expect(
        (await ledgerService.getOrCreateAccount(null, 'SYSTEM_ISSUANCE'))
          .balance,
      ).toBe(issuanceBefore - 15);

      // Nothing is left to refund on close.
      await post(`/forms/${internalId}/close`, authCookie, csrfToken, {
        reason: 'Quota reached',
      }).expect(200);
      expect(
        await ledgerService.findJournalByIdempotencyKey(
          `close-refund:${internalId}:c1`,
        ),
      ).toBeNull();
      expect((await publisherBalance()).escrow).toBe(before.escrow);
    });
  });
});
