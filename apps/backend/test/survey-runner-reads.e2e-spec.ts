import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'crypto';
import {
  attemptNotInProgressDetailsSchema,
  attemptOutcomeSchema,
  cancelAttemptResponseSchema,
  surveyAttemptDetailsSchema,
  surveyAttemptResponseSchema,
  surveySummarySchema,
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
import { LEDGER_REPOSITORY_PORT } from '../src/modules/economy/application/ports/ledger-repository.port';
import { InMemoryLedgerRepository } from '../src/modules/economy/infrastructure/in-memory-ledger.repository';
import { LedgerService } from '../src/modules/economy/application/ledger.service';
import { STARTER_POINTS_DATA_PROVIDER } from '../src/modules/economy/economy.module';
import { InMemoryStarterPointsDataProvider } from '../src/modules/economy/infrastructure/in-memory-starter-points-data-provider';
import { NOTIFICATION_REPOSITORY_PORT } from '../src/modules/notifications/application/ports/notification-repository.port';
import { InMemoryNotificationRepository } from '../src/modules/notifications/infrastructure/in-memory-notification.repository';
import { CompletionCodeService } from '../src/modules/forms/infrastructure/completion-code.service';
import { SessionService } from '../src/modules/auth/application/session.service';
import { EnvService } from '../src/common/config/env.service';
import { PrismaService } from '../src/common/database/prisma.service';
import { HttpExceptionFilter } from '../src/common/http/http-exception.filter';
import { AUTH_COOKIE_NAME } from '../src/modules/auth/presentation/cookie-options.helper';
import { FormEntity } from '../src/modules/forms/domain/form.entity';
import { FormVersionEntity } from '../src/modules/forms/domain/form-version.entity';
import { SurveyAttemptEntity } from '../src/modules/participation/domain/survey-attempt.entity';
import { seedCompleteDemographicProfile } from './fixtures/demographic-profile.fixture';

const HOUR_MS = 60 * 60 * 1000;

/**
 * Story IR.2a (API-01..API-05): the Respondent reads of the survey runner and
 * the cancel command through the whole HTTP stack (guards, pipes, envelope,
 * filter), with in-memory repositories. Every success body is parsed with the
 * shared schema (the backend half of the contract test).
 */
describe('Story IR.2a: survey runner reads (e2e)', () => {
  let app: INestApplication;
  let userRepo: InMemoryUserRepository;
  let formRepo: InMemoryFormRepository;
  let demoRepo: InMemoryDemographicProfileRepository;
  let partRepo: InMemoryParticipationRepository;
  let ledgerRepo: InMemoryLedgerRepository;
  let ledgerService: LedgerService;
  let sessionService: SessionService;
  let completionCodes: CompletionCodeService;

  /** Ledger clock (FR-24 maturity); attempts use the wall clock. */
  let ledgerNow = new Date();

  const TEST_JWT_SECRET = 'at_least_32_characters_super_secure_jwt_secret_key!';
  const ALLOWED_ORIGIN = 'http://localhost:3000';
  const COMPLETION_CODE = '482917';

  const publisherId = '90000000-0000-4000-8000-000000000001';
  const internalFormId = '90000000-0000-4000-8000-000000000011';
  const internalVersionId = '90000000-0000-4000-8000-000000000012';
  const externalFormId = '90000000-0000-4000-8000-000000000021';
  const externalVersionId = '90000000-0000-4000-8000-000000000022';
  const draftFormId = '90000000-0000-4000-8000-000000000031';
  const scarceFormId = '90000000-0000-4000-8000-000000000041';

  interface Actor {
    id: string;
    cookie: string;
    csrf: string;
  }

  async function actor(
    email: string,
    role: 'ADMIN' | 'PUBLISHER' | 'RESPONDENT' = 'RESPONDENT',
  ): Promise<Actor> {
    const user = await userRepo.create({
      email,
      passwordHash: '$2a$12$someHashedPassword',
      role,
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

  function get(path: string, who?: Actor) {
    const req = request(app.getHttpServer()).get(path);
    return who ? req.set('Cookie', who.cookie) : req;
  }

  function post(
    path: string,
    who: Actor,
    body: object = {},
    headers: Record<string, string> = {},
  ) {
    return request(app.getHttpServer())
      .post(path)
      .set('Cookie', who.cookie)
      .set('x-csrf-token', who.csrf)
      .set('Origin', ALLOWED_ORIGIN)
      .set('Content-Type', 'application/json')
      .set(headers)
      .send(body);
  }

  function cancel(
    attemptId: string,
    who: Actor,
    key = `cancel-${randomUUID()}`,
  ) {
    return post(
      `/attempts/${attemptId}/cancel`,
      who,
      {},
      {
        'Idempotency-Key': key,
      },
    );
  }

  async function start(formId: string, who: Actor) {
    const res = await post(`/surveys/${formId}/attempts`, who);
    expect(res.status).toBe(201);
    return surveyAttemptResponseSchema.parse(res.body.data);
  }

  /** Moves an attempt's server start back, so the Time Barrier has passed. */
  function backdate(attemptId: string, seconds: number): void {
    const a = partRepo.attempts.get(attemptId)!;
    partRepo.attempts.set(
      attemptId,
      new SurveyAttemptEntity(
        a.id,
        a.surveyId,
        a.formVersionId,
        a.respondentId,
        a.status,
        a.isGuest,
        new Date(a.startedAt.getTime() - seconds * 1000),
        a.submittedAt,
        a.clientContext,
        a.createdAt,
        a.updatedAt,
        a.codeVerification,
        a.closedReason,
        a.closedAt,
      ),
    );
  }

  function definition() {
    return {
      schemaVersion: 1,
      title: 'Thói quen tự học',
      blocks: [
        {
          id: 'q1',
          order: 0,
          type: 'text',
          title: 'Bạn học mấy giờ mỗi ngày?',
          required: true,
        },
      ],
      settings: {
        shuffleBlocks: false,
        progressBar: true,
        // The runner must not depend on the public route, which refuses this.
        requireAuth: true,
        allowPublicAccess: false,
        submitButtonText: 'Nộp bài',
      },
      metadata: { expectedEffortSeconds: 60, minTimeBarrierSeconds: 2 },
    } as any;
  }

  async function createForm(options: {
    id: string;
    versionId: string;
    type: 'INTERNAL' | 'EXTERNAL';
    status?: FormEntity['status'];
    expectedCompletions?: number;
    reward?: number;
    schemaJson?: ReturnType<typeof definition>;
  }): Promise<void> {
    await formRepo.create(
      new FormEntity(
        options.id,
        publisherId,
        options.type,
        options.status ?? 'PUBLISHED',
        `${options.type} runner survey`,
        'Mô tả',
        options.reward ?? 20,
        options.expectedCompletions ?? 50,
        new Date(),
        new Date(),
        undefined,
        0,
        5,
      ),
      new FormVersionEntity(
        options.versionId,
        options.id,
        1,
        options.schemaJson ?? definition(),
        null,
        options.status === undefined || options.status === 'PUBLISHED',
        options.type === 'EXTERNAL'
          ? 'https://docs.google.com/forms/d/e/runner/viewform'
          : null,
        options.type === 'EXTERNAL'
          ? completionCodes.computeVerifier(options.versionId, COMPLETION_CODE)
          : null,
        new Date(),
        new Date(),
      ),
    );
  }

  beforeAll(async () => {
    userRepo = new InMemoryUserRepository();
    const auditRepo = new InMemoryIdentityAuditRepository();
    const sessionRepo = new InMemorySessionRepository(auditRepo);
    formRepo = new InMemoryFormRepository();
    demoRepo = new InMemoryDemographicProfileRepository();
    partRepo = new InMemoryParticipationRepository();
    partRepo.formStatusLookup = (formId) => formRepo.peekForm(formId)?.status;
    formRepo.useCompletionSource((formId) =>
      partRepo.completionRefsFor(formId),
    );
    ledgerRepo = new InMemoryLedgerRepository();
    ledgerService = new LedgerService(ledgerRepo, { clock: () => ledgerNow });

    const envService = new EnvService({
      NODE_ENV: 'test',
      PORT: 4000,
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5433/rescom_test',
      JWT_SECRET: TEST_JWT_SECRET,
      JWT_ACCESS_TTL_SECONDS: 900,
      BCRYPT_ROUNDS: 12,
      FRONTEND_ORIGINS: ALLOWED_ORIGIN,
    });
    completionCodes = new CompletionCodeService(envService);

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
      .overrideProvider(SURVEY_FEEDBACK_REPOSITORY_PORT)
      .useValue(new InMemorySurveyFeedbackRepository())
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
      email: 'runner-publisher@rescom.test',
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
      idempotencyKey: 'seed-runner-publisher-escrow',
      entries: [
        { accountId: issuance.id, amount: -1000 },
        { accountId: escrow.id, amount: 1000 },
      ],
    });

    await createForm({
      id: internalFormId,
      versionId: internalVersionId,
      type: 'INTERNAL',
    });
    await createForm({
      id: externalFormId,
      versionId: externalVersionId,
      type: 'EXTERNAL',
    });
    await createForm({
      id: draftFormId,
      versionId: randomUUID(),
      type: 'INTERNAL',
      status: 'DRAFT',
    });
    await createForm({
      id: scarceFormId,
      versionId: randomUUID(),
      type: 'INTERNAL',
      expectedCompletions: 1,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /surveys/:id (API-01)', () => {
    it('answers the same public facts with and without a session, on both prefixes', async () => {
      const anonymous = await get(`/surveys/${internalFormId}`);
      expect(anonymous.status).toBe(200);
      expect(anonymous.body.error).toBeNull();
      expect(surveySummarySchema.parse(anonymous.body.data)).toMatchObject({
        id: internalFormId,
        status: 'PUBLISHED',
        estimatedEffortSeconds: 300,
      });

      const viewer = await actor('runner-viewer@rescom.test');
      const signedIn = await get(`/api/surveys/${internalFormId}`, viewer);
      expect(signedIn.status).toBe(200);
      expect(signedIn.body).toEqual(anonymous.body);
      expect(JSON.stringify(anonymous.body)).not.toMatch(
        /targetingJson|completionCode|publisherId|externalUrl/,
      );
    });

    it('answers 404 SURVEY_NOT_FOUND for a draft or unknown survey, 400 for a malformed id', async () => {
      const draft = await get(`/surveys/${draftFormId}`);
      const unknown = await get(`/surveys/${randomUUID()}`);
      expect(draft.status).toBe(404);
      expect(draft.body.error.code).toBe('SURVEY_NOT_FOUND');
      // Same error for both (no enumeration); only the per-request id differs.
      expect({ ...unknown.body.error, requestId: undefined }).toEqual({
        ...draft.body.error,
        requestId: undefined,
      });

      const malformed = await get('/surveys/not-a-uuid');
      expect(malformed.status).toBe(400);
      expect(malformed.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /attempts/:attemptId (API-02 + API-05)', () => {
    it("returns the owner's attempt with its pinned form, uncached, on both prefixes", async () => {
      const owner = await actor('runner-reader@rescom.test');
      const started = await start(internalFormId, owner);

      for (const prefix of ['', '/api']) {
        const res = await get(`${prefix}/attempts/${started.attemptId}`, owner);
        expect(res.status).toBe(200);
        expect(res.headers['cache-control']).toBe('no-store');
        const details = surveyAttemptDetailsSchema.parse(res.body.data);
        expect(details).toMatchObject({
          attemptId: started.attemptId,
          responseId: started.responseId,
          formVersionId: internalVersionId,
          versionNumber: 1,
          status: 'IN_PROGRESS',
          expiresAt: started.expiresAt,
          timeBarrier: started.timeBarrier,
        });
        expect(details.form?.blocks.map((block) => block.id)).toEqual(['q1']);
      }
    });

    it('never sends block integrity: attention-check answers stay server-side (MEDIUM-1)', async () => {
      const formId = randomUUID();
      const schemaJson = definition();
      schemaJson.blocks.push({
        id: 'q2',
        order: 1,
        type: 'rating',
        title: 'Hãy chọn 4 sao',
        required: true,
        maxRating: 5,
        ratingShape: 'STAR',
        integrity: {
          attentionCheck: {
            isAttentionCheck: true,
            expectedValue: 4,
            failAction: 'DISQUALIFY',
          },
          consistencyPair: { pairedBlockId: 'q1', rule: 'EQUIVALENT' },
          semanticCategory: 'ATTENTION_CHECK',
        },
      });
      await createForm({
        id: formId,
        versionId: randomUUID(),
        type: 'INTERNAL',
        schemaJson,
      });
      const owner = await actor('runner-attention@rescom.test');
      const started = await start(formId, owner);

      const res = await get(`/attempts/${started.attemptId}`, owner);
      expect(res.status).toBe(200);
      const details = surveyAttemptDetailsSchema.parse(res.body.data);
      expect(details.form?.blocks.map((block) => block.id)).toEqual([
        'q1',
        'q2',
      ]);
      expect(res.text).not.toMatch(
        /integrity|expectedValue|isAttentionCheck|consistencyPair|ATTENTION_CHECK/,
      );
    });

    it('answers 404 ATTEMPT_NOT_FOUND to another user on read, outcome and cancel', async () => {
      const owner = await actor('runner-owner@rescom.test');
      const stranger = await actor('runner-stranger@rescom.test');
      const started = await start(externalFormId, owner);

      const read = await get(`/attempts/${started.attemptId}`, stranger);
      const outcome = await get(
        `/attempts/${started.attemptId}/outcome`,
        stranger,
      );
      const cancelled = await cancel(started.attemptId, stranger);
      for (const res of [read, outcome, cancelled]) {
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('ATTEMPT_NOT_FOUND');
      }
      expect(partRepo.attempts.get(started.attemptId)?.status).toBe(
        'IN_PROGRESS',
      );

      const anonymous = await get(`/attempts/${started.attemptId}`);
      expect(anonymous.status).toBe(401);
    });
  });

  describe('POST /attempts/:attemptId/cancel (API-03)', () => {
    it('enforces session, CSRF, JSON and the Idempotency-Key', async () => {
      const owner = await actor('runner-guards@rescom.test');
      const started = await start(externalFormId, owner);
      const path = `/attempts/${started.attemptId}/cancel`;

      const noSession = await request(app.getHttpServer())
        .post(path)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'application/json')
        .set('Idempotency-Key', 'cancel-no-session')
        .send({});
      expect(noSession.status).toBe(401);

      const noCsrf = await request(app.getHttpServer())
        .post(path)
        .set('Cookie', owner.cookie)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'application/json')
        .set('Idempotency-Key', 'cancel-no-csrf')
        .send({});
      expect(noCsrf.status).toBe(403);

      const notJson = await request(app.getHttpServer())
        .post(path)
        .set('Cookie', owner.cookie)
        .set('x-csrf-token', owner.csrf)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'text/plain')
        .set('Idempotency-Key', 'cancel-not-json')
        .send('{}');
      expect(notJson.status).toBe(415);

      const noKey = await post(path, owner);
      expect(noKey.status).toBe(400);
      expect(noKey.body.error.code).toBe('INVALID_IDEMPOTENCY_KEY');

      const extraBody = await post(
        path,
        owner,
        { reason: 'x' },
        {
          'Idempotency-Key': 'cancel-extra-body',
        },
      );
      expect(extraBody.status).toBe(400);
      expect(extraBody.body.error.code).toBe('VALIDATION_ERROR');

      expect(partRepo.attempts.get(started.attemptId)?.status).toBe(
        'IN_PROGRESS',
      );
    });

    it('cancels once, replays the original closedAt, and refuses a later submit', async () => {
      const owner = await actor('runner-cancel@rescom.test');
      const started = await start(internalFormId, owner);

      const first = await cancel(started.attemptId, owner, 'cancel-tab-one');
      expect(first.status).toBe(200);
      const body = cancelAttemptResponseSchema.parse(first.body.data);
      expect(body).toMatchObject({
        attemptId: started.attemptId,
        status: 'ABANDONED',
        closedReason: 'CANCELLED',
      });

      const replay = await cancel(started.attemptId, owner, 'cancel-tab-two');
      expect(replay.status).toBe(200);
      expect(replay.body.data).toEqual(first.body.data);

      const read = await get(`/attempts/${started.attemptId}`, owner);
      expect(read.body.data).toMatchObject({
        status: 'ABANDONED',
        closedReason: 'CANCELLED',
        closedAt: body.closedAt,
      });

      backdate(started.attemptId, 10);
      const submit = await post(
        `/responses/${started.responseId}/submit`,
        owner,
        { attemptId: started.attemptId, answers: { q1: '3 giờ' } },
      );
      expect(submit.status).toBe(409);
      expect(submit.body.error.code).toBe('ATTEMPT_EXPIRED');
    });

    it('refuses a completed attempt with 409 ATTEMPT_NOT_IN_PROGRESS details', async () => {
      const owner = await actor('runner-completed@rescom.test');
      const started = await start(internalFormId, owner);
      backdate(started.attemptId, 10);
      const submit = await post(
        `/responses/${started.responseId}/submit`,
        owner,
        { attemptId: started.attemptId, answers: { q1: '2 giờ' } },
      );
      expect(submit.status).toBe(200);

      const res = await cancel(started.attemptId, owner);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ATTEMPT_NOT_IN_PROGRESS');
      expect(
        attemptNotInProgressDetailsSchema.parse(res.body.error.details),
      ).toEqual({ status: 'COMPLETED', closedReason: null });
    });

    it('releases the quota slot: at full quota a second respondent starts after the first cancels', async () => {
      const first = await actor('runner-quota-a@rescom.test');
      const second = await actor('runner-quota-b@rescom.test');
      const held = await start(scarceFormId, first);

      const refused = await post(`/surveys/${scarceFormId}/attempts`, second);
      expect(refused.status).toBe(409);
      expect(refused.body.error.code).toBe('SURVEY_QUOTA_FULL');
      const summary = await get(`/surveys/${scarceFormId}`);
      expect(summary.body.data.remainingSlots).toBe(0);

      expect((await cancel(held.attemptId, first)).status).toBe(200);
      await start(scarceFormId, second);
    });
  });

  describe('GET /attempts/:attemptId/outcome (API-04)', () => {
    it('Internal: AVAILABLE with the credited amount; reads post no journal', async () => {
      const owner = await actor('runner-internal-outcome@rescom.test');
      const started = await start(internalFormId, owner);

      const before = await get(`/attempts/${started.attemptId}/outcome`, owner);
      expect(before.status).toBe(200);
      expect(attemptOutcomeSchema.parse(before.body.data).reward.state).toBe(
        'NOT_COMPLETED',
      );

      backdate(started.attemptId, 10);
      const submit = await post(
        `/responses/${started.responseId}/submit`,
        owner,
        { attemptId: started.attemptId, answers: { q1: '4 giờ' } },
      );
      expect(submit.status).toBe(200);
      const credited = submit.body.data.reward;

      const posts = jest.spyOn(ledgerRepo, 'postJournalTransaction');
      for (let read = 0; read < 3; read++) {
        const res = await get(`/attempts/${started.attemptId}/outcome`, owner);
        expect(res.status).toBe(200);
        expect(res.headers['cache-control']).toBe('no-store');
        expect(attemptOutcomeSchema.parse(res.body.data)).toMatchObject({
          attemptStatus: 'COMPLETED',
          reward: {
            state: 'AVAILABLE',
            amount: credited.amount,
            journalId: credited.journalId,
            targetAccountClass: 'USER_AVAILABLE',
          },
        });
      }
      expect(posts).not.toHaveBeenCalled();
      posts.mockRestore();
    });

    it('External: PENDING with releasesAt, then AVAILABLE after the 48-hour release', async () => {
      const owner = await actor('runner-external-outcome@rescom.test');
      const admin = await actor('runner-admin@rescom.test', 'ADMIN');
      const started = await start(externalFormId, owner);
      backdate(started.attemptId, 10);
      ledgerNow = new Date();

      const verified = await post(
        `/attempts/${started.attemptId}/verify-code`,
        owner,
        {
          completionCode: COMPLETION_CODE,
        },
      );
      expect(verified.status).toBe(200);

      const pending = await get(
        `/attempts/${started.attemptId}/outcome`,
        owner,
      );
      const pendingOutcome = attemptOutcomeSchema.parse(pending.body.data);
      expect(pendingOutcome.reward).toMatchObject({
        state: 'PENDING',
        amount: 20,
        targetAccountClass: 'PENDING',
      });
      expect(Date.parse(pendingOutcome.reward.releasesAt!)).toBe(
        Date.parse(pendingOutcome.reward.creditedAt!) + 48 * HOUR_MS,
      );

      ledgerNow = new Date(ledgerNow.getTime() + 49 * HOUR_MS);
      const release = await post(
        `/economy/rewards/release-pending/${started.attemptId}`,
        admin,
      );
      expect(release.status).toBe(200);

      const available = await get(
        `/attempts/${started.attemptId}/outcome`,
        owner,
      );
      expect(
        attemptOutcomeSchema.parse(available.body.data).reward,
      ).toMatchObject({
        state: 'AVAILABLE',
        amount: 20,
        journalId: pendingOutcome.reward.journalId,
        releasesAt: null,
      });
    });
  });

  it('resolves the neighbouring attempt routes to their own controllers', async () => {
    const owner = await actor('runner-routes@rescom.test');
    const started = await start(externalFormId, owner);

    const feedback = await get(
      `/attempts/${started.attemptId}/feedback`,
      owner,
    );
    expect(feedback.status).toBe(200);
    expect(feedback.body.data).toMatchObject({ state: 'NOT_ELIGIBLE' });

    const verify = await post(
      `/attempts/${started.attemptId}/verify-code`,
      owner,
      {
        completionCode: 'abc',
      },
    );
    expect(verify.status).toBe(400);
    expect(verify.body.error.code).toBe('VALIDATION_ERROR');

    const report = await post(
      `/attempts/${started.attemptId}/report-missing-code`,
      owner,
      { reason: 'Trang cảm ơn không hiện mã.' },
    );
    expect(report.status).toBe(200);
    expect(report.body.data.status).toBe('REPORTED');

    // Decision Q5: a reported attempt can still be cancelled.
    const cancelled = await cancel(started.attemptId, owner);
    expect(cancelled.status).toBe(200);
    expect(
      partRepo.attempts.get(started.attemptId)?.codeVerification
        .missingCodeReportedAt,
    ).toBeInstanceOf(Date);
  });
});
