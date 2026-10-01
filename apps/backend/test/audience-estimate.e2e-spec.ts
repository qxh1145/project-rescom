import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { audienceEstimateSchema, DemographicProfileDto } from '@rescom/schemas';
import { AppModule } from '../src/app.module';
import { USER_REPOSITORY_PORT } from '../src/modules/users/application/ports/user.repository.port';
import { InMemoryUserRepository } from '../src/modules/users/infrastructure/in-memory-user.repository';
import { USER_PROFILE_REPOSITORY_PORT } from '../src/modules/users/application/ports/user-profile.repository.port';
import { InMemoryUserProfileRepository } from '../src/modules/users/infrastructure/in-memory-user-profile.repository';
import { DEMOGRAPHIC_PROFILE_REPOSITORY_PORT } from '../src/modules/users/application/ports/demographic-profile.repository.port';
import { InMemoryDemographicProfileRepository } from '../src/modules/users/infrastructure/in-memory-demographic-profile.repository';
import { SESSION_REPOSITORY_PORT } from '../src/modules/auth/application/ports/session-repository.port';
import { InMemorySessionRepository } from '../src/modules/auth/infrastructure/in-memory-session.repository';
import { IDENTITY_AUDIT_PORT } from '../src/modules/auth/application/ports/identity-audit.port';
import { InMemoryIdentityAuditRepository } from '../src/modules/auth/infrastructure/in-memory-identity-audit.repository';
import { FORM_REPOSITORY_PORT } from '../src/modules/forms/application/ports/form-repository.port';
import { InMemoryFormRepository } from '../src/modules/forms/infrastructure/in-memory-form.repository';
import { SURVEY_RESPONSE_REPOSITORY_PORT } from '../src/modules/marketplace/application/ports/survey-response.repository.port';
import { InMemorySurveyResponseRepository } from '../src/modules/marketplace/infrastructure/in-memory-survey-response.repository';
import { LEDGER_REPOSITORY_PORT } from '../src/modules/economy/application/ports/ledger-repository.port';
import { InMemoryLedgerRepository } from '../src/modules/economy/infrastructure/in-memory-ledger.repository';
import { NOTIFICATION_REPOSITORY_PORT } from '../src/modules/notifications/application/ports/notification-repository.port';
import { InMemoryNotificationRepository } from '../src/modules/notifications/infrastructure/in-memory-notification.repository';
import { STARTER_POINTS_DATA_PROVIDER } from '../src/modules/economy/economy.module';
import { InMemoryStarterPointsDataProvider } from '../src/modules/economy/infrastructure/in-memory-starter-points-data-provider';
import { SessionService } from '../src/modules/auth/application/session.service';
import { EnvService } from '../src/common/config/env.service';
import { PrismaService } from '../src/common/database/prisma.service';
import { HttpExceptionFilter } from '../src/common/http/http-exception.filter';
import { AUTH_COOKIE_NAME } from '../src/modules/auth/presentation/cookie-options.helper';
import { AUDIENCE_PROFILE_SOURCE_PORT } from '../src/modules/forms/application/ports/audience-profile-source.port';
import { InMemoryAudienceProfileSource } from '../src/modules/forms/infrastructure/in-memory-audience-profile.source';

