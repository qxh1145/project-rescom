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
import { SURVEY_RESPONSE_REPOSITORY_PORT } from '../src/modules/marketplace/application/ports/survey-response.repository.port';
import { InMemorySurveyResponseRepository } from '../src/modules/marketplace/infrastructure/in-memory-survey-response.repository';
import { SessionService } from '../src/modules/auth/application/session.service';
import { EnvService } from '../src/common/config/env.service';
import { PrismaService } from '../src/common/database/prisma.service';
import { HttpExceptionFilter } from '../src/common/http/http-exception.filter';
import { AUTH_COOKIE_NAME } from '../src/modules/auth/presentation/cookie-options.helper';
import { FormEntity } from '../src/modules/forms/domain/form.entity';
import { FormVersionEntity } from '../src/modules/forms/domain/form-version.entity';

describe('Story 4.2: Automated Marketplace Matching E2E Tests', () => {
  let app: INestApplication;
  let userRepo: InMemoryUserRepository;
  let sessionRepo: InMemorySessionRepository;
  let auditRepo: InMemoryIdentityAuditRepository;
  let formRepo: InMemoryFormRepository;
  let demoRepo: InMemoryDemographicProfileRepository;
  let responseRepo: InMemorySurveyResponseRepository;
  let sessionService: SessionService;
  let envService: EnvService;

  const TEST_JWT_SECRET = 'at_least_32_characters_super_secure_jwt_secret_key!';
  const ALLOWED_ORIGIN = 'http://localhost:3000';

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ||
      'postgresql://postgres:postgres@localhost:5433/rescom_test';

    userRepo = new InMemoryUserRepository();
    auditRepo = new InMemoryIdentityAuditRepository();
    sessionRepo = new InMemorySessionRepository(auditRepo);
    formRepo = new InMemoryFormRepository();
    demoRepo = new InMemoryDemographicProfileRepository();
    responseRepo = new InMemorySurveyResponseRepository();

    envService = new EnvService({
      NODE_ENV: 'test',
      PORT: 4000,
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5433/rescom_test',
      JWT_SECRET: TEST_JWT_SECRET,
      JWT_ACCESS_TTL_SECONDS: 900,
      BCRYPT_ROUNDS: 12,
      FRONTEND_ORIGINS: ALLOWED_ORIGIN,
    });

    const mockPrisma = {
      $connect: jest.fn().mockResolvedValue(undefined),
      $disconnect: jest.fn().mockResolvedValue(undefined),
      form: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        count: jest.fn(),
      },
      demographicProfile: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
      },
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
      .overrideProvider(SURVEY_RESPONSE_REPOSITORY_PORT)
      .useValue(responseRepo)
      .overrideProvider(EnvService)
      .useValue(envService)
      .compile();

    sessionService = moduleFixture.get(SessionService);

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalFilters(new HttpExceptionFilter());

    app.enableCors({
      origin: (origin, callback) => {
        if (!origin || envService.frontendOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(null, false);
        }
      },
      credentials: true,
    });

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    userRepo.clear();
    sessionRepo.clear();
    auditRepo.clear();
    formRepo.clear();
    demoRepo.clear();
    responseRepo.clear();
  });

  async function createTestUserWithSession(
    email: string,
    role: 'ADMIN' | 'PUBLISHER' | 'RESPONDENT' = 'RESPONDENT',
  ) {
    const user = await userRepo.create({
      email,
      passwordHash: '$2a$12$someHashedPassword',
      role,
      status: 'ACTIVE',
    });

    const tokens = await sessionService.createSession(user.id);
    return {
      user,
      accessToken: tokens.accessToken,
      csrfToken: tokens.csrfToken,
    };
  }

  it('should reject unauthenticated request to marketplace feed with 401', async () => {
    const res = await request(app.getHttpServer())
      .get('/marketplace/feed')
      .set('Origin', ALLOWED_ORIGIN);

    expect(res.status).toBe(401);
  });

  it('should allow user to update and retrieve their demographic profile', async () => {
    const { accessToken, csrfToken } = await createTestUserWithSession(
      'respondent1@example.com',
      'RESPONDENT',
    );

    // 1. Initial profile check
    const initialRes = await request(app.getHttpServer())
      .get('/demographics')
      .set('Cookie', [`${AUTH_COOKIE_NAME}=${accessToken}`])
      .set('Origin', ALLOWED_ORIGIN);

    expect(initialRes.status).toBe(200);
    expect(initialRes.body.data.isComplete).toBe(false);

    // 2. Update profile
    const updateRes = await request(app.getHttpServer())
      .put('/demographics')
      .set('Cookie', [`${AUTH_COOKIE_NAME}=${accessToken}`])
      .set('X-CSRF-Token', csrfToken)
      .set('Origin', ALLOWED_ORIGIN)
      .send({
        age: 21,
        gender: 'FEMALE',
        location: 'Hanoi',
        occupation: 'Student',
        fieldOfStudy: 'Computer Science',
      });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data.profile.age).toBe(21);
    expect(updateRes.body.data.profile.location).toBe('Hanoi');
    expect(updateRes.body.data.isComplete).toBe(true);

    // 3. Retrieve updated profile
    const getRes = await request(app.getHttpServer())
      .get('/demographics')
      .set('Cookie', [`${AUTH_COOKIE_NAME}=${accessToken}`])
      .set('Origin', ALLOWED_ORIGIN);

    expect(getRes.status).toBe(200);
    expect(getRes.body.data.profile.age).toBe(21);
    expect(getRes.body.data.isComplete).toBe(true);
  });

  it('should return personalized feed of PUBLISHED surveys matching respondent profile', async () => {
    const now = new Date();
    const publisherId = '55555555-5555-4555-8555-555555555555';

    // Survey 1: Open to all
    const openSurvey = new FormEntity(
      'form-open',
      publisherId,
      'INTERNAL',
      'PUBLISHED',
      'Universal Survey',
      'Open to all respondents',
      10,
      100,
      now,
      now,
    );
    const openVersion = new FormVersionEntity(
      'ver-open',
      'form-open',
      1,
      { title: 'Universal Survey', blocks: [] } as any,
      null,
      true,
      null,
      null,
      now,
      now,
    );
    await formRepo.create(openSurvey, openVersion);

    // Survey 2: Targeted at Age 18-25 & Hanoi
    const targetedSurvey = new FormEntity(
      'form-targeted-hanoi',
      publisherId,
      'INTERNAL',
      'PUBLISHED',
      'Hanoi Youth Survey',
      'Targeted at age 18-25 in Hanoi',
      25,
      50,
      now,
      now,
    );
    const targetedVersion = new FormVersionEntity(
      'ver-targeted',
      'form-targeted-hanoi',
      1,
      { title: 'Hanoi Youth Survey', blocks: [] } as any,
      { ageRange: { min: 18, max: 25 }, locations: ['Hanoi'] },
      true,
      null,
      null,
      now,
      now,
    );
    await formRepo.create(targetedSurvey, targetedVersion);

    // Survey 3: Targeted at Ho Chi Minh City only
    const hcmcSurvey = new FormEntity(
      'form-targeted-hcmc',
      publisherId,
      'INTERNAL',
      'PUBLISHED',
      'HCMC Survey',
      'Targeted at HCMC',
      30,
      50,
      now,
      now,
    );
    const hcmcVersion = new FormVersionEntity(
      'ver-hcmc',
      'form-targeted-hcmc',
      1,
      { title: 'HCMC Survey', blocks: [] } as any,
      { locations: ['Ho Chi Minh City'] },
      true,
      null,
      null,
      now,
      now,
    );
    await formRepo.create(hcmcSurvey, hcmcVersion);

    // Survey 4: DRAFT survey (must not appear in marketplace)
    const draftSurvey = new FormEntity(
      'form-draft-hidden',
      publisherId,
      'INTERNAL',
      'DRAFT',
      'Draft Survey',
      'Should not be visible',
      10,
      50,
      now,
      now,
    );
    const draftVersion = new FormVersionEntity(
      'ver-draft',
      'form-draft-hidden',
      1,
      { title: 'Draft Survey', blocks: [] } as any,
      null,
      false,
      null,
      null,
      now,
      now,
    );
    await formRepo.create(draftSurvey, draftVersion);

    // ── 1. Authenticated Respondent matching Hanoi criteria (22, Hanoi) ──
    const hanoiUserSession = await createTestUserWithSession(
      'hanoi_user@example.com',
      'RESPONDENT',
    );
    await demoRepo.upsert(hanoiUserSession.user.id, {
      age: 22,
      gender: 'MALE',
      location: 'Hanoi',
      occupation: 'Student',
    });

    const hanoiRes = await request(app.getHttpServer())
      .get('/marketplace/feed')
      .set('Cookie', [`${AUTH_COOKIE_NAME}=${hanoiUserSession.accessToken}`])
      .set('Origin', ALLOWED_ORIGIN);

    expect(hanoiRes.status).toBe(200);
    expect(hanoiRes.body.data.total).toBe(2);
    const hanoiSurveyIds = hanoiRes.body.data.surveys.map((s: any) => s.id);
    expect(hanoiSurveyIds).toContain('form-open');
    expect(hanoiSurveyIds).toContain('form-targeted-hanoi');
    expect(hanoiSurveyIds).not.toContain('form-targeted-hcmc');
    expect(hanoiSurveyIds).not.toContain('form-draft-hidden');
    expect(hanoiRes.body.data.profileCompleted).toBe(true);

    // ── 2. Authenticated Respondent with age 30 (outside 18-25) in Hanoi ──
    const olderUserSession = await createTestUserWithSession(
      'older_user@example.com',
      'RESPONDENT',
    );
    await demoRepo.upsert(olderUserSession.user.id, {
      age: 30,
      gender: 'MALE',
      location: 'Hanoi',
    });

    const olderRes = await request(app.getHttpServer())
      .get('/marketplace/feed')
      .set('Cookie', [`${AUTH_COOKIE_NAME}=${olderUserSession.accessToken}`])
      .set('Origin', ALLOWED_ORIGIN);

    expect(olderRes.status).toBe(200);
    expect(olderRes.body.data.total).toBe(1);
    expect(olderRes.body.data.surveys[0].id).toBe('form-open');

    // ── 3. Authenticated Respondent with no demographic profile ─────────
    const newRespondentSession = await createTestUserWithSession(
      'new_user@example.com',
      'RESPONDENT',
    );

    const newRes = await request(app.getHttpServer())
      .get('/marketplace/feed')
      .set('Cookie', [
        `${AUTH_COOKIE_NAME}=${newRespondentSession.accessToken}`,
      ])
      .set('Origin', ALLOWED_ORIGIN);

    expect(newRes.status).toBe(200);
    expect(newRes.body.data.total).toBe(1);
    expect(newRes.body.data.surveys[0].id).toBe('form-open');
    expect(newRes.body.data.profileCompleted).toBe(false);
  });

  describe('Story 4.3: Feed Interactions (Sort/Filter/Auto-Hide) E2E', () => {
    const publisherId = '55555555-5555-4555-8555-555555555555';

    beforeEach(async () => {
      // Form 1: High reward, longer duration
      const f1 = new FormEntity(
        'form-high-reward',
        publisherId,
        'INTERNAL',
        'PUBLISHED',
        'In-Depth Consumer Research',
        'Comprehensive survey about online purchasing habits',
        80, // reward 80
        50,
        new Date('2026-09-10T00:00:00Z'),
        new Date('2026-09-10T00:00:00Z'),
      );
      const v1 = new FormVersionEntity(
        'v1',
        'form-high-reward',
        1,
        { metadata: { expectedEffortSeconds: 600 } } as any, // 10 min
        null,
        true,
        null,
        null,
        new Date('2026-09-10T00:00:00Z'),
        new Date('2026-09-10T00:00:00Z'),
      );
      await formRepo.create(f1, v1);

      // Form 2: Low reward, quick duration
      const f2 = new FormEntity(
        'form-fast-survey',
        publisherId,
        'INTERNAL',
        'PUBLISHED',
        'Quick Opinion Poll',
        'Short 2-question survey about morning coffee',
        15, // reward 15
        100,
        new Date('2026-09-01T00:00:00Z'),
        new Date('2026-09-01T00:00:00Z'),
      );
      const v2 = new FormVersionEntity(
        'v2',
        'form-fast-survey',
        1,
        { metadata: { expectedEffortSeconds: 60 } } as any, // 1 min
        null,
        true,
        null,
        null,
        new Date('2026-09-01T00:00:00Z'),
        new Date('2026-09-01T00:00:00Z'),
      );
      await formRepo.create(f2, v2);

      // Form 3: Medium reward & duration
      const f3 = new FormEntity(
        'form-medium-poll',
        publisherId,
        'EXTERNAL',
        'PUBLISHED',
        'Student Lifestyle Questionnaire',
        'Study conducted across universities',
        40, // reward 40
        100,
        new Date('2026-09-05T00:00:00Z'),
        new Date('2026-09-05T00:00:00Z'),
      );
      const v3 = new FormVersionEntity(
        'v3',
        'form-medium-poll',
        1,
        { metadata: { expectedEffortSeconds: 180 } } as any, // 3 min
        null,
        true,
        null,
        null,
        new Date('2026-09-05T00:00:00Z'),
        new Date('2026-09-05T00:00:00Z'),
      );
      await formRepo.create(f3, v3);
    });

    it('should automatically hide completed survey for the respondent who submitted it', async () => {
      const userA = await createTestUserWithSession('user_a@example.com');
      const userB = await createTestUserWithSession('user_b@example.com');

      // User A submits form-high-reward
      await responseRepo.recordResponse({
        formId: 'form-high-reward',
        respondentId: userA.user.id,
        status: 'SUBMITTED',
      });

      // User A views feed (default hideCompleted: true) -> form-high-reward is hidden!
      const resA = await request(app.getHttpServer())
        .get('/marketplace/feed')
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${userA.accessToken}`])
        .set('Origin', ALLOWED_ORIGIN);

      expect(resA.status).toBe(200);
      expect(resA.body.data.total).toBe(2);
      const idsA = resA.body.data.surveys.map((s: any) => s.id);
      expect(idsA).not.toContain('form-high-reward');
      expect(idsA).toContain('form-fast-survey');
      expect(idsA).toContain('form-medium-poll');

      // User B has not completed it -> sees all 3
      const resB = await request(app.getHttpServer())
        .get('/marketplace/feed')
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${userB.accessToken}`])
        .set('Origin', ALLOWED_ORIGIN);

      expect(resB.status).toBe(200);
      expect(resB.body.data.total).toBe(3);

      // User A views feed with hideCompleted=false -> sees all 3 with isCompletedByCurrentUser=true
      const resAWithCompleted = await request(app.getHttpServer())
        .get('/marketplace/feed?hideCompleted=false')
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${userA.accessToken}`])
        .set('Origin', ALLOWED_ORIGIN);

      expect(resAWithCompleted.status).toBe(200);
      expect(resAWithCompleted.body.data.total).toBe(3);
      const completedCard = resAWithCompleted.body.data.surveys.find(
        (s: any) => s.id === 'form-high-reward',
      );
      expect(completedCard.isCompletedByCurrentUser).toBe(true);
    });

    it('should sort feed surveys via HTTP query parameters', async () => {
      const user = await createTestUserWithSession('sort_user@example.com');

      // 1. Sort by reward descending
      const resRewardDesc = await request(app.getHttpServer())
        .get('/marketplace/feed?sortBy=reward_desc')
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${user.accessToken}`])
        .set('Origin', ALLOWED_ORIGIN);

      expect(resRewardDesc.status).toBe(200);
      const rewardIds = resRewardDesc.body.data.surveys.map((s: any) => s.id);
      expect(rewardIds).toEqual([
        'form-high-reward', // 80
        'form-medium-poll', // 40
        'form-fast-survey', // 15
      ]);

      // 2. Sort by duration ascending (shortest first)
      const resDurationAsc = await request(app.getHttpServer())
        .get('/marketplace/feed?sortBy=duration_asc')
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${user.accessToken}`])
        .set('Origin', ALLOWED_ORIGIN);

      expect(resDurationAsc.status).toBe(200);
      const durationIds = resDurationAsc.body.data.surveys.map(
        (s: any) => s.id,
      );
      expect(durationIds).toEqual([
        'form-fast-survey', // 60s
        'form-medium-poll', // 180s
        'form-high-reward', // 600s
      ]);
    });

    it('should filter surveys via search and type query parameters', async () => {
      const user = await createTestUserWithSession('filter_user@example.com');

      // Search keyword
      const searchRes = await request(app.getHttpServer())
        .get('/marketplace/feed?search=coffee')
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${user.accessToken}`])
        .set('Origin', ALLOWED_ORIGIN);

      expect(searchRes.status).toBe(200);
      expect(searchRes.body.data.total).toBe(1);
      expect(searchRes.body.data.surveys[0].id).toBe('form-fast-survey');

      // Type filter
      const typeRes = await request(app.getHttpServer())
        .get('/marketplace/feed?type=EXTERNAL')
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${user.accessToken}`])
        .set('Origin', ALLOWED_ORIGIN);

      expect(typeRes.status).toBe(200);
      expect(typeRes.body.data.total).toBe(1);
      expect(typeRes.body.data.surveys[0].id).toBe('form-medium-poll');
    });
  });
});
