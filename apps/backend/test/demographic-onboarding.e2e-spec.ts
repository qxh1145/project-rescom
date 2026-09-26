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
import { COMPLETE_DEMOGRAPHIC_PROFILE } from './fixtures/demographic-profile.fixture';

/** Starter-points provider that reads completeness from the real demographic repository. */
class DemographicBackedStarterPointsProvider implements StarterPointsUserDataProvider {
  constructor(
    private readonly demographics: InMemoryDemographicProfileRepository,
  ) {}

  async getUserRegistrationDate(): Promise<Date | null> {
    return new Date();
  }

  async isDemographicComplete(userId: string): Promise<boolean> {
    const profile = await this.demographics.findByUserId(userId);
    return profile?.isComplete() ?? false;
  }

  async findActivationSurveyCompletions(): Promise<
    ActivationSurveyCompletionRecord[]
  > {
    return [];
  }

  async findUsersForExpiry(): Promise<string[]> {
    return [];
  }
}

describe('Story 7.1: Mandatory Demographic Survey E2E', () => {
  let app: INestApplication;
  let userRepo: InMemoryUserRepository;
  let demoRepo: InMemoryDemographicProfileRepository;
  let formRepo: InMemoryFormRepository;
  let partRepo: InMemoryParticipationRepository;
  let sessionService: SessionService;
  let ledgerService: LedgerService;
  let envService: EnvService;

  const TEST_JWT_SECRET = 'at_least_32_characters_super_secure_jwt_secret_key!';
  const ALLOWED_ORIGIN = 'http://localhost:3000';
  const publisherId = '22222222-2222-4222-8222-222222222222';
  const openFormId = '33333333-3333-4333-8333-333333333333';

  interface Actor {
    id: string;
    cookie: string;
    csrf: string;
  }

  let seed = 0;

  async function newcomer(): Promise<Actor> {
    seed += 1;
    const user = await userRepo.create({
      email: `newcomer${seed}@fpt.edu.vn`,
      passwordHash: '$2a$12$someHashedPassword',
      role: 'RESPONDENT',
      status: 'ACTIVE',
    });
    // Registration grants 100 Frozen starter points (Story 6.5, FR-4).
    await ledgerService.grantStarterPoints(user.id, 100);
    const tokens = await sessionService.createSession(user.id);
    return {
      id: user.id,
      cookie: `${AUTH_COOKIE_NAME}=${tokens.accessToken}`,
      csrf: tokens.csrfToken,
    };
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
      .overrideProvider(SURVEY_RESPONSE_REPOSITORY_PORT)
      .useValue(new InMemorySurveyResponseRepository())
      .overrideProvider(LEDGER_REPOSITORY_PORT)
      .useValue(new InMemoryLedgerRepository())
      .overrideProvider(STARTER_POINTS_DATA_PROVIDER)
      .useValue(new DemographicBackedStarterPointsProvider(demoRepo))
      .overrideProvider(NOTIFICATION_REPOSITORY_PORT)
      .useValue(new InMemoryNotificationRepository())
      .overrideProvider(EnvService)
      .useValue(envService)
      .compile();

    sessionService = moduleFixture.get(SessionService);
    ledgerService = moduleFixture.get(LedgerService);

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalFilters(new HttpExceptionFilter());
    app.enableCors({
      origin: (origin, callback) => {
        callback(null, !origin || envService.frontendOrigins.includes(origin));
      },
      credentials: true,
    });
    await app.init();

    const now = new Date();
    await formRepo.create(
      new FormEntity(
        openFormId,
        publisherId,
        'INTERNAL',
        'PUBLISHED',
        'Open Campus Survey',
        'Open to every onboarded respondent',
        10,
        50,
        now,
        now,
      ),
      new FormVersionEntity(
        'ver-open-onboarding',
        openFormId,
        1,
        { title: 'Open Campus Survey', blocks: [] } as any,
        null,
        true,
        null,
        null,
        now,
        now,
      ),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports an empty profile with every FR-6 field missing', async () => {
    const user = await newcomer();

    const res = await get(user, '/demographics').expect(200);

    expect(res.body.data.isComplete).toBe(false);
    expect(res.body.data.missingFields).toEqual([
      'age',
      'gender',
      'location',
      'occupation',
      'fieldOfStudy',
      'householdIncome',
      'specificInterests',
    ]);
  });

  it('blocks the Marketplace feed and survey attempts until the survey is complete (FR-6)', async () => {
    const user = await newcomer();

    const feed = await get(user, '/marketplace/feed').expect(403);
    expect(feed.body.error.code).toBe('DEMOGRAPHIC_PROFILE_REQUIRED');
    expect(feed.body.error.details.missingFields).toHaveLength(7);

    const attempt = await mutate(user, 'post', `/forms/${openFormId}/attempts`)
      .send({})
      .expect(403);
    expect(attempt.body.error.code).toBe('DEMOGRAPHIC_PROFILE_REQUIRED');
    expect(
      [...partRepo.attempts.values()].some((a) => a.respondentId === user.id),
    ).toBe(false);
  });

  it('rejects an incomplete mandatory survey submission with 400 and saves nothing', async () => {
    const user = await newcomer();
    const { specificInterests: _omit, ...withoutInterests } =
      COMPLETE_DEMOGRAPHIC_PROFILE;

    const res = await mutate(user, 'post', '/demographics/survey')
      .send(withoutInterests)
      .expect(400);

    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    await expect(demoRepo.findByUserId(user.id)).resolves.toBeNull();

    await mutate(user, 'post', '/api/demographics/survey')
      .send({ ...COMPLETE_DEMOGRAPHIC_PROFILE, householdIncome: '   ' })
      .expect(400);
  });

  it('requires a CSRF token to submit the survey', async () => {
    const user = await newcomer();

    const res = await request(app.getHttpServer())
      .post('/demographics/survey')
      .set('Cookie', [user.cookie])
      .set('Origin', ALLOWED_ORIGIN)
      .send(COMPLETE_DEMOGRAPHIC_PROFILE);

    expect(res.status).toBe(403);
    await expect(demoRepo.findByUserId(user.id)).resolves.toBeNull();
  });

  it('saves the survey, opens the activation step and unlocks earning features while points stay Frozen', async () => {
    const user = await newcomer();

    const submit = await mutate(user, 'post', '/demographics/survey')
      .send(COMPLETE_DEMOGRAPHIC_PROFILE)
      .expect(200);

    expect(submit.body.data).toMatchObject({
      isComplete: true,
      missingFields: [],
      nextStep: 'MARKETPLACE_ACTIVATION',
    });
    expect(submit.body.data.profile.specificInterests).toEqual(['Technology']);

    // FR-7/FR-8: the demographic survey alone does not unlock starter points.
    const wallet = await get(user, '/economy/wallet').expect(200);
    expect(wallet.body.data.balance.frozen).toBe(100);
    expect(wallet.body.data.balance.available).toBe(0);

    const status = await get(user, '/economy/starter-points/status').expect(
      200,
    );
    expect(status.body.data.isDemographicComplete).toBe(true);
    expect(status.body.data.isUnlocked).toBe(false);
    // Story 7.2: the Marketplace activation step is now open.
    expect(status.body.data.activationState).toBe('SURVEY_REQUIRED');

    const feed = await get(user, '/marketplace/feed').expect(200);
    expect(feed.body.data.profileCompleted).toBe(true);
    expect(feed.body.data.surveys.map((s: { id: string }) => s.id)).toContain(
      openFormId,
    );

    const attempt = await mutate(user, 'post', `/forms/${openFormId}/attempts`)
      .send({})
      .expect(201);
    expect(attempt.body.data.formId).toBe(openFormId);
  });

  it('re-engages the gate when a profile edit clears a required field', async () => {
    const user = await newcomer();
    await mutate(user, 'post', '/demographics/survey')
      .send(COMPLETE_DEMOGRAPHIC_PROFILE)
      .expect(200);

    const edit = await mutate(user, 'put', '/demographics')
      .send({ occupation: null })
      .expect(200);
    expect(edit.body.data.isComplete).toBe(false);
    expect(edit.body.data.missingFields).toEqual(['occupation']);

    const feed = await get(user, '/marketplace/feed').expect(403);
    expect(feed.body.error.details.missingFields).toEqual(['occupation']);
  });
});
