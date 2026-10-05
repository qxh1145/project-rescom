import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'crypto';
import {
  attemptOutcomeSchema,
  surveyAttemptResponseSchema,
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
import { SURVEY_RESPONSE_REPOSITORY_PORT } from '../src/modules/marketplace/application/ports/survey-response.repository.port';
import { InMemorySurveyResponseRepository } from '../src/modules/marketplace/infrastructure/in-memory-survey-response.repository';
import { LEDGER_REPOSITORY_PORT } from '../src/modules/economy/application/ports/ledger-repository.port';
import { InMemoryLedgerRepository } from '../src/modules/economy/infrastructure/in-memory-ledger.repository';
import { LedgerService } from '../src/modules/economy/application/ledger.service';
import { STARTER_POINTS_DATA_PROVIDER } from '../src/modules/economy/economy.module';
import { InMemoryStarterPointsDataProvider } from '../src/modules/economy/infrastructure/in-memory-starter-points-data-provider';
import { NOTIFICATION_REPOSITORY_PORT } from '../src/modules/notifications/application/ports/notification-repository.port';
import { InMemoryNotificationRepository } from '../src/modules/notifications/infrastructure/in-memory-notification.repository';
import { SessionService } from '../src/modules/auth/application/session.service';
import { EnvService } from '../src/common/config/env.service';
import { PrismaService } from '../src/common/database/prisma.service';
import { HttpExceptionFilter } from '../src/common/http/http-exception.filter';
import {
  AUTH_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
} from '../src/modules/auth/presentation/cookie-options.helper';
import { FormEntity } from '../src/modules/forms/domain/form.entity';
import { FormVersionEntity } from '../src/modules/forms/domain/form-version.entity';
import { seedCompleteDemographicProfile } from './fixtures/demographic-profile.fixture';
import { backdateAttempt } from './fixtures/participation.fixture';

/**
 * Story IR.3 (in-memory): the respondent-facing error and empty-state cases
 * that need no PostgreSQL: the real participation rate limiter (429 with
 * retry info), a mid-attempt session revoke followed by re-login and resume,
 * and the empty feed / wallet history / notification list.
 */
describe('Story IR.3: respondent journey edge cases (e2e)', () => {
  const JWT_SECRET = 'at_least_32_characters_super_secure_jwt_secret_key!';
  const ORIGIN = 'http://localhost:3000';
  const PASSWORD = 'Password12345!';
  const BURST_LIMIT = 3;
  const BURST_WINDOW_SECONDS = 60;

  let app: INestApplication;
  let userRepo: InMemoryUserRepository;
  let formRepo: InMemoryFormRepository;
  let demoRepo: InMemoryDemographicProfileRepository;
  let partRepo: InMemoryParticipationRepository;
  let sessionService: SessionService;

  const publisherId = randomUUID();

  interface Actor {
    id: string;
    cookie: string;
    csrf: string;
  }

  async function actor(): Promise<Actor> {
    const user = await userRepo.create({
      email: `ir3-${randomUUID()}@example.com`,
      passwordHash: '$2a$12$someHashedPassword',
      role: 'RESPONDENT',
      status: 'ACTIVE',
    });
    await seedCompleteDemographicProfile(demoRepo, user.id);
    const tokens = await sessionService.createSession(user.id);
    return {
      id: user.id,
      cookie: `${AUTH_COOKIE_NAME}=${tokens.accessToken}`,
      csrf: tokens.csrfToken,
    };
  }

  function post(urlPath: string, who: Actor, body: object = {}) {
    return request(app.getHttpServer())
      .post(urlPath)
      .set('Cookie', who.cookie)
      .set('x-csrf-token', who.csrf)
      .set('Origin', ORIGIN)
      .set('Content-Type', 'application/json')
      .send(body);
  }

  function get(urlPath: string, who: Actor) {
    return request(app.getHttpServer())
      .get(urlPath)
      .set('Cookie', who.cookie)
      .set('Origin', ORIGIN);
  }

  async function publishedSurvey() {
    const formId = randomUUID();
    const now = new Date();
    await formRepo.create(
      new FormEntity(
        formId,
        publisherId,
        'INTERNAL',
        'PUBLISHED',
        'IR.3 edge survey',
        null,
        10,
        50,
        now,
        now,
        undefined,
        0,
        5,
      ),
      new FormVersionEntity(
        randomUUID(),
        formId,
        1,
        {
          schemaVersion: 1,
          title: 'IR.3 edge survey',
          blocks: [
            { id: 'q1', order: 0, type: 'text', title: 'Q1', required: true },
          ],
          settings: {
            shuffleBlocks: false,
            progressBar: true,
            requireAuth: false,
            allowPublicAccess: true,
            submitButtonText: 'Submit',
          },
          metadata: { expectedEffortSeconds: 60, minTimeBarrierSeconds: 2 },
        } as never,
        null,
        true,
        null,
        null,
        now,
        now,
      ),
    );
    return formId;
  }

  function cookieOf(res: request.Response, name: string): string {
    const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    const found = cookies.find(
      (c) => c.startsWith(`${name}=`) && !c.startsWith(`${name}=;`),
    );
    if (!found) throw new Error(`no ${name} cookie`);
    return found.split(';')[0];
  }

  beforeAll(async () => {
    userRepo = new InMemoryUserRepository();
    const auditRepo = new InMemoryIdentityAuditRepository();
    formRepo = new InMemoryFormRepository();
    demoRepo = new InMemoryDemographicProfileRepository();
    partRepo = new InMemoryParticipationRepository();
    partRepo.formStatusLookup = (formId) => formRepo.peekForm(formId)?.status;
    formRepo.useCompletionSource((formId) =>
      partRepo.completionRefsFor(formId),
    );
    const ledgerRepo = new InMemoryLedgerRepository();
    const ledgerService = new LedgerService(ledgerRepo);

    const envService = new EnvService({
      NODE_ENV: 'test',
      PORT: 4000,
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5433/rescom_test',
      JWT_SECRET,
      JWT_ACCESS_TTL_SECONDS: 900,
      BCRYPT_ROUNDS: 12,
      FRONTEND_ORIGINS: ORIGIN,
      PARTICIPATION_BURST_LIMIT: BURST_LIMIT,
      PARTICIPATION_BURST_WINDOW_SECONDS: BURST_WINDOW_SECONDS,
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
      .useValue(new InMemorySessionRepository(auditRepo))
      .overrideProvider(IDENTITY_AUDIT_PORT)
      .useValue(auditRepo)
      .overrideProvider(FORM_REPOSITORY_PORT)
      .useValue(formRepo)
      .overrideProvider(DEMOGRAPHIC_PROFILE_REPOSITORY_PORT)
      .useValue(demoRepo)
      .overrideProvider(PARTICIPATION_REPOSITORY_PORT)
      .useValue(partRepo)
      .overrideProvider(SURVEY_RESPONSE_REPOSITORY_PORT)
      .useValue(new InMemorySurveyResponseRepository())
      .overrideProvider(LEDGER_REPOSITORY_PORT)
      .useValue(ledgerRepo)
      .overrideProvider(LedgerService)
      .useValue(ledgerService)
      .overrideProvider(NOTIFICATION_REPOSITORY_PORT)
      .useValue(new InMemoryNotificationRepository())
      .overrideProvider(STARTER_POINTS_DATA_PROVIDER)
      .useValue(new InMemoryStarterPointsDataProvider())
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
      email: 'ir3-publisher@rescom.test',
      passwordHash: 'hash',
      role: 'PUBLISHER',
      status: 'ACTIVE',
    });
    const issuance = await ledgerService.getOrCreateAccount(
      null,
      'SYSTEM_ISSUANCE',
    );
    const escrow = await ledgerService.getOrCreateAccount(
      publisherId,
      'ESCROW',
    );
    await ledgerService.postJournal({
      idempotencyKey: 'ir3-edge-escrow',
      entries: [
        { accountId: issuance.id, amount: -10_000 },
        { accountId: escrow.id, amount: 10_000 },
      ],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('rate limit (real limiter path)', () => {
    it('429s the attempt start past the burst limit with Retry-After and retry details, per user', async () => {
      const formId = await publishedSurvey();
      const limited = await actor();
      const bystander = await actor();

      // The first start creates the attempt; the repeats are 409 resumes, but
      // every request spends the burst budget.
      const first = await post(`/surveys/${formId}/attempts`, limited);
      expect(first.status).toBe(201);
      for (let i = 1; i < BURST_LIMIT; i++) {
        expect(
          (await post(`/surveys/${formId}/attempts`, limited)).status,
        ).toBe(409);
      }

      const blocked = await post(`/surveys/${formId}/attempts`, limited);
      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe('PARTICIPATION_RATE_LIMITED');
      expect(blocked.body.error.details).toMatchObject({
        scope: 'ATTEMPT_START',
        limit: BURST_LIMIT,
        windowSeconds: BURST_WINDOW_SECONDS,
      });
      const retryAfter = blocked.body.error.details.retryAfterSeconds;
      expect(retryAfter).toBeGreaterThanOrEqual(1);
      expect(retryAfter).toBeLessThanOrEqual(BURST_WINDOW_SECONDS);
      expect(blocked.headers['retry-after']).toBe(String(retryAfter));
      expect(
        new Date(blocked.body.error.details.retryAt).getTime(),
      ).toBeGreaterThan(Date.now() - 1000);

      // Nothing was consumed by the rejection, and other users are unaffected.
      expect(
        [...partRepo.attempts.values()].filter(
          (a) => a.respondentId === limited.id,
        ),
      ).toHaveLength(1);
      expect(
        (await post(`/surveys/${formId}/attempts`, bystander)).status,
      ).toBe(201);
    });

    it('429s submissions past the burst limit with Retry-After', async () => {
      const who = await actor();
      const unknownResponse = randomUUID();

      for (let i = 0; i < BURST_LIMIT; i++) {
        const res = await post(`/responses/${unknownResponse}/submit`, who, {
          answers: { q1: 'x' },
        });
        expect(res.status).not.toBe(429);
      }
      const blocked = await post(`/responses/${unknownResponse}/submit`, who, {
        answers: { q1: 'x' },
      });

      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe('PARTICIPATION_RATE_LIMITED');
      expect(blocked.body.error.details).toMatchObject({
        scope: 'INTERNAL_SUBMISSION',
        limit: BURST_LIMIT,
      });
      expect(Number(blocked.headers['retry-after'])).toBe(
        blocked.body.error.details.retryAfterSeconds,
      );
    });
  });

  describe('mid-attempt session end', () => {
    it('a revoked session is refused with 401; re-login resumes the same attempt on the same pinned version', async () => {
      const formId = await publishedSurvey();
      const email = `ir3-resume-${randomUUID()}@example.com`;
      const registered = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password: PASSWORD });
      expect(registered.status).toBe(201);
      const userId = registered.body.data.user.id as string;
      await seedCompleteDemographicProfile(demoRepo, userId);

      const csrfOf = async (cookie: string) => {
        const res = await request(app.getHttpServer())
          .get('/auth/csrf')
          .set('Cookie', cookie)
          .set('Origin', ORIGIN);
        expect(res.status).toBe(200);
        return res.body.data.csrfToken as string;
      };
      const firstCookies = [
        cookieOf(registered, AUTH_COOKIE_NAME),
        cookieOf(registered, REFRESH_COOKIE_NAME),
      ];
      const first: Actor = {
        id: userId,
        cookie: firstCookies.join('; '),
        csrf: await csrfOf(firstCookies.join('; ')),
      };

      const started = surveyAttemptResponseSchema.parse(
        (await post(`/surveys/${formId}/attempts`, first)).body.data,
      );
      expect((await get(`/attempts/${started.attemptId}`, first)).status).toBe(
        200,
      );

      // The session ends mid-attempt (logout revokes it server-side).
      const loggedOut = await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Cookie', first.cookie)
        .set('x-csrf-token', first.csrf)
        .set('Origin', ORIGIN);
      expect(loggedOut.status).toBe(204);
      const readRevoked = await get(`/attempts/${started.attemptId}`, first);
      expect(readRevoked.status).toBe(401);
      expect(readRevoked.body.error.code).toBe('AUTH_SESSION_REVOKED');
      // Submit is a guest-capable route: a revoked session degrades to a guest,
      // which may not submit a user-owned response (403, never a 200).
      const submitRevoked = await post(
        `/responses/${started.responseId}/submit`,
        first,
        { attemptId: started.attemptId, answers: { q1: 'late' } },
      );
      expect(submitRevoked.status).toBe(403);
      expect(submitRevoked.body.error.code).toBe('PARTICIPANT_NOT_ELIGIBLE');
      // A revoked session must not have touched the attempt.
      expect(partRepo.attempts.get(started.attemptId)?.status).toBe(
        'IN_PROGRESS',
      );

      // Re-login, then resume: the start 409 names the original attempt.
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: PASSWORD });
      expect(login.status).toBe(200);
      const secondCookie = [
        cookieOf(login, AUTH_COOKIE_NAME),
        cookieOf(login, REFRESH_COOKIE_NAME),
      ].join('; ');
      const second: Actor = {
        id: userId,
        cookie: secondCookie,
        csrf: await csrfOf(secondCookie),
      };
      const resume = await post(`/surveys/${formId}/attempts`, second);
      expect(resume.status).toBe(409);
      expect(resume.body.error.code).toBe('CONFLICTING_ACTIVE_ATTEMPT');
      expect(resume.body.error.details).toMatchObject({
        attemptId: started.attemptId,
        responseId: started.responseId,
        formVersionId: started.formVersionId,
      });
      const detail = await get(`/attempts/${started.attemptId}`, second);
      expect(detail.status).toBe(200);
      expect(detail.body.data).toMatchObject({
        attemptId: started.attemptId,
        formVersionId: started.formVersionId,
        status: 'IN_PROGRESS',
      });

      // The resumed attempt completes under the new session.
      backdateAttempt(partRepo, started.attemptId, 10);
      const submitted = await post(
        `/responses/${started.responseId}/submit`,
        second,
        { attemptId: started.attemptId, answers: { q1: 'resumed' } },
      );
      expect(submitted.status).toBe(200);
      expect(submitted.body.data.status).toBe('VALIDATED');
      const outcome = await get(
        `/attempts/${started.attemptId}/outcome`,
        second,
      );
      expect(attemptOutcomeSchema.parse(outcome.body.data).attemptStatus).toBe(
        'COMPLETED',
      );
    });
  });

  describe('empty states', () => {
    it('serves an empty feed, an empty wallet history and an empty notification list', async () => {
      const who = await actor();
      // No survey matches this respondent: hide everything via a filter that
      // nothing satisfies, so the case holds even when other tests publish.
      const feed = await get(
        '/marketplace/feed?search=no-such-survey-title-xyz',
        who,
      );
      expect(feed.status).toBe(200);
      expect(feed.body.data.surveys).toEqual([]);

      const wallet = await get('/economy/wallet', who);
      expect(wallet.status).toBe(200);
      expect(wallet.body.data.transactions).toEqual([]);
      expect(wallet.body.data.balance.total).toBe(0);

      const notices = await get('/notifications', who);
      expect(notices.status).toBe(200);
      expect(notices.body.data.items).toEqual([]);
      expect(notices.body.data.unreadCount).toBe(0);
      const unread = await get('/notifications/unread-count', who);
      expect(unread.status).toBe(200);
      expect(unread.body.data.unreadCount).toBe(0);
    });
  });
});
