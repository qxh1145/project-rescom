import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import {
  forgotPasswordResultSchema,
  resetPasswordResultSchema,
} from '@rescom/schemas';
import { AppModule } from '../src/app.module';
import { USER_REPOSITORY_PORT } from '../src/modules/users/application/ports/user.repository.port';
import { InMemoryUserRepository } from '../src/modules/users/infrastructure/in-memory-user.repository';
import { SESSION_REPOSITORY_PORT } from '../src/modules/auth/application/ports/session-repository.port';
import { InMemorySessionRepository } from '../src/modules/auth/infrastructure/in-memory-session.repository';
import { IDENTITY_AUDIT_PORT } from '../src/modules/auth/application/ports/identity-audit.port';
import { InMemoryIdentityAuditRepository } from '../src/modules/auth/infrastructure/in-memory-identity-audit.repository';
import { PASSWORD_RESET_REPOSITORY_PORT } from '../src/modules/auth/application/ports/password-reset.repository.port';
import { InMemoryPasswordResetRepository } from '../src/modules/auth/infrastructure/in-memory-password-reset.repository';
import { PasswordResetService } from '../src/modules/auth/application/password-reset.service';
import { EMAIL_SENDER_PORT } from '../src/modules/notifications/application/ports/email-sender.port';
import { CaptureEmailSender } from '../src/modules/notifications/infrastructure/capture-email-sender';
import { HttpExceptionFilter } from '../src/common/http/http-exception.filter';
import { EnvService } from '../src/common/config/env.service';
import { PrismaService } from '../src/common/database/prisma.service';
import { LEDGER_REPOSITORY_PORT } from '../src/modules/economy/application/ports/ledger-repository.port';
import { InMemoryLedgerRepository } from '../src/modules/economy/infrastructure/in-memory-ledger.repository';
import { STARTER_POINTS_DATA_PROVIDER } from '../src/modules/economy/economy.module';
import { InMemoryStarterPointsDataProvider } from '../src/modules/economy/infrastructure/in-memory-starter-points-data-provider';
import {
  AUTH_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
} from '../src/modules/auth/presentation/cookie-options.helper';

/**
 * Plan 5.4 (forgot / reset password) and plan 5.6 (revoke reasons) through
 * the real AuthController, guards, pipes and exception filter, with
 * in-memory persistence and the capture email sender.
 */
