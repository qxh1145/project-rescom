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
import { PrismaLedgerRepository } from '../src/modules/economy/infrastructure/prisma-ledger.repository';
import { randomUUID } from 'crypto';
import { walletDetailsSchema } from '@rescom/schemas';

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
  let respondentCookie: string;
  let respondentCsrfToken: string;
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

    const respondent = await userRepo.create({
      email: 'ledger-respondent@rescom.test',
      passwordHash: '$2a$12$someOtherHashedPassword',
      role: 'RESPONDENT',
      status: 'ACTIVE',
    });
    const respondentTokens = await sessionService.createSession(respondent.id);
    respondentCookie = `${AUTH_COOKIE_NAME}=${respondentTokens.accessToken}`;
    respondentCsrfToken = respondentTokens.csrfToken;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /economy/journals (AC1, AC2, AC3)', () => {
    it('forbids non-admin users from posting arbitrary ledger commands', async () => {
      const systemAccount = await ledgerService.getOrCreateAccount(
        null,
        'SYSTEM_ISSUANCE',
      );
      const userAccount = await ledgerService.getOrCreateAccount(
        respondentUserId,
        'USER_AVAILABLE',
      );

      const response = await request(app.getHttpServer())
        .post('/economy/journals')
        .set('Cookie', [respondentCookie])
        .set('x-csrf-token', respondentCsrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'application/json')
        .send({
          idempotencyKey: 'forbidden-direct-ledger-command',
          entries: [
            { accountId: systemAccount.id, amount: -100 },
            { accountId: userAccount.id, amount: 100 },
          ],
        });

      expect(response.status).toBe(403);
    });
    it('creates a balanced double-entry journal and updates balances', async () => {
      const systemAccount = await ledgerService.getOrCreateAccount(
        null,
        'SYSTEM_ISSUANCE',
      );
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
      const systemAccount = await ledgerService.getOrCreateAccount(
        null,
        'SYSTEM_ISSUANCE',
      );
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
      const systemAccount = await ledgerService.getOrCreateAccount(
        null,
        'SYSTEM_ISSUANCE',
      );
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
      const balanceAfterFirst = (await ledgerService.getAccount(userAccount.id))
        .balance;

      const res2 = await request(app.getHttpServer())
        .post('/economy/journals')
        .set('Cookie', [authCookie])
        .set('x-csrf-token', csrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'application/json')
        .send(payload);

      expect(res2.status).toBe(201);
      expect(res2.body.data.id).toBe(res1.body.data.id);

      const balanceAfterSecond = (
        await ledgerService.getAccount(userAccount.id)
      ).balance;
      expect(balanceAfterSecond).toBe(balanceAfterFirst); // Idempotent, not incremented again
    });

    it('rejects conflicting transaction on existing idempotency key with HTTP 409 IDEMPOTENCY_CONFLICT', async () => {
      const systemAccount = await ledgerService.getOrCreateAccount(
        null,
        'SYSTEM_ISSUANCE',
      );
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
      const systemAccount = await ledgerService.getOrCreateAccount(
        null,
        'SYSTEM_ISSUANCE',
      );
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

      const balanceBefore = (await ledgerService.getAccount(userAccount.id))
        .balance;

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

      const balanceAfter = (await ledgerService.getAccount(userAccount.id))
        .balance;
      expect(balanceAfter).toBe(balanceBefore - 75);
    });

    it('rejects second reversal of already-reversed journal with HTTP 409 JOURNAL_ALREADY_REVERSED', async () => {
      const systemAccount = await ledgerService.getOrCreateAccount(
        null,
        'SYSTEM_ISSUANCE',
      );
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
        .send({ idempotencyKey: 'e2e-distinct-second-reversal' });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('JOURNAL_ALREADY_REVERSED');
    });

    it('refuses to reverse a released External credit with HTTP 409 LEDGER_DOWNSTREAM_JOURNAL_EXISTS (review 3.2)', async () => {
      const publisherId = randomUUID();
      const attemptId = randomUUID();
      const pooledAttemptId = randomUUID();
      const systemAccount = await ledgerService.getOrCreateAccount(
        null,
        'SYSTEM_ISSUANCE',
      );
      const escrow = await ledgerService.getOrCreateAccount(
        publisherId,
        'ESCROW',
      );
      await ledgerService.postJournal({
        idempotencyKey: `e2e-downstream-escrow:${publisherId}`,
        entries: [
          { accountId: systemAccount.id, amount: -40 },
          { accountId: escrow.id, amount: 40 },
        ],
      });
      for (const id of [attemptId, pooledAttemptId]) {
        await ledgerService.creditPendingReward({
          attemptId: id,
          publisherId,
          respondentId: respondentUserId,
          amount: 20,
        });
      }
      // Past the 48-hour review window on an injected clock.
      const matured = new LedgerService(ledgerRepo, {
        clock: () => new Date(Date.now() + 49 * 60 * 60 * 1000),
      });
      await matured.releasePendingReward({ attemptId });
      const credit = await ledgerService.findJournalByIdempotencyKey(
        `external-completion:${attemptId}`,
      );
      const pending = await ledgerService.getOrCreateAccount(
        respondentUserId,
        'PENDING',
      );

      const res = await request(app.getHttpServer())
        .post(`/economy/journals/${credit!.id}/reverse`)
        .set('Cookie', [authCookie])
        .set('x-csrf-token', csrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'application/json')
        .send({ reason: 'Upheld dispute after release' });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('LEDGER_DOWNSTREAM_JOURNAL_EXISTS');
      expect(await ledgerRepo.findReversalJournal(credit!.id)).toBeNull();
      // The pooled credit of the other attempt is untouched.
      expect((await ledgerService.getAccount(pending.id)).balance).toBe(20);
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
      expect(res.body.data.projectedBalance).toBe(
        res.body.data.calculatedBalance,
      );
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

  describe('GET /economy/wallet (Story 6.2 - FR-31)', () => {
    it('returns complete wallet aggregate for authenticated user', async () => {
      const res = await request(app.getHttpServer())
        .get('/economy/wallet')
        .set('Cookie', [authCookie])
        .set('Origin', ALLOWED_ORIGIN);

      expect(res.status).toBe(200);
      // IR.5 A3.1: the frontend wallet schema is this shared one.
      walletDetailsSchema.parse(res.body.data);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.balance).toBeDefined();
      expect(typeof res.body.data.balance.available).toBe('number');
      expect(typeof res.body.data.balance.pending).toBe('number');
      expect(typeof res.body.data.balance.escrow).toBe('number');
      expect(typeof res.body.data.balance.frozen).toBe('number');
      expect(typeof res.body.data.balance.integrityHold).toBe('number');
      expect(typeof res.body.data.balance.total).toBe('number');
      expect(Array.isArray(res.body.data.transactions)).toBe(true);
      expect(res.body.data.accounts).toHaveLength(5);
    });

    it('supports GET /api/economy/wallet as direct route alias (AC3)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/economy/wallet')
        .set('Cookie', [authCookie])
        .set('Origin', ALLOWED_ORIGIN);

      expect(res.status).toBe(200);
      expect(res.body.data.balance).toBeDefined();
    });

    it('accurately reflects non-zero balances and transaction history after transfer (AC4, AC5)', async () => {
      const systemAccount = await ledgerService.getOrCreateAccount(
        null,
        'SYSTEM_ISSUANCE',
      );
      const userAccount = await ledgerService.getOrCreateAccount(
        respondentUserId,
        'USER_AVAILABLE',
      );

      // Post 300 points to user
      await request(app.getHttpServer())
        .post('/economy/journals')
        .set('Cookie', [authCookie])
        .set('x-csrf-token', csrfToken)
        .set('Origin', ALLOWED_ORIGIN)
        .send({
          idempotencyKey: 'e2e-wallet-funded-tx',
          description: 'Survey Reward Payout',
          entries: [
            { accountId: systemAccount.id, amount: -300 },
            { accountId: userAccount.id, amount: 300 },
          ],
        });

      const res = await request(app.getHttpServer())
        .get('/economy/wallet')
        .set('Cookie', [authCookie])
        .set('Origin', ALLOWED_ORIGIN);

      expect(res.status).toBe(200);
      const data = res.body.data;
      walletDetailsSchema.parse(data);
      expect(data.balance.available).toBeGreaterThanOrEqual(300);
      expect(data.balance.total).toBe(
        data.balance.available +
          data.balance.pending +
          data.balance.escrow +
          data.balance.frozen +
          data.balance.integrityHold,
      );
      expect(data.transactions.length).toBeGreaterThanOrEqual(1);
      const rewardTx = data.transactions.find(
        (t: any) => t.idempotencyKey === 'e2e-wallet-funded-tx',
      );
      expect(rewardTx).toBeDefined();
      expect(rewardTx.amount).toBe(300);
      expect(rewardTx.accountClass).toBe('USER_AVAILABLE');
      expect(rewardTx.description).toBe('Survey Reward Payout');
    });

    it('respects limit query parameter for transaction pagination', async () => {
      const res = await request(app.getHttpServer())
        .get('/economy/wallet?limit=1')
        .set('Cookie', [authCookie])
        .set('Origin', ALLOWED_ORIGIN);

      expect(res.status).toBe(200);
      expect(res.body.data.transactions.length).toBeLessThanOrEqual(1);
    });

    it('rejects unauthenticated request to /economy/wallet with HTTP 401', async () => {
      const res = await request(app.getHttpServer())
        .get('/economy/wallet')
        .set('Origin', ALLOWED_ORIGIN);

      expect(res.status).toBe(401);
    });
  });
});

