import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { FORM_REPOSITORY_PORT } from '../src/modules/forms/application/ports/form-repository.port';
import { InMemoryFormRepository } from '../src/modules/forms/infrastructure/in-memory-form.repository';
import { SURVEY_RESPONSE_REPOSITORY_PORT } from '../src/modules/marketplace/application/ports/survey-response.repository.port';
import { InMemorySurveyResponseRepository } from '../src/modules/marketplace/infrastructure/in-memory-survey-response.repository';
import { GuestSubmissionRateLimiter } from '../src/modules/forms/infrastructure/guest-submission-rate-limiter';
import { EnvService } from '../src/common/config/env.service';
import { PrismaService } from '../src/common/database/prisma.service';
import { HttpExceptionFilter } from '../src/common/http/http-exception.filter';
import { FormEntity } from '../src/modules/forms/domain/form.entity';
import { FormVersionEntity } from '../src/modules/forms/domain/form-version.entity';

describe('Story 4.4: Public Link & Guest Submissions E2E Tests', () => {
  let app: INestApplication;
  let formRepo: InMemoryFormRepository;
  let responseRepo: InMemorySurveyResponseRepository;
  let rateLimiter: GuestSubmissionRateLimiter;
  let envService: EnvService;

  const TEST_JWT_SECRET = 'at_least_32_characters_super_secure_jwt_secret_key!';
  const ALLOWED_ORIGIN = 'http://localhost:3000';
  const publisherId = '55555555-5555-4555-8555-555555555555';
  const publicFormId = '11111111-1111-4111-8111-111111111111';
  const privateFormId = '22222222-2222-4222-8222-222222222222';
  const draftFormId = '33333333-3333-4333-8333-333333333333';

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ||
      'postgresql://postgres:postgres@localhost:5433/rescom_test';

    formRepo = new InMemoryFormRepository();
    responseRepo = new InMemorySurveyResponseRepository();
    rateLimiter = new GuestSubmissionRateLimiter({
      limit: 3,
      windowMs: 60000,
    });

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
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(mockPrisma)
      .overrideProvider(FORM_REPOSITORY_PORT)
      .useValue(formRepo)
      .overrideProvider(SURVEY_RESPONSE_REPOSITORY_PORT)
      .useValue(responseRepo)
      .overrideProvider(GuestSubmissionRateLimiter)
      .useValue(rateLimiter)
      .overrideProvider(EnvService)
      .useValue(envService)
      .compile();

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

  beforeEach(async () => {
    formRepo.clear();
    responseRepo.clear();
    rateLimiter.clear();

    const now = new Date();

    // 1. Published Internal Public Form
    const pubForm = new FormEntity(
      publicFormId,
      publisherId,
      'INTERNAL',
      'PUBLISHED',
      'Citizen Feedback Form',
      'A survey open to all visitors',
      25,
      200,
      now,
      now,
    );
    const pubVer = new FormVersionEntity(
      'ver-pub-1',
      publicFormId,
      1,
      {
        blocks: [
          {
            id: 'name_block',
            type: 'text',
            title: 'Your Full Name',
            required: true,
            order: 0,
          },
          {
            id: 'score_block',
            type: 'number',
            title: 'Service Rating',
            required: false,
            order: 1,
          },
        ],
        settings: {
          requireAuth: false,
          allowPublicAccess: true,
          submitButtonText: 'Submit Opinion',
        },
      } as any,
      null,
      true,
      null,
      null,
      now,
      now,
    );
    await formRepo.create(pubForm, pubVer);

    // 2. Published Internal Private Form (requireAuth: true)
    const privForm = new FormEntity(
      privateFormId,
      publisherId,
      'INTERNAL',
      'PUBLISHED',
      'Confidential Member Survey',
      'Members only',
      10,
      50,
      now,
      now,
    );
    const privVer = new FormVersionEntity(
      'ver-priv-1',
      privateFormId,
      1,
      {
        blocks: [
          {
            id: 'q1',
            type: 'text',
            title: 'Member Token',
            required: true,
            order: 0,
          },
        ],
        settings: {
          requireAuth: true,
          allowPublicAccess: false,
        },
      } as any,
      null,
      true,
      null,
      null,
      now,
      now,
    );
    await formRepo.create(privForm, privVer);

    // 3. Draft Form
    const draftForm = new FormEntity(
      draftFormId,
      publisherId,
      'INTERNAL',
      'DRAFT',
      'Unfinished Form',
      null,
      10,
      50,
      now,
      now,
    );
    const draftVer = new FormVersionEntity(
      'ver-draft-1',
      draftFormId,
      1,
      { blocks: [] } as any,
      null,
      false,
      null,
      null,
      now,
      now,
    );
    await formRepo.create(draftForm, draftVer);
  });

  describe('GET /public/forms/:id', () => {
    it('should return public form details without authentication', async () => {
      const res = await request(app.getHttpServer())
        .get(`/public/forms/${publicFormId}`)
        .set('Origin', ALLOWED_ORIGIN);

      expect(res.status).toBe(200);
      expect(res.body.error).toBeNull();
      expect(res.body.data.id).toBe(publicFormId);
      expect(res.body.data.title).toBe('Citizen Feedback Form');
      expect(res.body.data.blocks).toHaveLength(2);
      expect(res.body.data.settings.allowPublicAccess).toBe(true);
    });

    it('should reject draft form with 404', async () => {
      const res = await request(app.getHttpServer())
        .get(`/public/forms/${draftFormId}`)
        .set('Origin', ALLOWED_ORIGIN);

      expect(res.status).toBe(404);
    });

    it('should reject private form requiring auth with 403', async () => {
      const res = await request(app.getHttpServer())
        .get(`/public/forms/${privateFormId}`)
        .set('Origin', ALLOWED_ORIGIN);

      expect(res.status).toBe(403);
    });
  });

  describe('POST /public/forms/:id/submissions', () => {
    it('should allow unauthenticated guest to submit response', async () => {
      const res = await request(app.getHttpServer())
        .post(`/public/forms/${publicFormId}/submissions`)
        .set('Origin', ALLOWED_ORIGIN)
        .set('X-Forwarded-For', '203.0.113.195')
        .send({
          answers: {
            name_block: 'John Guest',
            score_block: 10,
          },
          captchaToken: 'test-turnstile-token',
        });

      expect(res.status).toBe(201);
      expect(res.body.error).toBeNull();
      expect(res.body.data.submissionId).toBeDefined();
      expect(res.body.data.formId).toBe(publicFormId);
      expect(res.body.data.status).toBe('SUBMITTED');
      expect(res.body.data.isGuest).toBe(true);
      expect(res.body.data.rewardEarned).toBe(0);
      expect(res.body.data.respondentReliability).toBe('NOT_AVAILABLE');
      expect(res.body.data.integrityStatus).toBe('ASSESSED');
    });

    it('should reject submission with missing captchaToken with 400', async () => {
      const res = await request(app.getHttpServer())
        .post(`/public/forms/${publicFormId}/submissions`)
        .set('Origin', ALLOWED_ORIGIN)
        .send({
          answers: {
            name_block: 'John Guest',
          },
        });

      expect(res.status).toBe(400);
    });

    it('should reject submission with invalid captchaToken with 400', async () => {
      const res = await request(app.getHttpServer())
        .post(`/public/forms/${publicFormId}/submissions`)
        .set('Origin', ALLOWED_ORIGIN)
        .send({
          answers: {
            name_block: 'John Guest',
          },
          captchaToken: 'invalid-captcha-token',
        });

      expect(res.status).toBe(400);
    });

    it('should reject submission missing required answer with 400', async () => {
      const res = await request(app.getHttpServer())
        .post(`/public/forms/${publicFormId}/submissions`)
        .set('Origin', ALLOWED_ORIGIN)
        .send({
          answers: {
            score_block: 5,
          },
          captchaToken: 'test-turnstile-token',
        });

      expect(res.status).toBe(400);
    });

    it('should enforce strict IP rate limit after 3 submissions (429)', async () => {
      const clientIp = '198.51.100.42';

      for (let i = 0; i < 3; i++) {
        const res = await request(app.getHttpServer())
          .post(`/public/forms/${publicFormId}/submissions`)
          .set('Origin', ALLOWED_ORIGIN)
          .set('X-Forwarded-For', clientIp)
          .send({
            answers: {
              name_block: `Guest ${i}`,
            },
            captchaToken: 'test-turnstile-token',
          });
        expect(res.status).toBe(201);
      }

      // 4th submission from same IP
      const fourthRes = await request(app.getHttpServer())
        .post(`/public/forms/${publicFormId}/submissions`)
        .set('Origin', ALLOWED_ORIGIN)
        .set('X-Forwarded-For', clientIp)
        .send({
          answers: {
            name_block: 'Guest Over Limit',
          },
          captchaToken: 'test-turnstile-token',
        });

      expect(fourthRes.status).toBe(429);
    });
  });
});
