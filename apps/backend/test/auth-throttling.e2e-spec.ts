import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { JwtService } from '@nestjs/jwt';
import { randomBytes, randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { USER_REPOSITORY_PORT } from '../src/modules/users/application/ports/user.repository.port';
import { InMemoryUserRepository } from '../src/modules/users/infrastructure/in-memory-user.repository';
import { HttpExceptionFilter } from '../src/common/http/http-exception.filter';
import { EnvService } from '../src/common/config/env.service';
import {
  AUTH_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
} from '../src/modules/auth/presentation/cookie-options.helper';
import { SESSION_REPOSITORY_PORT } from '../src/modules/auth/application/ports/session-repository.port';
import { IDENTITY_AUDIT_PORT } from '../src/modules/auth/application/ports/identity-audit.port';
import { InMemorySessionRepository } from '../src/modules/auth/infrastructure/in-memory-session.repository';
import { InMemoryIdentityAuditRepository } from '../src/modules/auth/infrastructure/in-memory-identity-audit.repository';
import { PrismaService } from '../src/common/database/prisma.service';
import { LEDGER_REPOSITORY_PORT } from '../src/modules/economy/application/ports/ledger-repository.port';
import { InMemoryLedgerRepository } from '../src/modules/economy/infrastructure/in-memory-ledger.repository';
import { STARTER_POINTS_DATA_PROVIDER } from '../src/modules/economy/economy.module';
import { InMemoryStarterPointsDataProvider } from '../src/modules/economy/infrastructure/in-memory-starter-points-data-provider';

/**
 * Plan 0.1 (2026-10-01): with the old setup every page load spent the strict
 * `auth` bucket on GET /auth/me, so after ~10 loads per minute the whole site
 * went to /server-error. The `auth` bucket now covers credential endpoints
 * only, and the `default` bucket tracks a verified session per user.
 *
 * The limits are explicit and non-default, so the NODE_ENV=test relaxation in
 * SecurityModule (which only lifts the default values) does not apply. Each
 * test boots its own app: the throttler counters live in the app's memory.
 */
describe('Auth throttling E2E (plan 0.1)', () => {
  const JWT_SECRET = 'at_least_32_characters_super_secure_jwt_secret_key!';
  const ORIGIN = 'http://localhost:3000';
  const PASSWORD = 'Password12345!';
  const AUTH_LIMIT = 3;
  const DEFAULT_LIMIT = 25;
  const RATE_LIMITED_BODY = {
    data: null,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests. Please try again later.',
    },
    meta: {},
  };

  interface SignedInUser {
    id: string;
    accessToken: string;
    refreshToken: string;
  }

  let app: INestApplication;

  beforeEach(async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ||
      'postgresql://postgres:postgres@localhost:5433/rescom_test';

    const envService = new EnvService({
      NODE_ENV: 'test',
      PORT: 4000,
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5433/rescom_test',
      JWT_SECRET,
      JWT_ACCESS_TTL_SECONDS: 900,
      BCRYPT_ROUNDS: 12,
      FRONTEND_ORIGINS: ORIGIN,
      RATE_LIMIT_TTL_SECONDS: 60,
      RATE_LIMIT_MAX_REQUESTS: DEFAULT_LIMIT,
      AUTH_RATE_LIMIT_TTL_SECONDS: 60,
      AUTH_RATE_LIMIT_MAX_REQUESTS: AUTH_LIMIT,
    });
    const auditRepo = new InMemoryIdentityAuditRepository();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({
        $connect: jest.fn().mockResolvedValue(undefined),
        $disconnect: jest.fn().mockResolvedValue(undefined),
      })
      .overrideProvider(LEDGER_REPOSITORY_PORT)
      .useValue(new InMemoryLedgerRepository())
      .overrideProvider(STARTER_POINTS_DATA_PROVIDER)
      .useValue(new InMemoryStarterPointsDataProvider())
      .overrideProvider(USER_REPOSITORY_PORT)
      .useValue(new InMemoryUserRepository())
      .overrideProvider(SESSION_REPOSITORY_PORT)
      .useValue(new InMemorySessionRepository(auditRepo))
      .overrideProvider(IDENTITY_AUDIT_PORT)
      .useValue(auditRepo)
      .overrideProvider(EnvService)
      .useValue(envService)
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  function cookieValue(res: request.Response, name: string): string {
    const header = res.headers['set-cookie'];
    const cookies = Array.isArray(header) ? header : header ? [header] : [];
    // Skip the expiring legacy-path copies (`name=; Path=/auth; ...`).
    const cookie = cookies.find(
      (c: string) => c.startsWith(`${name}=`) && !c.startsWith(`${name}=;`),
    );
    if (!cookie) {
      throw new Error(`Expected the response to set the ${name} cookie`);
    }
    return cookie.split(';')[0].slice(name.length + 1);
  }

  async function register(email: string): Promise<SignedInUser> {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password: PASSWORD })
      .expect(201);
    return {
      id: res.body.data.user.id,
      accessToken: cookieValue(res, AUTH_COOKIE_NAME),
      refreshToken: cookieValue(res, REFRESH_COOKIE_NAME),
    };
  }

  function getMe(accessToken?: string): request.Test {
    const req = request(app.getHttpServer()).get('/auth/me');
    return accessToken
      ? req.set('Cookie', [`${AUTH_COOKIE_NAME}=${accessToken}`])
      : req;
  }

  function login(email: string, password: string): request.Test {
    return request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password });
  }

  /** Counted by `default` only: the `auth` throttler sets `*-auth` headers. */
  function expectDefaultBucketOnly(res: request.Response): void {
    expect(res.headers['x-ratelimit-limit']).toBe(String(DEFAULT_LIMIT));
    expect(res.headers['x-ratelimit-limit-auth']).toBeUndefined();
  }

  function expectRateLimited(res: request.Response): void {
    expect(res.status).toBe(429);
    expect(res.body).toEqual(RATE_LIMITED_BODY);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  }

  it('lets a signed-in user call me, csrf, refresh and logout more often than the auth limit', async () => {
    let user = await register('upkeep@example.com');
    const rounds = AUTH_LIMIT + 3;

    for (let i = 0; i < rounds; i++) {
      const me = await getMe(user.accessToken).expect(200);
      expect(me.body.data.id).toBe(user.id);
      expectDefaultBucketOnly(me);

      const csrf = await request(app.getHttpServer())
        .get('/auth/csrf')
        .set('Origin', ORIGIN)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${user.accessToken}`])
        .expect(200);
      expectDefaultBucketOnly(csrf);

      const refreshed = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Origin', ORIGIN)
        .set('Cookie', [
          `${AUTH_COOKIE_NAME}=${user.accessToken}`,
          `${REFRESH_COOKIE_NAME}=${user.refreshToken}`,
        ])
        .set('X-CSRF-Token', csrf.body.data.csrfToken)
        .expect(200);
      expectDefaultBucketOnly(refreshed);
      user = {
        id: user.id,
        accessToken: cookieValue(refreshed, AUTH_COOKIE_NAME),
        refreshToken: cookieValue(refreshed, REFRESH_COOKIE_NAME),
      };
    }

    for (let i = 0; i < rounds; i++) {
      const loggedOut = await request(app.getHttpServer())
        .post('/auth/logout')
        .expect(204);
      expectDefaultBucketOnly(loggedOut);
    }
  });

  it('still limits login per IP with the auth bucket, even when the caller holds a valid session', async () => {
    const member = await register('member@example.com');

    for (let i = 0; i < AUTH_LIMIT; i++) {
      const failed = await login('member@example.com', 'WrongPassword123!');
      expect(failed.status).toBe(401);
      expect(failed.headers['x-ratelimit-limit-auth']).toBe(String(AUTH_LIMIT));
    }

    const limited = await login('member@example.com', 'WrongPassword123!');
    expectRateLimited(limited);
    expect(limited.headers['x-ratelimit-limit']).toBe(String(AUTH_LIMIT));

    // A session cookie never opens a fresh login bucket: `auth` tracks the IP.
    expectRateLimited(
      await login('member@example.com', PASSWORD).set('Cookie', [
        `${AUTH_COOKIE_NAME}=${member.accessToken}`,
      ]),
    );

    // Session upkeep is not blocked by the exhausted login bucket.
    await getMe(member.accessToken).expect(200);
  });

  it('limits forgot-password per IP with the auth bucket (plan 5.4)', async () => {
    const forgot = () =>
      request(app.getHttpServer())
        .post('/auth/password/forgot')
        .set('Content-Type', 'application/json')
        .send({ email: 'nobody@example.com' });

    for (let i = 0; i < AUTH_LIMIT; i++) {
      const accepted = await forgot().expect(202);
      expect(accepted.headers['x-ratelimit-limit-auth']).toBe(
        String(AUTH_LIMIT),
      );
    }
    expectRateLimited(await forgot());
  });

  it('gives two signed-in users behind the same IP independent default buckets', async () => {
    const alice = await register('alice@example.com');
    const bob = await register('bob@example.com');

    for (let i = 0; i < DEFAULT_LIMIT; i++) {
      await getMe(alice.accessToken).expect(200);
    }
    expectRateLimited(await getMe(alice.accessToken));

    const bobMe = await getMe(bob.accessToken).expect(200);
    expect(bobMe.body.data.id).toBe(bob.id);
    expect(bobMe.headers['x-ratelimit-remaining']).toBe(
      String(DEFAULT_LIMIT - 1),
    );

    // The anonymous IP bucket is separate from Alice's user bucket too.
    await getMe().expect(401);
  });

  it('tracks forged, expired and random access cookies by IP, so they cannot mint fresh buckets', async () => {
    const victim = await register('victim@example.com');
    const forger = new JwtService();
    const claims = {
      sub: victim.id,
      sessionId: randomUUID(),
      sessionVersion: 1,
    };
    const unverifiableToken = (i: number): string => {
      switch (i % 3) {
        case 0: // the victim's claims, signed with another key
          return forger.sign(
            { ...claims, jti: `forged-${i}` },
            { secret: 'another_secret_that_is_at_least_32_characters!' },
          );
        case 1: // the right key, but expired
          return forger.sign(
            {
              ...claims,
              jti: `expired-${i}`,
              exp: Math.floor(Date.now() / 1000) - 60,
            },
            { secret: JWT_SECRET },
          );
        default: // random bytes
          return randomBytes(24).toString('base64url');
      }
    };

    for (let i = 0; i < DEFAULT_LIMIT - 1; i++) {
      await getMe(unverifiableToken(i)).expect(401);
    }
    // An anonymous request from the same IP shares that bucket.
    await getMe().expect(401);

    expectRateLimited(await getMe(unverifiableToken(DEFAULT_LIMIT)));
    expectRateLimited(await getMe());

    // The forged tokens named the victim, yet never touched the victim's bucket.
    const victimMe = await getMe(victim.accessToken).expect(200);
    expect(victimMe.headers['x-ratelimit-remaining']).toBe(
      String(DEFAULT_LIMIT - 1),
    );
  });
});
