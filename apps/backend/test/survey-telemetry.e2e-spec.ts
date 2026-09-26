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
import { SurveyAttemptEntity } from '../src/modules/participation/domain/survey-attempt.entity';
import { ResponseEntity } from '../src/modules/participation/domain/response.entity';

describe('Story 5.2: Behavioral Telemetry Ingestion E2E Tests', () => {
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
  const formId = '33333333-3333-4333-8333-333333333333';
  const formVersionId = '55555555-5555-4555-8555-555555555555';
  const attemptId = '66666666-6666-4666-8666-666666666666';
  const responseId = '77777777-7777-4777-8777-777777777777';

  let authCookie: string;
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
    app.setGlobalPrefix('api');

    await app.init();

    // Create respondent user
    const user = await userRepo.create({
      email: 'telemetry_tester@rescom.test',
      passwordHash: 'dummy-hash',
      role: 'RESPONDENT',
      status: 'ACTIVE',
    });
    respondentUserId = user.id;

    // Create session token
    const loginResult = await sessionService.createSession(user.id);
    authCookie = `${AUTH_COOKIE_NAME}=${loginResult.accessToken}; Path=/; HttpOnly`;

    // Seed published form & version
    const form = new FormEntity(
      formId,
      publisherId,
      'INTERNAL',
      'PUBLISHED',
      'Telemetry Survey',
      'Testing telemetry capture',
      25,
      50,
      new Date(),
      new Date(),
    );
    const version = new FormVersionEntity(
      formVersionId,
      formId,
      1,
      {
        title: 'Telemetry Survey',
        blocks: [
          { id: 'q1', type: 'text', title: 'Question 1', required: true },
        ],
      } as any,
      null,
      true,
      null,
      null,
      new Date(),
      new Date(),
    );
    await formRepo.create(form, version);

    // Seed attempt
    const attempt = new SurveyAttemptEntity(
      attemptId,
      formId,
      formVersionId,
      respondentUserId,
      'IN_PROGRESS',
      false,
      new Date(),
      null,
      null,
      new Date(),
      new Date(),
    );
    partRepo.attempts.set(attemptId, attempt);

    // Seed response
    const response = new ResponseEntity(
      responseId,
      formId,
      formVersionId,
      attemptId,
      respondentUserId,
      'IN_PROGRESS',
      null,
      '127.0.0.1',
      false,
      null,
      new Date(),
      new Date(),
    );
    partRepo.responses.set(responseId, response);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/forms/:id/attempts/:attemptId/integrity-events', () => {
    const clientEventId1 = '88888888-8888-4888-8888-888888888881';
    const clientEventId2 = '88888888-8888-4888-8888-888888888882';

    it('should ingest a batch of valid behavioral events and return 200 with count', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/forms/${formId}/attempts/${attemptId}/integrity-events`)
        .set('Cookie', [authCookie])
        .send({
          events: [
            {
              clientEventId: clientEventId1,
              eventType: 'QUESTION_SHOWN',
              attemptId,
              formVersionId,
              questionId: 'q1',
              occurredAt: new Date().toISOString(),
              metadata: {
                dwellTimeMs: 1200,
              },
            },
            {
              clientEventId: clientEventId2,
              eventType: 'ANSWER_SELECTED',
              attemptId,
              formVersionId,
              questionId: 'q1',
              occurredAt: new Date().toISOString(),
            },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.data.success).toBe(true);
      expect(res.body.data.ingestedCount).toBe(2);
      expect(res.body.data.attemptId).toBe(attemptId);
    });

    it('should deduplicate already recorded events idempotently without throwing', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/forms/${formId}/attempts/${attemptId}/integrity-events`)
        .set('Cookie', [authCookie])
        .send({
          events: [
            {
              clientEventId: clientEventId1, // already saved
              eventType: 'QUESTION_SHOWN',
              attemptId,
              formVersionId,
              occurredAt: new Date().toISOString(),
            },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.data.success).toBe(true);
      expect(res.body.data.ingestedCount).toBe(0); // duplicate skipped
    });

    it('should reject privacy-violating payloads containing keystroke tracking', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/forms/${formId}/attempts/${attemptId}/integrity-events`)
        .set('Cookie', [authCookie])
        .send({
          events: [
            {
              clientEventId: '99999999-9999-4999-8999-999999999999',
              eventType: 'ANSWER_ENTERED',
              attemptId,
              formVersionId,
              occurredAt: new Date().toISOString(),
              metadata: {
                keystrokes: 'Secret user input',
              },
            },
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it('should return 404 if attempt does not match form', async () => {
      const otherFormId = '99999999-9999-4999-8999-000000000000';
      const res = await request(app.getHttpServer())
        .post(
          `/api/forms/${otherFormId}/attempts/${attemptId}/integrity-events`,
        )
        .set('Cookie', [authCookie])
        .send({
          events: [
            {
              clientEventId: '12345678-1234-4234-8234-123456789012',
              eventType: 'PAGE_VISIBLE',
              attemptId,
              formVersionId,
              occurredAt: new Date().toISOString(),
            },
          ],
        });

      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/responses/:responseId/integrity-events', () => {
    it('should ingest telemetry through responseId route', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/responses/${responseId}/integrity-events`)
        .set('Cookie', [authCookie])
        .send({
          events: [
            {
              clientEventId: '33333333-4444-4444-8444-555555555555',
              eventType: 'PAGE_HIDDEN',
              attemptId,
              formVersionId,
              responseId,
              occurredAt: new Date().toISOString(),
            },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.data.success).toBe(true);
      expect(res.body.data.ingestedCount).toBe(1);
    });

    it('should return 404 for missing responseId', async () => {
      const missingResponseId = '00000000-0000-4000-8000-000000000000';
      const res = await request(app.getHttpServer())
        .post(`/api/responses/${missingResponseId}/integrity-events`)
        .set('Cookie', [authCookie])
        .send({
          events: [
            {
              clientEventId: '33333333-4444-4444-8444-666666666666',
              eventType: 'PAGE_HIDDEN',
              attemptId,
              formVersionId,
              occurredAt: new Date().toISOString(),
            },
          ],
        });

      expect(res.status).toBe(404);
    });
  });
});
