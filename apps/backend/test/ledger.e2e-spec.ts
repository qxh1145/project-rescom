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
import { SessionService } from '../src/modules/auth/application/session.service';
import { EnvService } from '../src/common/config/env.service';
import { PrismaService } from '../src/common/database/prisma.service';
import { HttpExceptionFilter } from '../src/common/http/http-exception.filter';
import { AUTH_COOKIE_NAME } from '../src/modules/auth/presentation/cookie-options.helper';
import { LedgerService } from '../src/modules/economy/application/ledger.service';

describe('Story 6.1: Double-Entry Ledger Core & Idempotency E2E Tests', () => {
  let app: INestApplication;
  let userRepo: InMemoryUserRepository;
  let sessionRepo: InMemorySessionRepository;
  let auditRepo: InMemoryIdentityAuditRepository;
  let ledgerRepo: InMemoryLedgerRepository;
  let ledgerService: LedgerService;
  let sessionService: SessionService;
  let envService: EnvService;

  const TEST_JWT_SECRET = 'at_least_32_characters_super_secure_jwt_secret_key!';
  const ALLOWED_ORIGIN = 'http://localhost:3000';

  let authCookie: string;
  let csrfToken: string;
  let respondentUserId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ||
      'postgresql://postgres:postgres@localhost:5433/rescom_test';

    userRepo = new InMemoryUserRepository();
    auditRepo = new InMemoryIdentityAuditRepository();
    sessionRepo = new InMemorySessionRepository(auditRepo);
    ledgerRepo = new InMemoryLedgerRepository();

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
      .overrideProvider(EnvService)
      .useValue(envService)
      .compile();

    sessionService = moduleFixture.get(SessionService);
    ledgerService = moduleFixture.get(LedgerService);

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalFilters(new HttpExceptionFilter());
    app.enableCors({
      origin: (origin, callback) => {
        if (!origin || envService.frontendOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(null, false);
        }
      },
      credentials: true,
    });
    await app.init();

    const user = await userRepo.create({
      email: 'ledger-tester@rescom.test',
      passwordHash: '$2a$12$someHashedPassword',
      role: 'ADMIN',
      status: 'ACTIVE',
    });
    respondentUserId = user.id;

    const tokens = await sessionService.createSession(user.id);
    authCookie = `${AUTH_COOKIE_NAME}=${tokens.accessToken}`;
    csrfToken = tokens.csrfToken;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /economy/journals (AC1, AC2, AC3)', () => {
    it('creates a balanced double-entry journal and updates balances', async () => {
      const systemAccount = await ledgerService.getOrCreateAccount(null, 'SYSTEM_ISSUANCE');
      const userAccount = await ledgerService.getOrCreateAccount(
        respondentUserId,
        'USER_AVAILABLE',
      );

      const res = await request(app.getHttpServer())
        .post('/economy/journals')
        .set('Cookie', [authCookie])
        .set('x-csrf-token', csrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'application/json')
        .send({
          idempotencyKey: 'e2e-tx-1',
          description: 'E2E Point Issuance',
          entries: [
            { accountId: systemAccount.id, amount: -200 },
            { accountId: userAccount.id, amount: 200 },
          ],
        });

      expect(res.status).toBe(201);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.idempotencyKey).toBe('e2e-tx-1');
      expect(res.body.data.entries).toHaveLength(2);
      expect(res.body.error).toBeNull();

      const userAccAfter = await ledgerService.getAccount(userAccount.id);
      expect(userAccAfter.balance).toBe(200);
    });

    it('rejects an unbalanced journal with HTTP 400 JOURNAL_UNBALANCED', async () => {
      const systemAccount = await ledgerService.getOrCreateAccount(null, 'SYSTEM_ISSUANCE');
      const userAccount = await ledgerService.getOrCreateAccount(
        respondentUserId,
        'USER_AVAILABLE',
      );

      const res = await request(app.getHttpServer())
        .post('/economy/journals')
        .set('Cookie', [authCookie])
        .set('x-csrf-token', csrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'application/json')
        .send({
          idempotencyKey: 'e2e-unbalanced',
          entries: [
            { accountId: systemAccount.id, amount: -200 },
            { accountId: userAccount.id, amount: 150 },
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('JOURNAL_UNBALANCED');
    });

    it('rejects an overdraft attempt on a user account with HTTP 409 INSUFFICIENT_BALANCE', async () => {
      const userAccount = await ledgerService.getOrCreateAccount(
        respondentUserId,
        'USER_AVAILABLE',
      );
      const escrowAccount = await ledgerService.getOrCreateAccount(
        respondentUserId,
        'ESCROW',
      );

      const res = await request(app.getHttpServer())
        .post('/economy/journals')
        .set('Cookie', [authCookie])
        .set('x-csrf-token', csrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'application/json')
        .send({
          idempotencyKey: 'e2e-overdraft',
          entries: [
            { accountId: userAccount.id, amount: -99999 }, // Current balance is 200
            { accountId: escrowAccount.id, amount: 99999 },
          ],
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('INSUFFICIENT_BALANCE');
    });

    it('returns existing journal on identical replay without duplicate balance changes (FR-ADD-11)', async () => {
      const systemAccount = await ledgerService.getOrCreateAccount(null, 'SYSTEM_ISSUANCE');
      const userAccount = await ledgerService.getOrCreateAccount(
        respondentUserId,
        'USER_AVAILABLE',
      );

      const payload = {
        idempotencyKey: 'e2e-idempotency-test',
        description: 'Replay test',
        entries: [
          { accountId: systemAccount.id, amount: -50 },
          { accountId: userAccount.id, amount: 50 },
        ],
      };

      const res1 = await request(app.getHttpServer())
        .post('/economy/journals')
        .set('Cookie', [authCookie])
        .set('x-csrf-token', csrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'application/json')
        .send(payload);

      expect(res1.status).toBe(201);
      const balanceAfterFirst = (await ledgerService.getAccount(userAccount.id)).balance;

      const res2 = await request(app.getHttpServer())
        .post('/economy/journals')
        .set('Cookie', [authCookie])
        .set('x-csrf-token', csrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'application/json')
        .send(payload);

      expect(res2.status).toBe(201);
      expect(res2.body.data.id).toBe(res1.body.data.id);

      const balanceAfterSecond = (await ledgerService.getAccount(userAccount.id)).balance;
      expect(balanceAfterSecond).toBe(balanceAfterFirst); // Idempotent, not incremented again
    });

    it('rejects conflicting transaction on existing idempotency key with HTTP 409 IDEMPOTENCY_CONFLICT', async () => {
      const systemAccount = await ledgerService.getOrCreateAccount(null, 'SYSTEM_ISSUANCE');
      const userAccount = await ledgerService.getOrCreateAccount(
        respondentUserId,
        'USER_AVAILABLE',
      );

      const res = await request(app.getHttpServer())
        .post('/economy/journals')
        .set('Cookie', [authCookie])
        .set('x-csrf-token', csrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'application/json')
        .send({
          idempotencyKey: 'e2e-idempotency-test', // Reusing key with different amount!
          description: 'Conflicting amount',
          entries: [
            { accountId: systemAccount.id, amount: -80 },
            { accountId: userAccount.id, amount: 80 },
          ],
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
    });
  });

  describe('POST /economy/journals/:id/reverse (AC4)', () => {
    it('successfully reverses an existing journal with exact negation entries', async () => {
      const systemAccount = await ledgerService.getOrCreateAccount(null, 'SYSTEM_ISSUANCE');
      const userAccount = await ledgerService.getOrCreateAccount(
        respondentUserId,
        'USER_AVAILABLE',
      );

      // Create initial journal
      const initial = await ledgerService.postJournal({
        idempotencyKey: 'e2e-to-reverse',
        entries: [
          { accountId: systemAccount.id, amount: -75 },
          { accountId: userAccount.id, amount: 75 },
        ],
      });

      const balanceBefore = (await ledgerService.getAccount(userAccount.id)).balance;

      const res = await request(app.getHttpServer())
        .post(`/economy/journals/${initial.id}/reverse`)
        .set('Cookie', [authCookie])
        .set('x-csrf-token', csrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'application/json')
        .send({ reason: 'E2E reversal test' });

      expect(res.status).toBe(201);
      expect(res.body.data.reversesJournalId).toBe(initial.id);
      expect(res.body.data.entries).toHaveLength(2);

      const balanceAfter = (await ledgerService.getAccount(userAccount.id)).balance;
      expect(balanceAfter).toBe(balanceBefore - 75);
    });

    it('rejects second reversal of already-reversed journal with HTTP 409 JOURNAL_ALREADY_REVERSED', async () => {
      const systemAccount = await ledgerService.getOrCreateAccount(null, 'SYSTEM_ISSUANCE');
      const userAccount = await ledgerService.getOrCreateAccount(
        respondentUserId,
        'USER_AVAILABLE',
      );

      const journal = await ledgerService.postJournal({
        idempotencyKey: 'e2e-double-reversal',
        entries: [
          { accountId: systemAccount.id, amount: -60 },
          { accountId: userAccount.id, amount: 60 },
        ],
      });

      await ledgerService.reverseJournal({ targetJournalId: journal.id });

      const res = await request(app.getHttpServer())
        .post(`/economy/journals/${journal.id}/reverse`)
        .set('Cookie', [authCookie])
        .set('x-csrf-token', csrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'application/json')
        .send();

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('JOURNAL_ALREADY_REVERSED');
    });
  });

  describe('Auditing & Balance Derivability (AC5)', () => {
    it('verifies account balance and confirms it equals the sum of immutable entries', async () => {
      const userAccount = await ledgerService.getOrCreateAccount(
        respondentUserId,
        'USER_AVAILABLE',
      );

      const res = await request(app.getHttpServer())
        .get(`/economy/accounts/${userAccount.id}/balance`)
        .set('Cookie', [authCookie])
        .set('Origin', ALLOWED_ORIGIN);

      expect(res.status).toBe(200);
      expect(res.body.data.accountId).toBe(userAccount.id);
      expect(res.body.data.isConsistent).toBe(true);
      expect(res.body.data.projectedBalance).toBe(res.body.data.calculatedBalance);
    });

    it('audits entire ledger and verifies closed zero-sum invariant', async () => {
      const res = await request(app.getHttpServer())
        .get('/economy/integrity')
        .set('Cookie', [authCookie])
        .set('Origin', ALLOWED_ORIGIN);

      expect(res.status).toBe(200);
      expect(res.body.data.totalSystemBalance).toBe(0);
      expect(res.body.data.isZeroSum).toBe(true);
    });
  });
});
