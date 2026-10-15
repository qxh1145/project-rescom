import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { EnvService } from '../src/common/config/env.service';
import { HttpExceptionFilter } from '../src/common/http/http-exception.filter';
import { SessionService } from '../src/modules/auth/application/session.service';
import { USER_REPOSITORY_PORT } from '../src/modules/users/application/ports/user.repository.port';
import { InMemoryUserRepository } from '../src/modules/users/infrastructure/in-memory-user.repository';
import { SESSION_REPOSITORY_PORT } from '../src/modules/auth/application/ports/session-repository.port';
import { InMemorySessionRepository } from '../src/modules/auth/infrastructure/in-memory-session.repository';
import { IDENTITY_AUDIT_PORT } from '../src/modules/auth/application/ports/identity-audit.port';
import { InMemoryIdentityAuditRepository } from '../src/modules/auth/infrastructure/in-memory-identity-audit.repository';
import { AUTH_COOKIE_NAME } from '../src/modules/auth/presentation/cookie-options.helper';

describe('RewardsEnabledGuard (e2e)', () => {
  let app: INestApplication;
  let adminCookie: string[];

  beforeAll(async () => {
    const users = new InMemoryUserRepository();
    const sessionsRepo = new InMemorySessionRepository();
    const audit = new InMemoryIdentityAuditRepository();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(USER_REPOSITORY_PORT)
      .useValue(users)
      .overrideProvider(SESSION_REPOSITORY_PORT)
      .useValue(sessionsRepo)
      .overrideProvider(IDENTITY_AUDIT_PORT)
      .useValue(audit)
      .overrideProvider(EnvService)
      .useValue(
        // Real EnvService (every getter defined), with only the flag off.
        new EnvService({
          NODE_ENV: 'test',
          PORT: 4000,
          DATABASE_URL:
            'postgresql://postgres:postgres@localhost:5433/rescom_test',
          JWT_SECRET: 'at_least_32_characters_super_secure_jwt_secret_key!',
          JWT_ACCESS_TTL_SECONDS: 900,
          BCRYPT_ROUNDS: 12,
          FRONTEND_ORIGINS: 'http://localhost:3000',
          REWARDS_ENABLED: false,
        }),
      )
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    const user = await users.create({
      email: 'admin-flag@example.com',
      passwordHash: null,
      role: 'ADMIN',
      status: 'ACTIVE',
    });
    const sessionService = app.get<SessionService>(SessionService);
    const tokens = await sessionService.createSession(user.id);
    adminCookie = [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`];
  });

  afterAll(async () => {
    await app?.close();
  });

  it('returns 404 on user rewards route when REWARDS_ENABLED=false', async () => {
    const res = await request(app.getHttpServer())
      .get('/rewards/vouchers')
      .expect(404);

    expect(res.body).toMatchObject({
      error: {
        code: 'NOT_FOUND',
      },
    });
  });

  it('returns 404 on admin rewards route even with valid admin session when REWARDS_ENABLED=false', async () => {
    const res = await request(app.getHttpServer())
      .get('/admin/rewards/vouchers')
      .set('Cookie', adminCookie)
      .expect(404);

    expect(res.body).toMatchObject({
      error: {
        code: 'NOT_FOUND',
      },
    });
  });
});
