import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { USER_REPOSITORY_PORT } from '../src/modules/users/application/ports/user.repository.port';
import { InMemoryUserRepository } from '../src/modules/users/infrastructure/in-memory-user.repository';
import { SESSION_REPOSITORY_PORT } from '../src/modules/auth/application/ports/session-repository.port';
import { InMemorySessionRepository } from '../src/modules/auth/infrastructure/in-memory-session.repository';
import { IDENTITY_AUDIT_PORT } from '../src/modules/auth/application/ports/identity-audit.port';
import { InMemoryIdentityAuditRepository } from '../src/modules/auth/infrastructure/in-memory-identity-audit.repository';
import { LEDGER_REPOSITORY_PORT } from '../src/modules/economy/application/ports/ledger-repository.port';
import { InMemoryLedgerRepository } from '../src/modules/economy/infrastructure/in-memory-ledger.repository';
import { TOP_UP_REPOSITORY_PORT } from '../src/modules/economy/application/ports/top-up-repository.port';
import { InMemoryTopUpRepository } from '../src/modules/economy/infrastructure/in-memory-top-up.repository';
import { PAYOS_TOP_UP_REPOSITORY_PORT } from '../src/modules/economy/application/ports/payos-top-up-repository.port';
import { InMemoryPayosTopUpRepository } from '../src/modules/economy/infrastructure/in-memory-payos-top-up.repository';
import { PAYMENT_PROVIDER_PORT } from '../src/modules/economy/application/ports/payment-provider.port';
import { FakePaymentProvider } from '../src/modules/economy/infrastructure/fake-payment-provider';
import { ADMIN_CAPABILITY_PORT } from '../src/modules/economy/application/ports/admin-capability.port';
import { InMemoryAdminCapabilityRepository } from '../src/modules/economy/infrastructure/in-memory-admin-capability.repository';
import { NOTIFICATION_REPOSITORY_PORT } from '../src/modules/notifications/application/ports/notification-repository.port';
import { InMemoryNotificationRepository } from '../src/modules/notifications/infrastructure/in-memory-notification.repository';
import { PayosAvailability } from '../src/modules/economy/application/payos-availability';
import { SessionService } from '../src/modules/auth/application/session.service';
import { EnvService } from '../src/common/config/env.service';
import { PrismaService } from '../src/common/database/prisma.service';
import { HttpExceptionFilter } from '../src/common/http/http-exception.filter';
import { AUTH_COOKIE_NAME } from '../src/modules/auth/presentation/cookie-options.helper';

