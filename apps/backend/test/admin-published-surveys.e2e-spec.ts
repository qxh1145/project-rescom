import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import {
  publishedSurveyPageSchema,
  surveyPinResultSchema,
} from '@rescom/schemas';
import { AppModule } from '../src/app.module';
import { USER_REPOSITORY_PORT } from '../src/modules/users/application/ports/user.repository.port';
import { InMemoryUserRepository } from '../src/modules/users/infrastructure/in-memory-user.repository';
import { SESSION_REPOSITORY_PORT } from '../src/modules/auth/application/ports/session-repository.port';
import { InMemorySessionRepository } from '../src/modules/auth/infrastructure/in-memory-session.repository';
import { IDENTITY_AUDIT_PORT } from '../src/modules/auth/application/ports/identity-audit.port';
import { InMemoryIdentityAuditRepository } from '../src/modules/auth/infrastructure/in-memory-identity-audit.repository';
import { USER_PROFILE_REPOSITORY_PORT } from '../src/modules/users/application/ports/user-profile.repository.port';
import { InMemoryUserProfileRepository } from '../src/modules/users/infrastructure/in-memory-user-profile.repository';
import { ADMIN_USER_DIRECTORY_PORT } from '../src/modules/users/application/ports/admin-user-directory.port';
import { InMemoryAdminUserDirectory } from '../src/modules/users/infrastructure/in-memory-admin-user-directory';
import { PUBLISHED_FORM_ADMIN_PORT } from '../src/modules/forms/application/ports/published-form-admin.port';
import { InMemoryFormAdminReads } from '../src/modules/forms/infrastructure/in-memory-form-admin-reads';
import { AUDIT_LOG_REPOSITORY_PORT } from '../src/modules/admin/application/ports/audit-log-repository.port';
import { InMemoryAuditLogRepository } from '../src/modules/admin/infrastructure/in-memory-audit-log.repository';
import { SessionService } from '../src/modules/auth/application/session.service';
import { EnvService } from '../src/common/config/env.service';
import { PrismaService } from '../src/common/database/prisma.service';
import { HttpExceptionFilter } from '../src/common/http/http-exception.filter';
import { AUTH_COOKIE_NAME } from '../src/modules/auth/presentation/cookie-options.helper';

/**
 * `GET /admin/surveys/published` and `PUT /admin/surveys/:formId/pin`:
 * ADMIN guard, CSRF, pinned-first order, pin only PUBLISHED, audit log.
 */
