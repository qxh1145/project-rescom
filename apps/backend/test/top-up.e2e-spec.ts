import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import {
  adminTopUpRequestListSchema,
  topUpRequestListSchema,
  topUpRequestSchema,
  topUpReviewResultSchema,
} from '@rescom/schemas';
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
import { ADMIN_CAPABILITY_PORT } from '../src/modules/economy/application/ports/admin-capability.port';
import {
  CapabilitySourceUser,
  InMemoryAdminCapabilityRepository,
} from '../src/modules/economy/infrastructure/in-memory-admin-capability.repository';
import { NOTIFICATION_REPOSITORY_PORT } from '../src/modules/notifications/application/ports/notification-repository.port';
import { InMemoryNotificationRepository } from '../src/modules/notifications/infrastructure/in-memory-notification.repository';
import { SessionService } from '../src/modules/auth/application/session.service';
import { LedgerService } from '../src/modules/economy/application/ledger.service';
import { EnvService } from '../src/common/config/env.service';
import { PrismaService } from '../src/common/database/prisma.service';
import { HttpExceptionFilter } from '../src/common/http/http-exception.filter';
import { AUTH_COOKIE_NAME } from '../src/modules/auth/presentation/cookie-options.helper';
import { UserRole } from '../src/modules/users/domain/user.entity';

interface Actor {
  id: string;
  cookie: string;
  csrf: string;
}

