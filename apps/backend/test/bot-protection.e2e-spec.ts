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
import { SurveyAttemptEntity } from '../src/modules/participation/domain/survey-attempt.entity';
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
import { seedCompleteDemographicProfile } from './fixtures/demographic-profile.fixture';
import { backdateAttempt } from './fixtures/participation.fixture';

/**
 * Story 8.2 — Automated Bot Protection (FR-28, FR-45, FR-46, NFR-4).
 * Small central limits via the EnvService override: 2 completions per rolling
 * hour, 5 requests per minute per user and action.
 */
describe('Story 8.2: Automated Bot Protection (Time Barrier & Rate Limit) E2E', () => {
  let app: INestApplication;
  let userRepo: InMemoryUserRepository;
  let formRepo: InMemoryFormRepository;
  let demoRepo: InMemoryDemographicProfileRepository;
  let partRepo: InMemoryParticipationRepository;
  let sessionService: SessionService;

  const ALLOWED_ORIGIN = 'http://localhost:3000';
  const publisherId = '22222222-2222-4222-8222-222222222222';
  const formId = '33333333-3333-4333-8333-333333333333';
  const formVersionId = '55555555-5555-4555-8555-555555555555';
  const ANSWERS = { 'q-major': 'Software Engineering' };

  interface Actor {
    id: string;
    cookie: string;
    csrfToken: string;
  }
  let userSeq = 0;

  async function createRespondent(): Promise<Actor> {
    userSeq += 1;
    const user = await userRepo.create({
      email: `bot-protection-${userSeq}@fpt.edu.vn`,
      passwordHash: 'hashed_pw',
      role: 'RESPONDENT',
      status: 'ACTIVE',
    });
    await seedCompleteDemographicProfile(demoRepo, user.id);
    const session = await sessionService.createSession(user.id);
    return {
      id: user.id,
      cookie: `${AUTH_COOKIE_NAME}=${session.accessToken}`,
      csrfToken: session.csrfToken,
    };
  }

  function startAttempt(actor: Actor) {
    return request(app.getHttpServer())
      .post(`/forms/${formId}/attempts`)
      .set('Cookie', actor.cookie)
      .set('x-csrf-token', actor.csrfToken)
      .set('Origin', ALLOWED_ORIGIN)
      .send({});
  }

  function submit(actor: Actor, responseId: string, body: object = {}) {
    return (
      request(app.getHttpServer())
        .post(`/responses/${responseId}/submit`)
        .set('Cookie', actor.cookie)
        // Epic 5 review P12: AD-20 CSRF on authenticated submissions.
        .set('x-csrf-token', actor.csrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .send({ answers: ANSWERS, ...body })
    );
  }

  function seedRecentCompletions(userId: string, count: number) {
    for (let i = 0; i < count; i++) {
      const id = `aaaaaaaa-aaaa-4aaa-8aaa-${String(userSeq * 100 + i).padStart(12, '0')}`;
      const submittedAt = new Date(Date.now() - (10 + i) * 60_000);
      partRepo.attempts.set(
        id,
        new SurveyAttemptEntity(
          id,
          'other-form',
          'other-version',
          userId,
          'COMPLETED',
          false,
          new Date(submittedAt.getTime() - 120_000),
          submittedAt,
          null,
          submittedAt,
          submittedAt,
        ),
      );
    }
  }

  const fraudLogsOf = (userId: string, type: string) =>
    partRepo.fraudLogs.filter(
      (log) => log.userId === userId && log.type === type,
    );

  beforeAll(async () => {
    userRepo = new InMemoryUserRepository();
    const auditRepo = new InMemoryIdentityAuditRepository();
    const sessionRepo = new InMemorySessionRepository(auditRepo);
    formRepo = new InMemoryFormRepository();
    demoRepo = new InMemoryDemographicProfileRepository();
    partRepo = new InMemoryParticipationRepository();
    const ledgerRepo = new InMemoryLedgerRepository();

    const envService = new EnvService({
      NODE_ENV: 'test',
      PORT: 4000,
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5433/rescom_test',
      JWT_SECRET: 'at_least_32_characters_super_secure_jwt_secret_key!',
      JWT_ACCESS_TTL_SECONDS: 900,
      BCRYPT_ROUNDS: 12,
      FRONTEND_ORIGINS: ALLOWED_ORIGIN,
      PARTICIPATION_COMPLETION_LIMIT: 2,
      PARTICIPATION_COMPLETION_WINDOW_SECONDS: 3600,
      PARTICIPATION_BURST_LIMIT: 5,
      PARTICIPATION_BURST_WINDOW_SECONDS: 60,
      // Decision E8-D4: custom values run under their own policy version.
      PARTICIPATION_RATE_LIMIT_POLICY_VERSION: 'participation-rate-limit-e2e',
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

    await userRepo.create({
      id: publisherId,
      email: 'publisher@rescom.test',
      passwordHash: 'hashed_pw',
      role: 'PUBLISHER',
      status: 'ACTIVE',
    });
    const ledgerService = moduleFixture.get(LedgerService);
    const escrow = await ledgerService.getOrCreateAccount(
      publisherId,
      'ESCROW',
    );
    const issuance = await ledgerService.getOrCreateAccount(
      null,
      'SYSTEM_ISSUANCE',
    );
    await ledgerService.postJournal({
      idempotencyKey: 'seed-escrow-bot-protection-e2e',
      description: 'Seed escrow balance',
      entries: [
        { accountId: issuance.id, amount: -1000 },
        { accountId: escrow.id, amount: 1000 },
      ],
    });

    // 5 answerable questions -> Time Barrier = 5 x 2 s = 10 s (publisher minimum 4 s).
    await formRepo.create(
      new FormEntity(
        formId,
        publisherId,
        'INTERNAL',
        'PUBLISHED',
        'Bot protection survey',
        null,
        10,
        50,
        new Date(),
        new Date(),
      ),
      new FormVersionEntity(
        formVersionId,
        formId,
        1,
        {
          title: 'Bot protection survey',
          metadata: { expectedEffortSeconds: 60, minTimeBarrierSeconds: 4 },
          blocks: [
            {
              id: 'q-major',
              order: 0,
              title: 'Major',
              type: 'text',
              required: true,
            },
            {
              id: 'q-year',
              order: 1,
              title: 'Year',
              type: 'number',
              required: false,
            },
            {
              id: 'q-rate',
              order: 2,
              title: 'Rate',
              type: 'rating',
              required: false,
              maxRating: 5,
            },
            {
              id: 'q-date',
              order: 3,
              title: 'Date',
              type: 'date',
              required: false,
            },
            {
              id: 'q-note',
              order: 4,
              title: 'Note',
              type: 'textarea',
              required: false,
            },
          ],
        } as any,
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

  describe('Time Barrier (FR-45, FR-28)', () => {
    it('announces the barrier, rejects a too-fast submission with 422 + details + Retry-After, keeps the attempt and logs once; the same attempt succeeds after waiting', async () => {
      const actor = await createRespondent();
      const start = await startAttempt(actor).expect(201);
      const { attemptId, responseId, timeBarrier } = start.body.data;
      expect(timeBarrier).toMatchObject({
        requiredSeconds: 10,
        questionCount: 5,
        secondsPerQuestion: 2,
        policyVersion: 'time-barrier-v1',
      });

      const tooFast = await submit(actor, responseId, {
        // Client-supplied timing is ignored (server-authoritative startedAt).
        clientContext: { startedAt: '2020-01-01T00:00:00.000Z' },
      });
      expect(tooFast.status).toBe(422);
      expect(tooFast.body.error.code).toBe('SUBMISSION_TOO_FAST');
      const details = tooFast.body.error.details;
      expect(details).toMatchObject({
        requiredSeconds: 10,
        questionCount: 5,
        secondsPerQuestion: 2,
        publisherMinimumSeconds: 4,
        policyVersion: 'time-barrier-v1',
      });
      expect(details.elapsedSeconds).toBeLessThan(10);
      expect(details.remainingSeconds).toBeGreaterThan(0);
      expect(details.remainingSeconds).toBeLessThanOrEqual(10);
      expect(tooFast.headers['retry-after']).toBe(
        String(details.remainingSeconds),
      );

      await submit(actor, responseId).expect(422);
      expect(partRepo.attempts.get(attemptId)?.status).toBe('IN_PROGRESS');
      expect(fraudLogsOf(actor.id, 'TIME_BARRIER')).toEqual([
        expect.objectContaining({
          dedupeKey: `time-barrier:${attemptId}`,
          details: expect.objectContaining({
            source: 'INTERNAL_SUBMISSION',
            attemptId,
            formId,
            requiredSeconds: 10,
          }),
        }),
      ]);

      backdateAttempt(partRepo, attemptId, 11);
      const accepted = await submit(actor, responseId).expect(200);
      expect(accepted.body.data.status).toBe('VALIDATED');
      const assessment = partRepo.outboxEvents.find(
        (event) =>
          event.eventType === 'IntegrityAssessmentRequested' &&
          event.payload.responseId === responseId,
      );
      expect(assessment?.payload.securityEvidence).toMatchObject({
        timeBarrier: { requiredSeconds: 10, questionCount: 5 },
      });
    });
  });

  describe('Rate limit (FR-46)', () => {
    it('blocks starting attempts at the completion limit with 429 + Retry-After and one RATE_LIMIT entry per window', async () => {
      const limited = await createRespondent();
      seedRecentCompletions(limited.id, 2);

      const first = await startAttempt(limited);
      expect(first.status).toBe(429);
      expect(first.body.error.code).toBe('PARTICIPATION_RATE_LIMITED');
      expect(first.body.error.details).toMatchObject({
        scope: 'COMPLETIONS',
        limit: 2,
        windowSeconds: 3600,
        policyVersion: 'participation-rate-limit-e2e',
      });
      // The oldest blocking completion (11 min ago) frees a slot in ~49 min.
      const retryAfter = Number(first.headers['retry-after']);
      expect(retryAfter).toBe(first.body.error.details.retryAfterSeconds);
      expect(retryAfter).toBeGreaterThan(48 * 60);
      expect(retryAfter).toBeLessThanOrEqual(49 * 60);

      await startAttempt(limited).expect(429);
      expect(fraudLogsOf(limited.id, 'RATE_LIMIT')).toHaveLength(1);
      expect(fraudLogsOf(limited.id, 'RATE_LIMIT')[0].details).toMatchObject({
        policyVersion: 'participation-rate-limit-e2e',
      });

      // Per user, not global: another respondent can still start.
      const other = await createRespondent();
      await startAttempt(other).expect(201);
    });

    it('decision E8-D6: reserves capacity at start — an open attempt counts, so the next start is refused up front and the open attempt still completes', async () => {
      const secondFormId = '33333333-3333-4333-8333-3333333333d6';
      const existing = await formRepo.findById(formId);
      await formRepo.create(
        new FormEntity(
          secondFormId,
          publisherId,
          'INTERNAL',
          'PUBLISHED',
          'Second bot protection survey',
          null,
          10,
          50,
          new Date(),
          new Date(),
        ),
        new FormVersionEntity(
          '55555555-5555-4555-8555-5555555555d6',
          secondFormId,
          1,
          existing!.currentVersion.schemaJson,
          null,
          true,
          null,
          null,
          new Date(),
          new Date(),
        ),
      );
      const actor = await createRespondent();
      seedRecentCompletions(actor.id, 1);

      // 1 completion + 0 open < 2: allowed, and it now holds a reservation.
      const open = await startAttempt(actor).expect(201);

      const refused = await request(app.getHttpServer())
        .post(`/forms/${secondFormId}/attempts`)
        .set('Cookie', actor.cookie)
        .set('x-csrf-token', actor.csrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .send({});
      expect(refused.status).toBe(429);
      expect(refused.body.error.details).toMatchObject({
        scope: 'COMPLETIONS',
        limit: 2,
        completionsInWindow: 1,
        inProgressAttempts: 1,
      });
      expect(refused.body.error.message).toMatch(/still have in progress/);
      expect(Number(refused.headers['retry-after'])).toBe(
        refused.body.error.details.retryAfterSeconds,
      );

      // The reserved attempt can always be completed (no 429 at submit).
      backdateAttempt(partRepo, open.body.data.attemptId, 11);
      const submitted = await submit(actor, open.body.data.responseId);
      expect(submitted.status).toBe(200);
      expect(submitted.body.data.status).toBe('VALIDATED');
    });

    it('keeps the in-transaction backstop: a submission over the limit (reservation bypassed) is refused without consuming the attempt', async () => {
      const actor = await createRespondent();
      const start = await startAttempt(actor).expect(201);
      const { attemptId, responseId } = start.body.data;
      backdateAttempt(partRepo, attemptId, 11);
      seedRecentCompletions(actor.id, 2);

      const res = await submit(actor, responseId);
      expect(res.status).toBe(429);
      expect(res.body.error.details.scope).toBe('COMPLETIONS');
      expect(res.headers['retry-after']).toBeDefined();
      expect(partRepo.attempts.get(attemptId)?.status).toBe('IN_PROGRESS');
      expect(partRepo.responses.get(responseId)?.status).toBe('IN_PROGRESS');
    });

    it('limits per-user request bursts on attempt start (429) and records evidence once per window', async () => {
      const actor = await createRespondent();
      await startAttempt(actor).expect(201);
      for (let i = 0; i < 4; i++) {
        // Duplicate starts are refused (active attempt) but still count.
        await startAttempt(actor).expect(409);
      }

      const burst = await startAttempt(actor);
      expect(burst.status).toBe(429);
      expect(burst.body.error.details).toMatchObject({
        scope: 'ATTEMPT_START',
        limit: 5,
        windowSeconds: 60,
      });
      expect(Number(burst.headers['retry-after'])).toBeGreaterThan(0);
      expect(Number(burst.headers['retry-after'])).toBeLessThanOrEqual(60);

      await startAttempt(actor).expect(429);
      // Epic 8 review P4 (FR-47): the entry records the requested survey.
      expect(fraudLogsOf(actor.id, 'RATE_LIMIT')).toEqual([
        expect.objectContaining({
          details: expect.objectContaining({
            scope: 'ATTEMPT_START',
            requestedFormId: formId,
          }),
        }),
      ]);
    });
  });
});
