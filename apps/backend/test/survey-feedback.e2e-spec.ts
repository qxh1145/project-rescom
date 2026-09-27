import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import {
  submitSurveyFeedbackResultSchema,
  surveyFeedbackStatusSchema,
  surveyFeedbackSubmittedEventPayloadSchema,
} from '@rescom/schemas';
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
import { PARTICIPATION_REPOSITORY_PORT } from '../src/modules/participation/application/ports/participation-repository.port';
import { InMemoryParticipationRepository } from '../src/modules/participation/infrastructure/in-memory-participation.repository';
import { SURVEY_FEEDBACK_REPOSITORY_PORT } from '../src/modules/participation/application/ports/survey-feedback-repository.port';
import { InMemorySurveyFeedbackRepository } from '../src/modules/participation/infrastructure/in-memory-survey-feedback.repository';
import { SessionService } from '../src/modules/auth/application/session.service';
import { EnvService } from '../src/common/config/env.service';
import { PrismaService } from '../src/common/database/prisma.service';
import { HttpExceptionFilter } from '../src/common/http/http-exception.filter';
import { AUTH_COOKIE_NAME } from '../src/modules/auth/presentation/cookie-options.helper';
import { FormEntity } from '../src/modules/forms/domain/form.entity';
import { FormVersionEntity } from '../src/modules/forms/domain/form-version.entity';
import { LedgerService } from '../src/modules/economy/application/ledger.service';
import { InMemoryLedgerRepository } from '../src/modules/economy/infrastructure/in-memory-ledger.repository';
import { LEDGER_REPOSITORY_PORT } from '../src/modules/economy/application/ports/ledger-repository.port';
import { NOTIFICATION_REPOSITORY_PORT } from '../src/modules/notifications/application/ports/notification-repository.port';
import { InMemoryNotificationRepository } from '../src/modules/notifications/infrastructure/in-memory-notification.repository';
import { STARTER_POINTS_DATA_PROVIDER } from '../src/modules/economy/economy.module';
import { CompletionCodeService } from '../src/modules/forms/infrastructure/completion-code.service';
import {
  AttemptStatus,
  SurveyAttemptEntity,
} from '../src/modules/participation/domain/survey-attempt.entity';
import { ResponseEntity } from '../src/modules/participation/domain/response.entity';

