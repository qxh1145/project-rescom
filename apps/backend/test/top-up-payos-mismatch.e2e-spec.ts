import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'crypto';
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
import { SessionService } from '../src/modules/auth/application/session.service';
import { EnvService } from '../src/common/config/env.service';
import { PrismaService } from '../src/common/database/prisma.service';
import { HttpExceptionFilter } from '../src/common/http/http-exception.filter';
import { AUTH_COOKIE_NAME } from '../src/modules/auth/presentation/cookie-options.helper';
import { UserRole } from '../src/modules/users/domain/user.entity';
import {
  UNIT_OF_WORK_PORT,
  PassThroughUnitOfWork,
} from '../src/common/database/unit-of-work.port';
import { PAYOS_TEST_CHECKSUM_KEY } from './fixtures/payos-webhook.fixture';

interface Actor {
  id: string;
  cookie: string;
  csrf: string;
}

describe('PayOS mismatch resolution (HTTP e2e)', () => {
  let app: INestApplication;
  let userRepo: InMemoryUserRepository;
  let payosRepo: InMemoryPayosTopUpRepository;
  let topUpRepo: InMemoryTopUpRepository;
  let ledgerRepo: InMemoryLedgerRepository;
  let provider: FakePaymentProvider;
  let sessionService: SessionService;

  const ALLOWED_ORIGIN = 'http://localhost:3000';
  let admin: Actor;
  let respondent: Actor;
  let publisher: Actor;

  async function createActor(email: string, role: UserRole): Promise<Actor> {
    const user = await userRepo.create({
      email,
      passwordHash: null,
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

  beforeAll(async () => {
    process.env.DATABASE_URL ||=
      'postgresql://postgres:postgres@localhost:5433/rescom_test';
    userRepo = new InMemoryUserRepository();
    const audits = new InMemoryIdentityAuditRepository();
    const sessions = new InMemorySessionRepository(audits);
    payosRepo = new InMemoryPayosTopUpRepository();
    topUpRepo = new InMemoryTopUpRepository();
    ledgerRepo = new InMemoryLedgerRepository();
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
      FRONTEND_ORIGINS: ALLOWED_ORIGIN,
      TOPUP_BANK_NAME: 'MB Bank',
      TOPUP_BANK_BIN: '970422',
      TOPUP_BANK_ACCOUNT_NUMBER: '0123456789',
      TOPUP_BANK_ACCOUNT_NAME: 'CONG TY RESCOM',
      TOPUP_REFUND_MAILBOX: 'refunds@rescom.test',
    });

    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(mockPrisma)
      .overrideProvider(USER_REPOSITORY_PORT)
      .useValue(userRepo)
      .overrideProvider(SESSION_REPOSITORY_PORT)
      .useValue(sessions)
      .overrideProvider(IDENTITY_AUDIT_PORT)
      .useValue(audits)
      .overrideProvider(LEDGER_REPOSITORY_PORT)
      .useValue(ledgerRepo)
      .overrideProvider(TOP_UP_REPOSITORY_PORT)
      .useValue(topUpRepo)
      .overrideProvider(PAYOS_TOP_UP_REPOSITORY_PORT)
      .useValue(payosRepo)
      .overrideProvider(PAYMENT_PROVIDER_PORT)
      .useValue(provider)
      .overrideProvider(UNIT_OF_WORK_PORT)
      .useValue(new PassThroughUnitOfWork())
      .overrideProvider(ADMIN_CAPABILITY_PORT)
      .useValue(
        new InMemoryAdminCapabilityRepository((id) => userRepo.findById(id)),
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

    sessionService = module.get(SessionService);
    admin = await createActor('admin-recheck@rescom.test', 'ADMIN');
    respondent = await createActor('user-recheck@fpt.edu.vn', 'RESPONDENT');
    publisher = await createActor(
      'publisher-mismatch@rescom.test',
      'PUBLISHER',
    );
  });

  afterAll(async () => {
    await app?.close();
  });

  it('enforces session, live role and CSRF; exposes masked account only', async () => {
    const created = await payosRepo.createProcessing(
      {
        id: randomUUID(),
        userId: respondent.id,
        amountVnd: 50_000,
        points: 250,
        expiresAt: new Date(Date.now() + 300_000),
        createdAt: new Date(),
      },
      { limit: 5, windowMs: 600_000, now: new Date() },
    );
    if (created.outcome !== 'CREATED') throw new Error('fixture failure');
    const row = created.topUp;
    row.status = 'AMOUNT_MISMATCH';
    row.amountPaidVnd = 49_000;
    row.paidAt = new Date();
    row.counterAccountNumber = '9876543210';
    row.counterAccountName = 'SECRET NAME';

    const body = {
      action: 'MANUAL_REFUND',
      expectedAmountPaidVnd: 49_000,
      note: 'Refund receipt',
    };
    await request(app.getHttpServer())
      .post(`/admin/top-ups/${row.id}/resolve-mismatch`)
      .set('Origin', ALLOWED_ORIGIN)
      .send(body)
      .expect(401);
    await request(app.getHttpServer())
      .post(`/admin/top-ups/${row.id}/resolve-mismatch`)
      .set('Cookie', respondent.cookie)
      .set('Origin', ALLOWED_ORIGIN)
      .set('x-csrf-token', respondent.csrf)
      .send(body)
      .expect(403);
    await request(app.getHttpServer())
      .post(`/admin/top-ups/${row.id}/resolve-mismatch`)
      .set('Cookie', publisher.cookie)
      .set('Origin', ALLOWED_ORIGIN)
      .set('x-csrf-token', publisher.csrf)
      .send(body)
      .expect(403);
    await request(app.getHttpServer())
      .post(`/admin/top-ups/${row.id}/resolve-mismatch`)
      .set('Cookie', admin.cookie)
      .set('Origin', ALLOWED_ORIGIN)
      .send(body)
      .expect(403);
    await request(app.getHttpServer())
      .post(`/admin/top-ups/${row.id}/resolve-mismatch`)
      .set('Cookie', admin.cookie)
      .set('Origin', ALLOWED_ORIGIN)
      .set('x-csrf-token', admin.csrf)
      .send({ action: 'MANUAL_REFUND', expectedAmountPaidVnd: 49_000 })
      .expect(400);
    const counts = await request(app.getHttpServer())
      .get('/admin/top-ups/tab-counts')
      .set('Cookie', admin.cookie)
      .expect(200);
    expect(counts.body.data.actionRequired).toBeGreaterThanOrEqual(1);
    const list = await request(app.getHttpServer())
      .get('/admin/top-ups/action-required')
      .set('Cookie', admin.cookie)
      .expect(200);
    expect(JSON.stringify(list.body)).not.toContain('9876543210');
    expect(JSON.stringify(list.body)).not.toContain('SECRET NAME');
    expect(
      list.body.data.mismatches.find(
        (item: { id: string }) => item.id === row.id,
      ),
    ).toMatchObject({ counterAccountLast4: '3210' });
    await request(app.getHttpServer())
      .post(`/admin/top-ups/${row.id}/resolve-mismatch`)
      .set('Cookie', admin.cookie)
      .set('Origin', ALLOWED_ORIGIN)
      .set('x-csrf-token', admin.csrf)
      .send(body)
      .expect(200);
    expect(row.status).toBe('MANUAL_REFUNDED');
  });
});