const origin = 'http://localhost:3000';
describe('PayOS checkout (HTTP)', () => {
  let app: INestApplication;
  let availability: PayosAvailability;
  let provider: FakePaymentProvider;
  let actor: { cookie: string; csrf: string };
  let other: { cookie: string; csrf: string };
  beforeAll(async () => {
    process.env.DATABASE_URL ||=
      'postgresql://postgres:postgres@localhost:5433/rescom_test';
    const users = new InMemoryUserRepository();
    const audits = new InMemoryIdentityAuditRepository();
    const sessions = new InMemorySessionRepository(audits);
    provider = new FakePaymentProvider('test');
    const mockPrisma: any = {
      $connect: jest.fn(),
      $disconnect: jest.fn(),
      $transaction: jest.fn((callback) => callback(mockPrisma)),
    };
    const env = new EnvService({
      NODE_ENV: 'test',
      PORT: 4000,
      DATABASE_URL: process.env.DATABASE_URL,
      JWT_SECRET: 'at_least_32_characters_super_secure_jwt_secret_key!',
      JWT_ACCESS_TTL_SECONDS: 900,
      BCRYPT_ROUNDS: 12,
      FRONTEND_ORIGINS: origin,
      TOPUP_BANK_NAME: 'MB Bank',
      TOPUP_BANK_BIN: '970422',
      TOPUP_BANK_ACCOUNT_NUMBER: '0123456789',
      TOPUP_BANK_ACCOUNT_NAME: 'CONG TY RESCOM',
    });
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(mockPrisma)
      .overrideProvider(USER_REPOSITORY_PORT)
      .useValue(users)
      .overrideProvider(SESSION_REPOSITORY_PORT)
      .useValue(sessions)
      .overrideProvider(IDENTITY_AUDIT_PORT)
      .useValue(audits)
      .overrideProvider(LEDGER_REPOSITORY_PORT)
      .useValue(new InMemoryLedgerRepository())
      .overrideProvider(TOP_UP_REPOSITORY_PORT)
      .useValue(new InMemoryTopUpRepository())
      .overrideProvider(PAYOS_TOP_UP_REPOSITORY_PORT)
      .useValue(new InMemoryPayosTopUpRepository())
      .overrideProvider(PAYMENT_PROVIDER_PORT)
      .useValue(provider)
      .overrideProvider(ADMIN_CAPABILITY_PORT)
      .useValue(
        new InMemoryAdminCapabilityRepository((id) => users.findById(id)),
      )
      .overrideProvider(NOTIFICATION_REPOSITORY_PORT)
      .useValue(new InMemoryNotificationRepository())
      .overrideProvider(EnvService)
      .useValue(env)
      .compile();
    app = module.createNestApplication();
    app.use(cookieParser());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    availability = module.get(PayosAvailability);
    const service = module.get(SessionService);
    const makeActor = async (email: string) => {
      const user = await users.create({
        email,
        passwordHash: null,
        role: 'RESPONDENT',
        status: 'ACTIVE',
      });
      const tokens = await service.createSession(user.id);
      return {
        cookie: `${AUTH_COOKIE_NAME}=${tokens.accessToken}`,
        csrf: tokens.csrfToken,
      };
    };
    actor = await makeActor('payos-first@fpt.edu.vn');
    other = await makeActor('payos-second@fpt.edu.vn');
  });
  afterAll(async () => {
    await app?.close();
  });
  const checkout = (
    app: INestApplication,
    actor: { cookie: string; csrf: string },
    amountVnd: number,
  ) =>
    request(app.getHttpServer())
      .post('/economy/top-ups/payos')
      .set('Cookie', actor.cookie)
      .set('x-csrf-token', actor.csrf)
      .set('Origin', origin)
      .send({ amountVnd, points: 99999 });
  it('closes checkout and keeps manual submission until enable', async () => {
    await checkout(app, actor, 10_000).expect(404);
    await request(app.getHttpServer())
      .get('/economy/top-ups/payos/availability')
      .set('Cookie', actor.cookie)
      .expect(200)
      .expect((response) =>
        expect(response.body.data.payosEnabled).toBe(false),
      );
    await request(app.getHttpServer())
      .post('/economy/top-ups')
      .set('Cookie', actor.cookie)
      .set('x-csrf-token', actor.csrf)
      .set('Origin', origin)
      .send({ amount: 100 })
      .expect(201);
    availability.open();
    await request(app.getHttpServer())
      .get('/economy/top-ups/payos/availability')
      .set('Cookie', actor.cookie)
      .expect(200)
      .expect((response) => expect(response.body.data.payosEnabled).toBe(true));
  });
  it('rejects amounts before provider, checks owner and cancels while manual closes', async () => {
    for (const amount of [9999, 10_100, 5_000_200])
      await checkout(app, actor, amount).expect(400);
    expect(provider.createCalls).toHaveLength(0);
    await request(app.getHttpServer())
      .post('/economy/top-ups')
      .set('Cookie', actor.cookie)
      .set('x-csrf-token', actor.csrf)
      .set('Origin', origin)
      .send({ amount: 100 })
      .expect(404);
    await request(app.getHttpServer())
      .post('/economy/top-ups/payos')
      .set('Cookie', actor.cookie)
      .set('Origin', origin)
      .send({ amountVnd: 10000 })
      .expect(403);
    const first = await checkout(app, actor, 10_000).expect(201);
    const id = first.body.data.topUp.id;
    expect(first.body.data.topUp.points).toBe(50);
    const repeat = await checkout(app, actor, 10_000).expect(409);
    expect(repeat.body.error.details.topUpId).toBe(id);
    await request(app.getHttpServer())
      .post(`/economy/top-ups/payos/${id}/cancel`)
      .set('Cookie', other.cookie)
      .set('x-csrf-token', other.csrf)
      .set('Origin', origin)
      .send({})
      .expect(404);
    await request(app.getHttpServer())
      .post(`/economy/top-ups/payos/${id}/cancel`)
      .set('Cookie', actor.cookie)
      .set('x-csrf-token', actor.csrf)
      .set('Origin', origin)
      .send({})
      .expect(200);
    await request(app.getHttpServer())
      .get(`/economy/top-ups/payos/${id}`)
      .set('Cookie', actor.cookie)
      .expect(200)
      .expect((response) =>
        expect(response.body.data.status).toBe('CANCELLED'),
      );
    const second = await checkout(app, actor, 10_000).expect(201);

    // List top-ups
    await request(app.getHttpServer())
      .get('/economy/top-ups/payos')
      .expect(401);

    const listRes = await request(app.getHttpServer())
      .get('/economy/top-ups/payos?limit=10&offset=0')
      .set('Cookie', actor.cookie)
      .expect(200);
    expect(listRes.body.data.total).toBe(2);
    expect(listRes.body.data.items[0].id).toBe(second.body.data.topUp.id);

    const otherListRes = await request(app.getHttpServer())
      .get('/economy/top-ups/payos')
      .set('Cookie', other.cookie)
      .expect(200);
    expect(otherListRes.body.data.total).toBe(0);
  });
});

