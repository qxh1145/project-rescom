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
import { NOTIFICATION_REPOSITORY_PORT } from '../src/modules/notifications/application/ports/notification-repository.port';
import {
  NOTIFICATION_PUBLISHER_PORT,
  NotificationPublisherPort,
} from '../src/modules/notifications/application/ports/notification-publisher.port';
import { InMemoryNotificationRepository } from '../src/modules/notifications/infrastructure/in-memory-notification.repository';
import { SessionService } from '../src/modules/auth/application/session.service';
import { EnvService } from '../src/common/config/env.service';
import { PrismaService } from '../src/common/database/prisma.service';
import { HttpExceptionFilter } from '../src/common/http/http-exception.filter';
import { AUTH_COOKIE_NAME } from '../src/modules/auth/presentation/cookie-options.helper';
import { LedgerService } from '../src/modules/economy/application/ledger.service';

const HOUR_MS = 60 * 60 * 1000;

describe('Story 9.6: Event Notification System E2E Tests', () => {
  let app: INestApplication;
  let userRepo: InMemoryUserRepository;
  let ledgerService: LedgerService;
  let sessionService: SessionService;
  let notificationRepo: InMemoryNotificationRepository;
  let publisher: NotificationPublisherPort;
  /** Ledger clock (Epic 6 review P2: releases need a 48 h old credit). */
  const creditTime = new Date('2026-09-20T08:00:00.000Z');
  let now = creditTime;

  const TEST_JWT_SECRET = 'at_least_32_characters_super_secure_jwt_secret_key!';
  const ALLOWED_ORIGIN = 'http://localhost:3000';

  let publisherUser: any;
  let respondent: { id: string; cookie: string; csrf: string };
  let otherUser: { id: string; cookie: string; csrf: string };

  async function login(email: string) {
    const user = await userRepo.create({
      email,
      passwordHash: '$2a$12$someHashedPassword',
      role: 'RESPONDENT',
      status: 'ACTIVE',
    });
    const tokens = await sessionService.createSession(user.id);
    return {
      id: user.id,
      cookie: `${AUTH_COOKIE_NAME}=${tokens.accessToken}`,
      csrf: tokens.csrfToken,
    };
  }

  /**
   * Seeds a Pending credit through the ledger (Epic 6 review P1: the HTTP
   * credit route is an Admin re-drive of a real completion).
   */
  async function creditPending(attemptId: string, amount: number) {
    now = creditTime;
    await ledgerService.creditPendingReward({
      attemptId,
      publisherId: publisherUser.id,
      respondentId: respondent.id,
      amount,
    });
  }

  /** Releases the respondent's own credit once it is 48 h old. */
  function releasePending(attemptId: string) {
    now = new Date(creditTime.getTime() + 48 * HOUR_MS);
    return request(app.getHttpServer())
      .post(`/economy/rewards/release-pending/${attemptId}`)
      .set('Cookie', respondent.cookie)
      .set('x-csrf-token', respondent.csrf)
      .set('Origin', ALLOWED_ORIGIN)
      .send({})
      .expect(200);
  }

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ||
      'postgresql://postgres:postgres@localhost:5433/rescom_test';

    userRepo = new InMemoryUserRepository();
    const auditRepo = new InMemoryIdentityAuditRepository();
    const sessionRepo = new InMemorySessionRepository(auditRepo);
    const ledgerRepo = new InMemoryLedgerRepository();
    notificationRepo = new InMemoryNotificationRepository();
    ledgerService = new LedgerService(ledgerRepo, { clock: () => now });

    const envService = new EnvService({
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
      .overrideProvider(LedgerService)
      .useValue(ledgerService)
      .overrideProvider(NOTIFICATION_REPOSITORY_PORT)
      .useValue(notificationRepo)
      .overrideProvider(EnvService)
      .useValue(envService)
      .compile();

    sessionService = moduleFixture.get(SessionService);
    publisher = moduleFixture.get<NotificationPublisherPort>(
      NOTIFICATION_PUBLISHER_PORT,
    );

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    publisherUser = await userRepo.create({
      email: 'publisher-notify@rescom.test',
      passwordHash: '$2a$12$someHashedPassword',
      role: 'PUBLISHER',
      status: 'ACTIVE',
    });
    respondent = await login('respondent-notify@rescom.test');
    otherUser = await login('other-notify@rescom.test');

    const system = await ledgerService.getOrCreateAccount(
      null,
      'SYSTEM_ISSUANCE',
    );
    const escrow = await ledgerService.getOrCreateAccount(
      publisherUser.id,
      'ESCROW',
    );
    await ledgerService.postJournal({
      idempotencyKey: 'seed-notify-escrow',
      entries: [
        { accountId: system.id, amount: -300 },
        { accountId: escrow.id, amount: 300 },
      ],
    });
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  describe('48h pending release creates a notification (FR-57)', () => {
    const attemptId = randomUUID();
    let notificationId: string;

    it('records one REWARD_RELEASED notification for the respondent, even on replay', async () => {
      await creditPending(attemptId, 20);
      await releasePending(attemptId);
      await releasePending(attemptId); // idempotent replay

      const released = notificationRepo
        .all()
        .filter((n) => n.type === 'REWARD_RELEASED');
      expect(released).toHaveLength(1);
      expect(released[0]).toMatchObject({
        userId: respondent.id,
        dedupeKey: `release-pending:${attemptId}`,
        isRead: false,
      });
    });

    it('shows the unread badge count and the recent list to the respondent', async () => {
      const countRes = await request(app.getHttpServer())
        .get('/notifications/unread-count')
        .set('Cookie', respondent.cookie)
        .expect(200);
      expect(countRes.body).toEqual({
        data: { unreadCount: 1 },
        error: null,
        meta: {},
      });

      const listRes = await request(app.getHttpServer())
        .get('/api/notifications')
        .set('Cookie', respondent.cookie)
        .expect(200);
      expect(listRes.body.data).toMatchObject({
        unreadCount: 1,
        total: 1,
        limit: 20,
        offset: 0,
        hasMore: false,
      });
      expect(listRes.body.data.items[0]).toMatchObject({
        type: 'REWARD_RELEASED',
        isRead: false,
        readAt: null,
      });
      expect(listRes.body.data.items[0].message).toMatch(/20/);
      expect(listRes.body.data.items[0]).not.toHaveProperty('userId');
      notificationId = listRes.body.data.items[0].id;
    });

    it("does not expose or let another user modify the respondent's notification", async () => {
      const otherList = await request(app.getHttpServer())
        .get('/notifications')
        .set('Cookie', otherUser.cookie)
        .expect(200);
      expect(otherList.body.data.items).toEqual([]);
      expect(otherList.body.data.unreadCount).toBe(0);

      const res = await request(app.getHttpServer())
        .patch(`/notifications/${notificationId}/read`)
        .set('Cookie', otherUser.cookie)
        .set('x-csrf-token', otherUser.csrf)
        .set('Origin', ALLOWED_ORIGIN)
        .expect(404);
      expect(res.body.error.code).toBe('NOTIFICATION_NOT_FOUND');
      expect(
        notificationRepo.all().find((n) => n.id === notificationId),
      ).toMatchObject({ isRead: false });
    });

    it('cannot be used to push a release notification to someone else', async () => {
      // Replaying the respondent's release while claiming another user.
      const spoof = await request(app.getHttpServer())
        .post(`/economy/rewards/release-pending/${attemptId}`)
        .set('Cookie', respondent.cookie)
        .set('x-csrf-token', respondent.csrf)
        .set('Origin', ALLOWED_ORIGIN)
        .send({ respondentId: otherUser.id })
        .expect(403);
      expect(spoof.body.error.code).toBe('PENDING_REWARD_FORBIDDEN');

      // Another user triggering the respondent's release is refused too:
      // ownership comes from the credit journal (Epic 6 review P2).
      const foreign = await request(app.getHttpServer())
        .post(`/economy/rewards/release-pending/${attemptId}`)
        .set('Cookie', otherUser.cookie)
        .set('x-csrf-token', otherUser.csrf)
        .set('Origin', ALLOWED_ORIGIN)
        .send({})
        .expect(403);
      expect(foreign.body.error.code).toBe('PENDING_REWARD_FORBIDDEN');

      // Caller-supplied amounts (and so text) are no longer accepted at all.
      const invalid = await request(app.getHttpServer())
        .post(`/economy/rewards/release-pending/${attemptId}`)
        .set('Cookie', respondent.cookie)
        .set('x-csrf-token', respondent.csrf)
        .set('Origin', ALLOWED_ORIGIN)
        .send({ amount: 'free points' })
        .expect(400);
      expect(invalid.body.error.code).toBe('VALIDATION_ERROR');

      expect(
        notificationRepo.all().filter((n) => n.userId === otherUser.id),
      ).toHaveLength(0);
      expect(
        notificationRepo.all().filter((n) => n.type === 'REWARD_RELEASED'),
      ).toHaveLength(1);
    });

    it('requires a CSRF token to mark a notification read', async () => {
      // A real, unread notification of the caller (not an undefined id).
      expect(notificationId).toEqual(expect.any(String));
      expect(
        notificationRepo.all().find((n) => n.id === notificationId),
      ).toMatchObject({ userId: respondent.id, isRead: false });

      const res = await request(app.getHttpServer())
        .patch(`/notifications/${notificationId}/read`)
        .set('Cookie', respondent.cookie)
        .set('Origin', ALLOWED_ORIGIN)
        .expect(403);
      expect(res.body.error.code).not.toBe('NOTIFICATION_NOT_FOUND');
      expect(
        notificationRepo.all().find((n) => n.id === notificationId),
      ).toMatchObject({ isRead: false });
    });

    it('marks the notification read and clears the badge', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/notifications/${notificationId}/read`)
        .set('Cookie', respondent.cookie)
        .set('x-csrf-token', respondent.csrf)
        .set('Origin', ALLOWED_ORIGIN)
        .expect(200);

      expect(res.body.data.notification).toMatchObject({
        id: notificationId,
        isRead: true,
      });
      expect(res.body.data.notification.readAt).toEqual(expect.any(String));
      expect(res.body.data.unreadCount).toBe(0);

      const unreadOnly = await request(app.getHttpServer())
        .get('/notifications?unreadOnly=true')
        .set('Cookie', respondent.cookie)
        .expect(200);
      expect(unreadOnly.body.data.items).toEqual([]);
      expect(unreadOnly.body.data.total).toBe(0);
    });
  });

  describe('mark all read and paging', () => {
    it('marks every unread notification of the caller only', async () => {
      for (const key of ['a', 'b', 'c']) {
        await publisher.publish({
          userId: respondent.id,
          type: 'WARNING',
          message: `Notice ${key}`,
          dedupeKey: `e2e-notice:${key}`,
        });
      }
      await publisher.publish({
        userId: otherUser.id,
        type: 'WARNING',
        message: 'Other notice',
        dedupeKey: 'e2e-notice:other',
      });

      const page = await request(app.getHttpServer())
        .get('/notifications?limit=2&offset=0')
        .set('Cookie', respondent.cookie)
        .expect(200);
      expect(page.body.data.items).toHaveLength(2);
      expect(page.body.data.hasMore).toBe(true);
      expect(page.body.data.unreadCount).toBe(3);

      const res = await request(app.getHttpServer())
        .patch('/api/notifications/read-all')
        .set('Cookie', respondent.cookie)
        .set('x-csrf-token', respondent.csrf)
        .set('Origin', ALLOWED_ORIGIN)
        .expect(200);
      expect(res.body.data).toEqual({ updatedCount: 3, unreadCount: 0 });

      const otherCount = await request(app.getHttpServer())
        .get('/notifications/unread-count')
        .set('Cookie', otherUser.cookie)
        .expect(200);
      expect(otherCount.body.data.unreadCount).toBe(1);
    });
  });

  describe('validation and authentication', () => {
    it('rejects invalid list queries with 400 VALIDATION_ERROR', async () => {
      for (const query of [
        'limit=0',
        'limit=51',
        'offset=-1',
        // Epic 9 review P10: bounded offset (was an unmapped 500).
        'offset=1e20',
        'offset=10001',
        'unreadOnly=yes',
        'foo=1',
      ]) {
        const res = await request(app.getHttpServer())
          .get(`/notifications?${query}`)
          .set('Cookie', respondent.cookie)
          .expect(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('rejects a malformed notification id with 400', async () => {
      await request(app.getHttpServer())
        .patch('/notifications/not-a-uuid/read')
        .set('Cookie', respondent.cookie)
        .set('x-csrf-token', respondent.csrf)
        .set('Origin', ALLOWED_ORIGIN)
        .expect(400);
    });

    it('rejects unauthenticated requests with 401', async () => {
      await request(app.getHttpServer()).get('/notifications').expect(401);
      await request(app.getHttpServer())
        .get('/notifications/unread-count')
        .expect(401);
      await request(app.getHttpServer())
        .patch('/notifications/read-all')
        .expect(401);
      await request(app.getHttpServer())
        .patch(`/notifications/${randomUUID()}/read`)
        .expect(401);
    });
  });
});
