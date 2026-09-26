import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { USER_REPOSITORY_PORT } from '../src/modules/users/application/ports/user.repository.port';
import { InMemoryUserRepository } from '../src/modules/users/infrastructure/in-memory-user.repository';
import { SESSION_REPOSITORY_PORT } from '../src/modules/auth/application/ports/session-repository.port';
import { InMemorySessionRepository } from '../src/modules/auth/infrastructure/in-memory-session.repository';
import { IDENTITY_AUDIT_PORT } from '../src/modules/auth/application/ports/identity-audit.port';
import { InMemoryIdentityAuditRepository } from '../src/modules/auth/infrastructure/in-memory-identity-audit.repository';
import { LEDGER_REPOSITORY_PORT } from '../src/modules/economy/application/ports/ledger-repository.port';
import { InMemoryLedgerRepository } from '../src/modules/economy/infrastructure/in-memory-ledger.repository';
import { NOTIFICATION_REPOSITORY_PORT } from '../src/modules/notifications/application/ports/notification-repository.port';
import { InMemoryNotificationRepository } from '../src/modules/notifications/infrastructure/in-memory-notification.repository';
import { FORM_REPOSITORY_PORT } from '../src/modules/forms/application/ports/form-repository.port';
import { InMemoryFormRepository } from '../src/modules/forms/infrastructure/in-memory-form.repository';
import { PARTICIPATION_REPOSITORY_PORT } from '../src/modules/participation/application/ports/participation-repository.port';
import { InMemoryParticipationRepository } from '../src/modules/participation/infrastructure/in-memory-participation.repository';
import { STARTER_POINTS_DATA_PROVIDER } from '../src/modules/economy/economy.module';
import { SessionService } from '../src/modules/auth/application/session.service';
import { EnvService } from '../src/common/config/env.service';
import { PrismaService } from '../src/common/database/prisma.service';
import { HttpExceptionFilter } from '../src/common/http/http-exception.filter';
import { AUTH_COOKIE_NAME } from '../src/modules/auth/presentation/cookie-options.helper';
import { LedgerService } from '../src/modules/economy/application/ledger.service';
import { FormEntity } from '../src/modules/forms/domain/form.entity';
import { FormVersionEntity } from '../src/modules/forms/domain/form-version.entity';
import { SurveyAttemptEntity } from '../src/modules/participation/domain/survey-attempt.entity';
import { ResponseEntity } from '../src/modules/participation/domain/response.entity';

const HOUR_MS = 60 * 60 * 1000;

/**
 * Story 6.4 reward settlement, secured by the Epic 6 code review:
 * - P1: the reward credit endpoints are Admin-only re-drives whose parameters
 *   all come from the committed completion (no body-supplied publisher,
 *   respondent or amount);
 * - P2: a Pending release is owned, priced and aged from its credit journal
 *   (server-enforced 48-hour window, server-side dispute check).
 */
