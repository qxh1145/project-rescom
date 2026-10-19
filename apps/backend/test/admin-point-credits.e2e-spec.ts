import { Test, TestingModule } from '@nestjs/testing';
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
import {
  ADMIN_CAPABILITY_PORT,
  AdminCapabilityPort,
} from '../src/modules/economy/application/ports/admin-capability.port';
import { ADMIN_POINT_CREDIT_OUTBOX_PORT } from '../src/modules/economy/application/ports/admin-point-credit-outbox.port';
import { InMemoryAdminPointCreditOutbox } from '../src/modules/economy/infrastructure/in-memory-admin-point-credit-outbox';
import {
  UNIT_OF_WORK_PORT,
  PassThroughUnitOfWork,
} from '../src/common/database/unit-of-work.port';
import { SessionService } from '../src/modules/auth/application/session.service';
import { EnvService } from '../src/common/config/env.service';
import { PrismaService } from '../src/common/database/prisma.service';
import { HttpExceptionFilter } from '../src/common/http/http-exception.filter';
import { AUTH_COOKIE_NAME } from '../src/modules/auth/presentation/cookie-options.helper';
import { LedgerService } from '../src/modules/economy/application/ledger.service';
import { User } from '../src/modules/users/domain/user.entity';

describe('Story 14.5: Admin Direct Point Credit E2E Tests', () => {
  let app: INestApplication;
  let userRepo: InMemoryUserRepository;
  let sessionRepo: InMemorySessionRepository;
  let auditRepo: InMemoryIdentityAuditRepository;
  let ledgerRepo: InMemoryLedgerRepository;
  let ledgerService: LedgerService;
  let sessionService: SessionService;
  let outbox: InMemoryAdminPointCreditOutbox;
  let envService: EnvService;

  const TEST_JWT_SECRET = 'at_least_32_characters_super_secure_jwt_secret_key!';
  const ALLOWED_ORIGIN = 'http://localhost:3000';

  let adminUser: User;
  let respondentUser: User;
  let lockedUser: User;
  let adminCookie: string;
  let adminCsrfToken: string;
  let respondentCookie: string;
  let respondentCsrfToken: string;

  beforeAll(async () => {
    userRepo = new InMemoryUserRepository();
    auditRepo = new InMemoryIdentityAuditRepository();
    sessionRepo = new InMemorySessionRepository(auditRepo);
    ledgerRepo = new InMemoryLedgerRepository();
    outbox = new InMemoryAdminPointCreditOutbox();

    const adminCapability: AdminCapabilityPort = {
      findCurrentCapability: async (userId: string) => {
        const u = await userRepo.findById(userId);
        return u ? { userId: u.id, role: u.role, status: u.status } : null;
      },
      listActiveAdminIds: async () => {
        return userRepo
          .snapshot()
          .filter((u) => u.role === 'ADMIN' && u.status === 'ACTIVE')
          .map((u) => u.id);
      },
    };

    envService = new EnvService({
      NODE_ENV: 'test',
      PORT: 4000,
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5433/rescom_test',
      JWT_SECRET: TEST_JWT_SECRET,
      JWT_ACCESS_TTL_SECONDS: 900,
      BCRYPT_ROUNDS: 12,
      FRONTEND_ORIGINS: ALLOWED_ORIGIN,
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
      .overrideProvider(ADMIN_CAPABILITY_PORT)
      .useValue(adminCapability)
      .overrideProvider(ADMIN_POINT_CREDIT_OUTBOX_PORT)
      .useValue(outbox)
      .overrideProvider(UNIT_OF_WORK_PORT)
      .useClass(PassThroughUnitOfWork)
      .overrideProvider(EnvService)
      .useValue(envService)
      .compile();

    sessionService = moduleFixture.get(SessionService);
    ledgerService = moduleFixture.get(LedgerService);

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalFilters(new HttpExceptionFilter());
    app.enableCors({
      origin: ALLOWED_ORIGIN,
      credentials: true,
    });
    await app.init();

    adminUser = await userRepo.create({
      email: 'admin-credit-tester@rescom.test',
      passwordHash: '$2a$12$someHashedPassword',
      role: 'ADMIN',
      status: 'ACTIVE',
    });
    const adminTokens = await sessionService.createSession(adminUser.id);
    adminCookie = `${AUTH_COOKIE_NAME}=${adminTokens.accessToken}`;
    adminCsrfToken = adminTokens.csrfToken;

    respondentUser = await userRepo.create({
      email: 'respondent-credit-target@rescom.test',
      passwordHash: '$2a$12$someOtherHashedPassword',
      role: 'RESPONDENT',
      status: 'ACTIVE',
    });
    const respondentTokens = await sessionService.createSession(
      respondentUser.id,
    );
    respondentCookie = `${AUTH_COOKIE_NAME}=${respondentTokens.accessToken}`;
    respondentCsrfToken = respondentTokens.csrfToken;

    lockedUser = await userRepo.create({
      email: 'locked-user@rescom.test',
      passwordHash: '$2a$12$someOtherHashedPassword',
      role: 'RESPONDENT',
      status: 'LOCKED',
    });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /admin/users/:id/point-credits', () => {
    const idempotencyKey = randomUUID();
    let creditedJournalId: string;

    it('credits points: 200 + wallet Available +amount + audit row + integrity zero-sum', async () => {
      const res = await request(app.getHttpServer())
        .post(`/admin/users/${respondentUser.id}/point-credits`)
        .set('Cookie', [adminCookie])
        .set('x-csrf-token', adminCsrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .send({
          amount: 500,
          reason: 'Bồi thường lỗi khảo sát gián đoạn',
          idempotencyKey,
        });

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        userId: respondentUser.id,
        amount: 500,
        reason: 'Bồi thường lỗi khảo sát gián đoạn',
        replayed: false,
      });
      expect(res.body.data.journalId).toBeDefined();
      creditedJournalId = res.body.data.journalId;

      // Available balance updated
      const wallet = await ledgerService.getWallet(respondentUser.id);
      expect(wallet.balance.available).toBe(500);

      // Identity audit logged
      const audit = auditRepo.records.find(
        (r) => r.action === 'ADMIN_POINTS_CREDITED',
      );
      expect(audit).toBeDefined();
      expect(audit).toMatchObject({
        userId: adminUser.id,
        targetUserId: respondentUser.id,
        outcome: 'SUCCESS',
        metadata: {
          journalId: creditedJournalId,
          amount: 500,
          reason: 'Bồi thường lỗi khảo sát gián đoạn',
        },
      });

      // Integrity check zero-sum
      const integrity = await ledgerService.verifyLedgerIntegrity();
      expect(integrity.isZeroSum).toBe(true);
    });

    it('replay 200 with replayed: true, same journalId, balance unchanged', async () => {
      const res = await request(app.getHttpServer())
        .post(`/admin/users/${respondentUser.id}/point-credits`)
        .set('Cookie', [adminCookie])
        .set('x-csrf-token', adminCsrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .send({
          amount: 500,
          reason: 'Bồi thường lỗi khảo sát gián đoạn',
          idempotencyKey,
        });

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        journalId: creditedJournalId,
        replayed: true,
      });

      const wallet = await ledgerService.getWallet(respondentUser.id);
      expect(wallet.balance.available).toBe(500);
    });

    it('different amount same key returns 409 IDEMPOTENCY_CONFLICT', async () => {
      const res = await request(app.getHttpServer())
        .post(`/admin/users/${respondentUser.id}/point-credits`)
        .set('Cookie', [adminCookie])
        .set('x-csrf-token', adminCsrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .send({
          amount: 600,
          reason: 'Bồi thường lỗi khảo sát gián đoạn',
          idempotencyKey,
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
    });

    it('self-credit returns 403 ADMIN_SELF_CREDIT_FORBIDDEN', async () => {
      const res = await request(app.getHttpServer())
        .post(`/admin/users/${adminUser.id}/point-credits`)
        .set('Cookie', [adminCookie])
        .set('x-csrf-token', adminCsrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .send({
          amount: 100,
          reason: 'Tự cộng điểm cho tài khoản admin',
          idempotencyKey: randomUUID(),
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ADMIN_SELF_CREDIT_FORBIDDEN');
    });

    it('LOCKED target returns 409 USER_BANNED', async () => {
      const res = await request(app.getHttpServer())
        .post(`/admin/users/${lockedUser.id}/point-credits`)
        .set('Cookie', [adminCookie])
        .set('x-csrf-token', adminCsrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .send({
          amount: 100,
          reason: 'Cộng điểm tài khoản bị khoá',
          idempotencyKey: randomUUID(),
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('USER_BANNED');
    });

    it('non-admin returns 403 FORBIDDEN', async () => {
      const res = await request(app.getHttpServer())
        .post(`/admin/users/${respondentUser.id}/point-credits`)
        .set('Cookie', [respondentCookie])
        .set('x-csrf-token', respondentCsrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .send({
          amount: 100,
          reason: 'Người dùng thử cộng điểm cho nhau',
          idempotencyKey: randomUUID(),
        });

      expect(res.status).toBe(403);
    });

    it('missing CSRF token returns 403', async () => {
      const res = await request(app.getHttpServer())
        .post(`/admin/users/${respondentUser.id}/point-credits`)
        .set('Cookie', [adminCookie])
        .set('Origin', ALLOWED_ORIGIN)
        .send({
          amount: 100,
          reason: 'Thiếu CSRF header gửi lên',
          idempotencyKey: randomUUID(),
        });

      expect(res.status).toBe(403);
    });

    it('extra key returns 400 VALIDATION_ERROR', async () => {
      const res = await request(app.getHttpServer())
        .post(`/admin/users/${respondentUser.id}/point-credits`)
        .set('Cookie', [adminCookie])
        .set('x-csrf-token', adminCsrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .send({
          amount: 100,
          reason: 'Có trường phụ không được phép',
          idempotencyKey: randomUUID(),
          extraField: 'unexpected',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('reason < 10 chars returns 400 VALIDATION_ERROR', async () => {
      const res = await request(app.getHttpServer())
        .post(`/admin/users/${respondentUser.id}/point-credits`)
        .set('Cookie', [adminCookie])
        .set('x-csrf-token', adminCsrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .send({
          amount: 100,
          reason: '123456789',
          idempotencyKey: randomUUID(),
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /admin/users/:id/point-credits & Reverse', () => {
    const reverseKey = randomUUID();
    let journalToReverseId: string;

    it('GET list shows credited item', async () => {
      const creditRes = await request(app.getHttpServer())
        .post(`/admin/users/${respondentUser.id}/point-credits`)
        .set('Cookie', [adminCookie])
        .set('x-csrf-token', adminCsrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .send({
          amount: 300,
          reason: 'Khoản cộng điểm để kiểm tra hoàn tác',
          idempotencyKey: reverseKey,
        });

      expect(creditRes.status).toBe(200);
      journalToReverseId = creditRes.body.data.journalId;

      const listRes = await request(app.getHttpServer())
        .get(`/admin/users/${respondentUser.id}/point-credits`)
        .set('Cookie', [adminCookie])
        .set('Origin', ALLOWED_ORIGIN);

      expect(listRes.status).toBe(200);
      expect(listRes.body.data.items).toBeDefined();
      const item = listRes.body.data.items.find(
        (i: any) => i.journalId === journalToReverseId,
      );
      expect(item).toBeDefined();
      expect(item).toMatchObject({
        journalId: journalToReverseId,
        amount: 300,
        reason: 'Khoản cộng điểm để kiểm tra hoàn tác',
        reversed: false,
        reversalJournalId: null,
      });
    });

    it('GET list for an unknown user returns 200 { items: [] }', async () => {
      const res = await request(app.getHttpServer())
        .get(`/admin/users/${randomUUID()}/point-credits`)
        .set('Cookie', [adminCookie])
        .set('Origin', ALLOWED_ORIGIN);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ items: [] });
    });

    it('reverse without reason returns 400 VALIDATION_ERROR', async () => {
      const res = await request(app.getHttpServer())
        .post(`/economy/journals/${journalToReverseId}/reverse`)
        .set('Cookie', [adminCookie])
        .set('x-csrf-token', adminCsrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('reverse with reason returns 201/200, logs LEDGER_JOURNAL_REVERSED, list shows reversed: true, integrity zero-sum', async () => {
      const res = await request(app.getHttpServer())
        .post(`/economy/journals/${journalToReverseId}/reverse`)
        .set('Cookie', [adminCookie])
        .set('x-csrf-token', adminCsrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .send({
          reason: 'Hoàn tác cộng nhầm do nhầm lẫn hỗ trợ',
        });

      expect([200, 201]).toContain(res.status);

      // Audit logged
      const revAudit = auditRepo.records.find(
        (r) =>
          r.action === 'LEDGER_JOURNAL_REVERSED' &&
          r.metadata?.targetJournalId === journalToReverseId,
      );
      expect(revAudit).toBeDefined();
      expect(revAudit?.metadata).toMatchObject({
        targetJournalId: journalToReverseId,
        reason: 'Hoàn tác cộng nhầm do nhầm lẫn hỗ trợ',
        adminCredit: true,
      });

      // List shows reversed: true
      const listRes = await request(app.getHttpServer())
        .get(`/admin/users/${respondentUser.id}/point-credits`)
        .set('Cookie', [adminCookie])
        .set('Origin', ALLOWED_ORIGIN);

      const item = listRes.body.data.items.find(
        (i: any) => i.journalId === journalToReverseId,
      );
      expect(item.reversed).toBe(true);
      expect(item.reversalJournalId).toBeDefined();

      // Integrity zero-sum
      const integrity = await ledgerService.verifyLedgerIntegrity();
      expect(integrity.isZeroSum).toBe(true);
    });

    it('second reverse returns 409 JOURNAL_ALREADY_REVERSED', async () => {
      const res = await request(app.getHttpServer())
        .post(`/economy/journals/${journalToReverseId}/reverse`)
        .set('Cookie', [adminCookie])
        .set('x-csrf-token', adminCsrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .send({
          idempotencyKey: randomUUID(),
          reason: 'Cố hoàn tác lần thứ hai',
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('JOURNAL_ALREADY_REVERSED');
    });
  });
});
