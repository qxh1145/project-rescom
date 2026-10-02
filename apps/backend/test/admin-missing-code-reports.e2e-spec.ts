import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { missingCodeReportPageSchema } from '@rescom/schemas';
import { AppModule } from '../src/app.module';
import { USER_REPOSITORY_PORT } from '../src/modules/users/application/ports/user.repository.port';
import { InMemoryUserRepository } from '../src/modules/users/infrastructure/in-memory-user.repository';
import { SESSION_REPOSITORY_PORT } from '../src/modules/auth/application/ports/session-repository.port';
import { InMemorySessionRepository } from '../src/modules/auth/infrastructure/in-memory-session.repository';
import { IDENTITY_AUDIT_PORT } from '../src/modules/auth/application/ports/identity-audit.port';
import { InMemoryIdentityAuditRepository } from '../src/modules/auth/infrastructure/in-memory-identity-audit.repository';
import { USER_PROFILE_REPOSITORY_PORT } from '../src/modules/users/application/ports/user-profile.repository.port';
import { InMemoryUserProfileRepository } from '../src/modules/users/infrastructure/in-memory-user-profile.repository';
import { FORM_TITLE_LOOKUP_PORT } from '../src/modules/forms/application/ports/form-title-lookup.port';
import { InMemoryFormAdminReads } from '../src/modules/forms/infrastructure/in-memory-form-admin-reads';
import { MISSING_CODE_REPORT_STATS_PORT } from '../src/modules/participation/application/ports/missing-code-report-stats.port';
import { InMemoryMissingCodeReportStats } from '../src/modules/participation/infrastructure/in-memory-missing-code-report-stats';
import { SessionService } from '../src/modules/auth/application/session.service';
import { EnvService } from '../src/common/config/env.service';
import { PrismaService } from '../src/common/database/prisma.service';
import { HttpExceptionFilter } from '../src/common/http/http-exception.filter';
import { AUTH_COOKIE_NAME } from '../src/modules/auth/presentation/cookie-options.helper';

/**
 * `GET /admin/missing-code-reports` (FR-23, read only): both prefixes, the
 * ADMIN guard, query validation, keyset pagination and responses parsed with
 * the shared `missingCodeReportPageSchema`.
 */