describe('Story 6.4: Respondent Point Credit & Pending Logic E2E Tests', () => {
  let app: INestApplication;
  let userRepo: InMemoryUserRepository;
  let ledgerRepo: InMemoryLedgerRepository;
  let notificationRepo: InMemoryNotificationRepository;
  let formRepo: InMemoryFormRepository;
  let partRepo: InMemoryParticipationRepository;
  let ledgerService: LedgerService;
  let sessionService: SessionService;
  let envService: EnvService;

  /** Server clock of the ledger (FR-24 maturity). */
  const startTime = new Date('2026-09-20T08:00:00.000Z');
  let now = startTime;

  const TEST_JWT_SECRET = 'at_least_32_characters_super_secure_jwt_secret_key!';
  const ALLOWED_ORIGIN = 'http://localhost:3000';

  const internalFormId = '10000000-0000-4000-8000-000000000001';
  const internalVersionId = '10000000-0000-4000-8000-000000000002';
  const externalFormId = '20000000-0000-4000-8000-000000000001';
  const externalVersionId = '20000000-0000-4000-8000-000000000002';

  interface Actor {
    id: string;
    cookie: string;
    csrf: string;
  }
  let publisher: Actor;
  let respondent: Actor;
  let otherRespondent: Actor;
  let admin: Actor;

  async function actor(
    email: string,
    role: 'ADMIN' | 'PUBLISHER' | 'RESPONDENT',
  ): Promise<Actor> {
    const user = await userRepo.create({
      email,
      passwordHash: '$2a$12$someHashedPassword',
      role,
      status: 'ACTIVE',
    });
    const tokens = await sessionService.createSession(user.id);
    return {
      id: user.id,
      cookie: `${AUTH_COOKIE_NAME}=${tokens.accessToken}`,
      csrf: tokens.csrfToken,
    };
  }

  function post(path: string, who: Actor, body: object = {}) {
    return request(app.getHttpServer())
      .post(path)
      .set('Cookie', who.cookie)
      .set('x-csrf-token', who.csrf)
      .set('Origin', ALLOWED_ORIGIN)
      .set('Content-Type', 'application/json')
      .send(body);
  }

  async function wallet(who: Actor) {
    const res = await request(app.getHttpServer())
      .get('/economy/wallet')
      .set('Cookie', who.cookie)
      .set('Origin', ALLOWED_ORIGIN);
    expect(res.status).toBe(200);
    return res.body.data.balance;
  }

  /** A VALIDATED Internal response with its pinned reward request. */
  function seedValidatedResponse(rewardAmount: number): string {
    const responseId = randomUUID();
    const attemptId = randomUUID();
    partRepo.attempts.set(
      attemptId,
      new SurveyAttemptEntity(
        attemptId,
        internalFormId,
        internalVersionId,
        respondent.id,
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
        internalFormId,
        internalVersionId,
        attemptId,
        respondent.id,
        'VALIDATED',
        { q1: 'answer' },
        '127.0.0.1',
        false,
        new Date(),
        new Date(),
        new Date(),
      ),
    );
    partRepo.outboxEvents.push({
      id: randomUUID(),
      eventType: 'InternalRewardRequested',
      idempotencyKey: `internal-reward:${responseId}`,
      payload: {
        responseId,
        attemptId,
        formId: internalFormId,
        formVersionId: internalVersionId,
        publisherId: publisher.id,
        respondentId: respondent.id,
        rewardAmount,
        policyMode: 'SHADOW',
      },
    });
    return responseId;
  }

  /** A COMPLETED External attempt of `who`. */
  function seedCompletedExternalAttempt(who: Actor): string {
    const attemptId = randomUUID();
    partRepo.attempts.set(
      attemptId,
      new SurveyAttemptEntity(
        attemptId,
        externalFormId,
        externalVersionId,
        who.id,
        'COMPLETED',
        false,
        new Date(),
        new Date(),
        null,
        new Date(),
        new Date(),
      ),
    );
    return attemptId;
  }

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ||
      'postgresql://postgres:postgres@localhost:5433/rescom_test';

    userRepo = new InMemoryUserRepository();
    const auditRepo = new InMemoryIdentityAuditRepository();
    const sessionRepo = new InMemorySessionRepository(auditRepo);
    ledgerRepo = new InMemoryLedgerRepository();
    notificationRepo = new InMemoryNotificationRepository();
    formRepo = new InMemoryFormRepository();
    partRepo = new InMemoryParticipationRepository();
    ledgerService = new LedgerService(ledgerRepo, { clock: () => now });

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
      .overrideProvider(LEDGER_REPOSITORY_PORT)
      .useValue(ledgerRepo)
      // One ledger instance with an injectable clock for the 48 h window.
      .overrideProvider(LedgerService)
      .useValue(ledgerService)
      .overrideProvider(NOTIFICATION_REPOSITORY_PORT)
      .useValue(notificationRepo)
      .overrideProvider(FORM_REPOSITORY_PORT)
      .useValue(formRepo)
      .overrideProvider(PARTICIPATION_REPOSITORY_PORT)
      .useValue(partRepo)
      .overrideProvider(STARTER_POINTS_DATA_PROVIDER)
      .useValue({
        getUserRegistrationDate: jest.fn(async () => null),
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

    publisher = await actor('publisher-reward@rescom.test', 'PUBLISHER');
    respondent = await actor('respondent-reward@rescom.test', 'RESPONDENT');
    otherRespondent = await actor('other-reward@rescom.test', 'RESPONDENT');
    admin = await actor('admin-reward@rescom.test', 'ADMIN');

    const makeForm = (
      id: string,
      type: 'INTERNAL' | 'EXTERNAL',
      reward: number,
    ) =>
      new FormEntity(
        id,
        publisher.id,
        type,
        'PUBLISHED',
        `${type} reward survey`,
        null,
        reward,
        50,
        new Date(),
        new Date(),
      );
    const makeVersion = (id: string, formId: string) =>
      new FormVersionEntity(
        id,
        formId,
        1,
        { title: 'Survey', blocks: [] } as any,
        null,
        true,
        null,
        null,
        new Date(),
        new Date(),
      );
    await formRepo.create(
      makeForm(internalFormId, 'INTERNAL', 50),
      makeVersion(internalVersionId, internalFormId),
    );
    await formRepo.create(
      makeForm(externalFormId, 'EXTERNAL', 20),
      makeVersion(externalVersionId, externalFormId),
    );

    // Seed publisher escrow account with 300 points
    const system = await ledgerService.getOrCreateAccount(
      null,
      'SYSTEM_ISSUANCE',
    );
    const publisherEscrow = await ledgerService.getOrCreateAccount(
      publisher.id,
      'ESCROW',
    );
    await ledgerService.postJournal({
      idempotencyKey: 'seed-e2e-publisher-escrow',
      entries: [
        { accountId: system.id, amount: -300 },
        { accountId: publisherEscrow.id, amount: 300 },
      ],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Reward credit endpoints are Admin re-drives (Epic 6 review P1)', () => {
    it('refuses a Respondent crediting themselves from a random response id', async () => {
      const res = await post(
        `/economy/rewards/internal/${randomUUID()}`,
        respondent,
        {
          publisherId: publisher.id,
          respondentId: respondent.id,
          rewardPerResponse: 25,
        },
      );

      expect(res.status).toBe(403);
      expect((await wallet(respondent)).available).toBe(0);
      expect((await wallet(publisher)).escrow).toBe(300);
    });

    it('refuses Respondents and Publishers on the External credit route', async () => {
      const attemptId = seedCompletedExternalAttempt(respondent);

      for (const who of [respondent, publisher]) {
        const res = await post(`/economy/rewards/external/${attemptId}`, who, {
          publisherId: publisher.id,
          respondentId: who.id,
          rewardPerResponse: 20,
        });
        expect(res.status).toBe(403);
      }
      expect((await wallet(publisher)).escrow).toBe(300);
    });

    it('rejects body-supplied settlement parameters even for an Admin', async () => {
      const responseId = seedValidatedResponse(40);

      const res = await post(`/economy/rewards/internal/${responseId}`, admin, {
        rewardPerResponse: 1000,
      });

      expect(res.status).toBe(400);
      expect((await wallet(publisher)).escrow).toBe(300);
    });

    it('returns 404 for an unknown response', async () => {
      const res = await post(
        `/economy/rewards/internal/${randomUUID()}`,
        admin,
      );

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('RESPONSE_NOT_FOUND');
    });

    it('re-drives a VALIDATED Internal response with exactly its pinned amount, once', async () => {
      const responseId = seedValidatedResponse(40);

      const res = await post(`/economy/rewards/internal/${responseId}`, admin);

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        status: 'SETTLED',
        amount: 40,
        targetAccountClass: 'USER_AVAILABLE',
      });
      expect(res.body.data.journalId).toEqual(expect.any(String));

      const replay = await post(
        `/economy/rewards/internal/${responseId}`,
        admin,
      );
      expect(replay.status).toBe(200);
      expect(replay.body.data.journalId).toBe(res.body.data.journalId);

      // Decision E6-D1: the full 40 is credited; Escrow pays the reserved
      // round(0.8 x 40) = 32 and SYSTEM_ISSUANCE the other 8, once.
      expect((await wallet(respondent)).available).toBe(40);
      expect((await wallet(publisher)).escrow).toBe(268);

      // Decision E9-D2: the re-driven instant credit is announced to the
      // respondent once (the replayed re-drive posts nothing new).
      expect(
        notificationRepo
          .all()
          .filter((n) => n.dedupeKey === `internal-reward:${responseId}`),
      ).toEqual([
        expect.objectContaining({
          userId: respondent.id,
          type: 'REWARD_EARNED',
          message: expect.stringMatching(/^40 points/),
        }),
      ]);
    });
  });

  describe('External Pending credit and 48-hour release (FR-24, Epic 6 review P2)', () => {
    let attemptId: string;

    beforeAll(async () => {
      now = startTime;
      attemptId = seedCompletedExternalAttempt(respondent);
    });

    it('credits a completed External attempt from the form reward (Admin re-drive)', async () => {
      const res = await post(`/economy/rewards/external/${attemptId}`, admin);

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        status: 'PENDING',
        amount: 20,
        targetAccountClass: 'PENDING',
      });

      const replay = await post(
        `/economy/rewards/external/${attemptId}`,
        admin,
      );
      expect(replay.body.data.journalId).toBe(res.body.data.journalId);

      const balance = await wallet(respondent);
      expect(balance.pending).toBe(20);
      // External surveys have no discount: Escrow pays the full 20.
      expect((await wallet(publisher)).escrow).toBe(248);
    });

    it('refuses an immediate release by the Respondent (server-enforced maturity)', async () => {
      const res = await post(
        `/economy/rewards/release-pending/${attemptId}`,
        respondent,
      );

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('PENDING_REWARD_NOT_MATURED');
      expect(res.body.error.details.maturesAt).toBe(
        new Date(startTime.getTime() + 48 * HOUR_MS).toISOString(),
      );
      expect((await wallet(respondent)).pending).toBe(20);
    });

    it('no longer accepts a client-supplied amount or dispute flag', async () => {
      const res = await post(
        `/economy/rewards/release-pending/${attemptId}`,
        respondent,
        { amount: 20, isDisputeHoldLocked: false },
      );

      expect(res.status).toBe(400);
    });

    it("refuses another Respondent's release of the credit", async () => {
      now = new Date(startTime.getTime() + 48 * HOUR_MS);

      const res = await post(
        `/economy/rewards/release-pending/${attemptId}`,
        otherRespondent,
      );

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('PENDING_REWARD_FORBIDDEN');
    });

    it('releases the matured credit to USER_AVAILABLE exactly once and notifies the Respondent', async () => {
      now = new Date(startTime.getTime() + 48 * HOUR_MS);

      const res = await post(
        `/economy/rewards/release-pending/${attemptId}`,
        respondent,
      );

      expect(res.status).toBe(200);
      expect(res.body.data.idempotencyKey).toBe(`release-pending:${attemptId}`);

      const replay = await post(
        `/economy/rewards/release-pending/${attemptId}`,
        respondent,
      );
      expect(replay.body.data.id).toBe(res.body.data.id);

      const balance = await wallet(respondent);
      expect(balance.pending).toBe(0);
      expect(balance.available).toBe(60); // 40 Internal + 20 released

      // Story 9.6: the release is announced to the respondent
      expect(
        notificationRepo
          .all()
          .filter((n) => n.dedupeKey === `release-pending:${attemptId}`),
      ).toEqual([
        expect.objectContaining({
          userId: respondent.id,
          type: 'REWARD_RELEASED',
        }),
      ]);
    });

    it('releases matured credits through the Admin/worker scan only', async () => {
      now = new Date(startTime.getTime() + 50 * HOUR_MS);
      const secondAttempt = seedCompletedExternalAttempt(otherRespondent);
      await post(`/economy/rewards/external/${secondAttempt}`, admin);

      const forbidden = await post(
        '/economy/rewards/release-matured',
        respondent,
        {},
      );
      expect(forbidden.status).toBe(403);

      const early = await post('/economy/rewards/release-matured', admin, {});
      expect(early.status).toBe(200);
      expect(early.body.data).toMatchObject({ processed: 0 });

      now = new Date(startTime.getTime() + 98 * HOUR_MS);
      const res = await post('/economy/rewards/release-matured', admin, {
        limit: 10,
      });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        processed: 1,
        releasedCount: 1,
        hasMore: false,
      });
      expect((await wallet(otherRespondent)).available).toBe(20);
    });
  });
});
