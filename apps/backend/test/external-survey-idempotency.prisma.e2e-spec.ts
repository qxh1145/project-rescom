import { execFileSync } from 'child_process';
import { randomUUID } from 'crypto';
import * as path from 'path';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/database/prisma.service';
import { EnvService } from '../src/common/config/env.service';
import { HttpExceptionFilter } from '../src/common/http/http-exception.filter';
import { USER_REPOSITORY_PORT } from '../src/modules/users/application/ports/user.repository.port';
import { InMemoryUserRepository } from '../src/modules/users/infrastructure/in-memory-user.repository';
import { SESSION_REPOSITORY_PORT } from '../src/modules/auth/application/ports/session-repository.port';
import { InMemorySessionRepository } from '../src/modules/auth/infrastructure/in-memory-session.repository';
import { IDENTITY_AUDIT_PORT } from '../src/modules/auth/application/ports/identity-audit.port';
import { InMemoryIdentityAuditRepository } from '../src/modules/auth/infrastructure/in-memory-identity-audit.repository';
import { SessionService } from '../src/modules/auth/application/session.service';
import { AUTH_COOKIE_NAME } from '../src/modules/auth/presentation/cookie-options.helper';
import {
  FORM_REPOSITORY_PORT,
  FormRepositoryPort,
} from '../src/modules/forms/application/ports/form-repository.port';
import { LedgerService } from '../src/modules/economy/application/ledger.service';

/**
 * Phase 5 M-3: concurrent `POST /forms/external` with the same
 * `Idempotency-Key` and `autoPublish: true` on PostgreSQL (real Prisma form
 * and ledger repositories, real Unit of Work, real unique constraint and
 * account locks). Exactly one survey and one Escrow reservation journal
 * survive; the loser answers with the winner's survey (`idempotentReplay`),
 * never with INSUFFICIENT_BALANCE when the balance only covers one survey.
 *
 * Applies pending migrations (`prisma migrate deploy`) to a dedicated
 * database whose name ends in `_test`. Ledger tables are append-only, so every
 * scenario uses a fresh Publisher and asserts only that Publisher's rows.
 * Skipped when the database is unreachable; fails instead when
 * `FORMS_TEST_DATABASE_URL` is set explicitly.
 */
const explicitUrl = process.env.FORMS_TEST_DATABASE_URL;
const databaseUrl =
  explicitUrl ??
  'postgresql://rescom_admin:rescom_password@localhost:5433/rescom_forms_test?schema=public';
const backendDir = path.resolve(__dirname, '..');

if (!new URL(databaseUrl).pathname.slice(1).endsWith('_test')) {
  throw new Error(
    'FORMS_TEST_DATABASE_URL must target a dedicated database ending in _test',
  );
}

/** Synchronous reachability probe, so `it.skip` can be chosen up front. */
function probeDatabase(): boolean {
  try {
    execFileSync(
      process.execPath,
      [
        '-e',
        "const { PrismaClient } = require('@prisma/client');" +
          'const p = new PrismaClient({ datasources: { db: { url: process.env.PROBE_URL } } });' +
          "p.$queryRawUnsafe('SELECT 1').then(() => process.exit(0), () => process.exit(1));",
      ],
      {
        cwd: backendDir,
        env: { ...process.env, PROBE_URL: databaseUrl },
        stdio: 'pipe',
        timeout: 30_000,
      },
    );
    return true;
  } catch {
    return false;
  }
}

const dbAvailable = probeDatabase();
const liveIt = dbAvailable ? it : it.skip;

