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
import { SURVEY_RESPONSE_REPOSITORY_PORT } from '../src/modules/marketplace/application/ports/survey-response.repository.port';
import { InMemorySurveyResponseRepository } from '../src/modules/marketplace/infrastructure/in-memory-survey-response.repository';
import { LEDGER_REPOSITORY_PORT } from '../src/modules/economy/application/ports/ledger-repository.port';
import { InMemoryLedgerRepository } from '../src/modules/economy/infrastructure/in-memory-ledger.repository';
import { STARTER_POINTS_DATA_PROVIDER } from '../src/modules/economy/economy.module';
import {
  ActivationSurveyCompletionRecord,
  FindActivationCompletionsOptions,
  StarterPointsUserDataProvider,
} from '../src/modules/economy/application/starter-points.coordinator';
import { NOTIFICATION_REPOSITORY_PORT } from '../src/modules/notifications/application/ports/notification-repository.port';
import { InMemoryNotificationRepository } from '../src/modules/notifications/infrastructure/in-memory-notification.repository';
import { LedgerService } from '../src/modules/economy/application/ledger.service';
import { SessionService } from '../src/modules/auth/application/session.service';
import { EnvService } from '../src/common/config/env.service';
import { PrismaService } from '../src/common/database/prisma.service';
import { HttpExceptionFilter } from '../src/common/http/http-exception.filter';
import { AUTH_COOKIE_NAME } from '../src/modules/auth/presentation/cookie-options.helper';
import { FormEntity } from '../src/modules/forms/domain/form.entity';
import { FormVersionEntity } from '../src/modules/forms/domain/form-version.entity';
import { CompletionCodeService } from '../src/modules/forms/infrastructure/completion-code.service';
import { SurveyAttemptEntity } from '../src/modules/participation/domain/survey-attempt.entity';
import { ResponseEntity } from '../src/modules/participation/domain/response.entity';
import { COMPLETE_DEMOGRAPHIC_PROFILE } from './fixtures/demographic-profile.fixture';

const HOUR = 60 * 60 * 1000;

/**
 * Starter-points data provider over the in-memory Participation, Forms, Users
 * and Demographics repositories — the same eligibility rule as
 * `PrismaStarterPointsDataProvider` (non-guest, others' surveys paying at
 * least 1 point, Internal VALIDATED / External COMPLETED, completed before
 * `completedBefore`).
 */
class ParticipationBackedStarterPointsProvider implements StarterPointsUserDataProvider {
  readonly registrationOverrides = new Map<string, Date>();

  constructor(
    private readonly users: InMemoryUserRepository,
    private readonly demographics: InMemoryDemographicProfileRepository,
    private readonly forms: InMemoryFormRepository,
    private readonly participation: InMemoryParticipationRepository,
  ) {}

  async getUserRegistrationDate(userId: string): Promise<Date | null> {
    return (
      this.registrationOverrides.get(userId) ??
      (await this.users.findById(userId))?.createdAt ??
      null
    );
  }

  async isDemographicComplete(userId: string): Promise<boolean> {
    return (
      (await this.demographics.findByUserId(userId))?.isComplete() ?? false
    );
  }

