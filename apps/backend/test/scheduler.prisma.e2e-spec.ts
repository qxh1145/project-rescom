import { execFileSync } from 'child_process';
import { randomUUID } from 'crypto';
import * as path from 'path';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, Logger } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { surveyAttemptResponseSchema } from '@rescom/schemas';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/database/prisma.service';
import { PrismaUnitOfWork } from '../src/common/database/prisma-unit-of-work';
import { EnvService } from '../src/common/config/env.service';
import { HttpExceptionFilter } from '../src/common/http/http-exception.filter';
import { FixedClock } from '../src/common/time/clock';
import { PrismaJobLeaseRepository } from '../src/common/scheduler/prisma-job-lease.repository';
import { PrismaOutboxClaimRepository } from '../src/common/scheduler/outbox/prisma-outbox-claim.repository';
import { OutboxDispatchJob } from '../src/common/scheduler/outbox/outbox-dispatch.job';
import {
  OutboxEnvelope,
  OutboxHandlerRegistry,
} from '../src/common/scheduler/outbox/outbox-handler';
import { SchedulerRunnerService } from '../src/common/scheduler/scheduler-runner.service';
import { USER_REPOSITORY_PORT } from '../src/modules/users/application/ports/user.repository.port';
import { InMemoryUserRepository } from '../src/modules/users/infrastructure/in-memory-user.repository';
import { SESSION_REPOSITORY_PORT } from '../src/modules/auth/application/ports/session-repository.port';
import { InMemorySessionRepository } from '../src/modules/auth/infrastructure/in-memory-session.repository';
import { IDENTITY_AUDIT_PORT } from '../src/modules/auth/application/ports/identity-audit.port';
import { InMemoryIdentityAuditRepository } from '../src/modules/auth/infrastructure/in-memory-identity-audit.repository';
import { DEMOGRAPHIC_PROFILE_REPOSITORY_PORT } from '../src/modules/users/application/ports/demographic-profile.repository.port';
import { InMemoryDemographicProfileRepository } from '../src/modules/users/infrastructure/in-memory-demographic-profile.repository';
import { SessionService } from '../src/modules/auth/application/session.service';
import { AUTH_COOKIE_NAME } from '../src/modules/auth/presentation/cookie-options.helper';
import {
  FORM_REPOSITORY_PORT,
  FormRepositoryPort,
} from '../src/modules/forms/application/ports/form-repository.port';
import { FormEntity } from '../src/modules/forms/domain/form.entity';
import { FormVersionEntity } from '../src/modules/forms/domain/form-version.entity';
import { CompletionCodeService } from '../src/modules/forms/infrastructure/completion-code.service';
import { LedgerService } from '../src/modules/economy/application/ledger.service';
import { RewardSettlementCoordinator } from '../src/modules/economy/application/reward-settlement.coordinator';
import { InternalRewardRequestedHandler } from '../src/modules/economy/infrastructure/outbox/internal-reward-requested.handler';
import { seedCompleteDemographicProfile } from './fixtures/demographic-profile.fixture';
import {
  BALANCED_LEDGER,
  ledgerInvariants,
} from './fixtures/ledger-invariants';

/**
 * Story IR.2b (T2–T8, T12, T14–T16) and plan 2.3 (QUOTA close race) on
 * PostgreSQL, with the real Prisma repositories, Unit of Work, row locks and
 * the scheduler's lease / claim SQL. Applies pending migrations to a scratch
 * database (name ending in `_test` or `_check`, never the seeded dev DB).
 * Skipped when the database is unreachable; fails instead when
 * `SCHEDULER_TEST_DATABASE_URL` is set explicitly.
 */
const explicitUrl = process.env.SCHEDULER_TEST_DATABASE_URL;
const databaseUrl =
  explicitUrl ??
  'postgresql://rescom_admin:rescom_password@localhost:5433/rescom_phase2_check?schema=public';
const backendDir = path.resolve(__dirname, '..');
const databaseName = new URL(databaseUrl).pathname.slice(1);

