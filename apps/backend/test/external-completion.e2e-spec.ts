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
import { CompletionCodeService } from '../src/modules/forms/infrastructure/completion-code.service';
import { SurveyAttemptEntity } from '../src/modules/participation/domain/survey-attempt.entity';
import { seedCompleteDemographicProfile } from './fixtures/demographic-profile.fixture';
import { backdateAttempt } from './fixtures/participation.fixture';

describe('Story 5.5: External Form Completion Code Verification E2E Tests', () => {
  let app: INestApplication;
  let userRepo: InMemoryUserRepository;
  let sessionRepo: InMemorySessionRepository;
  let auditRepo: InMemoryIdentityAuditRepository;
  let formRepo: InMemoryFormRepository;
  let demoRepo: InMemoryDemographicProfileRepository;
  let partRepo: InMemoryParticipationRepository;
  let ledgerRepo: InMemoryLedgerRepository;
  let notificationRepo: InMemoryNotificationRepository;
  let sessionService: SessionService;
  let envService: EnvService;
  let completionCodeService: CompletionCodeService;

  const TEST_JWT_SECRET = 'at_least_32_characters_super_secure_jwt_secret_key!';
  const ALLOWED_ORIGIN = 'http://localhost:3000';

  const publisherId = '22222222-2222-4222-8222-222222222222';
  const externalFormId = '44444444-4444-4444-8444-444444444444';
  const formVersionId = '55555555-5555-4555-8555-555555555555';
  const validPlaintextCode = '888999';

  let authCookie: string;
  let csrfToken: string;
  let respondentUserId: string;

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
    notificationRepo = new InMemoryNotificationRepository();

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
      .useValue(notificationRepo)
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
    const ledgerService = moduleFixture.get(LedgerService);

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    // Setup publisher and fund escrow account
    await userRepo.create({
      id: publisherId,
      email: 'publisher@rescom.test',
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
      idempotencyKey: 'seed-escrow-balance-ext-e2e',
      description: 'Seed escrow balance',
      entries: [
        { accountId: systemIssuance.id, amount: -1000 },
        { accountId: publisherEscrow.id, amount: 1000 },
      ],
    });

    // Setup respondent
    const respondent = await userRepo.create({
      id: '66666666-6666-4666-8666-666666666666',
      email: 'respondent@rescom.test',
      passwordHash: 'hash',
      role: 'RESPONDENT',
      status: 'ACTIVE',
    });
    respondentUserId = respondent.id;

    // Issue auth session
    const sessionRes = await sessionService.createSession(respondent.id);
    authCookie = `${AUTH_COOKIE_NAME}=${sessionRes.accessToken}`;
    csrfToken = sessionRes.csrfToken;

    // Compute verifier
    const storedVerifier = completionCodeService.computeVerifier(
      formVersionId,
      validPlaintextCode,
    );

    // Create external form and published version
    const externalForm = new FormEntity(
      externalFormId,
      publisherId,
      'EXTERNAL',
      'PUBLISHED',
      'Google Forms Feedback Survey',
      'Please complete the external Google form',
      50,
      100,
      new Date(),
      new Date(),
    );

    const version = new FormVersionEntity(
      formVersionId,
      externalFormId,
      1,
      {
        title: 'Google Forms Feedback Survey',
        blocks: [],
        metadata: {
          expectedEffortSeconds: 60,
          minTimeBarrierSeconds: 2, // 2s barrier for fast tests
        },
      } as any,
      null,
      true,
      'https://docs.google.com/forms/d/e/1FAIpQLSc/viewform',
      storedVerifier,
      new Date(),
      new Date(),
    );

    await formRepo.create(externalForm, version);
  });

  afterAll(async () => {
    await app.close();
  });

  it('1. Rejects code submission if submitted faster than Time Barrier (FR-13, FR-22)', async () => {
    const attemptId = '77777777-7777-4777-8777-777777777771';
    const attempt = new SurveyAttemptEntity(
      attemptId,
      externalFormId,
      formVersionId,
      respondentUserId,
      'IN_PROGRESS',
      false,
      new Date(), // started just now!
      null,
      null,
      new Date(),
      new Date(),
    );
    partRepo.attempts.set(attemptId, attempt);

    const res = await request(app.getHttpServer())
      .post(`/forms/${externalFormId}/attempts/${attemptId}/verify-code`)
      .set('Cookie', authCookie)
      .set('x-csrf-token', csrfToken)
      .set('Origin', ALLOWED_ORIGIN)
      .set('Content-Type', 'application/json')
      .send({ completionCode: validPlaintextCode });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('SUBMISSION_TOO_FAST');
  });

  it('2. Rejects invalid completion code with remaining attempts (FR-22)', async () => {
    const attemptId = '77777777-7777-4777-8777-777777777772';
    const attempt = new SurveyAttemptEntity(
      attemptId,
      externalFormId,
      formVersionId,
      respondentUserId,
      'IN_PROGRESS',
      false,
      new Date(Date.now() - 5000), // started 5s ago (> 2s barrier)
      null,
      null,
      new Date(),
      new Date(),
    );
    partRepo.attempts.set(attemptId, attempt);

    const res = await request(app.getHttpServer())
      .post(`/forms/${externalFormId}/attempts/${attemptId}/verify-code`)
      .set('Cookie', authCookie)
      .set('x-csrf-token', csrfToken)
      .set('Origin', ALLOWED_ORIGIN)
      .set('Content-Type', 'application/json')
      .send({ completionCode: '000000' }); // wrong code

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_COMPLETION_CODE');
    expect(res.body.error.details.remainingAttempts).toBe(2);
  });

  it('3. Successfully verifies valid code after time barrier, transitions to COMPLETED, and credits pending reward (FR-22, FR-24)', async () => {
    const attemptId = '77777777-7777-4777-8777-777777777773';
    const attempt = new SurveyAttemptEntity(
      attemptId,
      externalFormId,
      formVersionId,
      respondentUserId,
      'IN_PROGRESS',
      false,
      new Date(Date.now() - 5000), // started 5s ago (> 2s barrier)
      null,
      null,
      new Date(),
      new Date(),
    );
    partRepo.attempts.set(attemptId, attempt);

    const res = await request(app.getHttpServer())
      .post(`/forms/${externalFormId}/attempts/${attemptId}/verify-code`)
      .set('Cookie', authCookie)
      .set('x-csrf-token', csrfToken)
      .set('Origin', ALLOWED_ORIGIN)
      .set('Content-Type', 'application/json')
      .send({ completionCode: validPlaintextCode });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('COMPLETED');
    expect(res.body.data.attemptId).toBe(attemptId);
    expect(res.body.data.reward.status).toBe('PENDING');
    expect(res.body.data.reward.amount).toBe(50);

    const savedAttempt = partRepo.attempts.get(attemptId);
    expect(savedAttempt?.status).toBe('COMPLETED');

    // Story 9.6: "Points pending" notification recorded after the commit
    expect(notificationRepo.all()).toEqual([
      expect.objectContaining({
        userId: respondentUserId,
        type: 'REWARD_PENDING',
        dedupeKey: `external-completion:${attemptId}`,
      }),
    ]);
  });

  it('4. Locks attempt after 3 failed verification attempts (FR-22)', async () => {
    const attemptId = '77777777-7777-4777-8777-777777777774';
    const attempt = new SurveyAttemptEntity(
      attemptId,
      externalFormId,
      formVersionId,
      respondentUserId,
      'IN_PROGRESS',
      false,
      new Date(Date.now() - 5000),
      null,
      null,
      new Date(),
      new Date(),
    );
    partRepo.attempts.set(attemptId, attempt);

    // Attempt 1: fail
    await request(app.getHttpServer())
      .post(`/forms/${externalFormId}/attempts/${attemptId}/verify-code`)
      .set('Cookie', authCookie)
      .set('x-csrf-token', csrfToken)
      .set('Origin', ALLOWED_ORIGIN)
      .send({ completionCode: '111111' });

    // Attempt 2: fail
    await request(app.getHttpServer())
      .post(`/forms/${externalFormId}/attempts/${attemptId}/verify-code`)
      .set('Cookie', authCookie)
      .set('x-csrf-token', csrfToken)
      .set('Origin', ALLOWED_ORIGIN)
      .send({ completionCode: '222222' });

    // Attempt 3: fail -> locks attempt
    const res3 = await request(app.getHttpServer())
      .post(`/forms/${externalFormId}/attempts/${attemptId}/verify-code`)
      .set('Cookie', authCookie)
      .set('x-csrf-token', csrfToken)
      .set('Origin', ALLOWED_ORIGIN)
      .send({ completionCode: '333333' });

    expect(res3.status).toBe(409);
    expect(res3.body.error.code).toBe('ATTEMPT_LOCKED');

    const lockedAttempt = partRepo.attempts.get(attemptId);
    expect(lockedAttempt?.status).toBe('LOCKED');
  });

  it('5. Successfully reports missing completion code (FR-23)', async () => {
    const attemptId = '77777777-7777-4777-8777-777777777775';
    const attempt = new SurveyAttemptEntity(
      attemptId,
      externalFormId,
      formVersionId,
      respondentUserId,
      'IN_PROGRESS',
      false,
      new Date(Date.now() - 5000),
      null,
      null,
      new Date(),
      new Date(),
    );
    partRepo.attempts.set(attemptId, attempt);

    const res = await request(app.getHttpServer())
      .post(
        `/forms/${externalFormId}/attempts/${attemptId}/report-missing-code`,
      )
      .set('Cookie', authCookie)
      .set('x-csrf-token', csrfToken)
      .set('Origin', ALLOWED_ORIGIN)
      .set('Content-Type', 'application/json')
      .send({
        reason:
          'Publisher omitted the 6-digit confirmation code in Google Forms.',
      });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('REPORTED');
    expect(res.body.data.attemptId).toBe(attemptId);

    // Epic 5 review P2: the marker is server-owned, never in clientContext.
    const updated = partRepo.attempts.get(attemptId);
    expect(updated?.codeVerification.missingCodeReportedAt).toBeInstanceOf(
      Date,
    );
    expect(updated?.clientContext?.reportedMissingCode).toBeUndefined();

    // Queued for Admin investigation, not recorded as a fraud signal.
    const reportEvents = partRepo.outboxEvents.filter(
      (e) => e.idempotencyKey === `missing-code-report:${attemptId}`,
    );
    expect(reportEvents).toHaveLength(1);
    expect(reportEvents[0].eventType).toBe(
      'ExternalCompletionCodeMissingReported',
    );
    expect(
      partRepo.fraudLogs.some(
        (log) => (log.details as any)?.attemptId === attemptId,
      ),
    ).toBe(false);

    // Repeated reports are idempotent and keep the original timestamp.
    const retry = await request(app.getHttpServer())
      .post(
        `/forms/${externalFormId}/attempts/${attemptId}/report-missing-code`,
      )
      .set('Cookie', authCookie)
      .set('x-csrf-token', csrfToken)
      .set('Origin', ALLOWED_ORIGIN)
      .set('Content-Type', 'application/json')
      .send({ reason: 'Still no confirmation code on the thank-you page.' });
    expect(retry.status).toBe(200);
    expect(retry.body.data.reportedAt).toBe(res.body.data.reportedAt);
    expect(
      partRepo.outboxEvents.filter(
        (e) => e.idempotencyKey === `missing-code-report:${attemptId}`,
      ),
    ).toHaveLength(1);
  });

  it('6. Recovers a lost "points pending" notice on replay only while the credit is Pending (Epic 9 review P1)', async () => {
    // Reuses test 3's COMPLETED attempt (one completion per account/survey).
    const attemptId = '77777777-7777-4777-8777-777777777773';
    expect(partRepo.attempts.get(attemptId)?.status).toBe('COMPLETED');

    function replay() {
      return request(app.getHttpServer())
        .post(`/forms/${externalFormId}/attempts/${attemptId}/verify-code`)
        .set('Cookie', authCookie)
        .set('x-csrf-token', csrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'application/json')
        .send({ completionCode: validPlaintextCode });
    }
    const pendingNotices = () =>
      notificationRepo
        .all()
        .filter(
          (n) =>
            n.type === 'REWARD_PENDING' &&
            n.dedupeKey === `external-completion:${attemptId}`,
        );

    // The first notice was lost (e.g. its publish failed): a replay while the
    // credit is still Pending recovers it.
    notificationRepo.clear();
    const pendingReplay = await replay();
    expect(pendingReplay.status).toBe(200);
    expect(pendingNotices()).toHaveLength(1);
    const creditJournalId = pendingReplay.body.data.reward.journalId as string;
    expect(creditJournalId).toEqual(expect.any(String));

    // An admin reverses the credit (Phase 1 upheld dispute).
    const adminId = '99999999-9999-4999-8999-999999999991';
    await userRepo.create({
      id: adminId,
      email: 'admin.external@rescom.test',
      passwordHash: 'hash',
      role: 'ADMIN',
      status: 'ACTIVE',
    });
    const adminSession = await sessionService.createSession(adminId);
    const reversal = await request(app.getHttpServer())
      .post(`/economy/journals/${creditJournalId}/reverse`)
      .set('Cookie', `${AUTH_COOKIE_NAME}=${adminSession.accessToken}`)
      .set('x-csrf-token', adminSession.csrfToken)
      .set('Origin', ALLOWED_ORIGIN)
      .set('Content-Type', 'application/json')
      .send({ reason: 'Upheld dispute (e2e)' });
    expect(reversal.status).toBe(201);

    // No notice exists any more; the replay must not create a false one.
    notificationRepo.clear();
    const reversedReplay = await replay();
    expect(reversedReplay.status).toBe(200);
    expect(reversedReplay.body.data.status).toBe('COMPLETED');
    expect(pendingNotices()).toHaveLength(0);
  });

  describe('7. Decision E5-D1: account+FormVersion completion-code limit (completion-code-policy-v1)', () => {
    const limitedFormId = '44444444-4444-4444-8444-4444444444e5';
    const limitedVersionId = '55555555-5555-4555-8555-5555555555e5';
    const limitedCode = '424242';
    const mistyperId = '66666666-6666-4666-8666-6666666666e5';
    const limitAdminId = '99999999-9999-4999-8999-9999999999e5';
    let mistyperCookie: string;
    let mistyperCsrf: string;

    beforeAll(async () => {
      await formRepo.create(
        new FormEntity(
          limitedFormId,
          publisherId,
          'EXTERNAL',
          'PUBLISHED',
          'Second Google Forms Survey',
          null,
          10,
          100,
          new Date(),
          new Date(),
        ),
        new FormVersionEntity(
          limitedVersionId,
          limitedFormId,
          1,
          {
            title: 'Second Google Forms Survey',
            blocks: [],
            metadata: { expectedEffortSeconds: 60, minTimeBarrierSeconds: 2 },
          } as any,
          null,
          true,
          'https://docs.google.com/forms/d/e/1FAIpQLSe5/viewform',
          completionCodeService.computeVerifier(limitedVersionId, limitedCode),
          new Date(),
          new Date(),
        ),
      );
      await userRepo.create({
        id: mistyperId,
        email: 'mistyper@rescom.test',
        passwordHash: 'hash',
        role: 'RESPONDENT',
        status: 'ACTIVE',
      });
      await seedCompleteDemographicProfile(demoRepo, mistyperId);
      const session = await sessionService.createSession(mistyperId);
      mistyperCookie = `${AUTH_COOKIE_NAME}=${session.accessToken}`;
      mistyperCsrf = session.csrfToken;
      await userRepo.create({
        id: limitAdminId,
        email: 'admin.limits@rescom.test',
        passwordHash: 'hash',
        role: 'ADMIN',
        status: 'ACTIVE',
      });
    });

    function start() {
      return request(app.getHttpServer())
        .post(`/forms/${limitedFormId}/attempts`)
        .set('Cookie', mistyperCookie)
        .set('x-csrf-token', mistyperCsrf)
        .set('Origin', ALLOWED_ORIGIN)
        .send({});
    }

    function verify(attemptId: string, completionCode: string) {
      return request(app.getHttpServer())
        .post(`/forms/${limitedFormId}/attempts/${attemptId}/verify-code`)
        .set('Cookie', mistyperCookie)
        .set('x-csrf-token', mistyperCsrf)
        .set('Origin', ALLOWED_ORIGIN)
        .send({ completionCode });
    }

    async function startAndMistype(times: number) {
      const started = await start();
      expect(started.status).toBe(201);
      const attemptId = started.body.data.attemptId as string;
      backdateAttempt(partRepo, attemptId, 10);
      const replies = [];
      for (let i = 0; i < times; i++) {
        replies.push(await verify(attemptId, '000000'));
      }
      return { attemptId, replies };
    }

    it('3 wrong codes lock an attempt; 6 per account and version refuse a new attempt with 409 COMPLETION_CODE_LIMIT_REACHED; an Admin reset recovers it', async () => {
      const first = await startAndMistype(3);
      expect(first.replies[0].status).toBe(400);
      expect(first.replies[0].body.error.details.remainingAttempts).toBe(2);
      expect(first.replies[2].status).toBe(409);
      expect(first.replies[2].body.error.code).toBe('ATTEMPT_LOCKED');

      // One retry without Admin help.
      const second = await startAndMistype(3);
      expect(second.replies[2].body.error.code).toBe('ATTEMPT_LOCKED');

      const refused = await start();
      expect(refused.status).toBe(409);
      expect(refused.body.error).toMatchObject({
        code: 'COMPLETION_CODE_LIMIT_REACHED',
        details: {
          formVersionId: limitedVersionId,
          failedVerifications: 6,
          limit: 6,
          policyVersion: 'completion-code-policy-v1',
        },
      });

      // Only an Admin may reset (CSRF + JSON, reason required).
      const resetBody = {
        respondentId: mistyperId,
        formVersionId: limitedVersionId,
        reason: 'Honest mistyping confirmed by support',
      };
      const byRespondent = await request(app.getHttpServer())
        .post('/admin/completion-code-limits/reset')
        .set('Cookie', mistyperCookie)
        .set('x-csrf-token', mistyperCsrf)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'application/json')
        .send(resetBody);
      expect(byRespondent.status).toBe(403);

      const adminSession = await sessionService.createSession(limitAdminId);
      const reset = await request(app.getHttpServer())
        .post('/api/admin/completion-code-limits/reset')
        .set('Cookie', `${AUTH_COOKIE_NAME}=${adminSession.accessToken}`)
        .set('x-csrf-token', adminSession.csrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'application/json')
        .send(resetBody);
      expect(reset.status).toBe(200);
      expect(reset.body.data).toMatchObject({
        failuresForgiven: 6,
        failedVerifications: 0,
        limit: 6,
        policyVersion: 'completion-code-policy-v1',
      });
      expect(partRepo.completionCodeLimitResets).toEqual([
        expect.objectContaining({
          respondentId: mistyperId,
          resetById: limitAdminId,
          failuresForgiven: 6,
        }),
      ]);

      // The respondent can take the survey again and complete it.
      const again = await start();
      expect(again.status).toBe(201);
      backdateAttempt(partRepo, again.body.data.attemptId, 10);
      const verified = await verify(again.body.data.attemptId, limitedCode);
      expect(verified.status).toBe(200);
      expect(verified.body.data.status).toBe('COMPLETED');
    });
  });
  describe('8. Bug 3.4: a completion-code rotation during an in-progress attempt', () => {
    const rotatedFormId = '44444444-4444-4444-8444-4444444444b4';
    const rotatedV1Id = '55555555-5555-4555-8555-5555555555b4';
    const v1Code = '111111';
    const rotatingRespondentId = '66666666-6666-4666-8666-6666666666b4';
    let respondentCookie: string;
    let respondentCsrf: string;
    let publisherCookie: string;
    let publisherCsrf: string;

    beforeAll(async () => {
      await formRepo.create(
        new FormEntity(
          rotatedFormId,
          publisherId,
          'EXTERNAL',
          'PUBLISHED',
          'Rotating Google Forms Survey',
          null,
          10,
          100,
          new Date(),
          new Date(),
        ),
        new FormVersionEntity(
          rotatedV1Id,
          rotatedFormId,
          1,
          {
            title: 'Rotating Google Forms Survey',
            blocks: [],
            metadata: { expectedEffortSeconds: 60, minTimeBarrierSeconds: 2 },
          } as any,
          null,
          true,
          'https://docs.google.com/forms/d/e/1FAIpQLSb4/viewform',
          completionCodeService.computeVerifier(rotatedV1Id, v1Code),
          new Date(),
          new Date(),
        ),
      );
      await userRepo.create({
        id: rotatingRespondentId,
        email: 'rotation.respondent@rescom.test',
        passwordHash: 'hash',
        role: 'RESPONDENT',
        status: 'ACTIVE',
      });
      await seedCompleteDemographicProfile(demoRepo, rotatingRespondentId);
      const respondentSession =
        await sessionService.createSession(rotatingRespondentId);
      respondentCookie = `${AUTH_COOKIE_NAME}=${respondentSession.accessToken}`;
      respondentCsrf = respondentSession.csrfToken;
      const publisherSession = await sessionService.createSession(publisherId);
      publisherCookie = `${AUTH_COOKIE_NAME}=${publisherSession.accessToken}`;
      publisherCsrf = publisherSession.csrfToken;
    });

    function verify(attemptId: string, completionCode: string) {
      return request(app.getHttpServer())
        .post(`/forms/${rotatedFormId}/attempts/${attemptId}/verify-code`)
        .set('Cookie', respondentCookie)
        .set('x-csrf-token', respondentCsrf)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'application/json')
        .send({ completionCode });
    }

    it('rejects the superseded code and accepts the rotated one; the attempt stays pinned to v1', async () => {
      const started = await request(app.getHttpServer())
        .post(`/forms/${rotatedFormId}/attempts`)
        .set('Cookie', respondentCookie)
        .set('x-csrf-token', respondentCsrf)
        .set('Origin', ALLOWED_ORIGIN)
        .send({});
      expect(started.status).toBe(201);
      const attemptId = started.body.data.attemptId as string;
      backdateAttempt(partRepo, attemptId, 10);

      const rotated = await request(app.getHttpServer())
        .post(`/forms/${rotatedFormId}/rotate-code`)
        .set('Cookie', publisherCookie)
        .set('x-csrf-token', publisherCsrf)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'application/json')
        .send({ reason: 'Code leaked' });
      expect(rotated.status).toBe(200);
      expect(rotated.body.data.currentVersionNumber).toBe(2);
      const newCode = rotated.body.data.plaintextCompletionCode as string;
      const rotatedVersionId = rotated.body.data.currentVersion.id as string;
      expect(newCode).toMatch(/^\d{6}$/);
      expect(newCode).not.toBe(v1Code);

      const stale = await verify(attemptId, v1Code);
      expect(stale.status).toBe(400);
      expect(stale.body.error.code).toBe('INVALID_COMPLETION_CODE');
      expect(stale.body.error.details.remainingAttempts).toBe(2);
      // The strike is recorded against the version whose code was checked.
      expect(
        partRepo.fraudLogs
          .filter((entry) => entry.userId === rotatingRespondentId)
          .map((entry) => entry.details?.formVersionId),
      ).toEqual([rotatedVersionId]);

      const fresh = await verify(attemptId, newCode);
      expect(fresh.status).toBe(200);
      expect(fresh.body.data.status).toBe('COMPLETED');
      expect(fresh.body.data.formVersionId).toBe(rotatedV1Id);
      expect(partRepo.attempts.get(attemptId)?.formVersionId).toBe(rotatedV1Id);
    });
  });
});
