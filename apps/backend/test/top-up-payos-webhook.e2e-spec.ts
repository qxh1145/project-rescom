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
import { UnconfiguredPaymentProvider } from '../src/modules/economy/infrastructure/unconfigured-payment-provider';
import { ADMIN_CAPABILITY_PORT } from '../src/modules/economy/application/ports/admin-capability.port';
import { InMemoryAdminCapabilityRepository } from '../src/modules/economy/infrastructure/in-memory-admin-capability.repository';
import { NOTIFICATION_REPOSITORY_PORT } from '../src/modules/notifications/application/ports/notification-repository.port';
import { InMemoryNotificationRepository } from '../src/modules/notifications/infrastructure/in-memory-notification.repository';
import { PayosAvailability } from '../src/modules/economy/application/payos-availability';
import { EnvService } from '../src/common/config/env.service';
import { PrismaService } from '../src/common/database/prisma.service';
import { HttpExceptionFilter } from '../src/common/http/http-exception.filter';
import {
  buildPaymentLink,
  buildPayosWebhookData,
  signPayosWebhook,
  PAYOS_TEST_CHECKSUM_KEY,
} from './fixtures/payos-webhook.fixture';
import {
  UNIT_OF_WORK_PORT,
  PassThroughUnitOfWork,
} from '../src/common/database/unit-of-work.port';

describe('PayOS webhook (HTTP)', () => {
  let app: INestApplication;
  let provider: FakePaymentProvider;
  let repository: InMemoryPayosTopUpRepository;
  let ledger: InMemoryLedgerRepository;
  let availability: PayosAvailability;
  let userId: string;
  beforeAll(async () => {
    process.env.DATABASE_URL ||=
      'postgresql://postgres:postgres@localhost:5433/rescom_test';
    const users = new InMemoryUserRepository();
    const audits = new InMemoryIdentityAuditRepository();
    const sessions = new InMemorySessionRepository(audits);
    repository = new InMemoryPayosTopUpRepository();
    ledger = new InMemoryLedgerRepository();
    provider = new FakePaymentProvider(PAYOS_TEST_CHECKSUM_KEY);
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
      FRONTEND_ORIGINS: 'http://localhost:3000',
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
      .useValue(ledger)
      .overrideProvider(TOP_UP_REPOSITORY_PORT)
      .useValue(new InMemoryTopUpRepository())
      .overrideProvider(PAYOS_TOP_UP_REPOSITORY_PORT)
      .useValue(repository)
      .overrideProvider(PAYMENT_PROVIDER_PORT)
      .useValue(provider)
      .overrideProvider(UNIT_OF_WORK_PORT)
      .useValue(new PassThroughUnitOfWork())
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
    userId = (
      await users.create({
        email: 'webhook-test@fpt.edu.vn',
        passwordHash: null,
        role: 'RESPONDENT',
        status: 'ACTIVE',
      })
    ).id;
  });
  afterAll(async () => app?.close());
  it('credits once without cookie, CSRF or Origin even when checkout closed; alternate path and failures', async () => {
    expect(availability.isCheckoutOpen()).toBe(false);
    const topUp = await repository.createProcessing(
      {
        id: '89c9c2bb-b73d-413d-a42a-252cc275c803',
        userId,
        amountVnd: 20_000,
        points: 100,
        expiresAt: new Date(Date.now() + 300000),
        createdAt: new Date(),
      },
      { limit: 5, windowMs: 600000, now: new Date() },
    );
    if (topUp.outcome !== 'CREATED') throw new Error('fixture');
    const row = topUp.topUp;
    provider.setPayment(
      row.orderCode,
      buildPaymentLink({ orderCode: row.orderCode, id: String(row.orderCode) }),
    );
    const signed = signPayosWebhook(
      buildPayosWebhookData({
        orderCode: row.orderCode,
        paymentLinkId: String(row.orderCode),
      }),
    );
    const post = (prefix: string, body: object) =>
      request(app.getHttpServer())
        .post(`${prefix}/economy/top-ups/payos/webhook`)
        .send(body);
    await post('', { ...signed, signature: 'wrong' }).expect(401);
    expect(repository.rows.get(row.id)?.status).toBe('PROCESSING');
    await post('', signed).expect(200, { received: true });
    await post('/api', signed).expect(200, { received: true });
    for (let n = 0; n < 105; n++) await post('', signed).expect(200);
    expect(
      repository.events.filter(
        (event) => event.payload.status === 'SUCCESSFUL',
      ),
    ).toHaveLength(1);
    expect(
      (await ledger.findAccountByUserAndClass(userId, 'USER_AVAILABLE'))
        ?.balance,
    ).toBe(100);
    await post(
      '',
      signPayosWebhook(
        buildPayosWebhookData({
          orderCode: 999999999,
          paymentLinkId: 'unknown',
        }),
      ),
    ).expect(200);
    const another = await repository.createProcessing(
      {
        id: '6fc0aba7-7767-4364-a1b5-856061278b75',
        userId,
        amountVnd: 20_000,
        points: 100,
        expiresAt: new Date(Date.now() + 300000),
        createdAt: new Date(),
      },
      { limit: 5, windowMs: 600000, now: new Date() },
    );
    if (another.outcome !== 'CREATED') throw new Error('fixture');
    const verify = provider.verifyWebhook.bind(provider);
    const unconfigured = new UnconfiguredPaymentProvider();
    provider.verifyWebhook = unconfigured.verifyWebhook.bind(unconfigured);
    await post('', signed).expect(503);
    provider.verifyWebhook = verify;
    provider.failNext('getPayment');
    await post(
      '',
      signPayosWebhook(
        buildPayosWebhookData({
          orderCode: another.topUp.orderCode,
          paymentLinkId: String(another.topUp.orderCode),
        }),
      ),
    ).expect(503);
  });
});
