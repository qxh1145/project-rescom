import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { rewardsStatsSchema } from '@rescom/schemas';
import { AppModule } from '../src/app.module';
import { EnvService } from '../src/common/config/env.service';
import { HttpExceptionFilter } from '../src/common/http/http-exception.filter';
import { SessionService } from '../src/modules/auth/application/session.service';
import { AUTH_COOKIE_NAME } from '../src/modules/auth/presentation/cookie-options.helper';
import { USER_REPOSITORY_PORT } from '../src/modules/users/application/ports/user.repository.port';
import { InMemoryUserRepository } from '../src/modules/users/infrastructure/in-memory-user.repository';
import { SESSION_REPOSITORY_PORT } from '../src/modules/auth/application/ports/session-repository.port';
import { InMemorySessionRepository } from '../src/modules/auth/infrastructure/in-memory-session.repository';
import { IDENTITY_AUDIT_PORT } from '../src/modules/auth/application/ports/identity-audit.port';
import { InMemoryIdentityAuditRepository } from '../src/modules/auth/infrastructure/in-memory-identity-audit.repository';
import { REWARDS_STATS_READ_PORT } from '../src/modules/rewards/application/ports/rewards-stats-read.port';
import { InMemoryRewardsStatsRepository } from '../src/modules/rewards/infrastructure/in-memory-rewards-stats.repository';

describe('Admin Rewards Stats HTTP E2E contracts (in memory)', () => {
  let app: INestApplication;
  let users: InMemoryUserRepository;
  let statsRepo: InMemoryRewardsStatsRepository;
  let sessions: SessionService;
  let adminCookie: string;
  let respondentCookie: string;
  let rewardsEnabledFlag = true;

  beforeAll(async () => {
    users = new InMemoryUserRepository();
    const sessionsRepo = new InMemorySessionRepository();
    const audit = new InMemoryIdentityAuditRepository();
    statsRepo = new InMemoryRewardsStatsRepository();

    const env = new EnvService({
      NODE_ENV: 'test',
      PORT: 4000,
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5433/rescom_test',
      JWT_SECRET: 'at_least_32_characters_super_secure_jwt_secret_key!',
      JWT_ACCESS_TTL_SECONDS: 900,
      BCRYPT_ROUNDS: 12,
      FRONTEND_ORIGINS: 'http://localhost:3000',
      REWARDS_ENABLED: true,
    });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(USER_REPOSITORY_PORT)
      .useValue(users)
      .overrideProvider(SESSION_REPOSITORY_PORT)
      .useValue(sessionsRepo)
      .overrideProvider(IDENTITY_AUDIT_PORT)
      .useValue(audit)
      .overrideProvider(REWARDS_STATS_READ_PORT)
      .useValue(statsRepo)
      .overrideProvider(EnvService)
      .useValue(
        new Proxy(env, {
          get(target, prop, receiver) {
            if (prop === 'rewardsEnabled') {
              return rewardsEnabledFlag;
            }
            return Reflect.get(target, prop, receiver);
          },
        }),
      )
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    sessions = app.get(SessionService);

    const adminUser = await users.create({
      email: 'stats-admin@fpt.edu.vn',
      passwordHash: null,
      role: 'ADMIN',
      status: 'ACTIVE',
    });
    const adminTokens = await sessions.createSession(adminUser.id);
    adminCookie = `${AUTH_COOKIE_NAME}=${adminTokens.accessToken}`;

    const respondentUser = await users.create({
      email: 'stats-respondent@fpt.edu.vn',
      passwordHash: null,
      role: 'RESPONDENT',
      status: 'ACTIVE',
    });
    const respondentTokens = await sessions.createSession(respondentUser.id);
    respondentCookie = `${AUTH_COOKIE_NAME}=${respondentTokens.accessToken}`;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('rejects unauthenticated request with 401', async () => {
    await request(app.getHttpServer())
      .get('/admin/rewards/stats?from=2026-10-01&to=2026-10-10')
      .expect(401);
  });

  it('rejects non-admin caller with 403', async () => {
    await request(app.getHttpServer())
      .get('/admin/rewards/stats?from=2026-10-01&to=2026-10-10')
      .set('Cookie', respondentCookie)
      .expect(403);
  });

  it('rejects range > 366 days with 400 validation error', async () => {
    const res = await request(app.getHttpServer())
      .get('/admin/rewards/stats?from=2025-01-01&to=2026-02-01')
      .set('Cookie', adminCookie)
      .expect(400);

    expect(res.body).toMatchObject({
      error: {
        code: 'VALIDATION_ERROR',
      },
    });
  });

  it('returns 404 when REWARDS_ENABLED is false', async () => {
    rewardsEnabledFlag = false;
    try {
      await request(app.getHttpServer())
        .get('/admin/rewards/stats?from=2026-10-01&to=2026-10-10')
        .set('Cookie', adminCookie)
        .expect(404);
    } finally {
      rewardsEnabledFlag = true;
    }
  });

  it('serves literal /admin/rewards/stats with Cache-Control: no-store and validates schema', async () => {
    const res = await request(app.getHttpServer())
      .get('/admin/rewards/stats?from=2026-10-01&to=2026-10-10')
      .set('Cookie', adminCookie)
      .expect(200)
      .expect('Cache-Control', /no-store/);

    expect(res.body).toHaveProperty('data');
    expect(() => rewardsStatsSchema.parse(res.body.data)).not.toThrow();
  });

  it('serves literal /api/admin/rewards/stats prefix as well', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/admin/rewards/stats?from=2026-10-01&to=2026-10-10')
      .set('Cookie', adminCookie)
      .expect(200)
      .expect('Cache-Control', /no-store/);

    expect(res.body).toHaveProperty('data');
    expect(() => rewardsStatsSchema.parse(res.body.data)).not.toThrow();
  });
});
