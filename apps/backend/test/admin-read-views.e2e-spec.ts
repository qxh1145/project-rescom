import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import {
  adminJournalListSchema,
  adminLedgerSummarySchema,
  adminOverviewSchema,
  adminQueueCountsSchema,
  adminUserDetailResponseSchema,
  fraudLogPageSchema,
} from '@rescom/schemas';
import { AppModule } from '../src/app.module';
import { User } from '../src/modules/users/domain/user.entity';
import { USER_REPOSITORY_PORT } from '../src/modules/users/application/ports/user.repository.port';
import { InMemoryUserRepository } from '../src/modules/users/infrastructure/in-memory-user.repository';
import { USER_ADMIN_TRANSACTION_PORT } from '../src/modules/users/application/ports/user-admin-transaction.port';
import { InMemoryUserAdminTransactionAdapter } from '../src/modules/users/infrastructure/in-memory-user-admin-transaction.adapter';
import { USER_PROFILE_REPOSITORY_PORT } from '../src/modules/users/application/ports/user-profile.repository.port';
import { InMemoryUserProfileRepository } from '../src/modules/users/infrastructure/in-memory-user-profile.repository';
import { ADMIN_USER_DIRECTORY_PORT } from '../src/modules/users/application/ports/admin-user-directory.port';
import { InMemoryAdminUserDirectory } from '../src/modules/users/infrastructure/in-memory-admin-user-directory';
import { SESSION_REPOSITORY_PORT } from '../src/modules/auth/application/ports/session-repository.port';
import { InMemorySessionRepository } from '../src/modules/auth/infrastructure/in-memory-session.repository';
import { IDENTITY_AUDIT_PORT } from '../src/modules/auth/application/ports/identity-audit.port';
import { InMemoryIdentityAuditRepository } from '../src/modules/auth/infrastructure/in-memory-identity-audit.repository';
import { MODERATION_QUEUE_STATS_PORT } from '../src/modules/forms/application/ports/moderation-queue-stats.port';
import { FORM_TITLE_LOOKUP_PORT } from '../src/modules/forms/application/ports/form-title-lookup.port';
import { InMemoryFormAdminReads } from '../src/modules/forms/infrastructure/in-memory-form-admin-reads';
import { ADMIN_ECONOMY_STATS_PORT } from '../src/modules/economy/application/ports/admin-economy-stats.port';
import { InMemoryAdminEconomyStats } from '../src/modules/economy/infrastructure/in-memory-admin-economy-stats';
import { FRAUD_LOG_READ_PORT } from '../src/modules/participation/application/ports/fraud-log-read.port';
import { MISSING_CODE_REPORT_STATS_PORT } from '../src/modules/participation/application/ports/missing-code-report-stats.port';
import { InMemoryMissingCodeReportStats } from '../src/modules/participation/infrastructure/in-memory-missing-code-report-stats';
import { InMemoryFraudLogReader } from '../src/modules/participation/infrastructure/in-memory-fraud-log-reader';
import { SessionService } from '../src/modules/auth/application/session.service';
import { EnvService } from '../src/common/config/env.service';
import { PrismaService } from '../src/common/database/prisma.service';
import { HttpExceptionFilter } from '../src/common/http/http-exception.filter';
import { AUTH_COOKIE_NAME } from '../src/modules/auth/presentation/cookie-options.helper';

/**
 * Admin read views of mock-off Phase 4 (IR.4b part C overview and queue
 * counts, plan 4.2 FraudLog, plan 4.3 ledger, plan 4.6 `lockReason`): the
 * routes on both prefixes, the ADMIN guard, query validation, and responses
 * parsed with the shared `@rescom/schemas` contracts the frontend uses.
 */