describe('Story 9.2: Respondent Post-Completion Feedback E2E (FR-43)', () => {
  let app: INestApplication;
  let userRepo: InMemoryUserRepository;
  let formRepo: InMemoryFormRepository;
  let partRepo: InMemoryParticipationRepository;
  let feedbackRepo: InMemorySurveyFeedbackRepository;
  let ledgerService: LedgerService;

  const TEST_JWT_SECRET = 'at_least_32_characters_super_secure_jwt_secret_key!';
  const ALLOWED_ORIGIN = 'http://localhost:3000';

  const publisherId = '22222222-2222-4222-8222-222222222222';
  const respondentId = '66666666-6666-4666-8666-666666666666';
  const otherRespondentId = '67676767-6767-4767-8767-676767676767';
  const externalFormId = '44444444-4444-4444-8444-444444444444';
  const externalVersionId = '55555555-5555-4555-8555-555555555555';
  const internalFormId = '48484848-4848-4848-8848-484848484848';
  const internalVersionId = '58585858-5858-4858-8858-585858585858';
  const validPlaintextCode = '777111';

  let authCookie: string;
  let csrfToken: string;
  let otherAuthCookie: string;
  let otherCsrfToken: string;
  let publisherAuthCookie: string;
  let publisherCsrfToken: string;
  let adminAuthCookie: string;
  let adminCsrfToken: string;
  const adminId = '29292929-2929-4929-8929-292929292929';

  function seedAttempt(
    id: string,
    formId: string,
    formVersionId: string,
    status: AttemptStatus,
    owner: string = respondentId,
    startedAt = new Date(Date.now() - 5000),
  ): void {
    partRepo.attempts.set(
      id,
      new SurveyAttemptEntity(
        id,
        formId,
        formVersionId,
        owner,
        status,
        false,
        startedAt,
        status === 'COMPLETED' ? new Date() : null,
        null,
        new Date(),
        new Date(),
      ),
    );
  }

  function post(
    attemptId: string,
    body: unknown,
    cookie = authCookie,
    csrf = csrfToken,
    prefix = '',
  ) {
    return request(app.getHttpServer())
      .post(`${prefix}/attempts/${attemptId}/feedback`)
      .set('Cookie', cookie)
      .set('x-csrf-token', csrf)
      .set('Origin', ALLOWED_ORIGIN)
      .set('Content-Type', 'application/json')
      .send(body as object);
  }

  function get(attemptId: string, cookie = authCookie) {
    return request(app.getHttpServer())
      .get(`/attempts/${attemptId}/feedback`)
      .set('Cookie', cookie);
  }

  async function walletSnapshot() {
    const wallet = await ledgerService.getWallet(respondentId);
    return { balance: wallet.balance, count: wallet.transactions.length };
  }

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ||
      'postgresql://postgres:postgres@localhost:5433/rescom_test';

    userRepo = new InMemoryUserRepository();
    const auditRepo = new InMemoryIdentityAuditRepository();
    const sessionRepo = new InMemorySessionRepository(auditRepo);
    formRepo = new InMemoryFormRepository();
    partRepo = new InMemoryParticipationRepository();
    feedbackRepo = new InMemorySurveyFeedbackRepository();
    const ledgerRepo = new InMemoryLedgerRepository();

    const envService = new EnvService({
      NODE_ENV: 'test',
      PORT: 4000,
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5433/rescom_test',
      JWT_SECRET: TEST_JWT_SECRET,
      JWT_ACCESS_TTL_SECONDS: 900,
      BCRYPT_ROUNDS: 12,
      FRONTEND_ORIGINS: ALLOWED_ORIGIN,
    });
    const completionCodeService = new CompletionCodeService(envService);

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
      .useValue(new InMemoryDemographicProfileRepository())
      .overrideProvider(PARTICIPATION_REPOSITORY_PORT)
      .useValue(partRepo)
      .overrideProvider(SURVEY_FEEDBACK_REPOSITORY_PORT)
      .useValue(feedbackRepo)
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

    const sessionService = moduleFixture.get(SessionService);
    ledgerService = moduleFixture.get(LedgerService);

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    await userRepo.create({
      id: publisherId,
      email: 'publisher.feedback@rescom.test',
      passwordHash: 'hash',
      role: 'PUBLISHER',
      status: 'ACTIVE',
    });
    const publisherEscrow = await ledgerService.getOrCreateAccount(
      publisherId,
      'ESCROW',
    );
    const systemIssuance = await ledgerService.getOrCreateAccount(
      null,
      'SYSTEM_ISSUANCE',
    );
    await ledgerService.postJournal({
      idempotencyKey: 'seed-escrow-balance-feedback-e2e',
      description: 'Seed escrow balance',
      entries: [
        { accountId: systemIssuance.id, amount: -1000 },
        { accountId: publisherEscrow.id, amount: 1000 },
      ],
    });

    for (const [id, email] of [
      [respondentId, 'respondent.feedback@rescom.test'],
      [otherRespondentId, 'other.feedback@rescom.test'],
    ]) {
      await userRepo.create({
        id,
        email,
        passwordHash: 'hash',
        role: 'RESPONDENT',
        status: 'ACTIVE',
      });
    }
    const session = await sessionService.createSession(respondentId);
    authCookie = `${AUTH_COOKIE_NAME}=${session.accessToken}`;
    csrfToken = session.csrfToken;
    const otherSession = await sessionService.createSession(otherRespondentId);
    otherAuthCookie = `${AUTH_COOKIE_NAME}=${otherSession.accessToken}`;
    otherCsrfToken = otherSession.csrfToken;
    const publisherSession = await sessionService.createSession(publisherId);
    publisherAuthCookie = `${AUTH_COOKIE_NAME}=${publisherSession.accessToken}`;
    publisherCsrfToken = publisherSession.csrfToken;
    await userRepo.create({
      id: adminId,
      email: 'admin.feedback@rescom.test',
      passwordHash: 'hash',
      role: 'ADMIN',
      status: 'ACTIVE',
    });
    const adminSession = await sessionService.createSession(adminId);
    adminAuthCookie = `${AUTH_COOKIE_NAME}=${adminSession.accessToken}`;
    adminCsrfToken = adminSession.csrfToken;

    await formRepo.create(
      new FormEntity(
        externalFormId,
        publisherId,
        'EXTERNAL',
        'PUBLISHED',
        'External feedback survey',
        null,
        40,
        100,
        new Date(),
        new Date(),
      ),
      new FormVersionEntity(
        externalVersionId,
        externalFormId,
        1,
        {
          title: 'External feedback survey',
          blocks: [],
          metadata: { expectedEffortSeconds: 60, minTimeBarrierSeconds: 2 },
        } as any,
        null,
        true,
        'https://docs.google.com/forms/d/e/feedback/viewform',
        completionCodeService.computeVerifier(
          externalVersionId,
          validPlaintextCode,
        ),
        new Date(),
        new Date(),
      ),
    );
    await formRepo.create(
      new FormEntity(
        internalFormId,
        publisherId,
        'INTERNAL',
        'PUBLISHED',
        'Internal feedback survey',
        null,
        10,
        100,
        new Date(),
        new Date(),
      ),
      new FormVersionEntity(
        internalVersionId,
        internalFormId,
        1,
        { title: 'Internal feedback survey', blocks: [] } as any,
        null,
        true,
        null,
        null,
        new Date(),
        new Date(),
      ),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('External: prompt right after code verification, saved once, no reward change', async () => {
    const attemptId = '71717171-7171-4171-8171-717171717171';
    seedAttempt(attemptId, externalFormId, externalVersionId, 'IN_PROGRESS');

    const verify = await request(app.getHttpServer())
      .post(`/attempts/${attemptId}/verify-code`)
      .set('Cookie', authCookie)
      .set('x-csrf-token', csrfToken)
      .set('Origin', ALLOWED_ORIGIN)
      .set('Content-Type', 'application/json')
      .send({ completionCode: validPlaintextCode });
    expect(verify.status).toBe(200);
    expect(verify.body.data.status).toBe('COMPLETED');

    const before = await walletSnapshot();
    expect(before.balance.pending).toBe(40);

    const status = await get(attemptId);
    expect(status.status).toBe(200);
    expect(surveyFeedbackStatusSchema.parse(status.body.data)).toEqual({
      attemptId,
      state: 'ELIGIBLE',
      feedback: null,
    });

    const body = {
      rating: 2,
      comment: '  Mô tả nói 5 phút nhưng mất 15 phút  ',
      issueTags: ['LONGER_THAN_ESTIMATED', 'MISLEADING_DESCRIPTION'],
    };
    const created = await post(attemptId, body);
    expect(created.status).toBe(200);
    const result = submitSurveyFeedbackResultSchema.parse(created.body.data);
    expect(result.replayed).toBe(false);
    expect(result.feedback).toEqual(
      expect.objectContaining({
        attemptId,
        formId: externalFormId,
        formVersionId: externalVersionId,
        formType: 'EXTERNAL',
        rating: 2,
        comment: 'Mô tả nói 5 phút nhưng mất 15 phút',
        issueTags: ['LONGER_THAN_ESTIMATED', 'MISLEADING_DESCRIPTION'],
        validationStatus: 'PENDING',
      }),
    );
    expect(JSON.stringify(created.body)).not.toContain(respondentId);

    // Feedback never touches rewards.
    await expect(walletSnapshot()).resolves.toEqual(before);

    // The Survey Quality consumer gets exactly one event (AD-10).
    expect(feedbackRepo.outboxEvents).toHaveLength(1);
    expect(
      surveyFeedbackSubmittedEventPayloadSchema.parse(
        feedbackRepo.outboxEvents[0].payload,
      ),
    ).toEqual(
      expect.objectContaining({
        attemptId,
        respondentId,
        formType: 'EXTERNAL',
        responseId: null,
        hasComment: true,
      }),
    );

    const submitted = await get(attemptId);
    expect(submitted.body.data).toEqual({
      attemptId,
      state: 'SUBMITTED',
      feedback: result.feedback,
    });

    const replay = await post(attemptId, body);
    expect(replay.status).toBe(200);
    expect(replay.body.data).toEqual({
      feedback: result.feedback,
      replayed: true,
    });

    const conflict = await post(attemptId, { rating: 5 });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('FEEDBACK_ALREADY_SUBMITTED');
    expect(feedbackRepo.all()).toHaveLength(1);
    expect(feedbackRepo.outboxEvents).toHaveLength(1);
  });

  it('Internal: accepts feedback for a VALIDATED response through the api/ route', async () => {
    const attemptId = '72727272-7272-4272-8272-727272727272';
    const responseId = '73737373-7373-4373-8373-737373737373';
    seedAttempt(attemptId, internalFormId, internalVersionId, 'COMPLETED');
    partRepo.responses.set(
      responseId,
      new ResponseEntity(
        responseId,
        internalFormId,
        internalVersionId,
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

    const res = await post(
      attemptId,
      { rating: 5, comment: '<script>alert(1)</script>' },
      authCookie,
      csrfToken,
      '/api',
    );

    expect(res.status).toBe(200);
    expect(res.body.data.feedback).toEqual(
      expect.objectContaining({
        formType: 'INTERNAL',
        formId: internalFormId,
        rating: 5,
        // Plain text: stored verbatim, never interpreted.
        comment: '<script>alert(1)</script>',
      }),
    );
    expect(feedbackRepo.feedback.get(attemptId)?.responseId).toBe(responseId);
  });

  it('refuses a publisher rating their own survey (Epic 9 review P2)', async () => {
    const attemptId = '79797979-7979-4979-8979-797979797979';
    seedAttempt(
      attemptId,
      externalFormId,
      externalVersionId,
      'COMPLETED',
      publisherId,
    );

    const status = await get(attemptId, publisherAuthCookie);
    expect(status.status).toBe(200);
    expect(status.body.data).toEqual({
      attemptId,
      state: 'NOT_ELIGIBLE',
      feedback: null,
    });

    const res = await post(
      attemptId,
      { rating: 5 },
      publisherAuthCookie,
      publisherCsrfToken,
    );
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('FEEDBACK_NOT_ALLOWED');
    expect(feedbackRepo.feedback.has(attemptId)).toBe(false);
  });

  it('refuses feedback once an admin reversed the completion credit (Epic 9 review P3)', async () => {
    const attemptId = '7a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a';
    // The other respondent: one completion per account and survey.
    seedAttempt(
      attemptId,
      externalFormId,
      externalVersionId,
      'IN_PROGRESS',
      otherRespondentId,
    );
    const verify = await request(app.getHttpServer())
      .post(`/attempts/${attemptId}/verify-code`)
      .set('Cookie', otherAuthCookie)
      .set('x-csrf-token', otherCsrfToken)
      .set('Origin', ALLOWED_ORIGIN)
      .set('Content-Type', 'application/json')
      .send({ completionCode: validPlaintextCode });
    expect(verify.status).toBe(200);
    const creditJournalId = verify.body.data.reward.journalId as string;
    expect(creditJournalId).toEqual(expect.any(String));
    expect((await get(attemptId, otherAuthCookie)).body.data.state).toBe(
      'ELIGIBLE',
    );

    const reversal = await request(app.getHttpServer())
      .post(`/economy/journals/${creditJournalId}/reverse`)
      .set('Cookie', adminAuthCookie)
      .set('x-csrf-token', adminCsrfToken)
      .set('Origin', ALLOWED_ORIGIN)
      .set('Content-Type', 'application/json')
      .send({ reason: 'Upheld dispute (e2e)' });
    expect(reversal.status).toBe(201);

    expect((await get(attemptId, otherAuthCookie)).body.data).toEqual({
      attemptId,
      state: 'NOT_ELIGIBLE',
      feedback: null,
    });
    const res = await post(
      attemptId,
      { rating: 1 },
      otherAuthCookie,
      otherCsrfToken,
    );
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('FEEDBACK_NOT_ALLOWED');
  });

  it('stores a lone-surrogate comment as null instead of failing with 500 (Epic 9 review P8)', async () => {
    const attemptId = '7b7b7b7b-7b7b-4b7b-8b7b-7b7b7b7b7b7b';
    seedAttempt(attemptId, externalFormId, externalVersionId, 'COMPLETED');

    const res = await post(attemptId, { rating: 3, comment: '\ud83d' });

    expect(res.status).toBe(200);
    expect(res.body.data.feedback.comment).toBeNull();
    expect(feedbackRepo.feedback.get(attemptId)?.comment).toBeNull();
  });

  it('refuses attempts that are not completed (409) and keeps the prompt hidden', async () => {
    const attemptId = '74747474-7474-4474-8474-747474747474';
    seedAttempt(attemptId, externalFormId, externalVersionId, 'IN_PROGRESS');

    const res = await post(attemptId, { rating: 4 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('FEEDBACK_NOT_ALLOWED');

    const status = await get(attemptId);
    expect(status.body.data.state).toBe('NOT_ELIGIBLE');
  });

  it("answers 404 for another user's or an unknown attempt", async () => {
    const attemptId = '75757575-7575-4575-8575-757575757575';
    seedAttempt(attemptId, externalFormId, externalVersionId, 'COMPLETED');

    const foreign = await post(
      attemptId,
      { rating: 4 },
      otherAuthCookie,
      otherCsrfToken,
    );
    expect(foreign.status).toBe(404);
    expect(foreign.body.error.code).toBe('FEEDBACK_ATTEMPT_NOT_FOUND');

    const foreignStatus = await get(attemptId, otherAuthCookie);
    expect(foreignStatus.status).toBe(404);

    const unknown = await post('76767676-7676-4676-8676-767676767676', {
      rating: 4,
    });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('FEEDBACK_ATTEMPT_NOT_FOUND');
  });

  it('validates the body and the attempt id (400)', async () => {
    const attemptId = '77717771-7771-4771-8771-777177717771';
    seedAttempt(attemptId, externalFormId, externalVersionId, 'COMPLETED');

    for (const body of [
      {},
      { rating: 6 },
      { rating: 3.5 },
      { rating: '4' },
      { rating: 4, comment: 'x'.repeat(501) },
      { rating: 4, issueTags: ['SPAM'] },
      { rating: 4, respondentId },
    ]) {
      const res = await post(attemptId, body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect(feedbackRepo.feedback.has(attemptId)).toBe(false);

    const badId = await post('not-a-uuid', { rating: 4 });
    expect(badId.status).toBe(400);
  });

  it('requires CSRF (403), JSON (415) and authentication (401)', async () => {
    const attemptId = '78787878-7878-4878-8878-787878787878';
    seedAttempt(attemptId, externalFormId, externalVersionId, 'COMPLETED');

    const noCsrf = await request(app.getHttpServer())
      .post(`/attempts/${attemptId}/feedback`)
      .set('Cookie', authCookie)
      .set('Origin', ALLOWED_ORIGIN)
      .set('Content-Type', 'application/json')
      .send({ rating: 4 });
    expect(noCsrf.status).toBe(403);

    const form = await request(app.getHttpServer())
      .post(`/attempts/${attemptId}/feedback`)
      .set('Cookie', authCookie)
      .set('x-csrf-token', csrfToken)
      .set('Origin', ALLOWED_ORIGIN)
      .type('form')
      .send('rating=4');
    expect(form.status).toBe(415);

    const anonymousPost = await request(app.getHttpServer())
      .post(`/attempts/${attemptId}/feedback`)
      .set('Origin', ALLOWED_ORIGIN)
      .set('Content-Type', 'application/json')
      .send({ rating: 4 });
    expect(anonymousPost.status).toBe(401);

    const anonymousGet = await request(app.getHttpServer()).get(
      `/attempts/${attemptId}/feedback`,
    );
    expect(anonymousGet.status).toBe(401);
    expect(feedbackRepo.feedback.has(attemptId)).toBe(false);
  });
});