describe('POST /forms/external idempotency on PostgreSQL (Phase 5 M-3)', () => {
  const TEST_JWT_SECRET = 'at_least_32_characters_super_secure_jwt_secret_key!';
  const ALLOWED_ORIGIN = 'http://localhost:3000';
  // 20 × 10 = 200 points locked in Escrow on auto-publish.
  const body = {
    title: 'Concurrent Idempotent Survey',
    externalUrl: 'https://docs.google.com/forms/d/e/concurrent/viewform',
    rewardPerResponse: 10,
    expectedCompletions: 20,
    estimatedDurationMinutes: 8,
    autoPublish: true,
  };
  const cost = 200;

  let app: INestApplication;
  let prisma: PrismaService;
  let userRepo: InMemoryUserRepository;
  let sessionService: SessionService;
  let ledgerService: LedgerService;
  let formRepository: FormRepositoryPort;

  if (!dbAvailable) {
    if (explicitUrl) {
      it('reaches FORMS_TEST_DATABASE_URL', () => {
        throw new Error(
          `FORMS_TEST_DATABASE_URL is set but ${databaseUrl} is unreachable.`,
        );
      });
    } else {
      console.warn(
        `Postgres DB at ${databaseUrl} is unreachable. Skipping live external-survey idempotency tests.`,
      );
    }
  }

  beforeAll(async () => {
    if (!dbAvailable) return;
    const prismaCli = require.resolve('prisma/build/index.js', {
      paths: [backendDir],
    });
    execFileSync(
      process.execPath,
      [prismaCli, 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'],
      {
        cwd: backendDir,
        env: { ...process.env, DATABASE_URL: databaseUrl },
        stdio: 'pipe',
      },
    );
    prisma = new PrismaService({ datasources: { db: { url: databaseUrl } } });
    await prisma.$connect();

    const auditRepo = new InMemoryIdentityAuditRepository();
    userRepo = new InMemoryUserRepository();
    const envService = new EnvService({
      NODE_ENV: 'test',
      PORT: 4000,
      DATABASE_URL: databaseUrl,
      JWT_SECRET: TEST_JWT_SECRET,
      JWT_ACCESS_TTL_SECONDS: 900,
      BCRYPT_ROUNDS: 12,
      FRONTEND_ORIGINS: ALLOWED_ORIGIN,
    });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(USER_REPOSITORY_PORT)
      .useValue(userRepo)
      .overrideProvider(SESSION_REPOSITORY_PORT)
      .useValue(new InMemorySessionRepository(auditRepo))
      .overrideProvider(IDENTITY_AUDIT_PORT)
      .useValue(auditRepo)
      .overrideProvider(EnvService)
      .useValue(envService)
      .compile();

    sessionService = moduleFixture.get(SessionService);
    ledgerService = moduleFixture.get(LedgerService, { strict: false });
    formRepository = moduleFixture.get<FormRepositoryPort>(
      FORM_REPOSITORY_PORT,
      { strict: false },
    );

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  }, 180_000);

  afterAll(async () => {
    if (app) await app.close();
    if (prisma) await prisma.$disconnect();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** A fresh Publisher (in the DB for the foreign keys) funded with `points`. */
  async function publisherWith(points: number) {
    const id = randomUUID();
    const email = `m3-publisher-${id}@example.com`;
    await prisma.user.create({
      data: { id, email, passwordHash: 'hash', role: 'PUBLISHER' },
    });
    await userRepo.create({
      id,
      email,
      passwordHash: '$2a$12$someHashedPassword',
      role: 'PUBLISHER',
      status: 'ACTIVE',
    });
    const system = await ledgerService.getOrCreateAccount(
      null,
      'SYSTEM_ISSUANCE',
    );
    const available = await ledgerService.getOrCreateAccount(
      id,
      'USER_AVAILABLE',
    );
    await ledgerService.transfer({
      fromAccountId: system.id,
      toAccountId: available.id,
      amount: points,
      idempotencyKey: `m3-seed-${id}`,
      description: 'M-3 test seed',
    });
    const tokens = await sessionService.createSession(id);
    return { id, tokens };
  }

  function post(
    tokens: { accessToken: string; csrfToken: string },
    key: string,
  ) {
    return request(app.getHttpServer())
      .post('/forms/external')
      .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
      .set('x-csrf-token', tokens.csrfToken)
      .set('Origin', ALLOWED_ORIGIN)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', key)
      .send(body);
  }

  /**
   * Both requests pass the up-front replay check (as when they arrive
   * together), so the race is decided inside the Unit of Work: by the unique
   * key, or by the Escrow lock when the balance only covers one survey.
   */
  function letBothPassTheReplayCheck(): void {
    jest
      .spyOn(formRepository, 'findByCreationKey')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
  }

  async function assertOneSurveyOneReservation(
    publisherId: string,
    seeded: number,
    responses: request.Response[],
  ): Promise<void> {
    for (const res of responses) {
      expect(res.status).toBe(201);
    }
    const [a, b] = responses.map((res) => res.body.data);
    expect(a.id).toBe(b.id);
    expect(a.plaintextCompletionCode).toBe(b.plaintextCompletionCode);
    expect(
      [a.idempotentReplay, b.idempotentReplay].filter(Boolean),
    ).toHaveLength(1);

    const forms = await prisma.form.findMany({ where: { publisherId } });
    expect(forms).toHaveLength(1);
    expect(forms[0].id).toBe(a.id);
    expect(forms[0].status).toBe('MODERATION_QUEUE');

    const escrow = await prisma.ledgerAccount.findFirstOrThrow({
      where: { userId: publisherId, accountClass: 'ESCROW' },
    });
    const reservations = await prisma.ledgerJournal.findMany({
      where: {
        idempotencyKey: { startsWith: 'publish:' },
        entries: { some: { accountId: escrow.id } },
      },
    });
    expect(reservations).toHaveLength(1);
    const versions = await prisma.formVersion.findMany({
      where: { formId: a.id },
    });
    expect(reservations[0].idempotencyKey).toBe(`publish:${versions[0].id}`);

    const wallet = await ledgerService.getWallet(publisherId);
    expect(wallet.balance.escrow).toBe(cost);
    expect(wallet.balance.available).toBe(seeded - cost);
  }

  liveIt(
    'creates ONE survey and ONE Escrow reservation for two concurrent requests with the same key (unique-key loser replays)',
    async () => {
      const publisher = await publisherWith(1000);
      letBothPassTheReplayCheck();

      const responses = await Promise.all([
        post(publisher.tokens, 'm3-concurrent-key'),
        post(publisher.tokens, 'm3-concurrent-key'),
      ]);

      await assertOneSurveyOneReservation(publisher.id, 1000, responses);
    },
    60_000,
  );

  liveIt(
    'replays the winner (not INSUFFICIENT_BALANCE) when the balance covers only one survey',
    async () => {
      // 250 covers one 200-point reservation, not two.
      const publisher = await publisherWith(250);
      letBothPassTheReplayCheck();

      const responses = await Promise.all([
        post(publisher.tokens, 'm3-one-funded-key'),
        post(publisher.tokens, 'm3-one-funded-key'),
      ]);

      await assertOneSurveyOneReservation(publisher.id, 250, responses);
    },
    60_000,
  );

  liveIt(
    'converges unassisted concurrent requests (no forced interleaving) on one survey and one reservation',
    async () => {
      const publisher = await publisherWith(250);

      const responses = await Promise.all([
        post(publisher.tokens, 'm3-natural-key'),
        post(publisher.tokens, 'm3-natural-key'),
      ]);

      await assertOneSurveyOneReservation(publisher.id, 250, responses);
    },
    60_000,
  );

  liveIt(
    'still reports INSUFFICIENT_ESCROW_BALANCE for a different key the balance cannot fund',
    async () => {
      const publisher = await publisherWith(250);
      await post(publisher.tokens, 'm3-first-key').expect(201);

      const res = await post(publisher.tokens, 'm3-second-key');

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('INSUFFICIENT_ESCROW_BALANCE');
      expect(
        await prisma.form.count({ where: { publisherId: publisher.id } }),
      ).toBe(1);
    },
    60_000,
  );
});
