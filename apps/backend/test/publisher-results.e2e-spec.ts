import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  publisherAnalyticsSchema,
  publisherFormVersionDetailSchema,
  publisherProgressSchema,
  publisherResponsesPageSchema,
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
import { PARTICIPATION_REPOSITORY_PORT } from '../src/modules/participation/application/ports/participation-repository.port';
import { InMemoryParticipationRepository } from '../src/modules/participation/infrastructure/in-memory-participation.repository';
import { PUBLISHER_RESPONSE_READ_PORT } from '../src/modules/participation/application/ports/publisher-response-read.port';
import { InMemoryPublisherResponseReadRepository } from '../src/modules/participation/infrastructure/in-memory-publisher-response-read.repository';
import { SessionService } from '../src/modules/auth/application/session.service';
import { EnvService } from '../src/common/config/env.service';
import { PrismaService } from '../src/common/database/prisma.service';
import { HttpExceptionFilter } from '../src/common/http/http-exception.filter';
import { AUTH_COOKIE_NAME } from '../src/modules/auth/presentation/cookie-options.helper';
import { FormEntity } from '../src/modules/forms/domain/form.entity';
import { FormVersionEntity } from '../src/modules/forms/domain/form-version.entity';
import { LEDGER_REPOSITORY_PORT } from '../src/modules/economy/application/ports/ledger-repository.port';
import { InMemoryLedgerRepository } from '../src/modules/economy/infrastructure/in-memory-ledger.repository';
import { NOTIFICATION_REPOSITORY_PORT } from '../src/modules/notifications/application/ports/notification-repository.port';
import { InMemoryNotificationRepository } from '../src/modules/notifications/infrastructure/in-memory-notification.repository';
import { ResponseEntity } from '../src/modules/participation/domain/response.entity';
import { SurveyAttemptEntity } from '../src/modules/participation/domain/survey-attempt.entity';

const FIXTURES = join(
  __dirname,
  '../../../packages/schemas/src/forms/__fixtures__/publisher-results',
);
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8'));

