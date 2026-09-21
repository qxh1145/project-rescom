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

describe('Story 5.1: Survey Attempt Initialization & Concurrency E2E Tests', () => {
  let app: INestApplication;
  let userRepo: InMemoryUserRepository;
  let sessionRepo: InMemorySessionRepository;
  let auditRepo: InMemoryIdentityAuditRepository;
  let formRepo: InMemoryFormRepository;
  let demoRepo: InMemoryDemographicProfileRepository;
  let partRepo: InMemoryParticipationRepository;
  let sessionService: SessionService;
  let envService: EnvService;

  const TEST_JWT_SECRET = 'at_least_32_characters_super_secure_jwt_secret_key!';
  const ALLOWED_ORIGIN = 'http://localhost:3000';

  const publisherId = '22222222-2222-4222-8222-222222222222';
  const internalFormId = '33333333-3333-4333-8333-333333333333';
  const externalFormId = '44444444-4444-4444-8444-444444444444';

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

    const user = await userRepo.create({
      email: 'respondent@rescom.test',
      passwordHash: '$2a$12$someHashedPassword',
      role: 'RESPONDENT',
      status: 'ACTIVE',
    });
    respondentUserId = user.id;

    const tokens = await sessionService.createSession(user.id);
    authCookie = `${AUTH_COOKIE_NAME}=${tokens.accessToken}`;
    csrfToken = tokens.csrfToken;

    // Set respondent demographic profile: Age 22, Hanoi
    await demoRepo.upsert(respondentUserId, {
      age: 22,
      gender: 'MALE',
      location: 'Hanoi',
    });

    const now = new Date();

    // 1. Published Internal Form
    const internalForm = new FormEntity(
      internalFormId,
      publisherId,
      'INTERNAL',
      'PUBLISHED',
      'Campus Food Survey',
      'Internal survey about cafeteria',
      20,
      10,
      now,
      now,
    );
    const internalVersion = new FormVersionEntity(
      'ver-internal-1',
      internalFormId,
      1,
      { title: 'Campus Food Survey', blocks: [] } as any,
      null, // open targeting
      true,
      null,
      null,
      now,
      now,
    );
    await formRepo.create(internalForm, internalVersion);

    // 2. Published External Form
    const externalForm = new FormEntity(
      externalFormId,
      publisherId,
      'EXTERNAL',
      'PUBLISHED',
      'External Google Form Survey',
      'External research questionnaire',
      30,
      5,
      now,
      now,
    );
    const externalVersion = new FormVersionEntity(
      'ver-external-1',
      externalFormId,
      1,
      { title: 'External Survey', blocks: [] } as any,
      null,
      true,
      'https://docs.google.com/forms/d/e/sample-form/viewform',
      null,
      now,
      now,
    );
    await formRepo.create(externalForm, externalVersion);
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /forms/:id/attempts — initializes INTERNAL attempt with durable Response identity', async () => {
    const res = await request(app.getHttpServer())
      .post(`/forms/${internalFormId}/attempts`)
      .set('Cookie', [authCookie])
      .set('Origin', ALLOWED_ORIGIN)
      .set('x-csrf-token', csrfToken)
      .send({ clientContext: { device: 'desktop' } });

    expect(res.status).toBe(201);
    expect(res.body.error).toBeNull();
    const data = res.body.data;
    expect(data.attemptId).toBeDefined();
    expect(data.responseId).toBeDefined();
    expect(data.formId).toBe(internalFormId);
    expect(data.type).toBe('INTERNAL');
    expect(data.status).toBe('IN_PROGRESS');
    expect(data.externalUrl).toBeNull();
    expect(data.expiresAt).toBeDefined();
  });

  it('POST /forms/:id/attempts — rejects with 409 CONFLICTING_ACTIVE_ATTEMPT if attempt is active', async () => {
    const res = await request(app.getHttpServer())
      .post(`/forms/${internalFormId}/attempts`)
      .set('Cookie', [authCookie])
      .set('Origin', ALLOWED_ORIGIN)
      .set('x-csrf-token', csrfToken)
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICTING_ACTIVE_ATTEMPT');
  });

  it('POST /forms/:id/attempts — initializes EXTERNAL attempt with null responseId and externalUrl', async () => {
    const res = await request(app.getHttpServer())
      .post(`/forms/${externalFormId}/attempts`)
      .set('Cookie', [authCookie])
      .set('Origin', ALLOWED_ORIGIN)
      .set('x-csrf-token', csrfToken)
      .send({});

    expect(res.status).toBe(201);
    expect(res.body.error).toBeNull();
    const data = res.body.data;
    expect(data.attemptId).toBeDefined();
    expect(data.responseId).toBeNull();
    expect(data.type).toBe('EXTERNAL');
    expect(data.externalUrl).toBe(
      'https://docs.google.com/forms/d/e/sample-form/viewform',
    );
  });

  it('POST /surveys/:id/attempts — supports survey alias route identically', async () => {
    const customFormId = '55555555-5555-4555-8555-555555555555';
    const now = new Date();
    const form = new FormEntity(
      customFormId,
      publisherId,
      'INTERNAL',
      'PUBLISHED',
      'Alias Test Survey',
      null,
      10,
      10,
      now,
      now,
    );
    const version = new FormVersionEntity(
      'ver-custom-1',
      customFormId,
      1,
      { title: 'Alias', blocks: [] } as any,
      null,
      true,
      null,
      null,
      now,
      now,
    );
    await formRepo.create(form, version);

    const res = await request(app.getHttpServer())
      .post(`/surveys/${customFormId}/attempts`)
      .set('Cookie', [authCookie])
      .set('Origin', ALLOWED_ORIGIN)
      .set('x-csrf-token', csrfToken)
      .send({});

    expect(res.status).toBe(201);
    expect(res.body.data.formId).toBe(customFormId);
    expect(res.body.data.responseId).toBeDefined();
  });

  it('POST /forms/:id/attempts — rejects with 403 PARTICIPANT_NOT_ELIGIBLE on targeting mismatch', async () => {
    const restrictedFormId = '66666666-6666-4666-8666-666666666666';
    const now = new Date();
    const form = new FormEntity(
      restrictedFormId,
      publisherId,
      'INTERNAL',
      'PUBLISHED',
      'Restricted Survey',
      null,
      10,
      10,
      now,
      now,
    );
    const version = new FormVersionEntity(
      'ver-restricted-1',
      restrictedFormId,
      1,
      { title: 'Restricted', blocks: [] } as any,
      { locations: ['Ho Chi Minh City'] } as any, // user is in Hanoi!
      true,
      null,
      null,
      now,
      now,
    );
    await formRepo.create(form, version);

    const res = await request(app.getHttpServer())
      .post(`/forms/${restrictedFormId}/attempts`)
      .set('Cookie', [authCookie])
      .set('Origin', ALLOWED_ORIGIN)
      .set('x-csrf-token', csrfToken)
      .send({});

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PARTICIPANT_NOT_ELIGIBLE');
  });

  it('POST /forms/:id/attempts — rejects with 404 SURVEY_NOT_AVAILABLE if form not found or draft', async () => {
    const res = await request(app.getHttpServer())
      .post(`/forms/00000000-0000-4000-8000-000000000000/attempts`)
      .set('Cookie', [authCookie])
      .set('Origin', ALLOWED_ORIGIN)
      .set('x-csrf-token', csrfToken)
      .send({});

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('SURVEY_NOT_AVAILABLE');
  });
});