if (!/_(test|check)$/.test(databaseName)) {
  throw new Error(
    'SCHEDULER_TEST_DATABASE_URL must target a scratch database ending in _test or _check',
  );
}

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

describe('Scheduler, Outbox dispatcher and system closes on PostgreSQL (IR.2b, plan 2.3)', () => {
  const ALLOWED_ORIGIN = 'http://localhost:3000';
  const COMPLETION_CODE = '482917';
  const MINUTE = 60_000;

  let app: INestApplication;
  let prisma: PrismaService;
  let userRepo: InMemoryUserRepository;
  let demoRepo: InMemoryDemographicProfileRepository;
  let sessionService: SessionService;
  let formRepository: FormRepositoryPort;
  let ledgerService: LedgerService;
  let rewards: RewardSettlementCoordinator;
  let runner: SchedulerRunnerService;
  let completionCodes: CompletionCodeService;
  const publisherId = randomUUID();

  interface Actor {
    id: string;
    cookie: string;
    csrf: string;
  }

  if (!dbAvailable) {
    if (explicitUrl) {
      it('reaches SCHEDULER_TEST_DATABASE_URL', () => {
        throw new Error(
          `SCHEDULER_TEST_DATABASE_URL is set but ${databaseUrl} is unreachable.`,
        );
      });
    } else {
      console.warn(
        `Postgres DB at ${databaseUrl} is unreachable. Skipping the scheduler suite.`,
      );
    }
  }

  async function user(role: 'PUBLISHER' | 'RESPONDENT', id = randomUUID()) {
    const email = `ir2b-${role.toLowerCase()}-${id}@example.com`;
    await prisma.user.create({ data: { id, email, passwordHash: 'h', role } });
    await userRepo.create({
      id,
      email,
      passwordHash: '$2a$12$someHashedPassword',
      role,
      status: 'ACTIVE',
    });
    return id;
  }

  async function respondent(): Promise<Actor> {
    const id = await user('RESPONDENT');
    await seedCompleteDemographicProfile(demoRepo, id);
    const tokens = await sessionService.createSession(id);
    return {
      id,
      cookie: `${AUTH_COOKIE_NAME}=${tokens.accessToken}`,
      csrf: tokens.csrfToken,
    };
  }

  function post(urlPath: string, who: Actor, body: object) {
    return request(app.getHttpServer())
      .post(urlPath)
      .set('Cookie', who.cookie)
      .set('x-csrf-token', who.csrf)
      .set('Origin', ALLOWED_ORIGIN)
      .set('Content-Type', 'application/json')
      .send(body);
  }

  /** A PUBLISHED External survey whose Escrow is reserved (`publish:{versionId}`). */
  async function externalSurvey(over: {
    expectedCompletions: number;
    reward?: number;
    deadlineAt?: Date | null;
    status?: 'PUBLISHED' | 'MODERATION_QUEUE';
  }) {
    const formId = randomUUID();
    const versionId = randomUUID();
    const reward = over.reward ?? 10;
    const now = new Date();
    await formRepository.create(
      new FormEntity(
        formId,
        publisherId,
        'EXTERNAL',
        over.status ?? 'PUBLISHED',
        'IR.2b survey',
        null,
        reward,
        over.expectedCompletions,
        now,
        now,
        undefined,
        0,
        5,
        null,
        over.deadlineAt ?? null,
        'IT',
      ),
      new FormVersionEntity(
        versionId,
        formId,
        1,
        {
          schemaVersion: 1,
          title: 'IR.2b survey',
          blocks: [],
          settings: {},
          metadata: { expectedEffortSeconds: 60, minTimeBarrierSeconds: 2 },
        } as never,
        null,
        true,
        'https://docs.google.com/forms/d/e/ir2b/viewform',
        completionCodes.computeVerifier(versionId, COMPLETION_CODE),
        now,
        now,
      ),
    );
    await ledgerService.reserveEscrow({
      userId: publisherId,
      formVersionId: versionId,
      amount: reward * over.expectedCompletions,
      formTitle: 'IR.2b survey',
    });
    return { formId, versionId, reward };
  }

  async function startPastBarrier(formId: string, who: Actor) {
    const res = await post(`/surveys/${formId}/attempts`, who, {});
    expect(res.status).toBe(201);
    const started = surveyAttemptResponseSchema.parse(res.body.data);
    await prisma.surveyAttempt.update({
      where: { id: started.attemptId },
      data: { startedAt: new Date(Date.now() - 10_000) },
    });
    return started;
  }

  beforeAll(async () => {
    if (!dbAvailable) return;
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
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
    demoRepo = new InMemoryDemographicProfileRepository();
    const envService = new EnvService({
      NODE_ENV: 'test',
      PORT: 4000,
      DATABASE_URL: databaseUrl,
      JWT_SECRET: 'at_least_32_characters_super_secure_jwt_secret_key!',
      JWT_ACCESS_TTL_SECONDS: 900,
      BCRYPT_ROUNDS: 12,
      FRONTEND_ORIGINS: ALLOWED_ORIGIN,
      // On, but NODE_ENV=test: nothing starts on its own (T1).
      SCHEDULER_ENABLED: 'true',
    });
    completionCodes = new CompletionCodeService(envService);

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
      .overrideProvider(DEMOGRAPHIC_PROFILE_REPOSITORY_PORT)
      .useValue(demoRepo)
      .overrideProvider(EnvService)
      .useValue(envService)
      .compile();

    sessionService = moduleFixture.get(SessionService);
    ledgerService = moduleFixture.get(LedgerService, { strict: false });
    rewards = moduleFixture.get(RewardSettlementCoordinator, { strict: false });
    runner = moduleFixture.get(SchedulerRunnerService, { strict: false });
    formRepository = moduleFixture.get<FormRepositoryPort>(
      FORM_REPOSITORY_PORT,
      { strict: false },
    );

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    await user('PUBLISHER', publisherId);
    const issuance = await ledgerService.getOrCreateAccount(
      null,
      'SYSTEM_ISSUANCE',
    );
    const available = await ledgerService.getOrCreateAccount(
      publisherId,
      'USER_AVAILABLE',
    );
    await ledgerService.postJournal({
      idempotencyKey: `ir2b-funding:${publisherId}`,
      entries: [
        { accountId: issuance.id, amount: -50_000 },
        { accountId: available.id, amount: 50_000 },
      ],
    });
  }, 180_000);

  afterAll(async () => {
    if (app) await app.close();
    if (prisma) await prisma.$disconnect();
    jest.restoreAllMocks();
  });

  liveIt('T1: with NODE_ENV=test the flag starts no timer', () => {
    expect(runner.isRunning).toBe(false);
  });

  liveIt(
    'T2/T3: one lease holder, monotonically increasing token, stale owner rejected',
    async () => {
      const leases = new PrismaJobLeaseRepository(prisma);
      const job = `ir2b-lease-${randomUUID()}`;
      const now = new Date();
      await leases.ensureJobs([job], now);

      const [a, b] = await Promise.all([
        leases.tryAcquire(job, 'owner-a', now, 30_000),
        leases.tryAcquire(job, 'owner-b', now, 30_000),
      ]);
      const winners = [a, b].filter((r) => r.acquired);
      expect(winners).toHaveLength(1);
      expect([a, b].filter((r) => !r.acquired)).toEqual([
        { acquired: false, reason: 'HELD' },
      ]);
      const first = winners[0];
      if (!first.acquired) throw new Error('unreachable');
      const firstOwner = a.acquired ? 'owner-a' : 'owner-b';

      // The lease expires; another owner takes over with token + 1.
      const later = new Date(now.getTime() + 30_001);
      const takeover = await leases.tryAcquire(job, 'owner-c', later, 30_000);
      expect(takeover).toEqual({
        acquired: true,
        lease: {
          fencingToken: String(BigInt(first.lease.fencingToken) + 1n),
          consecutiveFailures: 0,
        },
      });
      expect(
        await leases.renew(job, firstOwner, first.lease.fencingToken, later, 1),
      ).toBe(false);
      expect(
        await leases.complete(
          job,
          firstOwner,
          first.lease.fencingToken,
          later,
          {
            status: 'SUCCEEDED',
            nextRunAt: later,
            consecutiveFailures: 0,
            summary: {},
            error: null,
          },
        ),
      ).toBe(false);
      const [row] = (await leases.list()).filter((r) => r.jobName === job);
      expect(row.leaseOwner).toBe('owner-c');
    },
  );

  describe('Outbox dispatcher (T4–T8)', () => {
    let rewardTarget: string;

    async function rewardEvent(responseId = randomUUID(), rewardAmount = 10) {
      return prisma.outboxEvent.create({
        data: {
          idempotencyKey: `internal-reward:${responseId}`,
          eventType: 'InternalRewardRequested',
          producer: 'participation-service',
          aggregateType: 'Response',
          aggregateId: responseId,
          orderingStream: `internal-reward:${responseId}`,
          streamSequence: 1,
          availableAt: new Date(Date.now() - MINUTE),
          payload: {
            responseId,
            attemptId: randomUUID(),
            formId: randomUUID(),
            formVersionId: randomUUID(),
            publisherId,
            respondentId: rewardTarget,
            rewardAmount,
            policyMode: 'SHADOW',
            policyDeploymentId: 'policy-default-v1',
            submittedAt: new Date().toISOString(),
          },
        },
      });
    }

    function dispatcher(
      registry: OutboxHandlerRegistry,
      clock = new FixedClock(new Date()),
    ) {
      return new OutboxDispatchJob(
        registry,
        new PrismaOutboxClaimRepository(prisma),
        new PrismaUnitOfWork(prisma),
        clock,
        { intervalMs: 15_000, maxAttempts: 8, random: () => 0.5 },
      );
    }

    /** The synthetic events below have no Response row: treat them as submitted. */
    const submittedResponses = {
      findResponseById: async () => ({ status: 'VALIDATED' }),
    };

    function realRegistry(): OutboxHandlerRegistry {
      const registry = new OutboxHandlerRegistry();
      registry.register(
        new InternalRewardRequestedHandler(rewards, submittedResponses),
      );
      return registry;
    }

    function ctx(owner: string, fencingToken: string) {
      return {
        runId: randomUUID(),
        now: new Date(),
        owner,
        fencingToken,
        shouldContinue: async () => true,
        logger: { log() {}, warn() {}, error() {}, debug() {} },
      };
    }

    beforeAll(async () => {
      if (!dbAvailable) return;
      rewardTarget = await user('RESPONDENT');
      // A publisher Escrow that funds the internal draws.
      await externalSurvey({ expectedCompletions: 100, reward: 10 });
    });

    liveIt(
      'T6: two concurrent dispatchers settle each event exactly once',
      async () => {
        const events = await Promise.all(
          Array.from({ length: 12 }, () => rewardEvent()),
        );
        const ids = events.map((e) => e.id);

        await Promise.all([
          dispatcher(realRegistry()).run(ctx('owner-a', '1')),
          dispatcher(realRegistry()).run(ctx('owner-b', '1')),
        ]);

        const rows = await prisma.outboxEvent.findMany({
          where: { id: { in: ids } },
        });
        expect(rows.every((r) => r.status === 'PROCESSED')).toBe(true);
        const processed = await prisma.processedHandler.count({
          where: { eventId: { in: ids } },
        });
        expect(processed).toBe(ids.length);
        const journals = await prisma.ledgerJournal.count({
          where: {
            idempotencyKey: {
              in: events.map((e) => e.idempotencyKey),
            },
          },
        });
        expect(journals).toBe(ids.length);
        const notices = await prisma.notification.count({
          where: {
            userId: rewardTarget,
            dedupeKey: { in: events.map((e) => e.idempotencyKey) },
          },
        });
        expect(notices).toBe(ids.length);
      },
      120_000,
    );

    liveIt(
      'replays of already-settled rewards are no-ops (no new journal, no notice)',
      async () => {
        const responseId = randomUUID();
        const event = await rewardEvent(responseId);
        // The synchronous settlement already posted it (pre-dispatcher data).
        await rewards.settleInternalReward({
          responseId,
          publisherId,
          respondentId: rewardTarget,
          rewardPerResponse: 10,
        });
        await prisma.notification.deleteMany({
          where: { userId: rewardTarget, dedupeKey: event.idempotencyKey },
        });

        await dispatcher(realRegistry()).run(ctx('owner-a', '2'));

        expect(
          (
            await prisma.outboxEvent.findUniqueOrThrow({
              where: { id: event.id },
            })
          ).status,
        ).toBe('PROCESSED');
        expect(
          await prisma.ledgerJournal.count({
            where: { idempotencyKey: event.idempotencyKey },
          }),
        ).toBe(1);
        expect(
          await prisma.notification.count({
            where: { userId: rewardTarget, dedupeKey: event.idempotencyKey },
          }),
        ).toBe(0);
      },
    );

    liveIt(
      'T4: crash after claim — the next owner re-claims after the lease (attempts 2), one journal',
      async () => {
        const event = await rewardEvent();
        const claims = new PrismaOutboxClaimRepository(prisma);
        const start = new Date();
        const crashed = await claims.claimBatch({
          types: ['InternalRewardRequested'],
          owner: 'owner-crashed',
          fencingToken: '9.1',
          now: start,
          leaseMs: 60_000,
          limit: 100,
        });
        expect(crashed.map((e) => e.id)).toContain(event.id);

        const clock = new FixedClock(new Date(start.getTime() + 60_001));
        await dispatcher(realRegistry(), clock).run(ctx('owner-b', '3'));

        const row = await prisma.outboxEvent.findUniqueOrThrow({
          where: { id: event.id },
        });
        expect(row).toMatchObject({ status: 'PROCESSED', attempts: 2 });
        expect(await claims.lockClaimed(event.id, 'owner-crashed', '9.1')).toBe(
          false,
        );
        expect(
          await prisma.ledgerJournal.count({
            where: { idempotencyKey: event.idempotencyKey },
          }),
        ).toBe(1);
      },
    );

    liveIt(
      'T5: a handler failing after its journal leaves nothing behind and retries once',
      async () => {
        const event = await rewardEvent();
        let fail = true;
        const registry = new OutboxHandlerRegistry();
        const real = new InternalRewardRequestedHandler(
          rewards,
          submittedResponses,
        );
        registry.register({
          name: real.name,
          eventType: real.eventType,
          schemaVersions: real.schemaVersions,
          handle: async (envelope: OutboxEnvelope) => {
            await real.handle(envelope);
            if (fail) throw new Error('crash after the journal');
          },
        });
        const clock = new FixedClock(new Date());

        await dispatcher(registry, clock).run(ctx('owner-a', '4'));
        const failed = await prisma.outboxEvent.findUniqueOrThrow({
          where: { id: event.id },
        });
        expect(failed.status).toBe('FAILED');
        expect(failed.availableAt.getTime()).toBeGreaterThan(
          clock.now().getTime(),
        );
        expect(
          await prisma.ledgerJournal.count({
            where: { idempotencyKey: event.idempotencyKey },
          }),
        ).toBe(0);
        expect(
          await prisma.processedHandler.count({ where: { eventId: event.id } }),
        ).toBe(0);
        expect(
          await prisma.notification.count({
            where: { dedupeKey: event.idempotencyKey },
          }),
        ).toBe(0);

        fail = false;
        clock.set(new Date(failed.availableAt.getTime() + 1));
        await dispatcher(registry, clock).run(ctx('owner-a', '5'));
        expect(
          await prisma.ledgerJournal.count({
            where: { idempotencyKey: event.idempotencyKey },
          }),
        ).toBe(1);
      },
    );

    liveIt(
      'T7/T8: an invalid payload is dead-lettered; unsubscribed types are never claimed',
      async () => {
        const bad = await prisma.outboxEvent.create({
          data: {
            idempotencyKey: `internal-reward:bad-${randomUUID()}`,
            eventType: 'InternalRewardRequested',
            producer: 'test',
            aggregateType: 'Response',
            aggregateId: randomUUID(),
            availableAt: new Date(Date.now() - MINUTE),
            payload: { responseId: 'nope' },
          },
        });
        const other = await prisma.outboxEvent.create({
          data: {
            idempotencyKey: `integrity-assessment:${randomUUID()}`,
            eventType: 'IntegrityAssessmentRequested',
            producer: 'test',
            aggregateType: 'Response',
            aggregateId: randomUUID(),
            availableAt: new Date(Date.now() - MINUTE),
            payload: {},
          },
        });

        await dispatcher(realRegistry()).run(ctx('owner-a', '6'));

        expect(
          await prisma.outboxEvent.findUniqueOrThrow({ where: { id: bad.id } }),
        ).toMatchObject({
          status: 'DEAD_LETTER',
          terminalState: 'INVALID_PAYLOAD',
          attempts: 1,
        });
        expect(
          await prisma.outboxEvent.findUniqueOrThrow({
            where: { id: other.id },
          }),
        ).toMatchObject({ status: 'PENDING', attempts: 0 });

        // Admin re-drive keeps the identity and resets the attempts.
        const claims = new PrismaOutboxClaimRepository(prisma);
        expect(await claims.redrive(bad.id, new Date(), publisherId)).toBe(
          'REDRIVEN',
        );
        expect(await claims.redrive(bad.id, new Date(), publisherId)).toBe(
          'NOT_DEAD_LETTER',
        );
        // Review LOW-13: exactly one audit row, written with the state change.
        expect(
          await prisma.identityAuditLog.count({
            where: {
              action: 'OUTBOX_EVENT_REDRIVEN',
              userId: publisherId,
              metadata: { equals: { eventId: bad.id } },
            },
          }),
        ).toBe(1);
        expect(
          await prisma.outboxEvent.findUniqueOrThrow({ where: { id: bad.id } }),
        ).toMatchObject({
          status: 'PENDING',
          attempts: 0,
          idempotencyKey: bad.idempotencyKey,
        });
        await prisma.outboxEvent.update({
          where: { id: bad.id },
          data: { status: 'DEAD_LETTER' },
        });
      },
    );
  });

  liveIt(
    'T12: the reservation sweep skips a row a submit holds, and only expired attempts',
    async () => {
      const survey = await externalSurvey({ expectedCompletions: 10 });
      const held = await respondent();
      const expired = await respondent();
      const fresh = await respondent();
      const heldAttempt = await startPastBarrier(survey.formId, held);
      const expiredAttempt = await startPastBarrier(survey.formId, expired);
      const freshAttempt = await startPastBarrier(survey.formId, fresh);
      const old = new Date(Date.now() - 33 * MINUTE);
      await prisma.surveyAttempt.updateMany({
        where: {
          id: { in: [heldAttempt.attemptId, expiredAttempt.attemptId] },
        },
        data: { startedAt: old },
      });

      // An Internal-style Response on the expired attempt follows it.
      const expiredRow = await prisma.surveyAttempt.findUniqueOrThrow({
        where: { id: expiredAttempt.attemptId },
      });
      const expiredResponse = await prisma.response.create({
        data: {
          formId: survey.formId,
          formVersionId: expiredRow.formVersionId,
          attemptId: expiredAttempt.attemptId,
          respondentId: expiredRow.respondentId,
          ipAddress: '127.0.0.1',
        },
      });

      let releaseLock!: () => void;
      const lockHeld = new Promise<void>((resolve) => (releaseLock = resolve));
      let locked!: () => void;
      const isLocked = new Promise<void>((resolve) => (locked = resolve));
      const submit = prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM survey_attempts WHERE id = ${heldAttempt.attemptId}::uuid FOR UPDATE`;
          locked();
          await lockHeld;
          await tx.surveyAttempt.update({
            where: { id: heldAttempt.attemptId },
            data: { status: 'COMPLETED', submittedAt: new Date() },
          });
        },
        { timeout: 30_000 },
      );
      await isLocked;

      const sweep = await runner.runJobOnce('reservation-expiry');
      releaseLock();
      await submit;

      expect(sweep).toMatchObject({ outcome: 'SUCCEEDED' });
      const rows = await prisma.surveyAttempt.findMany({
        where: {
          id: {
            in: [
              heldAttempt.attemptId,
              expiredAttempt.attemptId,
              freshAttempt.attemptId,
            ],
          },
        },
      });
      const byId = new Map(rows.map((r) => [r.id, r]));
      expect(byId.get(heldAttempt.attemptId)?.status).toBe('COMPLETED');
      expect(byId.get(expiredAttempt.attemptId)).toMatchObject({
        status: 'ABANDONED',
        closedReason: 'EXPIRED',
      });
      expect(byId.get(freshAttempt.attemptId)?.status).toBe('IN_PROGRESS');
      await expect(
        prisma.response.findUniqueOrThrow({
          where: { id: expiredResponse.id },
        }),
      ).resolves.toMatchObject({ status: 'ABANDONED' });
    },
    60_000,
  );

  liveIt(
    'T14/T15: deadline blocks starts, the job closes once and refunds the leftover Escrow',
    async () => {
      const past = new Date(Date.now() - 40 * MINUTE);
      const survey = await externalSurvey({
        expectedCompletions: 5,
        reward: 12,
        deadlineAt: past,
      });
      const late = await respondent();
      const refused = await post(
        `/surveys/${survey.formId}/attempts`,
        late,
        {},
      );
      expect(refused.body.error?.code).toBe('SURVEY_NOT_AVAILABLE');

      const first = await runner.runJobOnce('deadline-close');
      expect(first).toMatchObject({ outcome: 'SUCCEEDED' });
      const form = await prisma.form.findUniqueOrThrow({
        where: { id: survey.formId },
      });
      expect(form).toMatchObject({
        status: 'CLOSED',
        closeKind: 'DEADLINE',
        closeCount: 1,
      });
      const refund = await prisma.ledgerJournal.findUnique({
        where: { idempotencyKey: `close-refund:${survey.formId}:c1` },
        include: { entries: true },
      });
      expect(
        refund?.entries
          .filter((e) => e.amount > 0)
          .reduce((sum, e) => sum + e.amount, 0),
      ).toBe(60);
      expect(
        await prisma.notification.count({
          where: {
            userId: publisherId,
            type: 'ESCROW_RELEASED',
            dedupeKey: `deadline-close:${survey.formId}:c1`,
          },
        }),
      ).toBe(1);

      await runner.runJobOnce('deadline-close');
      expect(
        await prisma.ledgerJournal.count({
          where: {
            idempotencyKey: { startsWith: `close-refund:${survey.formId}:` },
          },
        }),
      ).toBe(1);
    },
  );

  liveIt(
    'plan 2.3: two concurrent last verifications close the survey once (QUOTA), no double refund',
    async () => {
      const survey = await externalSurvey({
        expectedCompletions: 2,
        reward: 10,
      });
      const a = await respondent();
      const b = await respondent();
      const attemptA = await startPastBarrier(survey.formId, a);
      const attemptB = await startPastBarrier(survey.formId, b);

      const [ra, rb] = await Promise.all([
        post(
          `/surveys/${survey.formId}/attempts/${attemptA.attemptId}/verify-code`,
          a,
          { completionCode: COMPLETION_CODE },
        ),
        post(
          `/surveys/${survey.formId}/attempts/${attemptB.attemptId}/verify-code`,
          b,
          { completionCode: COMPLETION_CODE },
        ),
      ]);
      expect([ra.status, rb.status]).toEqual([200, 200]);

      const form = await prisma.form.findUniqueOrThrow({
        where: { id: survey.formId },
      });
      expect(form).toMatchObject({
        status: 'CLOSED',
        closeKind: 'QUOTA',
        closeCount: 1,
      });
      // Both completions drew their Escrow: nothing left to refund, and no
      // second close journal.
      expect(
        await prisma.ledgerJournal.count({
          where: {
            idempotencyKey: { startsWith: `close-refund:${survey.formId}:` },
          },
        }),
      ).toBe(0);

      const third = await respondent();
      const full = await post(`/surveys/${survey.formId}/attempts`, third, {});
      expect(full.status).toBe(409);
      expect(full.body.error.code).toBe('SURVEY_QUOTA_FULL');
    },
    60_000,
  );

  liveIt(
    'plan 2.3: the last completion refunds the leftover Escrow in its transaction',
    async () => {
      // 3 slots reserved, the target lowered to 1 after publication: the one
      // completion closes the survey and returns the 2 unused slots.
      const survey = await externalSurvey({
        expectedCompletions: 3,
        reward: 10,
      });
      await prisma.form.update({
        where: { id: survey.formId },
        data: { expectedCompletions: 1 },
      });
      const who = await respondent();
      const attempt = await startPastBarrier(survey.formId, who);
      const res = await post(
        `/surveys/${survey.formId}/attempts/${attempt.attemptId}/verify-code`,
        who,
        { completionCode: COMPLETION_CODE },
      );
      expect(res.status).toBe(200);
      const refund = await prisma.ledgerJournal.findUnique({
        where: { idempotencyKey: `close-refund:${survey.formId}:c1` },
        include: { entries: true },
      });
      expect(
        refund?.entries
          .filter((e) => e.amount > 0)
          .reduce((sum, e) => sum + e.amount, 0),
      ).toBe(20);
    },
    60_000,
  );

  liveIt(
    'plan 2.3: an Internal submission that meets the target closes the survey in its transaction',
    async () => {
      const formId = randomUUID();
      const versionId = randomUUID();
      const now = new Date();
      await formRepository.create(
        new FormEntity(
          formId,
          publisherId,
          'INTERNAL',
          'PUBLISHED',
          'IR.2b internal',
          null,
          10,
          1,
          now,
          now,
          undefined,
          0,
          5,
        ),
        new FormVersionEntity(
          versionId,
          formId,
          1,
          {
            schemaVersion: 1,
            title: 'IR.2b internal',
            blocks: [
              { id: 'q1', order: 0, type: 'text', title: 'Q1', required: true },
            ],
            settings: {},
            metadata: { expectedEffortSeconds: 60, minTimeBarrierSeconds: 2 },
          } as never,
          null,
          true,
          null,
          null,
          now,
          now,
        ),
      );
      // Two slots reserved at the Form Builder draw (8 per completion), target 1.
      await ledgerService.reserveEscrow({
        userId: publisherId,
        formVersionId: versionId,
        amount: 16,
        formTitle: 'IR.2b internal',
      });
      const who = await respondent();
      const started = await startPastBarrier(formId, who);
      const res = await post(`/responses/${started.responseId}/submit`, who, {
        attemptId: started.attemptId,
        answers: { q1: 'done' },
      });
      expect(res.status).toBe(200);

      expect(
        await prisma.form.findUniqueOrThrow({ where: { id: formId } }),
      ).toMatchObject({ status: 'CLOSED', closeKind: 'QUOTA', closeCount: 1 });
      const refund = await prisma.ledgerJournal.findUnique({
        where: { idempotencyKey: `close-refund:${formId}:c1` },
        include: { entries: true },
      });
      // The owed reward of this very submission stays in Escrow for it.
      expect(
        refund?.entries
          .filter((e) => e.amount > 0)
          .reduce((sum, e) => sum + e.amount, 0),
      ).toBe(8);
      expect(
        await prisma.ledgerJournal.count({
          where: { idempotencyKey: `internal-reward:${started.responseId}` },
        }),
      ).toBe(1);
    },
    60_000,
  );

  liveIt(
    'T16: after every job ran (twice, concurrently) the ledger is balanced',
    async () => {
      const jobs = [
        'outbox-dispatch',
        'pending-release',
        'starter-expiry',
        'reservation-expiry',
        'deadline-close',
      ];
      await Promise.all(jobs.map((job) => runner.runJobOnce(job)));
      await Promise.all(jobs.map((job) => runner.runJobOnce(job)));
      expect(await ledgerInvariants(prisma)).toEqual(BALANCED_LEDGER);
    },
    120_000,
  );
});