const describePostgres =
  process.env.RUN_LEDGER_POSTGRES_E2E === 'true' ? describe : describe.skip;

describePostgres('Story 6.1 PostgreSQL ledger invariants', () => {
  let prisma: PrismaService;
  let service: LedgerService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    service = new LedgerService(new PrismaLedgerRepository(prisma));
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('deduplicates concurrent identical commands through the database constraint', async () => {
    const issuance = await service.getOrCreateAccount(null, 'SYSTEM_ISSUANCE');
    const clearing = await service.getOrCreateAccount(null, 'SYSTEM_CLEARING');
    const beforeIssuance = (await service.getAccount(issuance.id)).balance;
    const beforeClearing = (await service.getAccount(clearing.id)).balance;
    const command = {
      idempotencyKey: `postgres-concurrent:${randomUUID()}`,
      description: 'PostgreSQL concurrent idempotency check',
      entries: [
        { accountId: issuance.id, amount: -17 },
        { accountId: clearing.id, amount: 17 },
      ],
    };

    const [first, second] = await Promise.all([
      service.postJournal(command),
      service.postJournal(command),
    ]);

    expect(second.id).toBe(first.id);
    expect((await service.getAccount(issuance.id)).balance).toBe(
      beforeIssuance - 17,
    );
    expect((await service.getAccount(clearing.id)).balance).toBe(
      beforeClearing + 17,
    );
  });

  it('creates one account for concurrent provisioning of the same tuple', async () => {
    const currency = `TEST_${randomUUID()}`;
    const [first, second] = await Promise.all([
      service.getOrCreateAccount(null, 'SYSTEM_SINK', currency),
      service.getOrCreateAccount(null, 'SYSTEM_SINK', currency),
    ]);

    expect(second.id).toBe(first.id);
  });

  it('rejects direct mutation of a posted journal', async () => {
    const issuance = await service.getOrCreateAccount(null, 'SYSTEM_ISSUANCE');
    const clearing = await service.getOrCreateAccount(null, 'SYSTEM_CLEARING');
    const journal = await service.postJournal({
      idempotencyKey: `postgres-immutable:${randomUUID()}`,
      entries: [
        { accountId: issuance.id, amount: -1 },
        { accountId: clearing.id, amount: 1 },
      ],
    });

    await expect(
      prisma.ledgerJournal.update({
        where: { id: journal.id },
        data: { description: 'illegal mutation' },
      }),
    ).rejects.toThrow();
  });
});