describe('Password reset and session replacement (plan 5.4 / 5.6, e2e)', () => {
  let app: INestApplication;
  let userRepo: InMemoryUserRepository;
  let sessionRepo: InMemorySessionRepository;
  let auditRepo: InMemoryIdentityAuditRepository;
  let resetRepo: InMemoryPasswordResetRepository;
  let sender: CaptureEmailSender;
  let resetService: PasswordResetService;

  const TEST_JWT_SECRET = 'at_least_32_characters_super_secure_jwt_secret_key!';
  const ORIGIN = 'http://localhost:3000';
  const EMAIL = 'reset-me@example.com';
  const OLD_PASSWORD = 'mật khẩu cũ đủ dài';
  const NEW_PASSWORD = 'mật khẩu mới đủ dài';

  beforeAll(async () => {
    userRepo = new InMemoryUserRepository();
    auditRepo = new InMemoryIdentityAuditRepository();
    sessionRepo = new InMemorySessionRepository(auditRepo);
    resetRepo = new InMemoryPasswordResetRepository(
      userRepo,
      sessionRepo,
      auditRepo,
    );
    sender = new CaptureEmailSender();

    const envService = new EnvService({
      NODE_ENV: 'test',
      PORT: 4000,
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5433/rescom_test',
      JWT_SECRET: TEST_JWT_SECRET,
      JWT_ACCESS_TTL_SECONDS: 900,
      BCRYPT_ROUNDS: 12,
      FRONTEND_ORIGINS: ORIGIN,
    });

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
      .useValue(userRepo)
      .overrideProvider(SESSION_REPOSITORY_PORT)
      .useValue(sessionRepo)
      .overrideProvider(IDENTITY_AUDIT_PORT)
      .useValue(auditRepo)
      .overrideProvider(PASSWORD_RESET_REPOSITORY_PORT)
      .useValue(resetRepo)
      .overrideProvider(EMAIL_SENDER_PORT)
      .useValue(sender)
      .overrideProvider(EnvService)
      .useValue(envService)
      .compile();

    resetService = moduleFixture.get(PasswordResetService);
    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  function cookieOf(res: request.Response, name: string): string {
    const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    const match = cookies.find((cookie) => cookie.startsWith(`${name}=`));
    return match ? match.split(';')[0] : '';
  }

  function clearsAuthCookies(res: request.Response): boolean {
    const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    return [AUTH_COOKIE_NAME, REFRESH_COOKIE_NAME].every((name) =>
      cookies.some((cookie) => cookie.startsWith(`${name}=;`)),
    );
  }

  function login(password: string) {
    return request(app.getHttpServer())
      .post('/auth/login')
      .set('Content-Type', 'application/json')
      .send({ email: EMAIL, password });
  }

  function forgot(body: unknown, prefix = '') {
    return request(app.getHttpServer())
      .post(`${prefix}/auth/password/forgot`)
      .set('Content-Type', 'application/json')
      .send(body as object);
  }

  function reset(body: unknown) {
    return request(app.getHttpServer())
      .post('/auth/password/reset')
      .set('Content-Type', 'application/json')
      .send(body as object);
  }

  function tokenFromLastEmail(): string {
    const mail = sender.sent().at(-1)!;
    const match = mail.text.match(/reset-password\?token=([A-Za-z0-9_%-]+)/);
    return decodeURIComponent(match![1]);
  }

  it('registers the test account', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .set('Content-Type', 'application/json')
      .send({ email: EMAIL, password: OLD_PASSWORD })
      .expect(201);
  });

  it('answers 202 with the same body for a known and an unknown address', async () => {
    const known = await forgot({ email: EMAIL }).expect(202);
    const unknown = await forgot(
      { email: 'nobody@example.com' },
      '/api',
    ).expect(202);
    await resetService.flush();

    expect(known.body).toEqual(unknown.body);
    expect(forgotPasswordResultSchema.parse(known.body.data)).toEqual({
      accepted: true,
    });
    expect(known.headers['cache-control']).toBe('no-store');
    expect(sender.sent()).toHaveLength(1);
    expect(sender.sent()[0]).toMatchObject({
      to: EMAIL,
      subject: 'Rescom: Đặt lại mật khẩu',
    });
    expect(tokenFromLastEmail()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('validates the input with the shared schemas and accepts JSON only', async () => {
    const bad = await forgot({ email: 'not-an-email' }).expect(400);
    expect(bad.body.error.code).toBe('AUTH_INVALID_INPUT');
    await request(app.getHttpServer())
      .post('/auth/password/forgot')
      .set('Content-Type', 'text/plain')
      .send('email=x')
      .expect(415);

    const weak = await reset({ token: 'x', newPassword: 'short' }).expect(400);
    expect(weak.body.error.code).toBe('AUTH_INVALID_INPUT');
    expect(JSON.stringify(weak.body)).not.toContain('short');
  });

  it('resets the password, revokes every session with AUTH_SESSION_REVOKED and clears cookies', async () => {
    const signedIn = await login(OLD_PASSWORD).expect(200);
    const oldSession = cookieOf(signedIn, AUTH_COOKIE_NAME);

    await forgot({ email: EMAIL }).expect(202);
    await resetService.flush();
    const token = tokenFromLastEmail();

    const done = await reset({ token, newPassword: NEW_PASSWORD }).expect(200);
    expect(resetPasswordResultSchema.parse(done.body.data)).toEqual({
      passwordReset: true,
    });
    expect(clearsAuthCookies(done)).toBe(true);

    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', oldSession)
      .expect(401);
    expect(me.body.error.code).toBe('AUTH_SESSION_REVOKED');

    await login(OLD_PASSWORD).expect(401);
    await login(NEW_PASSWORD).expect(200);
    expect(auditRepo.records).toContainEqual(
      expect.objectContaining({ action: 'PASSWORD_RESET_COMPLETED' }),
    );
  });

  it('answers the same PASSWORD_RESET_TOKEN_INVALID for a used, unknown or malformed token', async () => {
    await forgot({ email: EMAIL }).expect(202);
    await resetService.flush();
    const token = tokenFromLastEmail();
    await reset({ token, newPassword: 'một mật khẩu khác nữa' }).expect(200);

    for (const candidate of [token, 'A'.repeat(43), 'not base64url!']) {
      const res = await reset({
        token: candidate,
        newPassword: 'mật khẩu thứ tư đủ dài',
      }).expect(400);
      expect(res.body.error.code).toBe('PASSWORD_RESET_TOKEN_INVALID');
    }
  });

  it('answers AUTH_SESSION_REPLACED to the device whose session a newer login replaced (plan 5.6)', async () => {
    const deviceA = await login('một mật khẩu khác nữa').expect(200);
    await login('một mật khẩu khác nữa').expect(200);

    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', cookieOf(deviceA, AUTH_COOKIE_NAME))
      .expect(401);
    expect(me.body.error.code).toBe('AUTH_SESSION_REPLACED');
    expect(clearsAuthCookies(me)).toBe(true);

    const refresh = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Origin', ORIGIN)
      .set('Cookie', cookieOf(deviceA, REFRESH_COOKIE_NAME))
      .set('x-csrf-token', 'any')
      .expect(401);
    expect(refresh.body.error.code).toBe('AUTH_SESSION_REPLACED');
  });
});