describe('Admin missing-code reports E2E', () => {
  let app: INestApplication;
  let userRepo: InMemoryUserRepository;
  let forms: InMemoryFormAdminReads;
  let missingCodes: InMemoryMissingCodeReportStats;
  let sessionService: SessionService;

  const ALLOWED_ORIGIN = 'http://localhost:3000';
  const FORM = '5a0c1f7e-2b4d-4c6a-8e1f-0a1b2c3d4e71';
  const ATTEMPT_BASE = '00000000-0000-4000-8000-0000000000';
  const NOW = Date.parse('2026-10-01T12:00:00.000Z');

  interface Actor {
    id: string;
    cookie: string;
    csrf: string;
  }

  let seed = 0;
  async function actor(
    role: 'ADMIN' | 'PUBLISHER' | 'RESPONDENT',
  ): Promise<Actor> {
    seed += 1;
    const user = await userRepo.create({
      email: `mcr-${seed}@fpt.edu.vn`,
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

  const get = (who: Actor | null, path: string) => {
    const req = request(app.getHttpServer())
      .get(path)
      .set('Origin', ALLOWED_ORIGIN);
    return who ? req.set('Cookie', [who.cookie]) : req;
  };

  function seedReports(count: number, respondentId: string | null) {
    missingCodes.reports = Array.from({ length: count }, (_, index) => ({
      attemptId: `${ATTEMPT_BASE}${String(10 + index)}`,
      surveyId: FORM,
      respondentId,
      reason: index === 0 ? 'Code never shown' : null,
      reportedAt: new Date(NOW - index * 60_000),
      attemptStatus: 'IN_PROGRESS',
    }));
    missingCodes.unresolved = count;
  }

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ||
      'postgresql://postgres:postgres@localhost:5433/rescom_test';

    userRepo = new InMemoryUserRepository();
    const auditRepo = new InMemoryIdentityAuditRepository();
    const sessionRepo = new InMemorySessionRepository(auditRepo);
    forms = new InMemoryFormAdminReads();
    missingCodes = new InMemoryMissingCodeReportStats();

    const envService = new EnvService({
      NODE_ENV: 'test',
      PORT: 4000,
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5433/rescom_test',
      JWT_SECRET: 'at_least_32_characters_super_secure_jwt_secret_key!',
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
      .overrideProvider(USER_REPOSITORY_PORT)
      .useValue(userRepo)
      .overrideProvider(SESSION_REPOSITORY_PORT)
      .useValue(sessionRepo)
      .overrideProvider(IDENTITY_AUDIT_PORT)
      .useValue(auditRepo)
      .overrideProvider(USER_PROFILE_REPOSITORY_PORT)
      .useValue(new InMemoryUserProfileRepository())
      .overrideProvider(MISSING_CODE_REPORT_STATS_PORT)
      .useValue(missingCodes)
      .overrideProvider(FORM_TITLE_LOOKUP_PORT)
      .useValue(forms)
      .overrideProvider(EnvService)
      .useValue(envService)
      .compile();

    sessionService = moduleFixture.get(SessionService);
    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    forms.clear();
    forms.seed({
      id: FORM,
      title: 'Campus survey',
      type: 'INTERNAL',
      status: 'PUBLISHED',
      publisherId: '00000000-0000-4000-8000-000000000001',
      updatedAt: new Date(NOW),
    });
    missingCodes.reports = [];
    missingCodes.unresolved = 0;
    missingCodes.calls = 0;
  });

  it('answers 401 without a session and 403 FORBIDDEN_RESOURCE to non-admins on both prefixes', async () => {
    const respondent = await actor('RESPONDENT');
    const publisher = await actor('PUBLISHER');
    for (const path of [
      '/admin/missing-code-reports',
      '/api/admin/missing-code-reports',
    ]) {
      const anonymous = await get(null, path).expect(401);
      expect(anonymous.body.data).toBeNull();
      for (const who of [respondent, publisher]) {
        const forbidden = await get(who, path).expect(403);
        expect(forbidden.body.error.code).toBe('FORBIDDEN_RESOURCE');
      }
    }
    expect(missingCodes.calls).toBe(0);
  });

  it('returns an empty page parsed with the shared schema', async () => {
    const admin = await actor('ADMIN');
    const res = await get(admin, '/admin/missing-code-reports').expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(missingCodeReportPageSchema.parse(res.body.data)).toEqual({
      items: [],
      total: 0,
      nextCursor: null,
    });
  });

  it('lists reports newest first with the survey title, on both prefixes', async () => {
    const admin = await actor('ADMIN');
    const respondent = await actor('RESPONDENT');
    seedReports(3, respondent.id);
    for (const path of [
      '/admin/missing-code-reports',
      '/api/admin/missing-code-reports',
    ]) {
      const res = await get(admin, path).expect(200);
      const page = missingCodeReportPageSchema.parse(res.body.data);
      expect(page.total).toBe(3);
      expect(page.nextCursor).toBeNull();
      expect(page.items.map((item) => item.attemptId)).toEqual([
        `${ATTEMPT_BASE}10`,
        `${ATTEMPT_BASE}11`,
        `${ATTEMPT_BASE}12`,
      ]);
      expect(page.items[0]).toMatchObject({
        survey: { id: FORM, title: 'Campus survey' },
        respondent: { id: respondent.id, displayName: null },
        reason: 'Code never shown',
        attemptStatus: 'IN_PROGRESS',
      });
    }
  });

  it('walks the keyset cursor without repeating or skipping a report', async () => {
    const admin = await actor('ADMIN');
    seedReports(5, null);

    const first = missingCodeReportPageSchema.parse(
      (await get(admin, '/admin/missing-code-reports?limit=2').expect(200)).body
        .data,
    );
    expect(first.items).toHaveLength(2);
    expect(first.total).toBe(5);
    expect(first.nextCursor).not.toBeNull();

    const second = missingCodeReportPageSchema.parse(
      (
        await get(
          admin,
          `/admin/missing-code-reports?limit=2&cursor=${encodeURIComponent(first.nextCursor as string)}`,
        ).expect(200)
      ).body.data,
    );
    expect(second.items).toHaveLength(2);
    expect(second.nextCursor).not.toBeNull();

    const third = missingCodeReportPageSchema.parse(
      (
        await get(
          admin,
          `/admin/missing-code-reports?limit=2&cursor=${encodeURIComponent(second.nextCursor as string)}`,
        ).expect(200)
      ).body.data,
    );
    expect(third.items).toHaveLength(1);
    expect(third.nextCursor).toBeNull();

    const ids = [...first.items, ...second.items, ...third.items].map(
      (item) => item.attemptId,
    );
    expect(new Set(ids).size).toBe(5);
    expect(ids).toEqual([10, 11, 12, 13, 14].map((n) => `${ATTEMPT_BASE}${n}`));
  });

  it('rejects an invalid limit, cursor or unknown query key with 400 VALIDATION_ERROR', async () => {
    const admin = await actor('ADMIN');
    for (const query of [
      'limit=0',
      'limit=101',
      'cursor=not-a-cursor',
      'x=1',
    ]) {
      const res = await get(
        admin,
        `/admin/missing-code-reports?${query}`,
      ).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });
});
