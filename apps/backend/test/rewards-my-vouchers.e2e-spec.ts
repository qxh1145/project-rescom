import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import {
  voucherTicketListSchema,
  voucherTicketResponseSchema,
  codeIssueReportSchema,
  redemptionHistoryListSchema,
  adminCodeIssueListSchema,
  adminCodeIssueSchema,
} from '@rescom/schemas';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/database/prisma.service';
import { HttpExceptionFilter } from '../src/common/http/http-exception.filter';
import { AUTH_COOKIE_NAME } from '../src/modules/auth/presentation/cookie-options.helper';
import { SessionService } from '../src/modules/auth/application/session.service';
import { USER_REPOSITORY_PORT } from '../src/modules/users/application/ports/user.repository.port';
import { InMemoryUserRepository } from '../src/modules/users/infrastructure/in-memory-user.repository';
import { SESSION_REPOSITORY_PORT } from '../src/modules/auth/application/ports/session-repository.port';
import { InMemorySessionRepository } from '../src/modules/auth/infrastructure/in-memory-session.repository';
import { IDENTITY_AUDIT_PORT } from '../src/modules/auth/application/ports/identity-audit.port';
import { InMemoryIdentityAuditRepository } from '../src/modules/auth/infrastructure/in-memory-identity-audit.repository';
import { VOUCHER_REPOSITORY_PORT } from '../src/modules/rewards/application/ports/voucher-repository.port';
import { InMemoryVoucherRepository } from '../src/modules/rewards/infrastructure/in-memory-voucher.repository';
import { MY_VOUCHERS_READ_PORT } from '../src/modules/rewards/application/ports/my-vouchers-read.port';
import { TICKET_WRITE_PORT } from '../src/modules/rewards/application/ports/ticket-write.port';
import { InMemoryMyVouchersRepository } from '../src/modules/rewards/infrastructure/in-memory-my-vouchers.repository';
import { REVERSE_SPEND_PORT } from '../src/modules/rewards/application/ports/reverse-spend.port';
import { NOTIFICATION_PUBLISHER_PORT } from '../src/modules/notifications/application/ports/notification-publisher.port';
import {
  UNIT_OF_WORK_PORT,
  PassThroughUnitOfWork,
} from '../src/common/database/unit-of-work.port';
import { ADMIN_CAPABILITY_PORT } from '../src/modules/economy/application/ports/admin-capability.port';
import { InMemoryAdminCapabilityRepository } from '../src/modules/economy/infrastructure/in-memory-admin-capability.repository';

const ORIGIN = 'http://localhost:3000';
const DB = 'postgresql://postgres:postgres@localhost:5433/rescom_test';