describe('Story IR.4a: Publisher progress and response viewing E2E (FR-39, FR-40)', () => {
  let app: INestApplication;
  let userRepo: InMemoryUserRepository;
  let formRepo: InMemoryFormRepository;
  let partRepo: InMemoryParticipationRepository;

  const TEST_JWT_SECRET = 'at_least_32_characters_super_secure_jwt_secret_key!';
  const ALLOWED_ORIGIN = 'http://localhost:3000';

  const ownerId = '21212121-2121-4121-8121-212121212121';
  const otherId = '31313131-3131-4131-8131-313131313131';
  const adminId = '41414141-4141-4141-8141-414141414141';
  const internalFormId = '51515151-5151-4151-8151-515151515151';
  const v1Id = '61616161-6161-4161-8161-616161616161';
  const v2Id = '62626262-6262-4262-8262-626262626262';
  const externalFormId = '71717171-7171-4171-8171-717171717171';
  const externalVersionId = '72727272-7272-4272-8272-727272727272';

  const cookies: Record<'owner' | 'other' | 'admin', string> = {
    owner: '',
    other: '',
    admin: '',
  };

  const blocks = [
    { id: 'q-name', type: 'text', title: 'Tên', order: 0, required: true },
    {
      id: 'q-rate',
      type: 'rating',
      title: 'Chấm',
      order: 1,
      required: false,
      maxRating: 5,
    },
  ];

  const get = (path: string, who: keyof typeof cookies | null = 'owner') => {
    const call = request(app.getHttpServer()).get(path);
    return who ? call.set('Cookie', cookies[who]) : call;
  };

  function addResponse(versionId: string, submittedAt: Date, rating = 4) {
    const attemptId = randomUUID();
    partRepo.attempts.set(
      attemptId,
      new SurveyAttemptEntity(
        attemptId,
        internalFormId,
        versionId,
        otherId,
        'COMPLETED',
        false,
        new Date(submittedAt.getTime() - 120_000),
        submittedAt,
        null,
        submittedAt,
        submittedAt,
      ),
    );
    const id = randomUUID();
    partRepo.responses.set(
      id,
      new ResponseEntity(
        id,
        internalFormId,
        versionId,
        attemptId,
        otherId,
        'VALIDATED',
        { 'q-name': 'An', 'q-rate': rating },
        '198.51.100.7',
        false,
        submittedAt,
        submittedAt,
        submittedAt,
      ),
    );
    return id;
  }

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ||
      'postgresql://postgres:postgres@localhost:5433/rescom_test';

    userRepo = new InMemoryUserRepository();
    const auditRepo = new InMemoryIdentityAuditRepository();
    const sessionRepo = new InMemorySessionRepository(auditRepo);
    formRepo = new InMemoryFormRepository();
    partRepo = new InMemoryParticipationRepository();

    const envService = new EnvService({
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
      .overrideProvider(PARTICIPATION_REPOSITORY_PORT)
      .useValue(partRepo)
      .overrideProvider(PUBLISHER_RESPONSE_READ_PORT)
      .useValue(new InMemoryPublisherResponseReadRepository(partRepo))
      .overrideProvider(LEDGER_REPOSITORY_PORT)
      .useValue(new InMemoryLedgerRepository())
      .overrideProvider(NOTIFICATION_REPOSITORY_PORT)
      .useValue(new InMemoryNotificationRepository())
      .overrideProvider(EnvService)
      .useValue(envService)
      .compile();

    const sessionService = moduleFixture.get(SessionService);
    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    for (const [id, who, role] of [
      [ownerId, 'owner', 'PUBLISHER'],
      [otherId, 'other', 'RESPONDENT'],
      [adminId, 'admin', 'ADMIN'],
    ] as const) {
      await userRepo.create({
        id,
        email: `${who}.results@rescom.test`,
        passwordHash: 'hash',
        role,
        status: 'ACTIVE',
      });
      const session = await sessionService.createSession(id);
      cookies[who] = `${AUTH_COOKIE_NAME}=${session.accessToken}`;
    }

    const version = (
      id: string,
      formId: string,
      number: number,
      externalUrl: string | null = null,
    ) =>
      new FormVersionEntity(
        id,
        formId,
        number,
        { title: 'Survey', blocks } as any,
        null,
        true,
        externalUrl,
        'stored-verifier',
        new Date('2026-09-02T00:00:00Z'),
        new Date('2026-09-01T00:00:00Z'),
      );
    const form = (id: string, type: 'INTERNAL' | 'EXTERNAL') =>
      new FormEntity(
        id,
        ownerId,
        type,
        'PUBLISHED',
        `${type} results survey`,
        null,
        0,
        100,
        new Date('2026-09-01T00:00:00Z'),
        new Date('2026-09-01T00:00:00Z'),
      );
    await formRepo.create(
      form(internalFormId, 'INTERNAL'),
      version(v1Id, internalFormId, 1),
    );
    await formRepo.createVersion(
      internalFormId,
      v2Id,
      new Date('2026-09-10T00:00:00Z'),
      {
        isPublished: true,
        publishedAt: new Date('2026-09-10T00:00:00Z'),
        expectedStatus: 'PUBLISHED',
      },
    );
    await formRepo.create(
      form(externalFormId, 'EXTERNAL'),
      version(
        externalVersionId,
        externalFormId,
        1,
        'https://docs.google.com/forms/d/e/results/viewform',
      ),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    partRepo.responses.clear();
    partRepo.attempts.clear();
  });

  it('the golden fixtures parse with the shared schemas (contract test, backend half)', () => {
    expect(() =>
      publisherProgressSchema.parse(fixture('progress')),
    ).not.toThrow();
    for (const name of [
      'responses-page-1',
      'responses-page-2',
      'responses-not-applicable',
    ]) {
      expect(() =>
        publisherResponsesPageSchema.parse(fixture(name)),
      ).not.toThrow();
    }
    expect(() =>
      publisherAnalyticsSchema.parse(fixture('analytics')),
    ).not.toThrow();
    expect(() =>
      publisherFormVersionDetailSchema.parse(fixture('version-detail')),
    ).not.toThrow();
  });

  describe('GET /forms/:id/progress', () => {
    it('owner: 200 with the shared shape, never cached', async () => {
      const res = await get(
        `/forms/${internalFormId}/progress?range=week`,
      ).expect(200);
      const progress = publisherProgressSchema.parse(res.body.data);
      expect(progress).toMatchObject({
        formId: internalFormId,
        status: 'PUBLISHED',
        expected: 100,
        pendingAttempts: null,
      });
      expect(progress.completionsSeries.buckets).toHaveLength(4);
      expect(res.headers['cache-control']).toBe('private, no-store');
      const external = await get(
        `/api/forms/${externalFormId}/progress`,
      ).expect(200);
      expect(
        publisherProgressSchema.parse(external.body.data).pendingAttempts,
      ).toBe(0);
    });

    it('non-owner and Admin: 404 FORM_NOT_FOUND; unauthenticated 401; bad id / range 400', async () => {
      for (const who of ['other', 'admin'] as const) {
        const res = await get(`/forms/${internalFormId}/progress`, who).expect(
          404,
        );
        expect(res.body.error.code).toBe('FORM_NOT_FOUND');
      }
      await get(`/forms/${internalFormId}/progress`, null).expect(401);
      expect(
        (await get('/forms/not-a-uuid/progress').expect(400)).body.error.code,
      ).toBe('VALIDATION_ERROR');
      expect(
        (await get(`/forms/${internalFormId}/progress?range=year`).expect(400))
          .body.error.code,
      ).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /forms/:id/responses', () => {
    it('empty version: AVAILABLE with no rows', async () => {
      const res = await get(`/forms/${internalFormId}/responses`).expect(200);
      expect(publisherResponsesPageSchema.parse(res.body.data)).toMatchObject({
        availability: 'AVAILABLE',
        totalCount: 0,
        responses: [],
        nextCursor: null,
      });
      expect(res.headers['cache-control']).toBe('private, no-store');
    });

    it('walks the pages with the cursor; v1 and v2 are disjoint', async () => {
      const v1Rows = [0, 1, 2, 3, 4].map((index) =>
        addResponse(v1Id, new Date(Date.UTC(2026, 8, 5, index))),
      );
      const v2Row = addResponse(v2Id, new Date(Date.UTC(2026, 8, 12)));
      const seen: string[] = [];
      let path = `/forms/${internalFormId}/responses?versionNumber=1&limit=2`;
      for (let guard = 0; guard < 5; guard += 1) {
        const page = publisherResponsesPageSchema.parse(
          (await get(path).expect(200)).body.data,
        );
        if (page.availability !== 'AVAILABLE') throw new Error('expected rows');
        expect(page.totalCount).toBe(5);
        seen.push(...page.responses.map((row) => row.id));
        if (!page.nextCursor) break;
        path = `/forms/${internalFormId}/responses?versionNumber=1&limit=2&cursor=${encodeURIComponent(page.nextCursor)}`;
      }
      expect(seen).toEqual([...v1Rows].reverse());
      const v2 = publisherResponsesPageSchema.parse(
        (await get(`/forms/${internalFormId}/responses`).expect(200)).body.data,
      );
      expect(
        v2.availability === 'AVAILABLE' && v2.responses.map((row) => row.id),
      ).toEqual([v2Row]);
      expect(JSON.stringify(v2)).not.toContain('198.51.100.7');
    });

    it('400 for a bad limit or cursor; 404 for an unknown version; NOT_APPLICABLE for Google Forms', async () => {
      expect(
        (await get(`/forms/${internalFormId}/responses?limit=101`).expect(400))
          .body.error.code,
      ).toBe('VALIDATION_ERROR');
      expect(
        (
          await get(`/forms/${internalFormId}/responses?cursor=garbage`).expect(
            400,
          )
        ).body.error.code,
      ).toBe('INVALID_CURSOR');
      // A well-formed token with forged, non-UUID ids is refused before SQL (400, never 500).
      const forged = Buffer.from(
        JSON.stringify({
          v: 1,
          versionId: v1Id,
          submittedAt: '2026-09-05T00:00:00.000Z',
          id: "x' OR 1=1",
        }),
      ).toString('base64url');
      expect(
        (
          await get(
            `/forms/${internalFormId}/responses?versionNumber=1&cursor=${forged}`,
          ).expect(400)
        ).body.error.code,
      ).toBe('INVALID_CURSOR');
      expect(
        (
          await get(
            `/forms/${internalFormId}/responses?versionNumber=7`,
          ).expect(404)
        ).body.error.code,
      ).toBe('FORM_VERSION_NOT_FOUND');
      const external = await get(`/forms/${externalFormId}/responses`).expect(
        200,
      );
      expect(
        publisherResponsesPageSchema.parse(external.body.data),
      ).toMatchObject({
        availability: 'NOT_APPLICABLE',
        reason: 'EXTERNAL_FORM',
      });
    });

    it('non-owner and Admin: 404; unauthenticated: 401', async () => {
      for (const who of ['other', 'admin'] as const) {
        expect(
          (await get(`/forms/${internalFormId}/responses`, who).expect(404))
            .body.error.code,
        ).toBe('FORM_NOT_FOUND');
      }
      await get(`/forms/${internalFormId}/responses`, null).expect(401);
    });
  });

  describe('GET /forms/:id/analytics', () => {
    it('owner: per-question summary of one version; Admin 404', async () => {
      addResponse(v1Id, new Date(Date.UTC(2026, 8, 5)), 5);
      addResponse(v1Id, new Date(Date.UTC(2026, 8, 6)), 3);
      const res = await get(`/forms/${internalFormId}/analytics`).expect(200);
      const analytics = publisherAnalyticsSchema.parse(res.body.data);
      if (analytics.availability !== 'AVAILABLE')
        throw new Error('expected rows');
      expect(analytics.form.versionNumber).toBe(1);
      expect(analytics.totalResponses).toBe(2);
      const rating = analytics.questions.find(
        (question) => question.questionId === 'q-rate',
      );
      expect(rating?.summary.kind === 'scale' && rating.summary.average).toBe(
        4,
      );
      expect(res.headers['cache-control']).toBe('private, no-store');
      await get(`/forms/${internalFormId}/analytics`, 'admin').expect(404);
      expect(
        publisherAnalyticsSchema.parse(
          (await get(`/forms/${externalFormId}/analytics`).expect(200)).body
            .data,
        ).availability,
      ).toBe('NOT_APPLICABLE');
    });
  });

  describe('GET /forms/:id/versions/:versionId', () => {
    it('owner: the stored definition, no completion code; another form’s version 404', async () => {
      const res = await get(`/forms/${internalFormId}/versions/${v1Id}`).expect(
        200,
      );
      const detail = publisherFormVersionDetailSchema.parse(res.body.data);
      expect(detail).toMatchObject({ id: v1Id, versionNumber: 1 });
      expect(JSON.stringify(res.body)).not.toContain('stored-verifier');
      expect(
        (
          await get(
            `/forms/${internalFormId}/versions/${externalVersionId}`,
          ).expect(404)
        ).body.error.code,
      ).toBe('FORM_VERSION_NOT_FOUND');
      await get(`/forms/${internalFormId}/versions/${v1Id}`, 'admin').expect(
        404,
      );
      await get(`/forms/${internalFormId}/versions/nope`).expect(400);
    });

    it('the versions list keeps its semantics (owner 200, list route not shadowed)', async () => {
      const res = await get(`/forms/${internalFormId}/versions`).expect(200);
      expect(
        res.body.data.map(
          (item: { versionNumber: number }) => item.versionNumber,
        ),
      ).toEqual([1, 2]);
    });
  });

  it('regression (R9): GET /forms/:id still answers 403 to a non-owner and 200 to an Admin', async () => {
    expect(
      (await get(`/forms/${internalFormId}`, 'other').expect(403)).body.error
        .code,
    ).toBe('FORM_FORBIDDEN');
    const admin = await get(`/forms/${internalFormId}`, 'admin').expect(200);
    expect(admin.body.data).toMatchObject({
      submittedAt: null,
      closedAt: null,
      rejection: null,
    });
  });
});
