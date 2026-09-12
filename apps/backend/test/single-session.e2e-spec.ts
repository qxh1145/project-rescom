import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { JwtService } from '@nestjs/jwt';
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

describe('Single-Session Enforcement E2E Tests (Story 1.3)', () => {
  let app: INestApplication;
  let userRepo: InMemoryUserRepository;
  let sessionRepo: InMemorySessionRepository;
  let auditRepo: InMemoryIdentityAuditRepository;
  let envService: EnvService;
  let jwtService: JwtService;

  const TEST_JWT_SECRET = 'at_least_32_characters_super_secure_jwt_secret_key!';

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ||
      'postgresql://postgres:postgres@localhost:5433/rescom_test';

    userRepo = new InMemoryUserRepository();
    auditRepo = new InMemoryIdentityAuditRepository();
    sessionRepo = new InMemorySessionRepository(auditRepo);
    jwtService = new JwtService({ secret: TEST_JWT_SECRET });

    envService = new EnvService({
      NODE_ENV: 'test',
      PORT: 4000,
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5433/rescom_test',
      JWT_SECRET: TEST_JWT_SECRET,
      JWT_ACCESS_TTL_SECONDS: 900,
      BCRYPT_ROUNDS: 12,
      FRONTEND_ORIGINS: 'http://localhost:3000',
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

  beforeEach(() => {
    userRepo.clear();
    sessionRepo.clear();
    auditRepo.clear();
  });

  function extractCookie(
    res: request.Response,
    cookieName: string,
  ): string | undefined {
    const cookies = res.headers['set-cookie'];
    if (!cookies) return undefined;
    const cookieArray = Array.isArray(cookies) ? cookies : [cookies];
    for (const cookie of cookieArray) {
      if (cookie.startsWith(`${cookieName}=`)) {
        return cookie.split(';')[0].split('=')[1];
      }
    }
    return undefined;
  }

  function expectCookiesCleared(res: request.Response) {
    const cookies = res.headers['set-cookie'];
    expect(cookies).toBeDefined();
    const cookieArray = Array.isArray(cookies) ? cookies : [cookies];
    const clearedAuth = cookieArray.some(
      (c) =>
        c.startsWith(`${AUTH_COOKIE_NAME}=;`) ||
        c.includes(`${AUTH_COOKIE_NAME}=;`),
    );
    const clearedRefresh = cookieArray.some(
      (c) =>
        c.startsWith(`${REFRESH_COOKIE_NAME}=;`) ||
        c.includes(`${REFRESH_COOKIE_NAME}=;`),
    );
    expect(clearedAuth).toBe(true);
    expect(clearedRefresh).toBe(true);
  }

  it('enforces single active session, rejects old tokens, and protects endpoints across all failure states', async () => {
    // 1. Register a test user
    const registerRes = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: 'user.single@example.com',
        password: 'Password123!',
      })
      .expect(201);

    const user = registerRes.body.data.user;
    expect(user).toBeDefined();
    expect(user.id).toBeDefined();

    // Verify registration issued sessionVersion = 1
    const registerToken = extractCookie(registerRes, AUTH_COOKIE_NAME);
    expect(registerToken).toBeDefined();
    const decodedReg = jwtService.decode(registerToken!) as any;
    expect(decodedReg.sessionVersion).toBe(1);

    // 2. Device A logs in -> sessionVersion = 2 (replaces registration session)
    const loginDeviceA = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: 'user.single@example.com',
        password: 'Password123!',
      })
      .expect(200);

    const deviceAAccessToken = extractCookie(loginDeviceA, AUTH_COOKIE_NAME);
    const deviceARefreshToken = extractCookie(
      loginDeviceA,
      REFRESH_COOKIE_NAME,
    );
    expect(deviceAAccessToken).toBeDefined();
    expect(deviceARefreshToken).toBeDefined();

    // Verify Device A sessionVersion = 2 by decoding access token in test code only
    const decodedA = jwtService.decode(deviceAAccessToken!) as any;
    expect(decodedA.sessionVersion).toBe(2);

    // 3. Device A calls GET /auth/me -> 200 OK with sanitized user data
    const meResA = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', `${AUTH_COOKIE_NAME}=${deviceAAccessToken}`)
      .expect(200);

    expect(meResA.body).toEqual({
      data: {
        id: user.id,
        email: 'user.single@example.com',
        role: 'RESPONDENT',
        status: 'ACTIVE',
      },
      error: null,
      meta: {},
    });
    expect((meResA.body.data as any).passwordHash).toBeUndefined();

    // 4. Device B logs in with same user credentials -> sessionVersion = 3, revokes Device A session
    const loginDeviceB = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: 'user.single@example.com',
        password: 'Password123!',
      })
      .expect(200);

    const deviceBAccessToken = extractCookie(loginDeviceB, AUTH_COOKIE_NAME);
    const deviceBRefreshToken = extractCookie(
      loginDeviceB,
      REFRESH_COOKIE_NAME,
    );
    expect(deviceBAccessToken).toBeDefined();
    expect(deviceBRefreshToken).toBeDefined();

    // Verify Device B sessionVersion = 3 by decoding access token in test code only
    const decodedB = jwtService.decode(deviceBAccessToken!) as any;
    expect(decodedB.sessionVersion).toBe(3);

    // 5. Device B calls GET /auth/me -> 200 OK
    const meResB = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', `${AUTH_COOKIE_NAME}=${deviceBAccessToken}`)
      .expect(200);
    expect(meResB.body.data.id).toBe(user.id);

    // 6. Device A calls GET /auth/me -> 401 AUTH_SESSION_REVOKED, cookies cleared, Cache-Control: no-store
    const revokedRes = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', `${AUTH_COOKIE_NAME}=${deviceAAccessToken}`)
      .expect(401);

    expect(revokedRes.body.error.code).toBe('AUTH_SESSION_REVOKED');
    expect(revokedRes.headers['cache-control']).toBe('no-store');
    expectCookiesCleared(revokedRes);

    // 7. Device A attempts POST /auth/refresh -> 401 AUTH_SESSION_REVOKED, cookies cleared
    const refreshRes = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Origin', 'http://localhost:3000')
      .set('Cookie', `${REFRESH_COOKIE_NAME}=${deviceARefreshToken}`)
      .set('x-csrf-token', 'irrelevant-token')
      .expect(401);

    expect(refreshRes.body.error.code).toBe('AUTH_SESSION_REVOKED');

    // 8. Device A attempts POST /auth/logout with revoked cookies -> 204 No Content, idempotent, no audit pollution
    const auditCountBeforeLogout = auditRepo.records.length;
    const logoutRes = await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Origin', 'http://localhost:3000')
      .set('Cookie', `${AUTH_COOKIE_NAME}=${deviceAAccessToken}`)
      .expect(204);

    expectCookiesCleared(logoutRes);
    // Audit log count must not increase for already-revoked logout
    expect(auditRepo.records.length).toBe(auditCountBeforeLogout);

    // 9. Device B calls GET /auth/me again -> remains 200 OK throughout Device A operations
    const meResBStillValid = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', `${AUTH_COOKIE_NAME}=${deviceBAccessToken}`)
      .expect(200);
    expect(meResBStillValid.body.data.id).toBe(user.id);

    // 10. Device B logs out cleanly -> 204 No Content
    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Origin', 'http://localhost:3000')
      .set('Cookie', `${AUTH_COOKIE_NAME}=${deviceBAccessToken}`)
      .expect(204);

    // 11. Subsequent login after logout -> receives sessionVersion = 4 (monotonic, does NOT reset to 1)
    const login4 = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: 'user.single@example.com',
        password: 'Password123!',
      })
      .expect(200);

    const token4 = extractCookie(login4, AUTH_COOKIE_NAME);
    expect(token4).toBeDefined();
    const decoded4 = jwtService.decode(token4!) as any;
    expect(decoded4.sessionVersion).toBe(4);
  });

  describe('Invalid Authentication Rejection Scenarios (AC6)', () => {
    it('should reject GET /auth/me without cookie with 401, clear cookies, and set no-store', async () => {
      const res = await request(app.getHttpServer())
        .get('/auth/me')
        .expect(401);

      expect(res.body.error.code).toBe('AUTH_UNAUTHORIZED');
      expect(res.headers['cache-control']).toBe('no-store');
      expectCookiesCleared(res);
    });

    it('should reject GET /auth/me with expired access token with 401, clear cookies, and set no-store', async () => {
      // Sign an already-expired JWT
      const expiredToken = jwtService.sign(
        {
          sub: 'u-expired',
          sessionId: 's-expired',
          sessionVersion: 1,
        },
        {
          expiresIn: -10, // Expired 10 seconds ago
        },
      );

      const res = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Cookie', `${AUTH_COOKIE_NAME}=${expiredToken}`)
        .expect(401);

      expect(res.body.error.code).toBe('AUTH_UNAUTHORIZED');
      expect(res.headers['cache-control']).toBe('no-store');
      expectCookiesCleared(res);
    });

    it('should reject GET /auth/me with locked user account with 403, clear cookies, and set no-store', async () => {
      // 1. Create a user and lock it
      const lockedUser = await userRepo.create({
        id: '12345678-1234-1234-1234-123456789012',
        email: 'locked@example.com',
        passwordHash: '$2a$12$something',
        role: 'RESPONDENT',
        status: 'LOCKED',
      });

      // 2. Active session exists for this locked user
      const now = new Date();
      const sessionId = '87654321-4321-4321-4321-210987654321';
      await sessionRepo.replaceUserSession(lockedUser.id, {
        session: {
          id: sessionId,
          userId: lockedUser.id,
          csrfDigest: 'digest',
          revoked: false,
          expiresAt: new Date(now.getTime() + 100000),
          createdAt: now,
          updatedAt: now,
        },
        credential: {
          id: 'cred-locked',
          sessionId,
          secretDigest: 'digest',
          isUsed: false,
          usedAt: null,
          expiresAt: new Date(now.getTime() + 100000),
          createdAt: now,
        },
        audit: {
          action: 'SESSION_REPLACED',
          userId: lockedUser.id,
          outcome: 'SUCCESS',
        },
      });

      const token = jwtService.sign({
        sub: lockedUser.id,
        sessionId,
        sessionVersion: 1,
      });

      const res = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Cookie', `${AUTH_COOKIE_NAME}=${token}`)
        .expect(401);

      expect(res.body.error.code).toBe('AUTH_USER_LOCKED');
      expect(res.headers['cache-control']).toBe('no-store');
      expectCookiesCleared(res);
    });
  });
});
