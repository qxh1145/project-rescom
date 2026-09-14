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
  OAUTH_INTENT_COOKIE_NAME,
} from '../src/modules/auth/presentation/cookie-options.helper';
import { SESSION_REPOSITORY_PORT } from '../src/modules/auth/application/ports/session-repository.port';
import { IDENTITY_AUDIT_PORT } from '../src/modules/auth/application/ports/identity-audit.port';
import { InMemorySessionRepository } from '../src/modules/auth/infrastructure/in-memory-session.repository';
import { InMemoryIdentityAuditRepository } from '../src/modules/auth/infrastructure/in-memory-identity-audit.repository';
import {
  OAUTH_PROVIDER_PORT,
  OAuthProviderPort,
} from '../src/modules/auth/application/ports/oauth-provider.port';
import { OAUTH_INTENT_REPOSITORY_PORT } from '../src/modules/auth/application/ports/oauth-intent-repository.port';
import { InMemoryOAuthIntentRepository } from '../src/modules/auth/infrastructure/in-memory-oauth-intent.repository';
import { OAUTH_PERSISTENCE_PORT } from '../src/modules/auth/application/ports/oauth-persistence.port';
import { InMemoryOAuthRepository } from '../src/modules/auth/infrastructure/in-memory-oauth.repository';
import { PrismaService } from '../src/common/database/prisma.service';
import { GoogleProviderUnavailableException } from '../src/modules/auth/application/exceptions/auth.exceptions';

function getCookies(res: request.Response): string[] {
  const c = res.headers['set-cookie'];
  if (!c) return [];
  return Array.isArray(c) ? c : [c];
}