describe('Story 6.6: Point Top-Up Request & Admin Approval (e2e)', () => {
  let app: INestApplication;
  let userRepo: InMemoryUserRepository;
  let ledgerRepo: InMemoryLedgerRepository;
  let topUpRepo: InMemoryTopUpRepository;
  let notificationRepo: InMemoryNotificationRepository;
  let sessionService: SessionService;
  let ledgerService: LedgerService;
  /** Simulates an Identity change committed after the session was validated. */
  const capabilityOverrides = new Map<string, CapabilitySourceUser>();

  const TEST_JWT_SECRET = 'at_least_32_characters_super_secure_jwt_secret_key!';
  const ALLOWED_ORIGIN = 'http://localhost:3000';

  let respondent: Actor;
  let otherRespondent: Actor;
  let admin: Actor;

  async function createActor(email: string, role: UserRole): Promise<Actor> {
    const user = await userRepo.create({
      email,
      passwordHash: null,
      role,
      status: 'ACTIVE',
    });
    topUpRepo.setUserEmail(user.id, user.email);
    const tokens = await sessionService.createSession(user.id);
    return {
      id: user.id,
      cookie: `${AUTH_COOKIE_NAME}=${tokens.accessToken}`,
      csrf: tokens.csrfToken,
    };
  }

  function createTopUp(actor: Actor, body: unknown, prefix = '') {
    return request(app.getHttpServer())
      .post(`${prefix}/economy/top-ups`)
      .set('Cookie', actor.cookie)
      .set('x-csrf-token', actor.csrf)
      .set('Origin', ALLOWED_ORIGIN)
      .send(body as object);
  }

  function approve(actor: Actor, topUpId: string) {
    return request(app.getHttpServer())
      .post(`/admin/top-ups/${topUpId}/approve`)
      .set('Cookie', actor.cookie)
      .set('x-csrf-token', actor.csrf)
      .set('Origin', ALLOWED_ORIGIN);
  }

  function reject(actor: Actor, topUpId: string, body: unknown) {
    return request(app.getHttpServer())
      .post(`/admin/top-ups/${topUpId}/reject`)
      .set('Cookie', actor.cookie)
      .set('x-csrf-token', actor.csrf)
      .set('Origin', ALLOWED_ORIGIN)
      .send(body as object);
  }

  async function availableOf(userId: string): Promise<number> {
    return (await ledgerService.getWallet(userId)).balance.available;
  }

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ||
      'postgresql://postgres:postgres@localhost:5433/rescom_test';

    userRepo = new InMemoryUserRepository();
    const auditRepo = new InMemoryIdentityAuditRepository();
    const sessionRepo = new InMemorySessionRepository(auditRepo);
    ledgerRepo = new InMemoryLedgerRepository();
    topUpRepo = new InMemoryTopUpRepository();
    notificationRepo = new InMemoryNotificationRepository();
    const capabilityRepo = new InMemoryAdminCapabilityRepository(
      async (userId) =>
        capabilityOverrides.get(userId) ?? (await userRepo.findById(userId)),
    );

    const envService = new EnvService({
      NODE_ENV: 'test',
      PORT: 4000,
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5433/rescom_test',
      JWT_SECRET: TEST_JWT_SECRET,
      JWT_ACCESS_TTL_SECONDS: 900,
      BCRYPT_ROUNDS: 12,
      FRONTEND_ORIGINS: ALLOWED_ORIGIN,
      TOPUP_BANK_NAME: 'MB Bank',
      TOPUP_BANK_BIN: '970422',
      TOPUP_BANK_ACCOUNT_NUMBER: '0123456789',
      TOPUP_BANK_ACCOUNT_NAME: 'CONG TY RESCOM',
    });

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
      .useValue(sessionRepo)
      .overrideProvider(IDENTITY_AUDIT_PORT)
      .useValue(auditRepo)
      .overrideProvider(LEDGER_REPOSITORY_PORT)
      .useValue(ledgerRepo)
      .overrideProvider(TOP_UP_REPOSITORY_PORT)
      .useValue(topUpRepo)
      .overrideProvider(ADMIN_CAPABILITY_PORT)
      .useValue(capabilityRepo)
      .overrideProvider(NOTIFICATION_REPOSITORY_PORT)
      .useValue(notificationRepo)
      .overrideProvider(EnvService)
      .useValue(envService)
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    sessionService = moduleFixture.get(SessionService);
    ledgerService = moduleFixture.get(LedgerService);

    respondent = await createActor('topup-student@fpt.edu.vn', 'RESPONDENT');
    otherRespondent = await createActor('topup-other@fpt.edu.vn', 'RESPONDENT');
    admin = await createActor('topup-admin@rescom.test', 'ADMIN');
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  afterEach(() => {
    capabilityOverrides.clear();
  });

  describe('user requests (FR-34)', () => {
    it('creates a Pending Payment request with bank info, transfer syntax and VietQR payload', async () => {
      const res = await createTopUp(respondent, { amount: 100 }).expect(201);

      const dto = topUpRequestSchema.parse(res.body.data);
      expect(dto.status).toBe('PENDING');
      expect(dto.amountVnd).toBe(20_000);
      expect(dto.transferReference).toMatch(/^RESCOM[A-HJ-NP-Z2-9]{8}$/);
      expect(dto.paymentInstructions).toMatchObject({
        bankName: 'MB Bank',
        bankBin: '970422',
        accountNumber: '0123456789',
        accountName: 'CONG TY RESCOM',
        amountVnd: 20_000,
        transferContent: dto.transferReference,
      });
      expect(dto.paymentInstructions!.qrPayload).toContain(
        dto.transferReference,
      );
      // No Points move before an Admin verifies the transfer.
      expect(await availableOf(respondent.id)).toBe(0);
    });

    it('is also served under the api/ prefix', async () => {
      const res = await createTopUp(otherRespondent, { amount: 250 }, '/api');
      expect(res.status).toBe(201);
      expect(res.body.data.amountVnd).toBe(50_000);
    });

    it('validates the amount and rejects unknown fields', async () => {
      const tooSmall = await createTopUp(respondent, { amount: 99 }).expect(
        400,
      );
      expect(tooSmall.body.error.code).toBe('VALIDATION_ERROR');

      const smuggled = await createTopUp(respondent, {
        amount: 100,
        userId: otherRespondent.id,
      }).expect(400);
      expect(smuggled.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('requires authentication, CSRF and a JSON body', async () => {
      await request(app.getHttpServer())
        .post('/economy/top-ups')
        .send({ amount: 100 })
        .expect(401);

      await request(app.getHttpServer())
        .post('/economy/top-ups')
        .set('Cookie', respondent.cookie)
        .set('Origin', ALLOWED_ORIGIN)
        .send({ amount: 100 })
        .expect(403);

      await request(app.getHttpServer())
        .post('/economy/top-ups')
        .set('Cookie', respondent.cookie)
        .set('x-csrf-token', respondent.csrf)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'text/plain')
        .send('amount=100')
        .expect(415);
    });

    it("lists only the caller's own requests", async () => {
      const res = await request(app.getHttpServer())
        .get('/economy/top-ups')
        .set('Cookie', respondent.cookie)
        .expect(200);

      const list = topUpRequestListSchema.parse(res.body.data);
      expect(list.total).toBe(1);
      expect(list.items.every((item) => item.amount === 100)).toBe(true);
    });

    it('limits open requests per user', async () => {
      await createTopUp(respondent, { amount: 100 }).expect(201);
      await createTopUp(respondent, { amount: 100 }).expect(201);

      const res = await createTopUp(respondent, { amount: 100 }).expect(409);
      expect(res.body.error.code).toBe('TOPUP_PENDING_LIMIT_REACHED');
      expect(res.body.error.details).toEqual({ maxPendingRequests: 3 });
    });
  });

  describe('admin review (FR-35, AD-16)', () => {
    it('restricts the review queue to admins', async () => {
      const res = await request(app.getHttpServer())
        .get('/admin/top-ups')
        .set('Cookie', respondent.cookie)
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN_RESOURCE');
    });

    it('lists pending requests oldest first with user info and amount', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/admin/top-ups')
        .set('Cookie', admin.cookie)
        .expect(200);

      const queue = adminTopUpRequestListSchema.parse(res.body.data);
      expect(queue.total).toBe(4);
      expect(queue.items[0].userEmail).toBe('topup-student@fpt.edu.vn');
      expect(queue.items.every((item) => item.status === 'PENDING')).toBe(true);
    });

    it('approves once: credits Available, records actor/correlation, audits via Outbox and notifies', async () => {
      const created = await createTopUp(otherRespondent, {
        amount: 500,
      }).expect(201);
      const topUpId: string = created.body.data.id;
      const before = await availableOf(otherRespondent.id);

      const res = await approve(admin, topUpId)
        .set('x-correlation-id', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc')
        .expect(200);

      const result = topUpReviewResultSchema.parse(res.body.data);
      expect(result.replayed).toBe(false);
      expect(result.topUp).toMatchObject({
        id: topUpId,
        status: 'APPROVED',
        adminId: admin.id,
        correlationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        userEmail: 'topup-other@fpt.edu.vn',
        paymentInstructions: null,
      });
      expect(await availableOf(otherRespondent.id)).toBe(before + 500);

      const journal = await ledgerService.findJournalByIdempotencyKey(
        `topup-approval:${topUpId}`,
      );
      expect(journal?.id).toBe(result.journalId);

      const auditEvents = topUpRepo.outboxEvents.filter(
        (event) => event.aggregateId === topUpId,
      );
      expect(auditEvents).toHaveLength(1);
      expect(auditEvents[0]).toMatchObject({
        eventType: 'AdminTopUpApproved',
        idempotencyKey: `admin-audit:topup-approval:${topUpId}`,
        correlationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      });
      expect(auditEvents[0].payload).toMatchObject({
        action: 'TOPUP_APPROVED',
        adminId: admin.id,
        journalId: result.journalId,
      });

      const notifications = await request(app.getHttpServer())
        .get('/notifications')
        .set('Cookie', otherRespondent.cookie)
        .expect(200);
      const success = notifications.body.data.items.filter(
        (item: { type: string }) => item.type === 'TOPUP_SUCCESS',
      );
      expect(success).toHaveLength(1);

      // Retry (double click / network replay) returns the original result.
      const retry = await approve(admin, topUpId).expect(200);
      expect(retry.body.data.replayed).toBe(true);
      expect(retry.body.data.journalId).toBe(result.journalId);
      expect(await availableOf(otherRespondent.id)).toBe(before + 500);
      expect(
        topUpRepo.outboxEvents.filter((event) => event.aggregateId === topUpId),
      ).toHaveLength(1);
      const afterRetry = await request(app.getHttpServer())
        .get('/notifications')
        .set('Cookie', otherRespondent.cookie)
        .expect(200);
      expect(
        afterRetry.body.data.items.filter(
          (item: { type: string }) => item.type === 'TOPUP_SUCCESS',
        ),
      ).toHaveLength(1);

      // The owner sees the approved request without payment instructions.
      const own = await request(app.getHttpServer())
        .get('/economy/top-ups')
        .set('Cookie', otherRespondent.cookie)
        .expect(200);
      const approvedItem = own.body.data.items.find(
        (item: { id: string }) => item.id === topUpId,
      );
      expect(approvedItem.status).toBe('APPROVED');
      expect(approvedItem.paymentInstructions).toBeNull();
    });

    it('requires CSRF and the ADMIN role to approve', async () => {
      const pending = topUpRepo.outboxEvents.length;
      const queue = await request(app.getHttpServer())
        .get('/admin/top-ups')
        .set('Cookie', admin.cookie)
        .expect(200);
      const topUpId: string = queue.body.data.items[0].id;

      await request(app.getHttpServer())
        .post(`/admin/top-ups/${topUpId}/approve`)
        .set('Cookie', admin.cookie)
        .set('Origin', ALLOWED_ORIGIN)
        .expect(403);

      const forbidden = await approve(respondent, topUpId).expect(403);
      expect(forbidden.body.error.code).toBe('FORBIDDEN_RESOURCE');
      expect(topUpRepo.outboxEvents).toHaveLength(pending);
    });

    it('re-checks the live Admin capability inside the approval', async () => {
      const queue = await request(app.getHttpServer())
        .get('/admin/top-ups')
        .set('Cookie', admin.cookie)
        .expect(200);
      const target = queue.body.data.items[0];
      const before = await availableOf(target.userId);

      // The admin was locked right after this session was validated.
      capabilityOverrides.set(admin.id, {
        id: admin.id,
        role: 'ADMIN',
        status: 'LOCKED',
      });
      const res = await approve(admin, target.id).expect(403);
      expect(res.body.error.code).toBe('TOPUP_ADMIN_CAPABILITY_REQUIRED');

      expect((await topUpRepo.findById(target.id))!.status).toBe('PENDING');
      expect(await availableOf(target.userId)).toBe(before);
    });

    it('rejects with a reason, posts no journal and warns the user', async () => {
      const created = await createTopUp(otherRespondent, {
        amount: 300,
      }).expect(201);
      const topUpId: string = created.body.data.id;
      const before = await availableOf(otherRespondent.id);

      const missingReason = await reject(admin, topUpId, {}).expect(400);
      expect(missingReason.body.error.code).toBe('VALIDATION_ERROR');

      const res = await reject(admin, topUpId, {
        reason: 'Không tìm thấy giao dịch chuyển khoản',
      }).expect(200);
      expect(res.body.data.topUp.status).toBe('REJECTED');
      expect(res.body.data.topUp.rejectionReason).toBe(
        'Không tìm thấy giao dịch chuyển khoản',
      );
      expect(res.body.data.journalId).toBeNull();
      expect(await availableOf(otherRespondent.id)).toBe(before);
      expect(
        await ledgerService.findJournalByIdempotencyKey(
          `topup-approval:${topUpId}`,
        ),
      ).toBeNull();
      expect(
        topUpRepo.outboxEvents.find((event) => event.aggregateId === topUpId)
          ?.eventType,
      ).toBe('AdminTopUpRejected');

      const notifications = await request(app.getHttpServer())
        .get('/notifications')
        .set('Cookie', otherRespondent.cookie)
        .expect(200);
      const warning = notifications.body.data.items.find(
        (item: { type: string; message: string }) =>
          item.type === 'WARNING' &&
          item.message.includes('Không tìm thấy giao dịch chuyển khoản'),
      );
      expect(warning).toBeDefined();

      // A rejected request can no longer be approved.
      const conflict = await approve(admin, topUpId).expect(409);
      expect(conflict.body.error.code).toBe('TOPUP_ALREADY_REVIEWED');
      expect(conflict.body.error.details).toEqual({
        currentStatus: 'REJECTED',
      });
    });

    it('forbids self-approval and reports unknown or malformed ids', async () => {
      const own = await createTopUp(admin, { amount: 100 }).expect(201);
      const selfReview = await approve(admin, own.body.data.id).expect(403);
      expect(selfReview.body.error.code).toBe('TOPUP_SELF_REVIEW_FORBIDDEN');

      const missing = await approve(
        admin,
        '99999999-9999-4999-8999-999999999999',
      ).expect(404);
      expect(missing.body.error.code).toBe('TOPUP_NOT_FOUND');

      await approve(admin, 'not-a-uuid').expect(400);
    });
  });
});