describe('Admin published surveys and pinning E2E', () => {
  let app: INestApplication;
  let userRepo: InMemoryUserRepository;
  let forms: InMemoryFormAdminReads;
  let auditLogs: InMemoryAuditLogRepository;
  let sessionService: SessionService;

  const ALLOWED_ORIGIN = 'http://localhost:3000';
  const OLD = '5a0c1f7e-2b4d-4c6a-8e1f-0a1b2c3d4e71';
  const NEW = '5a0c1f7e-2b4d-4c6a-8e1f-0a1b2c3d4e72';
  const CLOSED = '5a0c1f7e-2b4d-4c6a-8e1f-0a1b2c3d4e73';
  const PUBLISHER = '00000000-0000-4000-8000-000000000001';
  const NOW = Date.parse('2026-10-09T12:00:00.000Z');

  interface Actor {
    id: string;
    cookie: string;
    csrf: string;
  }

  let seed = 0;
  async function actor(role: 'ADMIN' | 'RESPONDENT'): Promise<Actor> {
    seed += 1;
    const user = await userRepo.create({
      email: `pin-${seed}@fpt.edu.vn`,
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

  const list = (who: Actor, search?: string) =>
    request(app.getHttpServer())
      .get('/admin/surveys/published')
      .query(search ? { search } : {})
      .set('Origin', ALLOWED_ORIGIN)
      .set('Cookie', [who.cookie]);

  const pin = (who: Actor, formId: string, body: unknown, csrf = true) => {
    const req = request(app.getHttpServer())
      .put(`/api/admin/surveys/${formId}/pin`)
      .set('Origin', ALLOWED_ORIGIN)
      .set('Cookie', [who.cookie])
      .set('Content-Type', 'application/json');
    return (csrf ? req.set('X-CSRF-Token', who.csrf) : req).send(
      JSON.stringify(body),
    );
  };

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ||
      'postgresql://postgres:postgres@localhost:5433/rescom_test';

    userRepo = new InMemoryUserRepository();
    const auditRepo = new InMemoryIdentityAuditRepository();
    const sessionRepo = new InMemorySessionRepository(auditRepo);
    const profileRepo = new InMemoryUserProfileRepository();
    forms = new InMemoryFormAdminReads();
    auditLogs = new InMemoryAuditLogRepository();

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
      .useValue(profileRepo)
      .overrideProvider(ADMIN_USER_DIRECTORY_PORT)
      .useValue(new InMemoryAdminUserDirectory(userRepo, profileRepo))
      .overrideProvider(PUBLISHED_FORM_ADMIN_PORT)
      .useValue(forms)
      .overrideProvider(AUDIT_LOG_REPOSITORY_PORT)
      .useValue(auditLogs)
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
    const base = { type: 'INTERNAL' as const, publisherId: PUBLISHER };
    forms.seed(
      {
        ...base,
        id: OLD,
        title: 'Old survey',
        status: 'PUBLISHED',
        updatedAt: new Date(NOW - 60_000),
      },
      {
        ...base,
        id: NEW,
        title: 'New survey',
        status: 'PUBLISHED',
        updatedAt: new Date(NOW),
      },
      {
        ...base,
        id: CLOSED,
        title: 'Closed survey',
        status: 'CLOSED',
        updatedAt: new Date(NOW),
      },
    );
  });

  it('forbids non-admins', async () => {
    const respondent = await actor('RESPONDENT');
    expect((await list(respondent).expect(403)).body.error.code).toBe(
      'FORBIDDEN_RESOURCE',
    );
    await pin(respondent, OLD, { pinned: true }).expect(403);
  });

  it('pins a survey: it lists first and the change is audited', async () => {
    const admin = await actor('ADMIN');
    const before = publishedSurveyPageSchema.parse(
      (await list(admin).expect(200)).body.data,
    );
    expect(before.items.map((item) => item.formId)).toEqual([NEW, OLD]);

    const res = await pin(admin, OLD, { pinned: true }).expect(200);
    expect(surveyPinResultSchema.parse(res.body.data)).toEqual({
      formId: OLD,
      isPinned: true,
    });

    const after = publishedSurveyPageSchema.parse(
      (await list(admin, 'survey').expect(200)).body.data,
    );
    expect(after.items.map((item) => [item.formId, item.isPinned])).toEqual([
      [OLD, true],
      [NEW, false],
    ]);
    const audit = await auditLogs.findMany({
      page: 1,
      limit: 10,
      action: 'SURVEY_PINNED',
    });
    expect(audit.items[0]).toMatchObject({
      userId: admin.id,
      metadata: { formId: OLD },
    });
  });

  it('refuses to pin a closed survey but unpins it', async () => {
    const admin = await actor('ADMIN');
    const res = await pin(admin, CLOSED, { pinned: true }).expect(409);
    expect(res.body.error.code).toBe('SURVEY_NOT_PUBLISHED');
    await pin(admin, CLOSED, { pinned: false }).expect(200);
  });

  it('answers 404 for an unknown survey, 400 for a bad body, 403 without CSRF', async () => {
    const admin = await actor('ADMIN');
    const unknown = '5a0c1f7e-2b4d-4c6a-8e1f-0a1b2c3d4e7f';
    expect(
      (await pin(admin, unknown, { pinned: true }).expect(404)).body.error.code,
    ).toBe('FORM_NOT_FOUND');
    expect(
      (await pin(admin, OLD, { pinned: 'yes' }).expect(400)).body.error.code,
    ).toBe('VALIDATION_ERROR');
    await pin(admin, OLD, { pinned: true }, false).expect(403);
  });
});
