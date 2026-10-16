import { randomUUID } from 'crypto';
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
import { SessionService } from '../src/modules/auth/application/session.service';
import { EnvService } from '../src/common/config/env.service';
import { PrismaService } from '../src/common/database/prisma.service';
import { HttpExceptionFilter } from '../src/common/http/http-exception.filter';
import { AUTH_COOKIE_NAME } from '../src/modules/auth/presentation/cookie-options.helper';
import { LedgerService } from '../src/modules/economy/application/ledger.service';

const origin = 'http://localhost:3000';

describe('Top-Up Refund (HTTP e2e)', () => {
  let app: INestApplication;
  let payosRepo: InMemoryPayosTopUpRepository;
  let ledgerRepo: InMemoryLedgerRepository;
  let ledgerService: LedgerService;
  let actor: { id: string; cookie: string; csrf: string };
  let other: { id: string; cookie: string; csrf: string };

  beforeAll(async () => {
    process.env.DATABASE_URL ||=
      'postgresql://postgres:postgres@localhost:5433/rescom_test';
    const users = new InMemoryUserRepository();
    const audits = new InMemoryIdentityAuditRepository();
    const sessions = new InMemorySessionRepository(audits);
    payosRepo = new InMemoryPayosTopUpRepository();
    ledgerRepo = new InMemoryLedgerRepository();
    ledgerService = new LedgerService(ledgerRepo);

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
      PAYOS_ENABLED: false, // Ensure refund routes work even when checkout is disabled!
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
      .useValue(ledgerRepo)
      .overrideProvider(TOP_UP_REPOSITORY_PORT)
      .useValue(new InMemoryTopUpRepository())
      .overrideProvider(PAYOS_TOP_UP_REPOSITORY_PORT)
      .useValue(payosRepo)
      .overrideProvider(PAYMENT_PROVIDER_PORT)
      .useValue(new FakePaymentProvider('test'))
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

    const service = module.get(SessionService);
    const makeActor = async (email: string) => {
      const user = await users.create({
        email,
        passwordHash: null,
        role: 'RESPONDENT',
        status: 'ACTIVE',
      });
      payosRepo.userEmails.set(user.id, email);
      const tokens = await service.createSession(user.id);
      return {
        id: user.id,
        cookie: `${AUTH_COOKIE_NAME}=${tokens.accessToken}`,
        csrf: tokens.csrfToken,
      };
    };

    actor = await makeActor('user-refund@fpt.edu.vn');
    other = await makeActor('other-refund@fpt.edu.vn');
  });

  afterAll(async () => {
    await app?.close();
  });

  async function seedSuccessfulTopUp(userId: string, points = 250) {
    const id = randomUUID();
    const orderCode = Math.floor(100_000 + Math.random() * 900_000);
    const journal = await ledgerService.creditPayosTopUp({
      topUpId: id,
      userId,
      points,
      orderCode,
    });
    payosRepo.creditJournals.set(journal.id, {
      id: journal.id,
      idempotencyKey: journal.idempotencyKey,
      createdAt: journal.createdAt,
    });

    const now = new Date();
    const row = {
      id,
      userId,
      orderCode,
      amountVnd: points * 200,
      points,
      status: 'SUCCESSFUL',
      checkoutUrl: null,
      paymentLinkId: 'link_1',
      expiresAt: new Date(now.getTime() + 600_000),
      cancelledAt: null,
      paidAt: now,
      journalId: journal.id,
      pointsCredited: points,
      amountPaidVnd: points * 200,
      providerReference: 'ref_1',
      counterAccountBankId: '970422',
      counterAccountBankName: 'MB Bank',
      counterAccountName: 'NGUYEN VAN A',
      counterAccountNumber: '0123456789',
      createdAt: now,
      channel: 'PAYOS',
    };
    payosRepo.rows.set(id, row as any);
    return row;
  }

  describe('Authentication & CSRF Guards', () => {
    it('returns 401 when no session cookie is provided', async () => {
      const dummyId = randomUUID();
      await request(app.getHttpServer())
        .post(`/economy/top-ups/payos/${dummyId}/refund-request`)
        .set('Origin', origin)
        .send({ reason: 'WRONG_AMOUNT', note: 'test' })
        .expect(401);

      await request(app.getHttpServer())
        .post(`/economy/top-ups/payos/${dummyId}/refund-request/withdraw`)
        .set('Origin', origin)
        .expect(401);
    });

    it('returns 403 when CSRF token is missing or invalid', async () => {
      const dummyId = randomUUID();
      await request(app.getHttpServer())
        .post(`/economy/top-ups/payos/${dummyId}/refund-request`)
        .set('Cookie', actor.cookie)
        .set('Origin', origin)
        .send({ reason: 'WRONG_AMOUNT', note: 'test' })
        .expect(403);

      await request(app.getHttpServer())
        .post(`/economy/top-ups/payos/${dummyId}/refund-request/withdraw`)
        .set('Cookie', actor.cookie)
        .set('Origin', origin)
        .expect(403);
    });
  });

  describe('Input Validation', () => {
    it('returns 400 when reason is missing or invalid', async () => {
      const topUp = await seedSuccessfulTopUp(actor.id);

      const res = await request(app.getHttpServer())
        .post(`/economy/top-ups/payos/${topUp.id}/refund-request`)
        .set('Cookie', actor.cookie)
        .set('x-csrf-token', actor.csrf)
        .set('Origin', origin)
        .send({ reason: 'INVALID_REASON', note: 'valid note' })
        .expect(400);

      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when the body has an unknown extra key (strict schema)', async () => {
      const topUp = await seedSuccessfulTopUp(actor.id);

      const res = await request(app.getHttpServer())
        .post(`/economy/top-ups/payos/${topUp.id}/refund-request`)
        .set('Cookie', actor.cookie)
        .set('x-csrf-token', actor.csrf)
        .set('Origin', origin)
        .send({
          reason: 'WRONG_AMOUNT',
          note: 'valid note',
          counterAccountNumber: '0123456789',
        })
        .expect(400);

      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when note exceeds 300 characters', async () => {
      const topUp = await seedSuccessfulTopUp(actor.id);

      const res = await request(app.getHttpServer())
        .post(`/economy/top-ups/payos/${topUp.id}/refund-request`)
        .set('Cookie', actor.cookie)
        .set('x-csrf-token', actor.csrf)
        .set('Origin', origin)
        .send({ reason: 'WRONG_AMOUNT', note: 'a'.repeat(301) })
        .expect(400);

      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when id is not a valid UUID', async () => {
      await request(app.getHttpServer())
        .post('/economy/top-ups/payos/not-a-uuid/refund-request')
        .set('Cookie', actor.cookie)
        .set('x-csrf-token', actor.csrf)
        .set('Origin', origin)
        .send({ reason: 'WRONG_AMOUNT', note: 'test' })
        .expect(400);
    });
  });

  describe('Authorization & Leakage Protection', () => {
    it('returns 404 when requesting refund on another user top-up', async () => {
      const otherTopUp = await seedSuccessfulTopUp(other.id);

      await request(app.getHttpServer())
        .post(`/economy/top-ups/payos/${otherTopUp.id}/refund-request`)
        .set('Cookie', actor.cookie)
        .set('x-csrf-token', actor.csrf)
        .set('Origin', origin)
        .send({ reason: 'WRONG_AMOUNT', note: 'trying other' })
        .expect(404);

      await request(app.getHttpServer())
        .post(`/economy/top-ups/payos/${otherTopUp.id}/refund-request/withdraw`)
        .set('Cookie', actor.cookie)
        .set('x-csrf-token', actor.csrf)
        .set('Origin', origin)
        .send({})
        .expect(404);
    });

    it('never leaks counterAccountNumber in read API or refund response', async () => {
      const topUp = await seedSuccessfulTopUp(actor.id, 100);

      // 1. Submit refund
      const submitRes = await request(app.getHttpServer())
        .post(`/economy/top-ups/payos/${topUp.id}/refund-request`)
        .set('Cookie', actor.cookie)
        .set('x-csrf-token', actor.csrf)
        .set('Origin', origin)
        .send({ reason: 'WRONG_AMOUNT', note: 'refund please' })
        .expect(200);

      const refundData = submitRes.body.data.request;
      expect(refundData.destination.last4).toBe('6789');
      expect(
        (refundData.destination as any).counterAccountNumber,
      ).toBeUndefined();
      expect((refundData.destination as any).accountNumber).toBeUndefined();

      // 2. GET /economy/top-ups/payos/:id
      const getRes = await request(app.getHttpServer())
        .get(`/economy/top-ups/payos/${topUp.id}`)
        .set('Cookie', actor.cookie)
        .expect(200);

      const topUpDto = getRes.body.data;
      expect((topUpDto as any).counterAccountNumber).toBeUndefined();
      expect(topUpDto.refundDeadline).not.toBeNull();
      expect(topUpDto.refund.request).not.toBeNull();
      expect(topUpDto.refund.request.destination.last4).toBe('6789');
      expect(
        (topUpDto.refund.request.destination as any).counterAccountNumber,
      ).toBeUndefined();

      // 3. Withdraw refund
      const withdrawRes = await request(app.getHttpServer())
        .post(`/economy/top-ups/payos/${topUp.id}/refund-request/withdraw`)
        .set('Cookie', actor.cookie)
        .set('x-csrf-token', actor.csrf)
        .set('Origin', origin)
        .send({})
        .expect(200);

      expect(withdrawRes.body.data.replayed).toBe(false);
      expect(withdrawRes.body.data.request.status).toBe('WITHDRAWN');
    });
  });
});
