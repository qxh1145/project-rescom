import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import {
  productTourListSchema,
  productTourProgressSchema,
} from '@rescom/schemas';
import { AppModule } from '../src/app.module';
import { USER_REPOSITORY_PORT } from '../src/modules/users/application/ports/user.repository.port';
import { InMemoryUserRepository } from '../src/modules/users/infrastructure/in-memory-user.repository';
import { SESSION_REPOSITORY_PORT } from '../src/modules/auth/application/ports/session-repository.port';
import { InMemorySessionRepository } from '../src/modules/auth/infrastructure/in-memory-session.repository';
import { IDENTITY_AUDIT_PORT } from '../src/modules/auth/application/ports/identity-audit.port';
import { InMemoryIdentityAuditRepository } from '../src/modules/auth/infrastructure/in-memory-identity-audit.repository';
import { PRODUCT_TOUR_REPOSITORY_PORT } from '../src/modules/product-tours/application/ports/product-tour-repository.port';
import { InMemoryProductTourRepository } from '../src/modules/product-tours/infrastructure/in-memory-product-tour.repository';
import { SessionService } from '../src/modules/auth/application/session.service';
import { EnvService } from '../src/common/config/env.service';
import { PrismaService } from '../src/common/database/prisma.service';
import { HttpExceptionFilter } from '../src/common/http/http-exception.filter';
import { AUTH_COOKIE_NAME } from '../src/modules/auth/presentation/cookie-options.helper';

/**
 * `GET /product-tours` and `PUT /product-tours/:tourId`: session and CSRF
 * guards, validation, per-account isolation, and responses parsed with the
 * shared product-tour schemas the frontend uses.
 */
describe('Product tours E2E', () => {
  let app: INestApplication;
  let userRepo: InMemoryUserRepository;
  let sessionService: SessionService;

  const ALLOWED_ORIGIN = 'http://localhost:3000';

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
      email: `tour-${seed}@fpt.edu.vn`,
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

  const list = (who: Actor | null, prefix = '') => {
    const req = request(app.getHttpServer()).get(`${prefix}/product-tours`);
    return who ? req.set('Cookie', [who.cookie]) : req;
  };

  const put = (who: Actor, tourId: string, body: unknown, prefix = '') =>
    request(app.getHttpServer())
      .put(`${prefix}/product-tours/${tourId}`)
      .set('Origin', ALLOWED_ORIGIN)
      .set('Cookie', [who.cookie])
      .set('X-CSRF-Token', who.csrf)
      .set('Content-Type', 'application/json')
      .send(body as object);

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ||
      'postgresql://postgres:postgres@localhost:5433/rescom_test';

    userRepo = new InMemoryUserRepository();
    const auditRepo = new InMemoryIdentityAuditRepository();
    const sessionRepo = new InMemorySessionRepository(auditRepo);

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
      .overrideProvider(PRODUCT_TOUR_REPOSITORY_PORT)
      .useValue(new InMemoryProductTourRepository())
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

  it('rejects GET and PUT without a session with 401', async () => {
    const anonymous = await list(null).expect(401);
    expect(anonymous.body.data).toBeNull();
    await request(app.getHttpServer())
      .put('/product-tours/FIRST_SURVEY')
      .set('Origin', ALLOWED_ORIGIN)
      .set('Content-Type', 'application/json')
      .send({ status: 'COMPLETED', step: 2 })
      .expect(401);
  });

  it('rejects PUT without the CSRF token with 403', async () => {
    const who = await actor('RESPONDENT');
    await request(app.getHttpServer())
      .put('/product-tours/FIRST_SURVEY')
      .set('Origin', ALLOWED_ORIGIN)
      .set('Cookie', [who.cookie])
      .set('Content-Type', 'application/json')
      .send({ status: 'IN_PROGRESS', step: 1 })
      .expect(403);
  });

  it('lists nothing for an account that never touched a tour', async () => {
    const who = await actor('RESPONDENT');
    const res = await list(who).expect(200);
    expect(productTourListSchema.parse(res.body.data)).toEqual({ tours: [] });
  });

  it('saves progress, lists it on both prefixes and keeps accounts apart', async () => {
    const who = await actor('RESPONDENT');
    const other = await actor('PUBLISHER');

    const saved = await put(who, 'FIRST_SURVEY', {
      status: 'IN_PROGRESS',
      step: 2,
    }).expect(200);
    expect(productTourProgressSchema.parse(saved.body.data)).toMatchObject({
      tourId: 'FIRST_SURVEY',
      status: 'IN_PROGRESS',
      step: 2,
    });

    await put(
      who,
      'FORM_BUILDER',
      { status: 'DISMISSED', step: 0 },
      '/api',
    ).expect(200);

    for (const prefix of ['', '/api']) {
      const res = await list(who, prefix).expect(200);
      const tours = productTourListSchema.parse(res.body.data).tours;
      expect(tours.map((t) => t.tourId).sort()).toEqual([
        'FIRST_SURVEY',
        'FORM_BUILDER',
      ]);
    }

    const otherList = await list(other).expect(200);
    expect(productTourListSchema.parse(otherList.body.data).tours).toEqual([]);
  });

  it('keeps a COMPLETED tour completed after a later IN_PROGRESS or DISMISSED write', async () => {
    const who = await actor('RESPONDENT');
    await put(who, 'TRACK_SURVEY', { status: 'COMPLETED', step: 3 }).expect(
      200,
    );
    for (const status of ['IN_PROGRESS', 'DISMISSED']) {
      const res = await put(who, 'TRACK_SURVEY', { status, step: 1 }).expect(
        200,
      );
      expect(productTourProgressSchema.parse(res.body.data)).toMatchObject({
        status: 'COMPLETED',
        step: 1,
      });
    }
  });

  it('rejects an unknown tour id, an invalid body and extra keys with 400 VALIDATION_ERROR', async () => {
    const who = await actor('RESPONDENT');
    const cases: [string, unknown][] = [
      ['NOT_A_TOUR', { status: 'COMPLETED', step: 0 }],
      ['FIRST_SURVEY', { status: 'DONE', step: 0 }],
      ['FIRST_SURVEY', { status: 'COMPLETED', step: 8 }],
      ['FIRST_SURVEY', { status: 'COMPLETED', step: -1 }],
      ['FIRST_SURVEY', { status: 'COMPLETED', step: 1, extra: true }],
    ];
    for (const [tourId, body] of cases) {
      const res = await put(who, tourId, body).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });
});
