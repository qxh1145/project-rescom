import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'crypto';
import { payosRecheckResultSchema } from '@rescom/schemas';
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
import { TopUpRequestEntity } from '../src/modules/economy/domain/top-up-request.entity';
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
import {
  buildPaymentLink,
  PAYOS_TEST_CHECKSUM_KEY,
} from './fixtures/payos-webhook.fixture';

interface Actor {
  id: string;
  cookie: string;
  csrf: string;
}

describe('PayOS Admin Recheck (HTTP e2e)', () => {
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
  });

  afterAll(async () => {
    await app?.close();
  });

  function postRecheck(
    actor: Actor,
    topUpId: string,
    options?: {
      prefix?: string;
      correlationId?: string;
      csrf?: string;
      origin?: string;
    },
  ) {
    const prefix = options?.prefix ?? '';
    const correlationId = options?.correlationId ?? randomUUID();
    const req = request(app.getHttpServer())
      .post(`${prefix}/admin/top-ups/${topUpId}/recheck`)
      .set('Cookie', actor.cookie)
      .set('Origin', options?.origin ?? ALLOWED_ORIGIN)
      .set('x-correlation-id', correlationId);

    if (options?.csrf !== undefined) {
      if (options.csrf) req.set('x-csrf-token', options.csrf);
    } else {
      req.set('x-csrf-token', actor.csrf);
    }

    return req;
  }

  it('ADMIN -> 200 for CREDITED, STILL_UNPAID, and MISMATCH; validates schema and creates audit Outbox row', async () => {
    // 1. CREDITED scenario
    const topUp1 = await payosRepo.createProcessing(
      {
        id: randomUUID(),
        userId: randomUUID(),
        amountVnd: 50_000,
        points: 250,
        expiresAt: new Date(Date.now() + 300000),
        createdAt: new Date(),
      },
      { limit: 5, windowMs: 600000, now: new Date() },
    );
    if (topUp1.outcome !== 'CREATED') throw new Error('fixture failure');
    const row1 = topUp1.topUp;

    provider.setPayment(
      row1.orderCode,
      buildPaymentLink({
        orderCode: row1.orderCode,
        id: String(row1.orderCode),
        amount: 50_000,
        amountPaid: 50_000,
        amountRemaining: 0,
        status: 'PAID',
      }),
    );

    const correlationId1 = randomUUID();
    const resCredited = await postRecheck(admin, row1.id, {
      correlationId: correlationId1,
    }).expect(200);

    const parsedCredited = payosRecheckResultSchema.parse(
      resCredited.body.data,
    );
    expect(parsedCredited.result).toBe('CREDITED');
    expect(parsedCredited.status).toBe('SUCCESSFUL');
    expect(parsedCredited.amountPaidVnd).toBe(50_000);

    // Verify audit Outbox event recorded
    const auditCredited = payosRepo.auditEvents.find(
      (e) => e.payload.topUpId === row1.id,
    );
    expect(auditCredited).toBeDefined();
    expect(auditCredited?.payload.result).toBe('CREDITED');
    expect(auditCredited?.payload.adminId).toBe(admin.id);
    expect(auditCredited?.payload.correlationId).toBe(correlationId1);

    // 2. STILL_UNPAID scenario
    const topUp2 = await payosRepo.createProcessing(
      {
        id: randomUUID(),
        userId: randomUUID(),
        amountVnd: 100_000,
        points: 500,
        expiresAt: new Date(Date.now() + 300000),
        createdAt: new Date(),
      },
      { limit: 5, windowMs: 600000, now: new Date() },
    );
    if (topUp2.outcome !== 'CREATED') throw new Error('fixture failure');
    const row2 = topUp2.topUp;

    provider.setPayment(
      row2.orderCode,
      buildPaymentLink({
        orderCode: row2.orderCode,
        id: String(row2.orderCode),
        amount: 100_000,
        amountPaid: 0,
        amountRemaining: 100_000,
        status: 'PENDING',
      }),
    );

    const resUnpaid = await postRecheck(admin, row2.id, {
      prefix: '/api',
    }).expect(200);

    const parsedUnpaid = payosRecheckResultSchema.parse(resUnpaid.body.data);
    expect(parsedUnpaid.result).toBe('STILL_UNPAID');
    expect(parsedUnpaid.status).toBe('PROCESSING');

    // 3. MISMATCH scenario
    const topUp3 = await payosRepo.createProcessing(
      {
        id: randomUUID(),
        userId: randomUUID(),
        amountVnd: 200_000,
        points: 1000,
        expiresAt: new Date(Date.now() + 300000),
        createdAt: new Date(),
      },
      { limit: 5, windowMs: 600000, now: new Date() },
    );
    if (topUp3.outcome !== 'CREATED') throw new Error('fixture failure');
    const row3 = topUp3.topUp;

    provider.setPayment(
      row3.orderCode,
      buildPaymentLink({
        orderCode: row3.orderCode,
        id: String(row3.orderCode),
        amount: 200_000,
        amountPaid: 150_000,
        amountRemaining: 50_000,
        status: 'UNDERPAID',
      }),
    );

    const resMismatch = await postRecheck(admin, row3.id).expect(200);
    const parsedMismatch = payosRecheckResultSchema.parse(
      resMismatch.body.data,
    );
    expect(parsedMismatch.result).toBe('MISMATCH');
    expect(parsedMismatch.status).toBe('AMOUNT_MISMATCH');
    expect(parsedMismatch.amountPaidVnd).toBe(150_000);
  });

  it('repeat recheck on SUCCESSFUL -> CREDITED with no second ledger journal', async () => {
    const topUp = await payosRepo.createProcessing(
      {
        id: randomUUID(),
        userId: randomUUID(),
        amountVnd: 50_000,
        points: 250,
        expiresAt: new Date(Date.now() + 300000),
        createdAt: new Date(),
      },
      { limit: 5, windowMs: 600000, now: new Date() },
    );
    if (topUp.outcome !== 'CREATED') throw new Error('fixture failure');
    const row = topUp.topUp;

    provider.setPayment(
      row.orderCode,
      buildPaymentLink({
        orderCode: row.orderCode,
        id: String(row.orderCode),
        amount: 50_000,
        amountPaid: 50_000,
        amountRemaining: 0,
        status: 'PAID',
      }),
    );

    // Initial recheck credits row
    await postRecheck(admin, row.id).expect(200);
    const initialJournal = await ledgerRepo.findJournalByIdempotencyKey(
      `topup-credit:${row.id}`,
    );
    expect(initialJournal).toBeDefined();

    // Repeat recheck
    const resRepeat = await postRecheck(admin, row.id).expect(200);
    const parsed = payosRecheckResultSchema.parse(resRepeat.body.data);
    expect(parsed.result).toBe('CREDITED');
    expect(parsed.status).toBe('SUCCESSFUL');

    // Confirm journal still exists and is the same
    const repeatJournal = await ledgerRepo.findJournalByIdempotencyKey(
      `topup-credit:${row.id}`,
    );
    expect(repeatJournal?.id).toBe(initialJournal?.id);
  });

  it('records PROVIDER_UNAVAILABLE audit row and returns 503 when payment provider is down', async () => {
    const topUp = await payosRepo.createProcessing(
      {
        id: randomUUID(),
        userId: randomUUID(),
        amountVnd: 50_000,
        points: 250,
        expiresAt: new Date(Date.now() + 300000),
        createdAt: new Date(),
      },
      { limit: 5, windowMs: 600000, now: new Date() },
    );
    if (topUp.outcome !== 'CREATED') throw new Error('fixture failure');
    const row = topUp.topUp;

    provider.failNext('getPayment');

    const correlationId = randomUUID();
    const res = await postRecheck(admin, row.id, { correlationId }).expect(503);
    expect(res.body.error.code).toBe('PAYMENT_PROVIDER_UNAVAILABLE');

    const audit = payosRepo.auditEvents.find(
      (e) =>
        e.payload.topUpId === row.id &&
        e.payload.result === 'PROVIDER_UNAVAILABLE',
    );
    expect(audit).toBeDefined();
    expect(audit?.payload.correlationId).toBe(correlationId);
  });

  it('USER role -> 403; no CSRF -> 403; manual row or unknown id -> 404', async () => {
    const validUuid = randomUUID();

    // 1. USER role -> 403
    await postRecheck(respondent, validUuid).expect(403);

    // 2. No CSRF -> 403
    await postRecheck(admin, validUuid, { csrf: '' }).expect(403);

    // 3. Unknown ID -> 404
    await postRecheck(admin, validUuid).expect(404);

    // 4. Manual top-up row -> 404
    const manualId = randomUUID();
    await topUpRepo.createPending(
      new TopUpRequestEntity({
        id: manualId,
        userId: respondent.id,
        amount: 100,
        amountVnd: 20000,
        transferReference: 'RESCOMMANUAL1',
      }),
      5,
    );
    await postRecheck(admin, manualId).expect(404);
  });
});
