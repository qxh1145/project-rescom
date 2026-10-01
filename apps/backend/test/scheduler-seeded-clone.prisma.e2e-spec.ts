import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, Logger } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/database/prisma.service';
import { EnvService } from '../src/common/config/env.service';
import {
  JobRunOutcome,
  SchedulerRunnerService,
} from '../src/common/scheduler/scheduler-runner.service';
import {
  BALANCED_LEDGER,
  ledgerInvariants,
} from './fixtures/ledger-invariants';

/**
 * Story IR.2b on a CLONE of the seeded dev database (plan 0.3 note): the seed
 * left ~121 PENDING Outbox events whose effects (rewards, notifications) were
 * already applied inline. One run of the dispatcher and of every job must not
 * credit a reward twice, must not create a notice for an already-applied
 * event, must leave unsubscribed event types untouched, and must keep the
 * ledger balanced. Prints what each job did.
 *
 * Opt-in: runs only with `SCHEDULER_SEED_CLONE_DATABASE_URL` (create the clone
 * with `createdb … rescom_phase2_seed && pg_dump rescom_db | psql
 * rescom_phase2_seed`, then `prisma migrate deploy` it). It refuses the
 * seeded database itself.
 */
const cloneUrl = process.env.SCHEDULER_SEED_CLONE_DATABASE_URL;
if (cloneUrl && new URL(cloneUrl).pathname.slice(1) === 'rescom_db') {
  throw new Error('Never run the seeded-clone suite against rescom_db itself.');
}
const liveIt = cloneUrl ? it : it.skip;

describe('Scheduler on a clone of the seeded dev database (IR.2b, plan 0.3)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let runner: SchedulerRunnerService;

  beforeAll(async () => {
    if (!cloneUrl) return;
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    prisma = new PrismaService({ datasources: { db: { url: cloneUrl } } });
    await prisma.$connect();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(EnvService)
      .useValue(
        new EnvService({
          ...process.env,
          NODE_ENV: 'test',
          DATABASE_URL: cloneUrl,
          JWT_SECRET:
            process.env.JWT_SECRET ??
            'at_least_32_characters_super_secure_jwt_secret_key!',
          SCHEDULER_ENABLED: 'true',
        }),
      )
      .compile();
    runner = moduleFixture.get(SchedulerRunnerService, { strict: false });
    app = moduleFixture.createNestApplication();
    await app.init();
  }, 120_000);

  afterAll(async () => {
    if (app) await app.close();
    if (prisma) await prisma.$disconnect();
    jest.restoreAllMocks();
  });

  async function snapshot() {
    const outbox = await prisma.outboxEvent.groupBy({
      by: ['eventType', 'status'],
      _count: { _all: true },
      _sum: { attempts: true },
    });
    const notifications = await prisma.notification.groupBy({
      by: ['type'],
      _count: { _all: true },
    });
    const journalsByPrefix = await prisma.$queryRaw<
      Array<{ prefix: string; n: bigint }>
    >`
      SELECT split_part(idempotency_key, ':', 1) AS prefix, count(*) AS n
      FROM ledger_journals GROUP BY 1 ORDER BY 1`;
    const rewardEvents = await prisma.outboxEvent.findMany({
      where: { eventType: 'InternalRewardRequested' },
      select: { idempotencyKey: true },
    });
    const settledBefore = await prisma.ledgerJournal.count({
      where: {
        idempotencyKey: { in: rewardEvents.map((e) => e.idempotencyKey) },
      },
    });
    return {
      outbox: outbox.map((row) => ({
        eventType: row.eventType,
        status: row.status,
        count: row._count._all,
        attempts: row._sum.attempts ?? 0,
      })),
      notifications: Object.fromEntries(
        notifications.map((row) => [row.type, row._count._all]),
      ) as Record<string, number>,
      journals: Object.fromEntries(
        journalsByPrefix.map((row) => [row.prefix, Number(row.n)]),
      ) as Record<string, number>,
      rewardEvents: rewardEvents.length,
      rewardEventsAlreadySettled: settledBefore,
    };
  }

  liveIt(
    'dispatches the seeded backlog idempotently and runs every job once',
    async () => {
      const before = await snapshot();
      expect(await ledgerInvariants(prisma)).toEqual(BALANCED_LEDGER);

      const results: JobRunOutcome[] = [];
      for (const job of [
        'outbox-dispatch',
        'pending-release',
        'starter-expiry',
        'reservation-expiry',
        'deadline-close',
        'storage-cleanup',
      ]) {
        results.push(await runner.runJobOnce(job));
      }
      const after = await snapshot();

      console.log(
        `IR.2b seeded-clone run\n${JSON.stringify({ before, results, after }, null, 2)}`,
      );

      // Every job ran (storage-cleanup may report PARTIAL without MinIO).
      for (const result of results) {
        expect(result.outcome).not.toBe('FAILED');
        expect(result.outcome).not.toBe('SKIPPED');
      }

      // The dispatcher processed the subscribed backlog …
      const rewardRows = after.outbox.filter(
        (row) => row.eventType === 'InternalRewardRequested',
      );
      expect(rewardRows.filter((row) => row.status !== 'PROCESSED')).toEqual(
        [],
      );
      // … without crediting anything twice: only rewards that had no journal
      // before could get one now.
      const newRewardJournals =
        (after.journals['internal-reward'] ?? 0) -
        (before.journals['internal-reward'] ?? 0);
      expect(newRewardJournals).toBeLessThanOrEqual(
        before.rewardEvents - before.rewardEventsAlreadySettled,
      );
      // No notice for an already-applied reward.
      expect(after.notifications.REWARD_EARNED ?? 0).toBe(
        (before.notifications.REWARD_EARNED ?? 0) + newRewardJournals,
      );
      // Unsubscribed types: untouched (never claimed).
      for (const row of after.outbox.filter(
        (r) => r.eventType !== 'InternalRewardRequested',
      )) {
        expect(row.status).toBe('PENDING');
        expect(row.attempts).toBe(0);
      }
      // Ledger still balanced, caches equal entry sums, no negative user balance.
      expect(await ledgerInvariants(prisma)).toEqual(BALANCED_LEDGER);

      // A second dispatcher run is a no-op.
      const again = await runner.runJobOnce('outbox-dispatch');
      expect(again).toMatchObject({ counts: { claimed: 0 } });
    },
    300_000,
  );
});
