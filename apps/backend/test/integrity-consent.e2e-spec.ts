import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { integrityConsentSchema } from '@rescom/schemas';
import { AppModule } from '../src/app.module';
import { USER_REPOSITORY_PORT } from '../src/modules/users/application/ports/user.repository.port';
import { InMemoryUserRepository } from '../src/modules/users/infrastructure/in-memory-user.repository';
import { SESSION_REPOSITORY_PORT } from '../src/modules/auth/application/ports/session-repository.port';
import { InMemorySessionRepository } from '../src/modules/auth/infrastructure/in-memory-session.repository';
import { IDENTITY_AUDIT_PORT } from '../src/modules/auth/application/ports/identity-audit.port';
import { InMemoryIdentityAuditRepository } from '../src/modules/auth/infrastructure/in-memory-identity-audit.repository';
import { INTEGRITY_CONSENT_REPOSITORY_PORT } from '../src/modules/participation/application/ports/integrity-consent-repository.port';
import { InMemoryIntegrityConsentRepository } from '../src/modules/participation/infrastructure/in-memory-integrity-consent.repository';
import { SessionService } from '../src/modules/auth/application/session.service';
import { EnvService } from '../src/common/config/env.service';
import { PrismaService } from '../src/common/database/prisma.service';
import { HttpExceptionFilter } from '../src/common/http/http-exception.filter';
import { AUTH_COOKIE_NAME } from '../src/modules/auth/presentation/cookie-options.helper';

/**
 * Integrity telemetry notice (Figma 14): `GET|POST /integrity/consent`
 * through guards, pipes, envelope and filter. Every success body is parsed
 * with the shared `integrityConsentSchema` (backend half of the contract).
 */
describe('Integrity consent (e2e)', () => {
  let app: INestApplication;
  let userRepo: InMemoryUserRepository;
  let consentRepo: InMemoryIntegrityConsentRepository;
  let sessionService: SessionService;

  const ALLOWED_ORIGIN = 'http://localhost:3000';

  async function actor(email: string) {
    const user = await userRepo.create({
      email,
      passwordHash: '$2a$12$someHashedPassword',
      role: 'RESPONDENT',
      status: 'ACTIVE',
    });
    const tokens = await sessionService.createSession(user.id);
    return {
      id: user.id,
      cookie: `${AUTH_COOKIE_NAME}=${tokens.accessToken}`,
      csrf: tokens.csrfToken,
    };
  }

  function accept(
    who: { cookie: string; csrf: string },
    body: unknown,
    prefix = '',
  ) {
    return request(app.getHttpServer())
      .post(`${prefix}/integrity/consent`)
      .set('Cookie', who.cookie)
      .set('x-csrf-token', who.csrf)
      .set('Origin', ALLOWED_ORIGIN)
      .set('Content-Type', 'application/json')
      .send(body as object);
  }

  beforeAll(async () => {
    userRepo = new InMemoryUserRepository();
    const auditRepo = new InMemoryIdentityAuditRepository();
    consentRepo = new InMemoryIntegrityConsentRepository();
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
      .useValue(new InMemorySessionRepository(auditRepo))
      .overrideProvider(IDENTITY_AUDIT_PORT)
      .useValue(auditRepo)
      .overrideProvider(INTEGRITY_CONSENT_REPOSITORY_PORT)
      .useValue(consentRepo)
      .overrideProvider(EnvService)
      .useValue(
        new EnvService({
          NODE_ENV: 'test',
          PORT: 4000,
          DATABASE_URL:
            'postgresql://postgres:postgres@localhost:5433/rescom_test',
          JWT_SECRET: 'at_least_32_characters_super_secure_jwt_secret_key!',
          JWT_ACCESS_TTL_SECONDS: 900,
          BCRYPT_ROUNDS: 12,
          FRONTEND_ORIGINS: ALLOWED_ORIGIN,
        }),
      )
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

  it('requires a session for both routes', async () => {
    const read = await request(app.getHttpServer()).get('/integrity/consent');
    const write = await request(app.getHttpServer())
      .post('/integrity/consent')
      .set('Origin', ALLOWED_ORIGIN)
      .set('Content-Type', 'application/json')
      .send({ noticeVersion: 1 });
    expect(read.status).toBe(401);
    expect(write.status).toBe(401);
  });

  it('reads, accepts once and replays the original acceptance', async () => {
    const user = await actor('consent-reader@rescom.test');

    const before = await request(app.getHttpServer())
      .get('/api/integrity/consent')
      .set('Cookie', user.cookie);
    expect(before.status).toBe(200);
    expect(before.headers['cache-control']).toBe('no-store');
    expect(integrityConsentSchema.parse(before.body.data)).toEqual({
      currentVersion: 1,
      acceptedVersion: null,
      acceptedAt: null,
    });

    const first = await accept(user, { noticeVersion: 1 });
    expect(first.status).toBe(200);
    const accepted = integrityConsentSchema.parse(first.body.data);
    expect(accepted).toMatchObject({ currentVersion: 1, acceptedVersion: 1 });

    const replay = await accept(user, { noticeVersion: 1 }, '/api');
    expect(replay.status).toBe(200);
    expect(replay.body.data).toEqual(first.body.data);

    const after = await request(app.getHttpServer())
      .get('/integrity/consent')
      .set('Cookie', user.cookie);
    expect(after.body.data).toEqual(first.body.data);
    expect(
      consentRepo.records.filter((record) => record.userId === user.id),
    ).toHaveLength(1);
  });

  it('refuses another notice version with 409 and records nothing', async () => {
    const user = await actor('consent-stale@rescom.test');

    const res = await accept(user, { noticeVersion: 2 });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: 'INTEGRITY_CONSENT_VERSION_MISMATCH',
      details: { currentVersion: 1 },
    });
    expect(
      consentRepo.records.filter((record) => record.userId === user.id),
    ).toHaveLength(0);
  });

  it('enforces CSRF, JSON and the strict body', async () => {
    const user = await actor('consent-guards@rescom.test');

    const noCsrf = await request(app.getHttpServer())
      .post('/integrity/consent')
      .set('Cookie', user.cookie)
      .set('Origin', ALLOWED_ORIGIN)
      .set('Content-Type', 'application/json')
      .send({ noticeVersion: 1 });
    expect(noCsrf.status).toBe(403);

    const notJson = await request(app.getHttpServer())
      .post('/integrity/consent')
      .set('Cookie', user.cookie)
      .set('x-csrf-token', user.csrf)
      .set('Origin', ALLOWED_ORIGIN)
      .set('Content-Type', 'text/plain')
      .send('noticeVersion=1');
    expect(notJson.status).toBe(415);

    for (const body of [
      {},
      { noticeVersion: '1' },
      { noticeVersion: 1, x: 1 },
    ]) {
      const invalid = await accept(user, body);
      expect(invalid.status).toBe(400);
      expect(invalid.body.error.code).toBe('VALIDATION_ERROR');
    }
  });
});