describe('Plan 5.5: POST /forms/audience-estimate E2E', () => {
  let app: INestApplication;
  let userRepo: InMemoryUserRepository;
  let audience: InMemoryAudienceProfileSource;
  let sessionService: SessionService;
  let envService: EnvService;

  const TEST_JWT_SECRET = 'at_least_32_characters_super_secure_jwt_secret_key!';
  const ALLOWED_ORIGIN = 'http://localhost:3000';

  interface Actor {
    id: string;
    cookie: string;
    csrf: string;
  }

  let seed = 0;

  async function actor(
    role: 'PUBLISHER' | 'RESPONDENT' = 'RESPONDENT',
  ): Promise<Actor> {
    seed += 1;
    const user = await userRepo.create({
      email: `audience-${seed}@fpt.edu.vn`,
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

  const estimate = (who: Actor, path = '/forms/audience-estimate') =>
    request(app.getHttpServer())
      .post(path)
      .set('Cookie', [who.cookie])
      .set('Origin', ALLOWED_ORIGIN)
      .set('x-csrf-token', who.csrf);

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ||
      'postgresql://postgres:postgres@localhost:5433/rescom_test';

    userRepo = new InMemoryUserRepository();
    const auditRepo = new InMemoryIdentityAuditRepository();
    const sessionRepo = new InMemorySessionRepository(auditRepo);
    audience = new InMemoryAudienceProfileSource();

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
      .overrideProvider(USER_PROFILE_REPOSITORY_PORT)
      .useValue(new InMemoryUserProfileRepository())
      .overrideProvider(DEMOGRAPHIC_PROFILE_REPOSITORY_PORT)
      .useValue(new InMemoryDemographicProfileRepository())
      .overrideProvider(AUDIENCE_PROFILE_SOURCE_PORT)
      .useValue(audience)
      .overrideProvider(SESSION_REPOSITORY_PORT)
      .useValue(sessionRepo)
      .overrideProvider(IDENTITY_AUDIT_PORT)
      .useValue(auditRepo)
      .overrideProvider(FORM_REPOSITORY_PORT)
      .useValue(new InMemoryFormRepository())
      .overrideProvider(SURVEY_RESPONSE_REPOSITORY_PORT)
      .useValue(new InMemorySurveyResponseRepository())
      .overrideProvider(LEDGER_REPOSITORY_PORT)
      .useValue(new InMemoryLedgerRepository())
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
    app.enableCors({
      origin: (origin, callback) => {
        callback(null, !origin || envService.frontendOrigins.includes(origin));
      },
      credentials: true,
    });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  function addRespondents(
    count: number,
    prefix: string,
    overrides: Partial<DemographicProfileDto> = {},
  ) {
    for (let i = 0; i < count; i += 1) {
      const userId = `${prefix}-${String(i).padStart(4, '0')}`;
      audience.add(userId, {
        id: `profile-${userId}`,
        userId,
        age: 20,
        gender: 'FEMALE',
        location: 'Hà Nội',
        occupation: 'Sinh viên',
        fieldOfStudy: 'Kinh tế',
        householdIncome: 'Dưới 5 triệu',
        specificInterests: ['Công nghệ'],
        createdAt: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-01T00:00:00.000Z',
        ...overrides,
      });
    }
  }

  beforeAll(() => {
    addRespondents(37, 'hn-econ');
    addRespondents(6, 'hn-med', { fieldOfStudy: 'Y khoa' });
    addRespondents(20, 'dn-econ', { location: 'Đà Nẵng', gender: 'MALE' });
  });

  it('rejects a request without a session (401)', async () => {
    for (const path of [
      '/forms/audience-estimate',
      '/api/forms/audience-estimate',
    ]) {
      const res = await request(app.getHttpServer())
        .post(path)
        .set('Origin', ALLOWED_ORIGIN)
        .send({ targeting: {} })
        .expect(401);
      expect(res.body.data).toBeNull();
    }
  });

  it('requires the CSRF token and a JSON body', async () => {
    const publisher = await actor('PUBLISHER');
    const noCsrf = await request(app.getHttpServer())
      .post('/forms/audience-estimate')
      .set('Cookie', [publisher.cookie])
      .set('Origin', ALLOWED_ORIGIN)
      .send({ targeting: {} })
      .expect(403);
    expect(noCsrf.body.error.code).toBe('AUTH_INVALID_CSRF_TOKEN');

    await estimate(publisher)
      .set('Content-Type', 'text/plain')
      .send('{"targeting":{}}')
      .expect(415);
  });

  it('validates the body with the shared strict schema (400)', async () => {
    const publisher = await actor('PUBLISHER');
    for (const body of [
      {},
      { targeting: { schools: ['FPT'] } },
      { targeting: { ageRange: { min: 30, max: 20 } } },
      { targeting: { genders: ['ROBOT'] } },
    ]) {
      const res = await estimate(publisher).send(body).expect(400);
      expect(res.body.data).toBeNull();
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('returns a noisy, rounded count in the envelope, on both prefixes', async () => {
    const publisher = await actor('PUBLISHER');
    const answers: unknown[] = [];
    for (const path of [
      '/forms/audience-estimate',
      '/api/forms/audience-estimate',
    ]) {
      const res = await estimate(publisher, path)
        .send({ targeting: { locations: ['Hà Nội'], genders: ['FEMALE'] } })
        .expect(200);
      expect(res.body.error).toBeNull();
      expect(audienceEstimateSchema.safeParse(res.body.data).success).toBe(
        true,
      );
      // 43 matches, noise in [-3, 3], rounded to 10: 40 or 50.
      expect([40, 50]).toContain(res.body.data.estimatedRespondents);
      answers.push(res.body.data);
    }
    // The noise is deterministic (per targeting and day): no averaging it away.
    expect(answers[1]).toEqual(answers[0]);
  });

  it('never reveals a group under the minimum (k-anonymity)', async () => {
    const publisher = await actor('PUBLISHER');
    const small = await estimate(publisher)
      .send({ targeting: { fieldOfStudy: ['Y khoa'] } })
      .expect(200);
    const empty = await estimate(publisher)
      .send({ targeting: { fieldOfStudy: ['Thiên văn'] } })
      .expect(200);
    // 6 and 0 matches are indistinguishable.
    expect(small.body.data).toEqual({
      estimatedRespondents: null,
      minimumReportable: 10,
    });
    expect(empty.body.data).toEqual(small.body.data);
  });

  it('counts everyone eligible for an open (empty) targeting', async () => {
    const publisher = await actor('PUBLISHER');
    const res = await estimate(publisher).send({ targeting: {} }).expect(200);
    // 63 matches, noise in [-3, 3], rounded to 10.
    expect([60, 70]).toContain(res.body.data.estimatedRespondents);
  });

  it('suppresses an OR-ed list whose single value is a small group', async () => {
    const publisher = await actor('PUBLISHER');
    const res = await estimate(publisher)
      .send({ targeting: { fieldOfStudy: ['Kinh tế', 'Y khoa'] } })
      .expect(200);
    expect(res.body.data.estimatedRespondents).toBeNull();
  });

  it('limits each user to 30 estimates per hour (429 with Retry-After)', async () => {
    const publisher = await actor('PUBLISHER');
    for (let i = 0; i < 30; i += 1) {
      await estimate(publisher).send({ targeting: {} }).expect(200);
    }
    const res = await estimate(publisher).send({ targeting: {} }).expect(429);
    expect(res.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });
});
