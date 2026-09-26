import { Test, TestingModule } from '@nestjs/testing';
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
import { STARTER_POINTS_DATA_PROVIDER } from '../src/modules/economy/economy.module';
import { InMemoryStarterPointsDataProvider } from '../src/modules/economy/infrastructure/in-memory-starter-points-data-provider';
import { SessionService } from '../src/modules/auth/application/session.service';
import { EnvService } from '../src/common/config/env.service';
import { PrismaService } from '../src/common/database/prisma.service';
import { HttpExceptionFilter } from '../src/common/http/http-exception.filter';
import { AUTH_COOKIE_NAME } from '../src/modules/auth/presentation/cookie-options.helper';
import { LedgerService } from '../src/modules/economy/application/ledger.service';
import { UserRole } from '../src/modules/users/domain/user.entity';
import { NOTIFICATION_REPOSITORY_PORT } from '../src/modules/notifications/application/ports/notification-repository.port';
import { InMemoryNotificationRepository } from '../src/modules/notifications/infrastructure/in-memory-notification.repository';

describe('Story 6.5: Frozen Starter Points Lifecycle E2E Tests', () => {
  let app: INestApplication;
  let userRepo: InMemoryUserRepository;
  let sessionRepo: InMemorySessionRepository;
  let auditRepo: InMemoryIdentityAuditRepository;
  let ledgerRepo: InMemoryLedgerRepository;
  let ledgerService: LedgerService;
  let sessionService: SessionService;
  let envService: EnvService;
  let dataProvider: InMemoryStarterPointsDataProvider;
  let notificationRepo: InMemoryNotificationRepository;

  const TEST_JWT_SECRET = 'at_least_32_characters_super_secure_jwt_secret_key!';
  const ALLOWED_ORIGIN = 'http://localhost:3000';

  let adminUser: any;
  let adminCookie: string;
  let adminCsrfToken: string;

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ||
      'postgresql://postgres:postgres@localhost:5433/rescom_test';

    userRepo = new InMemoryUserRepository();
    auditRepo = new InMemoryIdentityAuditRepository();
    sessionRepo = new InMemorySessionRepository(auditRepo);
    ledgerRepo = new InMemoryLedgerRepository();
    dataProvider = new InMemoryStarterPointsDataProvider();
    notificationRepo = new InMemoryNotificationRepository();

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
      .overrideProvider(STARTER_POINTS_DATA_PROVIDER)
      .useValue(dataProvider)
      .overrideProvider(NOTIFICATION_REPOSITORY_PORT)
      .useValue(notificationRepo)
      .overrideProvider(EnvService)
      .useValue(envService)
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    ledgerService = moduleFixture.get<LedgerService>(LedgerService);
    sessionService = moduleFixture.get<SessionService>(SessionService);

    // Create Admin user
    adminUser = await userRepo.create({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      email: 'admin@rescom.test',
      passwordHash: null,
      role: 'ADMIN' as UserRole,
      status: 'ACTIVE',
    });
    const adminTokens = await sessionService.createSession(adminUser.id);
    adminCookie = `${AUTH_COOKIE_NAME}=${adminTokens.accessToken}`;
    adminCsrfToken = adminTokens.csrfToken;
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('automatically grants 100 Frozen starter points upon registration (FR-4)', async () => {
    const email = 'newstarter@rescom.test';
    const registerRes = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password: 'StrongPassword123!' })
      .expect(201);

    const user = registerRes.body.data.user;
    expect(user.id).toBeDefined();

    dataProvider.userRegistrationDates.set(user.id, new Date());

    const sessionTokens = await sessionService.createSession(user.id);
    const userCookie = `${AUTH_COOKIE_NAME}=${sessionTokens.accessToken}`;

    // Verify wallet shows 100 Frozen and 0 Available
    const walletRes = await request(app.getHttpServer())
      .get('/economy/wallet')
      .set('Cookie', userCookie)
      .expect(200);

    expect(walletRes.body.data.balance.frozen).toBe(100);
    expect(walletRes.body.data.balance.available).toBe(0);
    expect(walletRes.body.data.balance.total).toBe(100);

    // Check starter points status
    const statusRes = await request(app.getHttpServer())
      .get('/economy/starter-points/status')
      .set('Cookie', userCookie)
      .expect(200);

    expect(statusRes.body.data.userId).toBe(user.id);
    expect(statusRes.body.data.isGranted).toBe(true);
    expect(statusRes.body.data.frozenBalance).toBe(100);
    expect(statusRes.body.data.isDemographicComplete).toBe(false);
    expect(statusRes.body.data.hasCompletedMarketplaceSurvey).toBe(false);
    expect(statusRes.body.data.isUnlocked).toBe(false);
    expect(statusRes.body.data.unlockEligibility.eligible).toBe(false);
    expect(statusRes.body.data.unlockEligibility.missingSteps).toHaveLength(2);
    expect(statusRes.body.data.activationState).toBe('DEMOGRAPHICS_REQUIRED');
    expect(statusRes.body.data.activatedAt).toBeNull();
  });

  describe('a failed registration grant is recovered (FR-4)', () => {
    const password = 'StrongPassword123!';

    async function starterGrants(userId: string) {
      const wallet = await ledgerService.getWallet(userId);
      return {
        frozen: wallet.balance.frozen,
        grants: wallet.transactions.filter(
          (t) => t.idempotencyKey === `starter-grant:${userId}`,
        ).length,
      };
    }

    async function registerWhileGrantFails(email: string) {
      const grant = jest
        .spyOn(ledgerService, 'grantStarterPoints')
        .mockRejectedValueOnce(new Error('ledger unavailable'));
      try {
        const res = await request(app.getHttpServer())
          .post('/auth/register')
          .send({ email, password })
          .expect(201);
        expect(grant).toHaveBeenCalledTimes(1);
        return res.body.data.user.id as string;
      } finally {
        grant.mockRestore();
      }
    }

    it('still returns 201, and the next login grants exactly 100 Frozen once', async () => {
      const email = 'grant-fails-login@rescom.test';
      const userId = await registerWhileGrantFails(email);
      expect(await starterGrants(userId)).toEqual({ frozen: 0, grants: 0 });

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password })
        .expect(200);
      expect(await starterGrants(userId)).toEqual({ frozen: 100, grants: 1 });

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password })
        .expect(200);
      expect(await starterGrants(userId)).toEqual({ frozen: 100, grants: 1 });
    });

    it('is recovered by the next starter-points status read', async () => {
      const userId = await registerWhileGrantFails(
        'grant-fails-status@rescom.test',
      );
      const tokens = await sessionService.createSession(userId);

      const statusRes = await request(app.getHttpServer())
        .get('/economy/starter-points/status')
        .set('Cookie', `${AUTH_COOKIE_NAME}=${tokens.accessToken}`)
        .expect(200);

      expect(statusRes.body.data).toMatchObject({
        isGranted: true,
        frozenBalance: 100,
        activationState: 'DEMOGRAPHICS_REQUIRED',
      });
      expect(await starterGrants(userId)).toEqual({ frozen: 100, grants: 1 });
    });
  });

  it('rejects starter points unlock when onboarding is incomplete (FR-8)', async () => {
    const user = await userRepo.create({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      email: 'incomplete@rescom.test',
      passwordHash: null,
      role: 'RESPONDENT' as UserRole,
      status: 'ACTIVE',
    });
    await ledgerService.grantStarterPoints(user.id);
    dataProvider.userRegistrationDates.set(user.id, new Date());
    dataProvider.demographicCompletions.set(user.id, true);

    const tokens = await sessionService.createSession(user.id);
    const userCookie = `${AUTH_COOKIE_NAME}=${tokens.accessToken}`;
    const userCsrfToken = tokens.csrfToken;

    const unlockRes = await request(app.getHttpServer())
      .post('/economy/starter-points/unlock')
      .set('Cookie', userCookie)
      .set('x-csrf-token', userCsrfToken)
      .set('Origin', ALLOWED_ORIGIN)
      .expect(200);

    expect(unlockRes.body.data.unlocked).toBe(false);
    expect(unlockRes.body.data.missingSteps).toContain(
      'Complete 1 Marketplace Survey',
    );

    // Balance remains 100 frozen
    const walletRes = await request(app.getHttpServer())
      .get('/economy/wallet')
      .set('Cookie', userCookie)
      .expect(200);

    expect(walletRes.body.data.balance.frozen).toBe(100);
    expect(walletRes.body.data.balance.available).toBe(0);
  });

  it('unlocks 100 Frozen points to Available when both demographic and marketplace steps are completed (FR-8)', async () => {
    const user = await userRepo.create({
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      email: 'completed@rescom.test',
      passwordHash: null,
      role: 'RESPONDENT' as UserRole,
      status: 'ACTIVE',
    });
    await ledgerService.grantStarterPoints(user.id);
    dataProvider.userRegistrationDates.set(user.id, new Date());
    dataProvider.demographicCompletions.set(user.id, true);
    dataProvider.recordCompletion(user.id);

    const tokens = await sessionService.createSession(user.id);
    const userCookie = `${AUTH_COOKIE_NAME}=${tokens.accessToken}`;
    const userCsrfToken = tokens.csrfToken;

    const unlockRes = await request(app.getHttpServer())
      .post('/economy/starter-points/unlock')
      .set('Cookie', userCookie)
      .set('x-csrf-token', userCsrfToken)
      .set('Origin', ALLOWED_ORIGIN)
      .expect(200);

    expect(unlockRes.body.data.unlocked).toBe(true);
    expect(unlockRes.body.data.amount).toBe(100);

    // Verify wallet updated: 0 Frozen, 100 Available
    const walletRes = await request(app.getHttpServer())
      .get('/economy/wallet')
      .set('Cookie', userCookie)
      .expect(200);

    expect(walletRes.body.data.balance.frozen).toBe(0);
    expect(walletRes.body.data.balance.available).toBe(100);
    expect(walletRes.body.data.balance.total).toBe(100);

    // Status shows unlocked
    const statusRes = await request(app.getHttpServer())
      .get('/economy/starter-points/status')
      .set('Cookie', userCookie)
      .expect(200);

    expect(statusRes.body.data.isUnlocked).toBe(true);
    expect(statusRes.body.data.activationState).toBe('ACTIVATED');
    expect(statusRes.body.data.activatedAt).toEqual(expect.any(String));

    // Story 9.6: the activation is announced in the user's notification center
    const notificationsRes = await request(app.getHttpServer())
      .get('/notifications')
      .set('Cookie', userCookie)
      .expect(200);
    expect(notificationsRes.body.data.unreadCount).toBe(1);
    expect(notificationsRes.body.data.items[0]).toMatchObject({
      type: 'ACCOUNT_ACTIVATED',
      isRead: false,
    });
    expect(notificationsRes.body.data.items[0].message).toMatch(/unlocked/i);
  });

  it('expires (voids) frozen points for accounts older than 30 days without completed onboarding (FR-5)', async () => {
    const user = await userRepo.create({
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      email: 'expired@rescom.test',
      passwordHash: null,
      role: 'RESPONDENT' as UserRole,
      status: 'ACTIVE',
    });
    await ledgerService.grantStarterPoints(user.id);
    const thirtyOneDaysAgo = new Date(Date.now() - 31 * 86400000);
    dataProvider.userRegistrationDates.set(user.id, thirtyOneDaysAgo);
    dataProvider.demographicCompletions.set(user.id, false);

    // Admin triggers expiry endpoint
    const expireRes = await request(app.getHttpServer())
      .post('/economy/starter-points/expire')
      .set('Cookie', adminCookie)
      .set('x-csrf-token', adminCsrfToken)
      .set('Origin', ALLOWED_ORIGIN)
      .send({ cutoffDate: new Date(Date.now() - 30 * 86400000).toISOString() })
      .expect(200);

    expect(expireRes.body.data.expiredCount).toBeGreaterThanOrEqual(1);
    expect(expireRes.body.data.expiredUserIds).toContain(user.id);
    expect(expireRes.body.data.totalPointsVoided).toBeGreaterThanOrEqual(100);
    expect(expireRes.body.data.unlockedUserIds).toEqual([]);
    expect(expireRes.body.data.failedCount).toBe(0);

    // Verify user wallet has 0 frozen and 0 available
    const tokens = await sessionService.createSession(user.id);
    const userCookie = `${AUTH_COOKIE_NAME}=${tokens.accessToken}`;

    const walletRes = await request(app.getHttpServer())
      .get('/economy/wallet')
      .set('Cookie', userCookie)
      .expect(200);

    expect(walletRes.body.data.balance.frozen).toBe(0);
    expect(walletRes.body.data.balance.available).toBe(0);
    expect(walletRes.body.data.balance.total).toBe(0);

    // Verify warning notification was generated
    const notification = notificationRepo
      .all()
      .find((n) => n.userId === user.id && n.type === 'WARNING');
    expect(notification).toBeDefined();
    expect(notification?.message).toMatch(/expired/i);
  });

  it('sweeps in bounded batches: every candidate once, then a null cursor', async () => {
    const batchUsers = [
      '12121212-0000-4000-8000-000000000003',
      '12121212-0000-4000-8000-000000000001',
      '12121212-0000-4000-8000-000000000002',
    ];
    for (const [index, id] of batchUsers.entries()) {
      await userRepo.create({
        id,
        email: `batch-${index}@rescom.test`,
        passwordHash: null,
        role: 'RESPONDENT' as UserRole,
        status: 'ACTIVE',
      });
      await ledgerService.grantStarterPoints(id);
      dataProvider.userRegistrationDates.set(
        id,
        new Date(Date.now() - (40 + index) * 86400000),
      );
    }

    const expired: string[] = [];
    let after: string | undefined;
    let batches = 0;
    do {
      const res = await request(app.getHttpServer())
        .post('/economy/starter-points/expire')
        .set('Cookie', adminCookie)
        .set('x-csrf-token', adminCsrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .send({ limit: 2, ...(after ? { after } : {}) })
        .expect(200);
      expect(res.body.data.scannedCount).toBeLessThanOrEqual(2);
      expired.push(...res.body.data.expiredUserIds);
      after = res.body.data.nextCursor ?? undefined;
      batches++;
    } while (after && batches < 10);

    expect(batches).toBeGreaterThanOrEqual(2);
    expect(after).toBeUndefined();
    // Oldest registration first; nobody is scanned twice.
    expect(expired).toEqual([batchUsers[2], batchUsers[1], batchUsers[0]]);
    for (const id of batchUsers) {
      expect((await ledgerService.getWallet(id)).balance.frozen).toBe(0);
    }
  });

  it('rejects an out-of-range batch size or a forged cursor with 400', async () => {
    for (const body of [
      { limit: 0 },
      { limit: 501 },
      { after: 'forged-cursor' },
      {
        after: Buffer.from(
          JSON.stringify({ registeredAt: 'yesterday', userId: adminUser.id }),
        ).toString('base64url'),
      },
    ]) {
      const res = await request(app.getHttpServer())
        .post('/economy/starter-points/expire')
        .set('Cookie', adminCookie)
        .set('x-csrf-token', adminCsrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .send(body)
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('rejects unauthenticated requests with 401 Unauthorized', async () => {
    await request(app.getHttpServer())
      .get('/economy/starter-points/status')
      .expect(401);

    await request(app.getHttpServer())
      .post('/economy/starter-points/unlock')
      .expect(401);

    await request(app.getHttpServer())
      .post('/economy/starter-points/expire')
      .expect(401);
  });

  it('rejects non-admin users from invoking the expiry endpoint with 403 Forbidden', async () => {
    const respondent = await userRepo.create({
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      email: 'regular@rescom.test',
      passwordHash: null,
      role: 'RESPONDENT' as UserRole,
      status: 'ACTIVE',
    });
    const tokens = await sessionService.createSession(respondent.id);
    const respondentCookie = `${AUTH_COOKIE_NAME}=${tokens.accessToken}`;

    await request(app.getHttpServer())
      .post('/economy/starter-points/expire')
      .set('Cookie', respondentCookie)
      .set('x-csrf-token', tokens.csrfToken)
      .set('Origin', ALLOWED_ORIGIN)
      .send({ cutoffDate: new Date().toISOString() })
      .expect(403);
  });

  it('guarantees idempotency on starter points grant and unlock operations', async () => {
    const user = await userRepo.create({
      id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      email: 'idempotent@rescom.test',
      passwordHash: null,
      role: 'RESPONDENT' as UserRole,
      status: 'ACTIVE',
    });
    // First grant
    const journal1 = await ledgerService.grantStarterPoints(user.id);
    // Second grant returns existing journal (idempotent)
    const journal2 = await ledgerService.grantStarterPoints(user.id);
    expect(journal1.id).toBe(journal2.id);

    // Setup eligibility
    dataProvider.userRegistrationDates.set(user.id, new Date());
    dataProvider.demographicCompletions.set(user.id, true);
    dataProvider.recordCompletion(user.id);

    const tokens = await sessionService.createSession(user.id);
    const userCookie = `${AUTH_COOKIE_NAME}=${tokens.accessToken}`;
    const userCsrfToken = tokens.csrfToken;

    // First unlock
    const unlock1 = await request(app.getHttpServer())
      .post('/economy/starter-points/unlock')
      .set('Cookie', userCookie)
      .set('x-csrf-token', userCsrfToken)
      .set('Origin', ALLOWED_ORIGIN)
      .expect(200);
    expect(unlock1.body.data.unlocked).toBe(true);

    // Second unlock (already unlocked, frozen balance is 0)
    const unlock2 = await request(app.getHttpServer())
      .post('/economy/starter-points/unlock')
      .set('Cookie', userCookie)
      .set('x-csrf-token', userCsrfToken)
      .set('Origin', ALLOWED_ORIGIN)
      .expect(200);
    expect(unlock2.body.data.unlocked).toBe(false);
  });
});
