import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { userProfileSchema } from '@rescom/schemas';
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
import { FormEntity } from '../src/modules/forms/domain/form.entity';
import { FormVersionEntity } from '../src/modules/forms/domain/form-version.entity';
import { seedCompleteDemographicProfile } from './fixtures/demographic-profile.fixture';

describe('Story IR.4b part A: user profile (FR-9) E2E', () => {
  let app: INestApplication;
  let userRepo: InMemoryUserRepository;
  let profileRepo: InMemoryUserProfileRepository;
  let demoRepo: InMemoryDemographicProfileRepository;
  let formRepo: InMemoryFormRepository;
  let sessionService: SessionService;
  let envService: EnvService;

  const TEST_JWT_SECRET = 'at_least_32_characters_super_secure_jwt_secret_key!';
  const ALLOWED_ORIGIN = 'http://localhost:3000';
  const EMPTY_PROFILE = {
    displayName: null,
    birthYear: null,
    school: null,
    schoolYear: null,
    goal: null,
  };

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
      email: `profile-${seed}@fpt.edu.vn`,
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

  const get = (who: Actor, path: string) =>
    request(app.getHttpServer())
      .get(path)
      .set('Cookie', [who.cookie])
      .set('Origin', ALLOWED_ORIGIN);

  const patchProfile = (who: Actor, path = '/users/me/profile') =>
    request(app.getHttpServer())
      .patch(path)
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
    profileRepo = new InMemoryUserProfileRepository();
    demoRepo = new InMemoryDemographicProfileRepository();
    formRepo = new InMemoryFormRepository();

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
      .useValue(profileRepo)
      .overrideProvider(DEMOGRAPHIC_PROFILE_REPOSITORY_PORT)
      .useValue(demoRepo)
      .overrideProvider(SESSION_REPOSITORY_PORT)
      .useValue(sessionRepo)
      .overrideProvider(IDENTITY_AUDIT_PORT)
      .useValue(auditRepo)
      .overrideProvider(FORM_REPOSITORY_PORT)
      .useValue(formRepo)
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

  it('rejects unauthenticated reads and writes with 401', async () => {
    for (const path of ['/users/me/profile', '/api/users/me/profile']) {
      const read = await request(app.getHttpServer())
        .get(path)
        .set('Origin', ALLOWED_ORIGIN)
        .expect(401);
      expect(read.body.data).toBeNull();

      await request(app.getHttpServer())
        .patch(path)
        .set('Origin', ALLOWED_ORIGIN)
        .send({ goal: 'EARN' })
        .expect(401);
    }
  });

  it('answers a user without a stored profile with every field null, on both prefixes', async () => {
    const user = await actor();

    for (const path of ['/users/me/profile', '/api/users/me/profile']) {
      const res = await get(user, path).expect(200);
      expect(res.body).toEqual({ data: EMPTY_PROFILE, error: null, meta: {} });
      // Personal data: never stored by a shared or browser cache.
      expect(res.headers['cache-control']).toBe('no-store');
      // Contract: the frontend parses the response with the shared schema.
      expect(userProfileSchema.safeParse(res.body.data).success).toBe(true);
    }
  });

  it('requires the CSRF token and a JSON body to update', async () => {
    const user = await actor();

    const noCsrf = await request(app.getHttpServer())
      .patch('/users/me/profile')
      .set('Cookie', [user.cookie])
      .set('Origin', ALLOWED_ORIGIN)
      .send({ displayName: 'Linh' })
      .expect(403);
    expect(noCsrf.body.error.code).toBe('AUTH_INVALID_CSRF_TOKEN');

    await patchProfile(user)
      .set('Content-Type', 'text/plain')
      .send('displayName=Linh')
      .expect(415);

    await expect(profileRepo.findByUserId(user.id)).resolves.toBeNull();
  });

  it('rejects unknown keys and invalid values with 400 VALIDATION_ERROR and format() details', async () => {
    const user = await actor();

    const unknownKey = await patchProfile(user)
      .send({ displayName: 'Linh', role: 'ADMIN' })
      .expect(400);
    expect(unknownKey.body.error.code).toBe('VALIDATION_ERROR');
    expect(unknownKey.body.error.details._errors.length).toBeGreaterThan(0);

    const tooLong = await patchProfile(user)
      .send({ displayName: 'x'.repeat(51) })
      .expect(400);
    expect(tooLong.body.error.details.displayName._errors.length).toBe(1);

    const badEnum = await patchProfile(user)
      .send({ schoolYear: 'Năm 9', goal: 'ADMIN' })
      .expect(400);
    expect(Object.keys(badEnum.body.error.details)).toEqual(
      expect.arrayContaining(['schoolYear', 'goal']),
    );

    // The 13..100 age bound uses the server clock (exact edges: service spec).
    const year = new Date().getUTCFullYear();
    for (const birthYear of [year - 5, 1800]) {
      const res = await patchProfile(user).send({ birthYear }).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details.birthYear._errors.length).toBe(1);
    }

    await expect(profileRepo.findByUserId(user.id)).resolves.toBeNull();
  });

  it('applies partial updates: absent keeps, null clears, blank becomes null', async () => {
    const user = await actor();

    const full = await patchProfile(user)
      .send({
        displayName: '  Linh Nguyễn ',
        birthYear: 2005,
        school: 'Trường Đại học FPT – Đà Nẵng',
        schoolYear: 'Năm 3',
        goal: 'BOTH',
      })
      .expect(200);
    expect(full.body).toEqual({
      data: {
        displayName: 'Linh Nguyễn',
        birthYear: 2005,
        school: 'Trường Đại học FPT – Đà Nẵng',
        schoolYear: 'Năm 3',
        goal: 'BOTH',
      },
      error: null,
      meta: {},
    });
    expect(userProfileSchema.safeParse(full.body.data).success).toBe(true);

    const partial = await patchProfile(user, '/api/users/me/profile')
      .send({ goal: 'EARN', school: null, displayName: '   ' })
      .expect(200);
    expect(partial.body.data).toEqual({
      displayName: null,
      birthYear: 2005,
      school: null,
      schoolYear: 'Năm 3',
      goal: 'EARN',
    });

    const noop = await patchProfile(user).send({}).expect(200);
    expect(noop.body.data).toEqual(partial.body.data);

    const read = await get(user, '/users/me/profile').expect(200);
    expect(read.body.data).toEqual(partial.body.data);
  });

  it('never changes the role, status or session when the goal changes (AC A6)', async () => {
    const respondent = await actor('RESPONDENT');
    const publisher = await actor('PUBLISHER');

    await patchProfile(respondent).send({ goal: 'COLLECT' }).expect(200);
    await patchProfile(publisher).send({ goal: 'EARN' }).expect(200);

    const respondentMe = await get(respondent, '/auth/me').expect(200);
    expect(respondentMe.body.data).toMatchObject({
      id: respondent.id,
      role: 'RESPONDENT',
      status: 'ACTIVE',
    });
    const publisherMe = await get(publisher, '/auth/me').expect(200);
    expect(publisherMe.body.data).toMatchObject({
      id: publisher.id,
      role: 'PUBLISHER',
      status: 'ACTIVE',
    });
  });

  it('never writes the demographic profile: birthYear does not rewrite age (AC A5)', async () => {
    const user = await actor();
    await seedCompleteDemographicProfile(demoRepo, user.id, { age: 22 });
    const before = await get(user, '/demographics').expect(200);

    await patchProfile(user)
      .send({ birthYear: 1990, school: 'ĐH Bách khoa Hà Nội' })
      .expect(200);

    const after = await get(user, '/demographics').expect(200);
    expect(after.body.data).toEqual(before.body.data);
    expect(after.body.data.profile.age).toBe(22);
  });

  it('a PUT /demographics change takes effect on the next feed request (FR-9, AC A5)', async () => {
    const user = await actor();
    await seedCompleteDemographicProfile(demoRepo, user.id, {
      location: 'Hanoi',
    });
    const now = new Date();
    const publisherId = '55555555-5555-4555-8555-555555555555';
    for (const [formId, location] of [
      ['form-profile-hanoi', 'Hanoi'],
      ['form-profile-hcmc', 'Ho Chi Minh City'],
    ]) {
      await formRepo.create(
        new FormEntity(
          formId,
          publisherId,
          'INTERNAL',
          'PUBLISHED',
          `${location} survey`,
          `Targeted at ${location}`,
          10,
          50,
          now,
          now,
        ),
        new FormVersionEntity(
          `ver-${formId}`,
          formId,
          1,
          { title: `${location} survey`, blocks: [] } as any,
          { locations: [location] },
          true,
          null,
          null,
          now,
          now,
        ),
      );
    }
    const feedIds = async () =>
      (await get(user, '/marketplace/feed').expect(200)).body.data.surveys.map(
        (survey: { id: string }) => survey.id,
      );

    expect(await feedIds()).toEqual(['form-profile-hanoi']);

    await request(app.getHttpServer())
      .put('/demographics')
      .set('Cookie', [user.cookie])
      .set('Origin', ALLOWED_ORIGIN)
      .set('x-csrf-token', user.csrf)
      .send({ location: 'Ho Chi Minh City' })
      .expect(200);

    expect(await feedIds()).toEqual(['form-profile-hcmc']);
  });
});