describe('Google OAuth E2E Tests (AC1 - AC7, AC11 - AC13)', () => {
  let app: INestApplication;
  let userRepo: InMemoryUserRepository;
  let sessionRepo: InMemorySessionRepository;
  let auditRepo: InMemoryIdentityAuditRepository;
  let oauthIntentRepo: InMemoryOAuthIntentRepository;
  let oauthRepo: InMemoryOAuthRepository;
  let envService: EnvService;
  let mockOAuthProvider: jest.Mocked<OAuthProviderPort>;

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ||
      'postgresql://postgres:postgres@localhost:5433/rescom_test';

    userRepo = new InMemoryUserRepository();
    auditRepo = new InMemoryIdentityAuditRepository();
    sessionRepo = new InMemorySessionRepository(auditRepo);
    oauthIntentRepo = new InMemoryOAuthIntentRepository();
    oauthRepo = new InMemoryOAuthRepository(userRepo, auditRepo);

    envService = new EnvService({
      NODE_ENV: 'test',
      PORT: 4000,
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5433/rescom_test',
      JWT_SECRET: 'at_least_32_characters_super_secure_jwt_secret_key!',
      JWT_ACCESS_TTL_SECONDS: 900,
      SESSION_ABSOLUTE_TTL_SECONDS: 2592000,
      BCRYPT_ROUNDS: 12,
      FRONTEND_ORIGINS: 'http://localhost:3000',
      GOOGLE_CLIENT_ID: 'google-client-id-test',
      GOOGLE_CLIENT_SECRET: 'google-client-secret-test',
      GOOGLE_REDIRECT_URI: 'http://localhost:4000/auth/google/callback',
      AUTH_FRONTEND_SUCCESS_URL: 'http://localhost:3000/auth/success',
      AUTH_FRONTEND_ERROR_URL: 'http://localhost:3000/auth/error',
      OAUTH_INTENT_TTL_SECONDS: 600,
      SECRET_PROTECTION_KEY:
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      SECRET_PROTECTION_KEY_VERSION: 1,
    });

    mockOAuthProvider = {
      generateAuthorizationUrl: jest.fn().mockImplementation((params) => {
        return `https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=google-client-id-test&redirect_uri=http://localhost:4000/auth/google/callback&scope=openid%20email&state=${params.state}&nonce=${params.nonce}&code_challenge=${params.codeChallenge}&code_challenge_method=S256`;
      }),
      exchangeAndVerify: jest.fn(),
    };

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
      .overrideProvider(OAUTH_INTENT_REPOSITORY_PORT)
      .useValue(oauthIntentRepo)
      .overrideProvider(OAUTH_PERSISTENCE_PORT)
      .useValue(oauthRepo)
      .overrideProvider(OAUTH_PROVIDER_PORT)
      .useValue(mockOAuthProvider)
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
    if (app) {
      await app.close();
    }
  });

  beforeEach(() => {
    userRepo.clear();
    sessionRepo.clear();
    auditRepo.clear();
    oauthIntentRepo.clear();
    oauthRepo.clear();
    jest.clearAllMocks();
  });

  describe('AC1: Google authorization initiation (GET /auth/google)', () => {
    it('should initiate login flow, set intent cookie, and redirect to Google', async () => {
      const response = await request(app.getHttpServer())
        .get('/auth/google')
        .expect(302);

      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers.location).toContain(
        'https://accounts.google.com/o/oauth2/v2/auth',
      );
      expect(response.headers.location).toContain('code_challenge_method=S256');

      const cookies = getCookies(response);
      const intentCookie = cookies.find((c: string) =>
        c.startsWith(`${OAUTH_INTENT_COOKIE_NAME}=`),
      );
      expect(intentCookie).toBeDefined();
      expect(intentCookie).toContain('HttpOnly');
      expect(intentCookie).toContain('Path=/auth/google/callback');
      expect(intentCookie).toContain('SameSite=Lax');

      // Intent must be persisted
      const intents = (oauthIntentRepo as any).intents;
      expect(intents.size).toBe(1);
    });

    it('should invalidate prior intents when initiateLogin is called with an existing intent cookie', async () => {
      // First initiation
      const firstRes = await request(app.getHttpServer())
        .get('/auth/google')
        .expect(302);

      const firstCookie = getCookies(firstRes).find((c) =>
        c.startsWith(`${OAUTH_INTENT_COOKIE_NAME}=`),
      )!;
      const rawCookieVal = firstCookie.split(';')[0];

      // Second initiation with the first intent cookie
      await request(app.getHttpServer())
        .get('/auth/google')
        .set('Cookie', [rawCookieVal])
        .expect(302);

      const intents = Array.from(
        (oauthIntentRepo as any).intents.values(),
      ) as any[];
      expect(intents.length).toBe(2);
      const invalidated = intents.find((i) => i.failedAt !== null);
      expect(invalidated).toBeDefined();
    });
  });

  describe('AC2: Callback validation fails closed and cannot be replayed (GET /auth/google/callback)', () => {
    it('should redirect to frontend error URL when intent cookie is missing', async () => {
      const response = await request(app.getHttpServer())
        .get('/auth/google/callback?code=mock_code&state=mock_state')
        .expect(303);

      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers.location).toBe(
        'http://localhost:3000/auth/error?error=AUTH_INVALID_OAUTH_INTENT',
      );

      // Clears intent cookie
      const cookies = getCookies(response);
      const intentCookie = cookies.find((c: string) =>
        c.startsWith(`${OAUTH_INTENT_COOKIE_NAME}=`),
      );
      expect(intentCookie).toBeDefined();
      expect(
        intentCookie!.includes('Max-Age=0') ||
          intentCookie!.includes('Expires=Thu, 01 Jan 1970'),
      ).toBe(true);
    });

    it('should redirect to frontend error URL when state does not match', async () => {
      // 1. Initiate login
      const initRes = await request(app.getHttpServer())
        .get('/auth/google')
        .expect(302);

      const initCookie = getCookies(initRes).find((c) =>
        c.startsWith(`${OAUTH_INTENT_COOKIE_NAME}=`),
      )!;
      const rawCookieVal = initCookie.split(';')[0];

      // 2. Callback with wrong state
      const response = await request(app.getHttpServer())
        .get('/auth/google/callback?code=mock_code&state=wrong_state')
        .set('Cookie', [rawCookieVal])
        .expect(303);

      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers.location).toBe(
        'http://localhost:3000/auth/error?error=AUTH_INVALID_OAUTH_INTENT',
      );
    });

    it('should handle provider denial and map to GOOGLE_AUTH_CANCELLED', async () => {
      // 1. Initiate login
      const initRes = await request(app.getHttpServer())
        .get('/auth/google')
        .expect(302);

      const location = initRes.headers.location;
      const stateMatch = location.match(/state=([^&]+)/);
      const state = stateMatch ? decodeURIComponent(stateMatch[1]) : '';

      const initCookie = getCookies(initRes).find((c) =>
        c.startsWith(`${OAUTH_INTENT_COOKIE_NAME}=`),
      )!;
      const rawCookieVal = initCookie.split(';')[0];

      // 2. Callback with error=access_denied
      const response = await request(app.getHttpServer())
        .get(`/auth/google/callback?error=access_denied&state=${state}`)
        .set('Cookie', [rawCookieVal])
        .expect(303);

      expect(response.headers.location).toBe(
        'http://localhost:3000/auth/error?error=GOOGLE_AUTH_CANCELLED',
      );

      // Verify intent was consumed
      const intentId = rawCookieVal.split('=')[1].split('.')[0];
      const consumed = await oauthIntentRepo.findById(intentId);
      expect(consumed?.isConsumed()).toBe(true);
    });

    it('should reject callback replay with AUTH_INVALID_OAUTH_INTENT', async () => {
      // 1. Initiate login
      const initRes = await request(app.getHttpServer())
        .get('/auth/google')
        .expect(302);

      const location = initRes.headers.location;
      const state = decodeURIComponent(location.match(/state=([^&]+)/)![1]);
      const initCookie = getCookies(initRes).find((c) =>
        c.startsWith(`${OAUTH_INTENT_COOKIE_NAME}=`),
      )!;
      const rawCookieVal = initCookie.split(';')[0];

      mockOAuthProvider.exchangeAndVerify.mockResolvedValueOnce({
        sub: 'replayed-sub',
        email: 'replayed@example.com',
        emailVerified: true,
      });

      // 2. First callback succeeds
      await request(app.getHttpServer())
        .get(`/auth/google/callback?code=valid_code&state=${state}`)
        .set('Cookie', [rawCookieVal])
        .expect(303);

      // 3. Replay with same intent and state
      const replayRes = await request(app.getHttpServer())
        .get(`/auth/google/callback?code=valid_code&state=${state}`)
        .set('Cookie', [rawCookieVal])
        .expect(303);

      expect(replayRes.headers.location).toBe(
        'http://localhost:3000/auth/error?error=AUTH_INVALID_OAUTH_INTENT',
      );
    });
  });

  describe('AC3, AC4, AC5: Identity verification, first-time, and returning login', () => {
    it('should successfully authenticate new user on first-time Google login', async () => {
      // 1. Initiate login
      const initRes = await request(app.getHttpServer())
        .get('/auth/google')
        .expect(302);

      const location = initRes.headers.location;
      const state = decodeURIComponent(location.match(/state=([^&]+)/)![1]);
      const initCookie = getCookies(initRes).find((c) =>
        c.startsWith(`${OAUTH_INTENT_COOKIE_NAME}=`),
      )!;
      const rawCookieVal = initCookie.split(';')[0];

      mockOAuthProvider.exchangeAndVerify.mockResolvedValueOnce({
        sub: 'google-sub-first-time',
        email: 'firsttime@gmail.com',
        emailVerified: true,
      });

      // 2. Callback
      const callbackRes = await request(app.getHttpServer())
        .get(`/auth/google/callback?code=good_code&state=${state}`)
        .set('Cookie', [rawCookieVal])
        .expect(303);

      expect(callbackRes.headers.location).toBe(
        'http://localhost:3000/auth/success',
      );

      // Check cookies
      const cookies = getCookies(callbackRes);
      const authCookie = cookies.find((c) =>
        c.startsWith(`${AUTH_COOKIE_NAME}=`),
      );
      const refreshCookie = cookies.find((c) =>
        c.startsWith(`${REFRESH_COOKIE_NAME}=`),
      );
      const clearIntentCookie = cookies.find((c) =>
        c.startsWith(`${OAUTH_INTENT_COOKIE_NAME}=`),
      );

      expect(authCookie).toBeDefined();
      expect(refreshCookie).toBeDefined();
      expect(
        clearIntentCookie!.includes('Max-Age=0') ||
          clearIntentCookie!.includes('Expires=Thu, 01 Jan 1970'),
      ).toBe(true);

      // Check user created
      const createdUser = await userRepo.findByEmail('firsttime@gmail.com');
      expect(createdUser).toBeDefined();
      expect(createdUser?.role).toBe('RESPONDENT');
      expect(createdUser?.status).toBe('ACTIVE');
      expect(createdUser?.passwordHash).toBeNull();
    });

    it('should resolve existing user by provider subject on returning login', async () => {
      // Seed user with linked Google identity
      const existingUser = await userRepo.create({
        email: 'returning@gmail.com',
        passwordHash: null,
        role: 'RESPONDENT',
        status: 'ACTIVE',
      });
      await oauthRepo.linkGoogleIdentity({
        userId: existingUser.id,
        sub: 'google-sub-returning',
      });

      // 1. Initiate login
      const initRes = await request(app.getHttpServer())
        .get('/auth/google')
        .expect(302);

      const location = initRes.headers.location;
      const state = decodeURIComponent(location.match(/state=([^&]+)/)![1]);
      const initCookie = getCookies(initRes).find((c) =>
        c.startsWith(`${OAUTH_INTENT_COOKIE_NAME}=`),
      )!;
      const rawCookieVal = initCookie.split(';')[0];

      mockOAuthProvider.exchangeAndVerify.mockResolvedValueOnce({
        sub: 'google-sub-returning',
        email: 'returning-changed-email@gmail.com', // Even if email changed, resolves by sub
        emailVerified: true,
      });

      // 2. Callback
      const callbackRes = await request(app.getHttpServer())
        .get(`/auth/google/callback?code=good_code&state=${state}`)
        .set('Cookie', [rawCookieVal])
        .expect(303);

      expect(callbackRes.headers.location).toBe(
        'http://localhost:3000/auth/success',
      );

      // Verify single active session created for existing user
      const sessions = Array.from(
        (sessionRepo as any).sessions.values(),
      ) as any[];
      const activeSession = sessions.find(
        (s) => s.userId === existingUser.id && !s.revoked,
      );
      expect(activeSession).toBeDefined();
    });

    it('should fail closed when returning user is locked', async () => {
      const lockedUser = await userRepo.create({
        email: 'locked@gmail.com',
        passwordHash: null,
        role: 'RESPONDENT',
        status: 'LOCKED',
      });
      await oauthRepo.linkGoogleIdentity({
        userId: lockedUser.id,
        sub: 'google-sub-locked',
      });

      // 1. Initiate login
      const initRes = await request(app.getHttpServer())
        .get('/auth/google')
        .expect(302);

      const location = initRes.headers.location;
      const state = decodeURIComponent(location.match(/state=([^&]+)/)![1]);
      const initCookie = getCookies(initRes).find((c) =>
        c.startsWith(`${OAUTH_INTENT_COOKIE_NAME}=`),
      )!;
      const rawCookieVal = initCookie.split(';')[0];

      mockOAuthProvider.exchangeAndVerify.mockResolvedValueOnce({
        sub: 'google-sub-locked',
        email: 'locked@gmail.com',
        emailVerified: true,
      });

      // 2. Callback
      const callbackRes = await request(app.getHttpServer())
        .get(`/auth/google/callback?code=good_code&state=${state}`)
        .set('Cookie', [rawCookieVal])
        .expect(303);

      expect(callbackRes.headers.location).toBe(
        'http://localhost:3000/auth/error?error=AUTH_INVALID_CREDENTIALS',
      );
      // No session cookies issued
      const cookies = getCookies(callbackRes);
      expect(
        cookies.find((c) => c.startsWith(`${AUTH_COOKIE_NAME}=`)),
      ).toBeUndefined();
    });

    it('should handle provider unavailable error gracefully', async () => {
      const initRes = await request(app.getHttpServer())
        .get('/auth/google')
        .expect(302);

      const location = initRes.headers.location;
      const state = decodeURIComponent(location.match(/state=([^&]+)/)![1]);
      const initCookie = getCookies(initRes).find((c) =>
        c.startsWith(`${OAUTH_INTENT_COOKIE_NAME}=`),
      )!;
      const rawCookieVal = initCookie.split(';')[0];

      mockOAuthProvider.exchangeAndVerify.mockRejectedValueOnce(
        new GoogleProviderUnavailableException('Network failure'),
      );

      const callbackRes = await request(app.getHttpServer())
        .get(`/auth/google/callback?code=good_code&state=${state}`)
        .set('Cookie', [rawCookieVal])
        .expect(303);

      expect(callbackRes.headers.location).toBe(
        'http://localhost:3000/auth/error?error=AUTH_GOOGLE_PROVIDER_UNAVAILABLE',
      );
    });
  });

  describe('AC6: Matching password email collision never auto-links', () => {
    it('should fail closed with AUTH_GOOGLE_LINK_REQUIRED when verified Google email matches password user', async () => {
      // Pre-existing user with password
      await userRepo.create({
        email: 'collision@example.com',
        passwordHash: '$2a$10$fakehashfortestingpassword123',
        role: 'RESPONDENT',
        status: 'ACTIVE',
      });

      // Initiate login
      const initRes = await request(app.getHttpServer())
        .get('/auth/google')
        .expect(302);

      const location = initRes.headers.location;
      const state = decodeURIComponent(location.match(/state=([^&]+)/)![1]);
      const initCookie = getCookies(initRes).find((c) =>
        c.startsWith(`${OAUTH_INTENT_COOKIE_NAME}=`),
      )!;
      const rawCookieVal = initCookie.split(';')[0];

      // Google returns this email with unlinked sub
      mockOAuthProvider.exchangeAndVerify.mockResolvedValueOnce({
        sub: 'unlinked-google-sub',
        email: 'collision@example.com',
        emailVerified: true,
      });

      const callbackRes = await request(app.getHttpServer())
        .get(`/auth/google/callback?code=good_code&state=${state}`)
        .set('Cookie', [rawCookieVal])
        .expect(303);

      expect(callbackRes.headers.location).toBe(
        'http://localhost:3000/auth/error?error=AUTH_GOOGLE_LINK_REQUIRED',
      );

      // Verify no session cookie was issued
      const cookies = getCookies(callbackRes);
      expect(
        cookies.find((c) => c.startsWith(`${AUTH_COOKIE_NAME}=`)),
      ).toBeUndefined();
    });
  });

  describe('AC7: Explicit Google link and unlink', () => {
    let passwordUser: any;
    let accessCookieVal: string;
    let csrfToken: string;

    beforeEach(async () => {
      // Register a user to obtain valid session, cookie, and CSRF
      const regRes = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'linkable@example.com', password: 'ValidPassword123!' })
        .expect(201);

      const cookies = getCookies(regRes);
      const authCookie = cookies.find((c) =>
        c.startsWith(`${AUTH_COOKIE_NAME}=`),
      )!;
      accessCookieVal = authCookie.split(';')[0];
      passwordUser = await userRepo.findByEmail('linkable@example.com');

      // Bootstrap CSRF
      const csrfRes = await request(app.getHttpServer())
        .get('/auth/csrf')
        .set('Origin', 'http://localhost:3000')
        .set('Cookie', [accessCookieVal])
        .expect(200);

      csrfToken = csrfRes.body.data.csrfToken;
    });

    it('should reject POST /auth/google/link/start with wrong password', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/google/link/start')
        .set('Origin', 'http://localhost:3000')
        .set('Cookie', [accessCookieVal])
        .set('X-CSRF-Token', csrfToken)
        .send({ currentPassword: 'WrongPassword999!' })
        .expect(401);

      expect(response.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
    });

    it('should reject POST /auth/google/link/start with invalid CSRF token', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/google/link/start')
        .set('Origin', 'http://localhost:3000')
        .set('Cookie', [accessCookieVal])
        .set('X-CSRF-Token', 'invalid_csrf_token_value')
        .send({ currentPassword: 'ValidPassword123!' })
        .expect(403);

      expect(response.body.error.code).toBe('AUTH_INVALID_CSRF_TOKEN');
    });

    it('should initiate link with valid recent-auth and complete link callback', async () => {
      // 1. Link start
      const linkStartRes = await request(app.getHttpServer())
        .post('/auth/google/link/start')
        .set('Origin', 'http://localhost:3000')
        .set('Cookie', [accessCookieVal])
        .set('X-CSRF-Token', csrfToken)
        .send({ currentPassword: 'ValidPassword123!' })
        .expect(303);

      expect(linkStartRes.headers.location).toContain(
        'https://accounts.google.com/o/oauth2/v2/auth',
      );
      const location = linkStartRes.headers.location;
      const state = decodeURIComponent(location.match(/state=([^&]+)/)![1]);

      const cookies = getCookies(linkStartRes);
      const intentCookie = cookies.find((c) =>
        c.startsWith(`${OAUTH_INTENT_COOKIE_NAME}=`),
      )!;
      const rawIntentCookieVal = intentCookie.split(';')[0];

      mockOAuthProvider.exchangeAndVerify.mockResolvedValueOnce({
        sub: 'google-sub-linked',
        email: 'linkable@example.com',
        emailVerified: true,
      });

      // 2. Link callback
      const callbackRes = await request(app.getHttpServer())
        .get(`/auth/google/callback?code=link_code&state=${state}`)
        .set('Cookie', [rawIntentCookieVal])
        .expect(303);

      expect(callbackRes.headers.location).toBe(
        'http://localhost:3000/auth/success',
      );

      // Verify user now has linked identity
      const { identityCount } = await oauthRepo.countUserLoginMethods(
        passwordUser.id,
      );
      expect(identityCount).toBe(1);

      // 3. Attempting to link another Google account to the same user should now be rejected at link/start
      const nextCsrfRes = await request(app.getHttpServer())
        .get('/auth/csrf')
        .set('Origin', 'http://localhost:3000')
        .set('Cookie', [accessCookieVal])
        .expect(200);

      const conflictRes = await request(app.getHttpServer())
        .post('/auth/google/link/start')
        .set('Origin', 'http://localhost:3000')
        .set('Cookie', [accessCookieVal])
        .set('X-CSRF-Token', nextCsrfRes.body.data.csrfToken)
        .send({ currentPassword: 'ValidPassword123!' })
        .expect(409);

      expect(conflictRes.body.error.code).toBe('AUTH_GOOGLE_IDENTITY_CONFLICT');
    });

    it('should successfully unlink Google identity when password remains', async () => {
      // Link Google identity first
      await oauthRepo.linkGoogleIdentity({
        userId: passwordUser.id,
        sub: 'google-sub-to-unlink',
      });

      const { identityCount: beforeCount } =
        await oauthRepo.countUserLoginMethods(passwordUser.id);
      expect(beforeCount).toBe(1);

      // Unlink
      await request(app.getHttpServer())
        .delete('/auth/google/link')
        .set('Origin', 'http://localhost:3000')
        .set('Cookie', [accessCookieVal])
        .set('X-CSRF-Token', csrfToken)
        .send({ currentPassword: 'ValidPassword123!' })
        .expect(204);

      const { identityCount: afterCount } =
        await oauthRepo.countUserLoginMethods(passwordUser.id);
      expect(afterCount).toBe(0);

      // Verify audit record was created
      const unlinkedLog = auditRepo.records.find(
        (l) => l.action === 'IDENTITY_UNLINKED',
      );
      expect(unlinkedLog).toBeDefined();
      expect(unlinkedLog?.outcome).toBe('SUCCESS');
    });
  });
});
