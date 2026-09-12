import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
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

describe('Authentication E2E Tests (AC1 - AC8)', () => {
  let app: INestApplication;
  let userRepo: InMemoryUserRepository;
  let sessionRepo: InMemorySessionRepository;
  let auditRepo: InMemoryIdentityAuditRepository;
  let envService: EnvService;

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ||
      'postgresql://postgres:postgres@localhost:5433/rescom_test';

    userRepo = new InMemoryUserRepository();
    sessionRepo = new InMemorySessionRepository();
    auditRepo = new InMemoryIdentityAuditRepository();
    envService = new EnvService({
      NODE_ENV: 'test',
      PORT: 4000,
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5433/rescom_test',
      JWT_SECRET: 'at_least_32_characters_super_secure_jwt_secret_key!',
      JWT_ACCESS_TTL_SECONDS: 900,
      BCRYPT_ROUNDS: 12,
      FRONTEND_ORIGINS: 'http://localhost:3000',
    });

    const mockPrisma = {
      $connect: jest.fn().mockResolvedValue(undefined),
      $disconnect: jest.fn().mockResolvedValue(undefined),
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
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

  describe('AC1: Registration succeeds for a new email', () => {
    it('should register successfully, set HTTP-only cookie, and return sanitized user', async () => {
      const payload = {
        email: '  NewUser@Example.COM  ',
        password: 'SecurePassword123!',
      };

      const response = await request(app.getHttpServer())
        .post('/auth/register')
        .send(payload)
        .expect(201);

      expect(response.headers['cache-control']).toBe('no-store');

      // Cookie assertions
      const cookies = response.headers['set-cookie'];
      expect(cookies).toBeDefined();
      const authCookie = (Array.isArray(cookies) ? cookies : [cookies]).find(
        (c: string) => c.startsWith(`${AUTH_COOKIE_NAME}=`),
      );
      expect(authCookie).toBeDefined();
      expect(authCookie).toContain('HttpOnly');
      expect(authCookie).toContain('SameSite=Lax');
      expect(authCookie).toContain('Path=/');

      // Body assertions
      expect(response.body).toEqual({
        data: {
          user: {
            id: expect.any(String),
            email: 'newuser@example.com',
            role: 'RESPONDENT',
            status: 'ACTIVE',
          },
        },
        error: null,
        meta: {},
      });

      // Crucial: token and passwordHash MUST NOT be in the body
      expect(response.body.data.user.passwordHash).toBeUndefined();
      expect(response.body.data.token).toBeUndefined();
    });
  });

  describe('AC2: Registration validation is deterministic', () => {
    it('should return 400 with AUTH_INVALID_REGISTRATION_INPUT for invalid inputs', async () => {
      const invalidCases = [
        { email: 'not-an-email', password: 'ValidPassword123!' },
        { email: 'valid@example.com', password: 'short' },
        { email: 'valid@example.com', password: 'a'.repeat(73) },
        {
          email: 'valid@example.com',
          password: 'ValidPassword123!',
          extra: 'field',
        },
      ];

      for (const invalidPayload of invalidCases) {
        const response = await request(app.getHttpServer())
          .post('/auth/register')
          .send(invalidPayload)
          .expect(400);

        expect(response.body).toEqual({
          data: null,
          error: {
            code: 'AUTH_INVALID_REGISTRATION_INPUT',
            message: expect.any(String),
            details: expect.anything(),
          },
          meta: {},
        });

        // No authentication cookie should be set
        expect(response.headers['set-cookie']).toBeUndefined();
      }
    });
  });

  describe('AC3: Duplicate registration is race-safe', () => {
    it('should return 409 AUTH_EMAIL_ALREADY_REGISTERED when email exists', async () => {
      // First registration
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'existing@example.com',
          password: 'Password12345!',
        })
        .expect(201);

      // Duplicate registration attempt
      const response = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: '  EXISTING@example.com  ',
          password: 'AnotherPassword123!',
        })
        .expect(409);

      expect(response.body).toEqual({
        data: null,
        error: {
          code: 'AUTH_EMAIL_ALREADY_REGISTERED',
          message: 'An account with this email already exists.',
        },
        meta: {},
      });
      expect(response.headers['set-cookie']).toBeUndefined();
    });
  });

  describe('AC4: Login succeeds with valid credentials', () => {
    it('should log in, issue new cookie, and return sanitized user envelope', async () => {
      // Create user first
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'login.user@example.com',
          password: 'CorrectPassword123!',
        })
        .expect(201);

      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: '  Login.User@Example.COM ',
          password: 'CorrectPassword123!',
        })
        .expect(200);

      expect(response.headers['cache-control']).toBe('no-store');

      const cookies = response.headers['set-cookie'];
      expect(cookies).toBeDefined();
      const authCookie = (Array.isArray(cookies) ? cookies : [cookies]).find(
        (c: string) => c.startsWith(`${AUTH_COOKIE_NAME}=`),
      );
      expect(authCookie).toBeDefined();
      expect(authCookie).toContain('HttpOnly');

      expect(response.body).toEqual({
        data: {
          user: {
            id: expect.any(String),
            email: 'login.user@example.com',
            role: 'RESPONDENT',
            status: 'ACTIVE',
          },
        },
        error: null,
        meta: {},
      });
      expect(response.body.data.user.passwordHash).toBeUndefined();
      expect(response.body.data.token).toBeUndefined();
    });
  });

  describe('AC5: Invalid login does not enumerate accounts', () => {
    it('should return identical 401 AUTH_INVALID_CREDENTIALS for all failure modes', async () => {
      // 1. Registered active user
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'registered@example.com',
          password: 'ValidPassword123!',
        })
        .expect(201);

      // 2. Locked user
      await userRepo.create({
        email: 'locked@example.com',
        passwordHash: '$2a$12$somehash',
        role: 'RESPONDENT',
        status: 'LOCKED',
      });

      // 3. Google-only user (no passwordHash)
      await userRepo.create({
        email: 'googleonly@example.com',
        passwordHash: null,
        role: 'RESPONDENT',
        status: 'ACTIVE',
      });

      const failureCases = [
        { email: 'unknown@example.com', password: 'AnyPassword123!' },
        { email: 'registered@example.com', password: 'WrongPassword123!' },
        { email: 'locked@example.com', password: 'ValidPassword123!' },
        { email: 'googleonly@example.com', password: 'AnyPassword123!' },
      ];

      for (const testCase of failureCases) {
        const response = await request(app.getHttpServer())
          .post('/auth/login')
          .send(testCase)
          .expect(401);

        expect(response.body).toEqual({
          data: null,
          error: {
            code: 'AUTH_INVALID_CREDENTIALS',
            message: 'Invalid email or password.',
          },
          meta: {},
        });
        expect(response.headers['set-cookie']).toBeUndefined();
      }
    });

    it('should return 400 AUTH_INVALID_LOGIN_INPUT for malformed login input', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'not-an-email', password: '' })
        .expect(400);

      expect(response.body).toEqual({
        data: null,
        error: {
          code: 'AUTH_INVALID_LOGIN_INPUT',
          message: expect.any(String),
          details: expect.anything(),
        },
        meta: {},
      });
      expect(response.headers['set-cookie']).toBeUndefined();
    });
  });

  describe('AC6: Cookie and CORS configuration', () => {
    it('should handle CORS origin allowlist correctly with credentials and reject unauthorized origins', async () => {
      // Allowed origin
      const allowedRes = await request(app.getHttpServer())
        .post('/auth/login')
        .set('Origin', 'http://localhost:3000')
        .send({ email: 'nobody@example.com', password: 'pw' });

      expect(allowedRes.headers['access-control-allow-origin']).toBe(
        'http://localhost:3000',
      );
      expect(allowedRes.headers['access-control-allow-credentials']).toBe(
        'true',
      );

      // Rejected origin
      const rejectedRes = await request(app.getHttpServer())
        .post('/auth/login')
        .set('Origin', 'http://unauthorized-evil.com')
        .send({ email: 'nobody@example.com', password: 'pw' });

      expect(
        rejectedRes.headers['access-control-allow-origin'],
      ).toBeUndefined();
    });

    it('should reject non-JSON payloads with 415 Unsupported Media Type', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/register')
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send('email=test@example.com&password=Password12345!');

      expect(response.status).toBe(415);
      expect(response.body.error.code).toBe('AUTH_UNSUPPORTED_MEDIA_TYPE');
    });
  });

  describe('AC7: Logout expires HTTP-only cookie', () => {
    it('should return 204 with no-store and clear the access token cookie', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/logout')
        .expect(204);

      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.text).toBe('');

      const cookies = response.headers['set-cookie'];
      expect(cookies).toBeDefined();
      const authCookie = (Array.isArray(cookies) ? cookies : [cookies]).find(
        (c: string) => c.startsWith(`${AUTH_COOKIE_NAME}=`),
      );
      expect(authCookie).toBeDefined();
      // Verifies cookie expiration (either Max-Age=0 or Expires in the past)
      expect(
        authCookie.includes('Max-Age=0') ||
          authCookie.includes('Expires=Thu, 01 Jan 1970'),
      ).toBe(true);
      expect(authCookie).toContain('Path=/');
      expect(authCookie).toContain('HttpOnly');
      expect(authCookie).toContain('SameSite=Lax');
    });
  });

  describe('AC8 & AC9: Session, CSRF bootstrap, and Refresh rotation', () => {
    it('should issue both access and refresh cookies on login and support CSRF bootstrap and refresh rotation', async () => {
      // 1. Register a user
      const regRes = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'sessionuser@example.com', password: 'Password12345!' })
        .expect(201);

      const regCookiesHeader = regRes.headers['set-cookie'];
      const regCookies = Array.isArray(regCookiesHeader)
        ? regCookiesHeader
        : [regCookiesHeader];
      const regAccess = regCookies.find((c: string) =>
        c.startsWith(`${AUTH_COOKIE_NAME}=`),
      );
      const regRefresh = regCookies.find((c: string) =>
        c.startsWith(`${REFRESH_COOKIE_NAME}=`),
      );

      expect(regAccess).toBeDefined();
      expect(regRefresh).toBeDefined();
      expect(regRefresh).toContain('Path=/auth');

      // Extract raw cookie values
      const accessVal = regAccess!.split(';')[0];
      const refreshVal = regRefresh!.split(';')[0];

      // 2. CSRF bootstrap with access cookie
      const csrfRes = await request(app.getHttpServer())
        .get('/auth/csrf')
        .set('Origin', 'http://localhost:3000')
        .set('Cookie', [accessVal])
        .expect(200);

      expect(csrfRes.headers['cache-control']).toBe('no-store');
      expect(csrfRes.body.data.csrfToken).toBeDefined();
      const initialCsrf = csrfRes.body.data.csrfToken;

      // 3. POST /auth/refresh with valid refresh cookie and X-CSRF-Token
      const refreshRes = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Origin', 'http://localhost:3000')
        .set('Cookie', [refreshVal])
        .set('X-CSRF-Token', initialCsrf)
        .expect(200);

      expect(refreshRes.headers['cache-control']).toBe('no-store');
      expect(refreshRes.body.data.csrfToken).toBeDefined();
      expect(refreshRes.body.data.csrfToken).not.toEqual(initialCsrf);

      const rotatedCookiesHeader = refreshRes.headers['set-cookie'];
      const rotatedCookies = Array.isArray(rotatedCookiesHeader)
        ? rotatedCookiesHeader
        : [rotatedCookiesHeader];
      const rotatedAccess = rotatedCookies.find((c: string) =>
        c.startsWith(`${AUTH_COOKIE_NAME}=`),
      );
      const rotatedRefresh = rotatedCookies.find((c: string) =>
        c.startsWith(`${REFRESH_COOKIE_NAME}=`),
      );
      expect(rotatedAccess).toBeDefined();
      expect(rotatedRefresh).toBeDefined();

      // 4. Replay old consumed refresh credential -> must fail with 401 and revoke session
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Origin', 'http://localhost:3000')
        .set('Cookie', [refreshVal])
        .set('X-CSRF-Token', refreshRes.body.data.csrfToken)
        .expect(401);

      // Rotated access token should now be revoked due to replay
      const rotatedAccessVal = rotatedAccess.split(';')[0];
      await request(app.getHttpServer())
        .get('/auth/csrf')
        .set('Origin', 'http://localhost:3000')
        .set('Cookie', [rotatedAccessVal])
        .expect(401);
    });
  });
});