  async findActivationSurveyCompletions(
    userId: string,
    options: FindActivationCompletionsOptions,
  ): Promise<ActivationSurveyCompletionRecord[]> {
    const completions: ActivationSurveyCompletionRecord[] = [];
    const counts = (at: Date | null): at is Date =>
      at !== null && at.getTime() <= options.completedBefore.getTime();

    for (const response of this.participation.responses.values()) {
      if (
        response.respondentId !== userId ||
        response.isGuest ||
        response.status !== 'VALIDATED' ||
        !counts(response.submittedAt)
      ) {
        continue;
      }
      const survey = await this.forms.findById(response.formId);
      if (
        !survey ||
        survey.form.publisherId === userId ||
        survey.form.rewardPerResponse < 1
      ) {
        continue;
      }
      completions.push({
        source: 'INTERNAL',
        formId: response.formId,
        attemptId: response.attemptId,
        completedAt: response.submittedAt,
        rewardPerResponse: survey.form.rewardPerResponse,
      });
    }

    for (const attempt of this.participation.attempts.values()) {
      if (
        attempt.respondentId !== userId ||
        attempt.isGuest ||
        attempt.status !== 'COMPLETED' ||
        !counts(attempt.submittedAt)
      ) {
        continue;
      }
      const survey = await this.forms.findById(attempt.surveyId);
      if (
        !survey ||
        survey.form.type !== 'EXTERNAL' ||
        survey.form.publisherId === userId ||
        survey.form.rewardPerResponse < 1
      ) {
        continue;
      }
      completions.push({
        source: 'EXTERNAL',
        formId: attempt.surveyId,
        attemptId: attempt.id,
        completedAt: attempt.submittedAt,
        rewardPerResponse: survey.form.rewardPerResponse,
      });
    }

    return completions
      .sort((a, b) => a.completedAt.getTime() - b.completedAt.getTime())
      .slice(0, options.limit);
  }

  async findUsersForExpiry(): Promise<string[]> {
    return [];
  }
}