describe('Admin read views (mock-off Phase 4) E2E', () => {
  let app: INestApplication;
  let userRepo: InMemoryUserRepository;
  let profileRepo: InMemoryUserProfileRepository;
  let forms: InMemoryFormAdminReads;
  let economy: InMemoryAdminEconomyStats;
  let fraud: InMemoryFraudLogReader;
  let missingCodes: InMemoryMissingCodeReportStats;
  let sessionService: SessionService;

  const ALLOWED_ORIGIN = 'http://localhost:3000';
  const DAY = 86_400_000;
  const FORM = '5a0c1f7e-2b4d-4c6a-8e1f-0a1b2c3d4e71';
  const VERSION = '5a0c1f7e-2b4d-4c6a-8e1f-0a1b2c3d4e72';
  const id = (n: number) =>
    `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

  interface Actor {
    id: string;
    email: string;
    cookie: string;
    csrf: string;
  }

  let seed = 0;
  async function actor(
    role: 'ADMIN' | 'PUBLISHER' | 'RESPONDENT',
    status: 'ACTIVE' | 'LOCKED' = 'ACTIVE',
  ): Promise<Actor> {
    seed += 1;
    const user = await userRepo.create({
      email: `admin-read-${seed}@fpt.edu.vn`,
      passwordHash: '$2a$12$someHashedPassword',
      role,
      status: 'ACTIVE',
    });
    const tokens = await sessionService.createSession(user.id);
    if (status === 'LOCKED') {
      // Locked after signing in (a locked account cannot open a session).
      userRepo.save(new User({ ...user, status: 'LOCKED' }));
    }
    return {
      id: user.id,
      email: user.email,
      cookie: `${AUTH_COOKIE_NAME}=${tokens.accessToken}`,
      csrf: tokens.csrfToken,
    };
  }

  const get = (who: Actor | null, path: string) => {
    const req = request(app.getHttpServer())
      .get(path)
      .set('Origin', ALLOWED_ORIGIN);
    return who ? req.set('Cookie', [who.cookie]) : req;
  };

  const ROUTES = [
    '/admin/overview',
    '/admin/queue-counts',
    '/admin/fraud-log',
    '/admin/ledger/journals',
    '/admin/ledger/summary',
  ];

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ||
      'postgresql://postgres:postgres@localhost:5433/rescom_test';

    userRepo = new InMemoryUserRepository();
    const auditRepo = new InMemoryIdentityAuditRepository();
    const sessionRepo = new InMemorySessionRepository(auditRepo);
    profileRepo = new InMemoryUserProfileRepository();
    forms = new InMemoryFormAdminReads();
    economy = new InMemoryAdminEconomyStats();
    fraud = new InMemoryFraudLogReader();
    missingCodes = new InMemoryMissingCodeReportStats();

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
      .overrideProvider(USER_ADMIN_TRANSACTION_PORT)
      .useValue(
        new InMemoryUserAdminTransactionAdapter(
          userRepo,
          sessionRepo,
          auditRepo,
        ),
      )
      .overrideProvider(USER_PROFILE_REPOSITORY_PORT)
      .useValue(profileRepo)
      .overrideProvider(ADMIN_USER_DIRECTORY_PORT)
      .useValue(new InMemoryAdminUserDirectory(userRepo, profileRepo))
      .overrideProvider(MISSING_CODE_REPORT_STATS_PORT)
      .useValue(missingCodes)
      .overrideProvider(MODERATION_QUEUE_STATS_PORT)
      .useValue(forms)
      .overrideProvider(FORM_TITLE_LOOKUP_PORT)
      .useValue(forms)
      .overrideProvider(ADMIN_ECONOMY_STATS_PORT)
      .useValue(economy)
      .overrideProvider(FRAUD_LOG_READ_PORT)
      .useValue(fraud)
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

  beforeEach(() => {
    forms.clear();
    economy.clear();
    fraud.clear();
    missingCodes.unresolved = 0;
    missingCodes.calls = 0;
  });

  it('answers 401 without a session and 403 FORBIDDEN_RESOURCE to respondents and publishers', async () => {
    const respondent = await actor('RESPONDENT');
    const publisher = await actor('PUBLISHER');
    for (const route of ROUTES) {
      for (const path of [route, `/api${route}`]) {
        const anonymous = await get(null, path).expect(401);
        expect(anonymous.body.data).toBeNull();
        for (const who of [respondent, publisher]) {
          const forbidden = await get(who, path).expect(403);
          expect(forbidden.body.error.code).toBe('FORBIDDEN_RESOURCE');
        }
      }
    }
    expect(forms.calls + economy.calls + fraud.calls).toBe(0);
  });

  it('answers a locked ADMIN with the existing locked envelope on every route', async () => {
    const locked = await actor('ADMIN', 'LOCKED');
    for (const route of ROUTES) {
      for (const path of [route, `/api${route}`]) {
        const res = await get(locked, path).expect(403);
        expect(res.body.data).toBeNull();
        expect(res.body.error.code).toBe('AUTH_USER_LOCKED');
      }
    }
    expect(forms.calls + economy.calls + fraud.calls).toBe(0);
  });

  it('serves the overview and the queue counts with the shared contracts on both prefixes', async () => {
    const admin = await actor('ADMIN');
    const publisher = await actor('PUBLISHER');
    await profileRepo.upsertPartial(publisher.id, { displayName: 'Linh' });
    forms.seed(
      {
        id: FORM,
        title: 'Thói quen đọc sách',
        type: 'INTERNAL',
        status: 'MODERATION_QUEUE',
        publisherId: publisher.id,
        updatedAt: new Date(Date.now() - DAY),
      },
      {
        id: id(1),
        title: 'Đang chạy',
        type: 'EXTERNAL',
        status: 'PUBLISHED',
        publisherId: publisher.id,
        updatedAt: new Date(),
      },
    );
    economy.pendingTopUps = [
      {
        id: id(2),
        userId: admin.id,
        amount: 100,
        amountVnd: 20_000,
        transferReference: 'RESCOMK7Q2M9XA',
        createdAt: new Date(),
      },
      {
        id: id(3),
        userId: admin.id,
        amount: 50,
        amountVnd: 10_000,
        transferReference: 'RESCOMB3N8Q1ZY',
        createdAt: new Date(Date.now() + 60_000),
      },
    ];
    economy.balances = { escrow: 250, pending: 0 };
    missingCodes.unresolved = 3;

    for (const prefix of ['', '/api']) {
      const counts = await get(admin, `${prefix}/admin/queue-counts`).expect(
        200,
      );
      expect(counts.headers['cache-control']).toBe('no-store');
      expect(adminQueueCountsSchema.parse(counts.body.data)).toEqual({
        surveys: 1,
        topUps: 2,
        disputes: 3,
        quality: 0,
      });

      const res = await get(admin, `${prefix}/admin/overview`).expect(200);
      const overview = adminOverviewSchema.parse(res.body.data);
      expect(overview.pendingSurveys.count).toBe(1);
      expect(overview.escrow).toEqual({ points: 250, runningSurveys: 1 });
      expect(overview.pendingTopUps).toEqual({
        count: 2,
        points: 150,
        amountVnd: 30_000,
      });
      expect(overview.openIssues).toEqual({
        disputes: 0,
        missingCodeReports: 3,
      });
      expect(overview.todo.map((item) => item.kind)).toEqual([
        'SURVEY_REVIEW',
        'TOP_UP',
      ]);
      expect(overview.todo[0]).toMatchObject({ publisherName: 'Linh' });
      expect(overview.todo[0]).toMatchObject({ moreCount: 0 });
      // The oldest of 2 pending top-ups: "+1 more".
      expect(overview.todo[1]).toMatchObject({
        requesterName: admin.email,
        moreCount: 1,
      });
    }
  });

  it('lists the FraudLog with filters, a keyset cursor and account statuses', async () => {
    const admin = await actor('ADMIN');
    const offender = await actor('RESPONDENT');
    forms.seed({
      id: FORM,
      title: 'Thói quen đọc sách',
      type: 'INTERNAL',
      status: 'PUBLISHED',
      publisherId: admin.id,
      updatedAt: new Date(),
      versionIds: [VERSION],
    });
    const now = Date.now();
    fraud.rows = [1, 2, 3].map((n) => ({
      id: id(n),
      userId: offender.id,
      type: n === 2 ? 'SECURITY_VIOLATION' : 'TIME_BARRIER',
      details:
        n === 2
          ? {
              action: 'COMPLETION_CODE_VERIFICATION_FAILED',
              formVersionId: VERSION,
              failureCount: 2,
              isLocked: false,
            }
          : { formId: FORM, elapsedSeconds: 30, requiredSeconds: 90 },
      createdAt: new Date(now - n * 3_600_000),
    }));

    const first = await get(
      admin,
      `/api/admin/fraud-log?userId=${offender.id}&days=14&limit=2`,
    ).expect(200);
    const page = fraudLogPageSchema.parse(first.body.data);
    expect(page.items.map((item) => item.id)).toEqual([id(1), id(2)]);
    expect(page.items[1].survey).toEqual({
      id: FORM,
      title: 'Thói quen đọc sách',
    });
    expect(page.total).toBe(3);
    expect(page.windowDays).toBe(14);
    expect(page.accounts).toEqual([
      { userId: offender.id, count: 3, repeated: true, status: 'ACTIVE' },
    ]);
    expect(page.nextCursor).not.toBeNull();

    const second = await get(
      admin,
      `/admin/fraud-log?userId=${offender.id}&limit=2&cursor=${encodeURIComponent(page.nextCursor!)}`,
    ).expect(200);
    expect(
      fraudLogPageSchema.parse(second.body.data).items.map((item) => item.id),
    ).toEqual([id(3)]);

    const byKind = await get(
      admin,
      '/admin/fraud-log?type=COMPLETION_CODE',
    ).expect(200);
    expect(
      byKind.body.data.items.map((item: { id: string }) => item.id),
    ).toEqual([id(2)]);

    const bySearch = await get(
      admin,
      `/admin/fraud-log?search=${encodeURIComponent(offender.email)}`,
    ).expect(200);
    expect(bySearch.body.data.total).toBe(3);

    for (const bad of [
      'days=5',
      'type=NOPE',
      'limit=101',
      'cursor=x',
      'page=2',
    ]) {
      const res = await get(admin, `/admin/fraud-log?${bad}`).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('lists ledger journals by segment with the keyset cursor and serves the summary', async () => {
    const admin = await actor('ADMIN');
    await profileRepo.upsertPartial(admin.id, {
      displayName: 'Nguyễn Thuỳ Linh',
    });
    forms.seed({
      id: FORM,
      title: 'Hành vi tiêu dùng',
      type: 'INTERNAL',
      status: 'CLOSED',
      publisherId: admin.id,
      updatedAt: new Date(),
    });
    const now = Date.now();
    const journal = (n: number, key: string, minutesAgo: number) => {
      const createdAt = new Date(now - minutesAgo * 60_000);
      return {
        id: id(n),
        idempotencyKey: key,
        description: null,
        reversesJournalId: null,
        createdAt,
        entries: [
          {
            id: id(100 + n),
            accountId: id(200),
            amount: -40,
            createdAt,
            accountClass: 'ESCROW' as const,
            ownerUserId: admin.id,
          },
          {
            id: id(300 + n),
            accountId: id(201),
            amount: 40,
            createdAt,
            accountClass: 'USER_AVAILABLE' as const,
            ownerUserId: admin.id,
          },
        ],
      };
    };
    economy.journals = [
      journal(1, `close-refund:${FORM}:c1`, 1),
      journal(2, `topup-approval:${id(9)}`, 2),
      journal(3, `close-refund:${FORM}:c2`, 3),
    ];
    economy.balances = { escrow: 120, pending: 10 };

    const first = await get(
      admin,
      '/admin/ledger/journals?type=refund&limit=1',
    ).expect(200);
    const list = adminJournalListSchema.parse(first.body.data);
    expect(list.items.map((item) => item.id)).toEqual([id(1)]);
    expect(list.hasMore).toBe(true);
    expect(list.items[0].related).toBe('Hành vi tiêu dùng');
    expect(list.items[0].entries[1]).toMatchObject({
      accountClass: 'USER_AVAILABLE',
      ownerName: 'Nguyễn Thuỳ Linh',
    });

    const cursor = encodeURIComponent(
      `${list.items[0].createdAt}:${list.items[0].id}`,
    );
    const second = await get(
      admin,
      `/api/admin/ledger/journals?type=refund&limit=1&before=${cursor}`,
    ).expect(200);
    expect(adminJournalListSchema.parse(second.body.data).items[0].id).toBe(
      id(3),
    );

    const summary = await get(admin, '/admin/ledger/summary').expect(200);
    expect(adminLedgerSummarySchema.parse(summary.body.data)).toMatchObject({
      escrowTotal: 120,
      pendingTotal: 10,
    });

    for (const bad of ['type=payout', 'before=garbage', 'limit=0', 'extra=1']) {
      const res = await get(admin, `/admin/ledger/journals?${bad}`).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('returns the lock reason on the admin user DTO (plan 4.6)', async () => {
    const admin = await actor('ADMIN');
    const target = await actor('RESPONDENT');
    const reason = 'Vi phạm lặp lại: nộp quá nhanh, sai mã.';

    const locked = await request(app.getHttpServer())
      .patch(`/admin/users/${target.id}/status`)
      .set('Cookie', [admin.cookie])
      .set('Origin', ALLOWED_ORIGIN)
      .set('x-csrf-token', admin.csrf)
      .send({ status: 'LOCKED', reason })
      .expect(200);
    expect(
      adminUserDetailResponseSchema.parse(locked.body).data.user.lockReason,
    ).toBe(reason);

    const detail = await get(admin, `/admin/users/${target.id}`).expect(200);
    expect(detail.body.data.user.lockReason).toBe(reason);
    const listed = await get(admin, '/admin/users?status=LOCKED').expect(200);
    expect(
      listed.body.data.items.find(
        (item: { id: string }) => item.id === target.id,
      )?.lockReason,
    ).toBe(reason);

    const unlocked = await request(app.getHttpServer())
      .patch(`/admin/users/${target.id}/status`)
      .set('Cookie', [admin.cookie])
      .set('Origin', ALLOWED_ORIGIN)
      .set('x-csrf-token', admin.csrf)
      .send({ status: 'ACTIVE' })
      .expect(200);
    expect(unlocked.body.data.user.lockReason).toBeNull();
  });
});