describe('Rewards My Vouchers & Code Issues HTTP contracts (in memory)', () => {
  let app: INestApplication;
  let users: InMemoryUserRepository;
  let vouchers: InMemoryVoucherRepository;
  let myVouchersRepo: InMemoryMyVouchersRepository;
  let sessions: SessionService;
  let sequence = 0;
  type Actor = { id: string; cookie: string; csrf: string };

  async function actor(role: 'ADMIN' | 'RESPONDENT'): Promise<Actor> {
    const user = await users.create({
      email: `my-vouchers-${++sequence}@fpt.edu.vn`,
      passwordHash: null,
      role,
      status: 'ACTIVE',
    });
    const tokens = await sessions.createSession(user.id);
    return {
      id: user.id,
      cookie: `${AUTH_COOKIE_NAME}=${tokens.accessToken}`,
      csrf: tokens.csrfToken,
    };
  }

  function get(path: string, who?: Actor) {
    const call = request(app.getHttpServer()).get(path).set('Origin', ORIGIN);
    return who ? call.set('Cookie', [who.cookie]) : call;
  }

  function post(path: string, payload: object, who?: Actor, csrf = true) {
    const call = request(app.getHttpServer()).post(path).set('Origin', ORIGIN);
    if (who) {
      call.set('Cookie', [who.cookie]);
      if (csrf) call.set('x-csrf-token', who.csrf);
    }
    return call.send(payload);
  }

  const voucherId = '00000000-0000-4000-8000-000000000010';
  const redemptionId = '00000000-0000-4000-8000-000000000020';
  const codeId = '00000000-0000-4000-8000-000000000030';
  const replacementCodeId = '00000000-0000-4000-8000-000000000040';
  let respondent: Actor;
  let admin: Actor;

  beforeAll(async () => {
    process.env.DATABASE_URL ||= DB;
    users = new InMemoryUserRepository();
    vouchers = new InMemoryVoucherRepository();
    myVouchersRepo = new InMemoryMyVouchersRepository();
    const audit = new InMemoryIdentityAuditRepository();
    const adminCap = new InMemoryAdminCapabilityRepository((id) =>
      users.findById(id),
    );

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(USER_REPOSITORY_PORT)
      .useValue(users)
      .overrideProvider(SESSION_REPOSITORY_PORT)
      .useClass(InMemorySessionRepository)
      .overrideProvider(IDENTITY_AUDIT_PORT)
      .useValue(audit)
      .overrideProvider(ADMIN_CAPABILITY_PORT)
      .useValue(adminCap)
      .overrideProvider(VOUCHER_REPOSITORY_PORT)
      .useValue(vouchers)
      .overrideProvider(MY_VOUCHERS_READ_PORT)
      .useValue(myVouchersRepo)
      .overrideProvider(TICKET_WRITE_PORT)
      .useValue(myVouchersRepo)
      .overrideProvider(REVERSE_SPEND_PORT)
      .useValue({
        reverseSpend: async (params: { journalId: string }) => ({
          journalId: 'rev-' + params.journalId,
        }),
      })
      .overrideProvider(NOTIFICATION_PUBLISHER_PORT)
      .useValue({
        publish: async () => {},
      })
      .overrideProvider(UNIT_OF_WORK_PORT)
      .useClass(PassThroughUnitOfWork)
      .overrideProvider(PrismaService)
      .useValue({
        $executeRaw: jest.fn().mockResolvedValue(1),
        $queryRaw: jest.fn().mockResolvedValue([]),
        $transaction: async (fn: any) => fn({}),
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    sessions = app.get(SessionService);
    respondent = await actor('RESPONDENT');
    admin = await actor('ADMIN');

    // Seed voucher in both repositories
    const v = {
      id: voucherId,
      title: 'Highlands Coffee 50k',
      brand: { id: 'highlands', name: 'Highlands' },
      category: 'COFFEE' as const,
      valueVnd: 50000,
      basePoints: 100,
      promoPoints: 90,
      priceVersion: 1,
      stockTotal: 10,
      stockRemaining: 5,
      codesAvailable: 5,
      state: 'ACTIVE' as const,
      isVisible: true,
      isSharedCode: false,
      sharedCode: null,
      redeemStartsAt: '2026-10-01T00:00:00.000Z',
      redeemEndsAt: '2026-10-31T23:59:59.000Z',
      codeExpiresAt: '2026-11-15T23:59:59.000Z',
      description: null,
      whereToUse: null,
      terms: ['Term 1'],
      howToUse: ['Show code'],
      imageUrl: null,
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
      createdById: admin.id,
    };
    vouchers.vouchers.set(voucherId, v);
    myVouchersRepo.seedVoucher(v);

    // Seed original code & replacement code
    myVouchersRepo.seedCode({
      id: codeId,
      voucherId,
      code: 'HL-TEST-001',
      redemptionId,
      issueReportId: null,
    });
    myVouchersRepo.seedCode({
      id: replacementCodeId,
      voucherId,
      code: 'HL-TEST-002',
      redemptionId: null,
      issueReportId: null,
    });

    // Seed redemption for respondent
    myVouchersRepo.seedRedemption({
      id: redemptionId,
      userId: respondent.id,
      voucherId,
      voucherCodeId: codeId,
      flashSaleItemId: null,
      quoteId: null,
      status: 'SUCCEEDED',
      pricePoints: 90,
      priceSource: 'PROMO',
      journalId: '00000000-0000-4000-8000-000000000099',
      reference: 'RDM-2610-AAAA',
      createdAt: new Date('2026-10-10T10:00:00.000Z'),
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('User ticket endpoints', () => {
    it('requires session, validates UUIDs and serves both route prefixes', async () => {
      expect((await get('/rewards/my-vouchers')).status).toBe(401);
      const alias = await get('/api/rewards/my-vouchers', respondent);
      expect(alias.status).toBe(200);
      expect(alias.headers['cache-control']).toBe('no-store');
      voucherTicketListSchema.parse(alias.body.data);

      const invalid = await get('/rewards/my-vouchers/not-a-uuid', respondent);
      expect(invalid.status).toBe(400);
      expect(invalid.body.error).toBeTruthy();
    });

    it('GET /rewards/my-vouchers: 200 parsed with voucherTicketListSchema, no-store', async () => {
      const res = await get('/rewards/my-vouchers', respondent);
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body.error).toBeNull();
      const parsed = voucherTicketListSchema.parse(res.body.data);
      expect(parsed.total).toBe(1);
      expect(parsed.items[0].id).toBe(redemptionId);
    });

    it('GET /rewards/my-vouchers/:id: 200 parsed with voucherTicketResponseSchema, 404 on unknown', async () => {
      const res = await get(`/rewards/my-vouchers/${redemptionId}`, respondent);
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      const parsed = voucherTicketResponseSchema.parse(res.body.data);
      expect(parsed.ticket.id).toBe(redemptionId);

      const notFound = await get(
        `/rewards/my-vouchers/00000000-0000-4000-8000-999999999999`,
        respondent,
      );
      expect(notFound.status).toBe(404);
      expect(notFound.body.error.code).toBe('TICKET_NOT_FOUND');
    });

    it('POST /rewards/my-vouchers/:id/use: 200, requires CSRF', async () => {
      const noCsrf = await post(
        `/rewards/my-vouchers/${redemptionId}/use`,
        {},
        respondent,
        false,
      );
      expect(noCsrf.status).toBe(403);

      const res = await post(
        `/rewards/my-vouchers/${redemptionId}/use`,
        {},
        respondent,
      );
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      const parsed = voucherTicketResponseSchema.parse(res.body.data);
      expect(parsed.ticket.status).toBe('USED');
    });

    it('POST /rewards/my-vouchers/:id/undo-use: 200, restores UNUSED', async () => {
      const res = await post(
        `/rewards/my-vouchers/${redemptionId}/undo-use`,
        {},
        respondent,
      );
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      const parsed = voucherTicketResponseSchema.parse(res.body.data);
      expect(parsed.ticket.status).toBe('UNUSED');
    });

    it('POST /rewards/my-vouchers/:id/issues: 201 parsed with codeIssueReportSchema', async () => {
      const res = await post(
        `/rewards/my-vouchers/${redemptionId}/issues`,
        { reason: 'CODE_INVALID', note: 'Cashier refused' },
        respondent,
      );
      expect(res.status).toBe(201);
      expect(res.headers['cache-control']).toBe('no-store');
      const parsed = codeIssueReportSchema.parse(res.body.data);
      expect(parsed.status).toBe('OPEN');
      expect(parsed.reason).toBe('CODE_INVALID');
    });

    it('GET /rewards/redemptions: 200 parsed with redemptionHistoryListSchema', async () => {
      const res = await get(
        '/rewards/redemptions?limit=10&offset=0',
        respondent,
      );
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      const parsed = redemptionHistoryListSchema.parse(res.body.data);
      expect(parsed.total).toBe(1);
      expect(parsed.items[0].id).toBe(redemptionId);
    });
  });

  describe('Admin code issues endpoints', () => {
    let reportId: string;

    it('requires session and validates admin UUID params on alias prefix', async () => {
      expect((await get('/admin/rewards/code-issues')).status).toBe(401);
      const invalid = await get(
        '/api/admin/rewards/code-issues/not-a-uuid',
        admin,
      );
      expect(invalid.status).toBe(400);
      const alias = await get('/api/admin/rewards/code-issues', admin);
      expect(alias.status).toBe(200);
      expect(alias.headers['cache-control']).toBe('no-store');
      adminCodeIssueListSchema.parse(alias.body.data);
    });

    beforeAll(async () => {
      const openRep = Array.from(myVouchersRepo.reports.values()).find(
        (r) => r.status === 'OPEN',
      );
      reportId = openRep!.id;
    });

    it('GET /admin/rewards/code-issues: 403 for respondent, 200 for admin', async () => {
      const forbidden = await get('/admin/rewards/code-issues', respondent);
      expect(forbidden.status).toBe(403);

      const res = await get('/admin/rewards/code-issues', admin);
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      const parsed = adminCodeIssueListSchema.parse(res.body.data);
      expect(parsed.total).toBe(1);
      expect(parsed.items[0].id).toBe(reportId);
    });

    it('GET /admin/rewards/code-issues/:id: 200 parsed with adminCodeIssueSchema', async () => {
      const res = await get(`/admin/rewards/code-issues/${reportId}`, admin);
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      const parsed = adminCodeIssueSchema.parse(res.body.data);
      expect(parsed.id).toBe(reportId);
    });

    it('POST /admin/rewards/code-issues/:id/resolve: 200 resolve REPLACE', async () => {
      const res = await post(
        `/admin/rewards/code-issues/${reportId}/resolve`,
        { outcome: 'REPLACE', note: 'New code issued' },
        admin,
      );
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      const parsed = adminCodeIssueSchema.parse(res.body.data);
      expect(parsed.status).toBe('REPLACED');
    });
  });
});