describe('Story 7.2: Marketplace Survey Activation Step E2E', () => {
  let app: INestApplication;
  let userRepo: InMemoryUserRepository;
  let demoRepo: InMemoryDemographicProfileRepository;
  let formRepo: InMemoryFormRepository;
  let partRepo: InMemoryParticipationRepository;
  let notificationRepo: InMemoryNotificationRepository;
  let provider: ParticipationBackedStarterPointsProvider;
  let sessionService: SessionService;
  let ledgerService: LedgerService;
  let envService: EnvService;
  let completionCodeService: CompletionCodeService;

  const TEST_JWT_SECRET = 'at_least_32_characters_super_secure_jwt_secret_key!';
  const ALLOWED_ORIGIN = 'http://localhost:3000';
  const publisherId = '22222222-2222-4222-8222-222222222222';
  const internalFormIds = [
    '33333333-3333-4333-8333-333333333331',
    '33333333-3333-4333-8333-333333333332',
  ];
  const externalFormId = '44444444-4444-4444-8444-444444444444';
  const externalVersionId = '45454545-4545-4454-8454-454545454545';
  const completionCode = '246810';

  interface Actor {
    id: string;
    cookie: string;
    csrf: string;
  }

  let seed = 0;

  async function onboardedRespondent(): Promise<Actor> {
    seed += 1;
    const user = await userRepo.create({
      email: `activation${seed}@fpt.edu.vn`,
      passwordHash: '$2a$12$someHashedPassword',
      role: 'RESPONDENT',
      status: 'ACTIVE',
    });
    // Registration grants 100 Frozen starter points (Story 6.5, FR-4).
    await ledgerService.grantStarterPoints(user.id, 100);
    const tokens = await sessionService.createSession(user.id);
    const actor = {
      id: user.id,
      cookie: `${AUTH_COOKIE_NAME}=${tokens.accessToken}`,
      csrf: tokens.csrfToken,
    };
    // Step 1/2 (Story 7.1): the Mandatory Demographic Survey.
    await mutate(actor, 'post', '/demographics/survey')
      .send(COMPLETE_DEMOGRAPHIC_PROFILE)
      .expect(200);
    return actor;
  }

  const get = (actor: Actor, path: string) =>
    request(app.getHttpServer())
      .get(path)
      .set('Cookie', [actor.cookie])
      .set('Origin', ALLOWED_ORIGIN);

  const mutate = (actor: Actor, method: 'post' | 'put', path: string) =>
    request(app.getHttpServer())
      [method](path)
      .set('Cookie', [actor.cookie])
      .set('Origin', ALLOWED_ORIGIN)
      .set('x-csrf-token', actor.csrf);

  const status = async (actor: Actor) =>
    (await get(actor, '/economy/starter-points/status').expect(200)).body.data;

  const wallet = async (actor: Actor) =>
    (await get(actor, '/economy/wallet').expect(200)).body.data.balance;

  const activationNotifications = (userId: string) =>
    notificationRepo
      .all()
      .filter((n) => n.userId === userId && n.type === 'ACCOUNT_ACTIVATED');

  async function createInternalForm(
    formId: string,
    owner: string,
    reward: number,
  ): Promise<void> {
    const now = new Date();
    await formRepo.create(
      new FormEntity(
        formId,
        owner,
        'INTERNAL',
        'PUBLISHED',
        `Internal survey ${formId.slice(-4)}`,
        'Marketplace survey',
        reward,
        100,
        now,
        now,
      ),
      new FormVersionEntity(
        `${formId.slice(0, -4)}9${formId.slice(-3)}`,
        formId,
        1,
        {
          title: 'Marketplace survey',
          settings: { requireAuth: true, allowPublicAccess: false },
          metadata: { expectedEffortSeconds: 30, minTimeBarrierSeconds: 1 },
          blocks: [
            {
              id: 'block-q1',
              order: 0,
              title: 'Your Major',
              type: 'text',
              required: true,
              minLength: 2,
            },
          ],
        } as any,
        null,
        true,
        null,
        null,
        now,
        now,
      ),
    );
  }

  async function completeInternalSurvey(actor: Actor, formId: string) {
    const start = await mutate(actor, 'post', `/forms/${formId}/attempts`)
      .send({})
      .expect(201);
    // Pass the Time Barrier (Story 8.2: 1 question x 2 s) without sleeping.
    const attempt = partRepo.attempts.get(start.body.data.attemptId)!;
    partRepo.attempts.set(
      attempt.id,
      new SurveyAttemptEntity(
        attempt.id,
        attempt.surveyId,
        attempt.formVersionId,
        attempt.respondentId,
        attempt.status,
        attempt.isGuest,
        new Date(Date.now() - 5000),
        attempt.submittedAt,
        attempt.clientContext,
        attempt.createdAt,
        attempt.updatedAt,
      ),
    );
    return mutate(
      actor,
      'post',
      `/responses/${start.body.data.responseId}/submit`,
    )
      .send({ answers: { 'block-q1': 'Software Engineering' } })
      .expect(200);
  }

  async function verifyExternalSurvey(actor: Actor): Promise<string> {
    const attemptId = `77777777-7777-4777-8777-${String(seed).padStart(12, '0')}`;
    partRepo.attempts.set(
      attemptId,
      new SurveyAttemptEntity(
        attemptId,
        externalFormId,
        externalVersionId,
        actor.id,
        'IN_PROGRESS',
        false,
        new Date(Date.now() - 5000),
        null,
        null,
        new Date(),
        new Date(),
      ),
    );
    await mutate(
      actor,
      'post',
      `/forms/${externalFormId}/attempts/${attemptId}/verify-code`,
    )
      .set('Content-Type', 'application/json')
      .send({ completionCode })
      .expect(200);
    return attemptId;
  }

  /** Moves a completed External attempt `hours` into the past. */
  function ageAttempt(attemptId: string, hours: number): void {
    const attempt = partRepo.attempts.get(attemptId)!;
    const submittedAt = new Date(Date.now() - hours * HOUR);
    partRepo.attempts.set(
      attemptId,
      new SurveyAttemptEntity(
        attempt.id,
        attempt.surveyId,
        attempt.formVersionId,
        attempt.respondentId,
        attempt.status,
        attempt.isGuest,
        new Date(submittedAt.getTime() - 5000),
        submittedAt,
        attempt.clientContext,
        attempt.createdAt,
        new Date(),
      ),
    );
  }

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ||
      'postgresql://postgres:postgres@localhost:5433/rescom_test';

    userRepo = new InMemoryUserRepository();
    const auditRepo = new InMemoryIdentityAuditRepository();
    const sessionRepo = new InMemorySessionRepository(auditRepo);
    formRepo = new InMemoryFormRepository();
    demoRepo = new InMemoryDemographicProfileRepository();
    partRepo = new InMemoryParticipationRepository();
    notificationRepo = new InMemoryNotificationRepository();
    provider = new ParticipationBackedStarterPointsProvider(
      userRepo,
      demoRepo,
      formRepo,
      partRepo,
    );

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
      .overrideProvider(SURVEY_RESPONSE_REPOSITORY_PORT)
      .useValue(new InMemorySurveyResponseRepository())
      .overrideProvider(LEDGER_REPOSITORY_PORT)
      .useValue(new InMemoryLedgerRepository())
      .overrideProvider(STARTER_POINTS_DATA_PROVIDER)
      .useValue(provider)
      .overrideProvider(NOTIFICATION_REPOSITORY_PORT)
      .useValue(notificationRepo)
      .overrideProvider(EnvService)
      .useValue(envService)
      .compile();

    sessionService = moduleFixture.get(SessionService);
    ledgerService = moduleFixture.get(LedgerService);

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    // Another student publishes the Marketplace surveys and funds the rewards.
    await userRepo.create({
      id: publisherId,
      email: 'publisher@fpt.edu.vn',
      passwordHash: 'hash',
      role: 'RESPONDENT',
      status: 'ACTIVE',
    });
    const escrow = await ledgerService.getOrCreateAccount(
      publisherId,
      'ESCROW',
    );
    const issuance = await ledgerService.getOrCreateAccount(
      null,
      'SYSTEM_ISSUANCE',
    );
    await ledgerService.postJournal({
      idempotencyKey: 'seed-activation-escrow',
      entries: [
        { accountId: issuance.id, amount: -5000 },
        { accountId: escrow.id, amount: 5000 },
      ],
    });
    for (const formId of internalFormIds) {
      await createInternalForm(formId, publisherId, 10);
    }

    const now = new Date();
    await formRepo.create(
      new FormEntity(
        externalFormId,
        publisherId,
        'EXTERNAL',
        'PUBLISHED',
        'Google Forms survey',
        'External Marketplace survey',
        20,
        100,
        now,
        now,
      ),
      new FormVersionEntity(
        externalVersionId,
        externalFormId,
        1,
        {
          title: 'Google Forms survey',
          blocks: [],
          metadata: { expectedEffortSeconds: 60, minTimeBarrierSeconds: 2 },
        } as any,
        null,
        true,
        'https://docs.google.com/forms/d/e/activation/viewform',
        completionCodeService.computeVerifier(
          externalVersionId,
          completionCode,
        ),
        now,
        now,
      ),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('prompts an onboarded respondent to complete one Marketplace survey (FR-7)', async () => {
    const respondent = await onboardedRespondent();

    const current = await status(respondent);

    expect(current).toMatchObject({
      activationState: 'SURVEY_REQUIRED',
      isDemographicComplete: true,
      hasCompletedMarketplaceSurvey: false,
      isUnlocked: false,
      frozenBalance: 100,
      daysRemaining: 30,
      activatedAt: null,
      activationSurvey: null,
      isVerifiedMember: false,
      unlockEligibility: {
        eligible: false,
        missingSteps: ['Complete 1 Marketplace Survey'],
      },
    });
  });

  /** Seeds a VALIDATED Response directly (a path the API no longer offers). */
  function seedValidatedResponse(
    responseId: string,
    formId: string,
    respondentId: string,
  ): void {
    partRepo.responses.set(
      responseId,
      new ResponseEntity(
        responseId,
        formId,
        `${formId.slice(0, -4)}9${formId.slice(-3)}`,
        null,
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
  }

  it('does not count the respondent’s own survey, which they cannot even start (decision E4-DN2)', async () => {
    const respondent = await onboardedRespondent();
    const ownFormId = '88888888-8888-4888-8888-888888888881';
    await createInternalForm(ownFormId, respondent.id, 10);

    // The feed hides it and starting it is refused.
    const feed = await get(respondent, '/marketplace/feed').expect(200);
    expect(
      feed.body.data.surveys.map((survey: { id: string }) => survey.id),
    ).not.toContain(ownFormId);
    const start = await mutate(
      respondent,
      'post',
      `/forms/${ownFormId}/attempts`,
    )
      .send({})
      .expect(403);
    expect(start.body.error.code).toBe('SELF_PARTICIPATION_FORBIDDEN');

    // Even a legacy completion of one's own survey never activates.
    seedValidatedResponse(
      '88888888-8888-4888-8888-888888888889',
      ownFormId,
      respondent.id,
    );
    expect((await status(respondent)).activationState).toBe('SURVEY_REQUIRED');
    expect(await wallet(respondent)).toMatchObject({ frozen: 100 });
  });

  it('does not count a zero-reward survey toward activation (decision E7-DN2, B(1))', async () => {
    const respondent = await onboardedRespondent();
    const freeFormId = '88888888-8888-4888-8888-888888888882';
    await createInternalForm(freeFormId, publisherId, 0);

    await completeInternalSurvey(respondent, freeFormId);

    const current = await status(respondent);
    expect(current.activationState).toBe('SURVEY_REQUIRED');
    expect(current.hasCompletedMarketplaceSurvey).toBe(false);
    expect(current.isVerifiedMember).toBe(false);
    expect(await wallet(respondent)).toMatchObject({
      frozen: 100,
      available: 0,
    });

    // A rewarded survey still activates.
    await completeInternalSurvey(respondent, internalFormIds[0]);
    expect(await status(respondent)).toMatchObject({
      activationState: 'ACTIVATED',
      isVerifiedMember: true,
    });
  });

  it('unlocks 100 Frozen points exactly once after one Internal Marketplace survey (FR-8)', async () => {
    const respondent = await onboardedRespondent();

    await completeInternalSurvey(respondent, internalFormIds[0]);

    expect(await wallet(respondent)).toMatchObject({
      frozen: 0,
      available: 110,
    });
    const activated = await status(respondent);
    expect(activated).toMatchObject({
      activationState: 'ACTIVATED',
      isUnlocked: true,
      frozenBalance: 0,
      activationSurvey: {
        source: 'INTERNAL',
        formId: internalFormIds[0],
        status: 'CONFIRMED',
      },
    });
    expect(activated.activatedAt).toEqual(expect.any(String));
    expect(activationNotifications(respondent.id)).toHaveLength(1);

    // A second completion and an explicit retry never unlock again.
    await completeInternalSurvey(respondent, internalFormIds[1]);
    const retry = await mutate(
      respondent,
      'post',
      '/economy/starter-points/unlock',
    ).expect(200);
    expect(retry.body.data).toMatchObject({
      unlocked: false,
      activationState: 'ACTIVATED',
    });

    expect(await wallet(respondent)).toMatchObject({
      frozen: 0,
      available: 120,
    });
    expect(activationNotifications(respondent.id)).toHaveLength(1);
  });

  it('activates on an External survey only after its 48-hour review window (FR-24)', async () => {
    const respondent = await onboardedRespondent();

    const attemptId = await verifyExternalSurvey(respondent);

    const pending = await status(respondent);
    expect(pending.activationState).toBe('PENDING_CONFIRMATION');
    expect(pending.activationSurvey).toMatchObject({
      source: 'EXTERNAL',
      formId: externalFormId,
      status: 'PENDING_REVIEW',
    });
    expect(
      new Date(pending.activationSurvey.confirmsAt).getTime() -
        new Date(pending.activationSurvey.completedAt).getTime(),
    ).toBe(48 * HOUR);
    expect(await wallet(respondent)).toMatchObject({
      frozen: 100,
      pending: 20,
    });
    const early = await mutate(
      respondent,
      'post',
      '/economy/starter-points/unlock',
    ).expect(200);
    expect(early.body.data).toMatchObject({
      unlocked: false,
      activationState: 'PENDING_CONFIRMATION',
    });

    // The review window closes without a dispute.
    ageAttempt(attemptId, 49);
    expect((await status(respondent)).activationState).toBe('READY_TO_UNLOCK');

    const claim = await mutate(
      respondent,
      'post',
      '/economy/starter-points/unlock',
    ).expect(200);
    expect(claim.body.data).toMatchObject({
      unlocked: true,
      amount: 100,
      activationState: 'ACTIVATED',
    });
    expect(await wallet(respondent)).toMatchObject({
      frozen: 0,
      available: 100,
    });
    expect(activationNotifications(respondent.id)).toHaveLength(1);
  });

  it('posts a single unlock journal under concurrent unlock requests', async () => {
    const respondent = await onboardedRespondent();
    const responseId = '99999999-9999-4999-8999-999999999991';
    partRepo.responses.set(
      responseId,
      new ResponseEntity(
        responseId,
        internalFormIds[0],
        `${internalFormIds[0].slice(0, -4)}9${internalFormIds[0].slice(-3)}`,
        null,
        respondent.id,
        'VALIDATED',
        {},
        '127.0.0.1',
        false,
        new Date(),
        new Date(),
        new Date(),
      ),
    );

    const results = await Promise.all(
      [1, 2, 3].map(() =>
        mutate(respondent, 'post', '/economy/starter-points/unlock').expect(
          200,
        ),
      ),
    );

    const journalIds = new Set(
      results
        .map((res) => res.body.data)
        .filter((data) => data.unlocked)
        .map((data) => data.journalId),
    );
    expect(journalIds.size).toBe(1);
    expect(await wallet(respondent)).toMatchObject({
      frozen: 0,
      available: 100,
    });
    expect(activationNotifications(respondent.id)).toHaveLength(1);
  });

  it('never fails the survey submission when the unlock fails, and a later trigger recovers', async () => {
    const respondent = await onboardedRespondent();
    jest
      .spyOn(ledgerService, 'unlockStarterPoints')
      .mockRejectedValueOnce(new Error('ledger temporarily unavailable'));

    const submit = await completeInternalSurvey(respondent, internalFormIds[0]);

    expect(submit.status).toBe(200);
    expect(submit.body.data.status).toBe('VALIDATED');
    expect(await wallet(respondent)).toMatchObject({
      frozen: 100,
      available: 10,
    });
    expect((await status(respondent)).activationState).toBe('READY_TO_UNLOCK');

    const retry = await mutate(
      respondent,
      'post',
      '/economy/starter-points/unlock',
    ).expect(200);
    expect(retry.body.data.unlocked).toBe(true);
    expect(await wallet(respondent)).toMatchObject({
      frozen: 0,
      available: 110,
    });
  });

  it('does not count completions made after the 30-day window (FR-5)', async () => {
    const respondent = await onboardedRespondent();
    provider.registrationOverrides.set(
      respondent.id,
      new Date(Date.now() - 31 * 24 * HOUR),
    );

    await completeInternalSurvey(respondent, internalFormIds[1]);

    const expired = await status(respondent);
    expect(expired.activationState).toBe('EXPIRED');
    expect(expired.isExpired).toBe(true);
    // Decision E7-DN3: both steps are done, so the respondent is a Verified
    // Member even though the starter points can no longer unlock.
    expect(expired.isVerifiedMember).toBe(true);
    expect(expired.hasCompletedMarketplaceSurvey).toBe(false);
    expect(await wallet(respondent)).toMatchObject({ frozen: 100 });
    const unlock = await mutate(
      respondent,
      'post',
      '/economy/starter-points/unlock',
    ).expect(200);
    expect(unlock.body.data).toMatchObject({
      unlocked: false,
      activationState: 'EXPIRED',
    });
  });
});
