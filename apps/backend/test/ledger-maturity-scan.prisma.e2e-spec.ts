import { execFileSync } from 'child_process';
import { randomUUID } from 'crypto';
import * as path from 'path';
import { PrismaService } from '../src/common/database/prisma.service';
import {
  currentClient,
  runInTransaction,
} from '../src/common/database/prisma-unit-of-work';
import {
  disputeHoldDescription,
  disputeHoldKey,
  disputeResolutionKey,
} from '../src/modules/economy/domain/dispute-hold';
import { PrismaLedgerRepository } from '../src/modules/economy/infrastructure/prisma-ledger.repository';

/**
 * Live check of the FR-24 maturity scan SQL (`findMaturedPendingCredits`,
 * BE-5) on PostgreSQL. Applies pending migrations (`prisma migrate deploy`)
 * to a dedicated database whose name ends in `_test`; every scenario seeds
 * and reads inside one transaction that is rolled back, so the append-only
 * ledger tables stay empty.
 *
 * The suite is reported as skipped when the database is unreachable, and
 * fails instead when `LEDGER_TEST_DATABASE_URL` is set explicitly.
 */
const explicitUrl = process.env.LEDGER_TEST_DATABASE_URL;
const databaseUrl =
  explicitUrl ??
  'postgresql://rescom_admin:rescom_password@localhost:5433/rescom_ledger_test?schema=public';
const backendDir = path.resolve(__dirname, '..');

if (!new URL(databaseUrl).pathname.slice(1).endsWith('_test')) {
  throw new Error(
    'LEDGER_TEST_DATABASE_URL must target a dedicated database ending in _test',
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

describe('Ledger maturity scan on PostgreSQL (BE-5)', () => {
  let prisma: PrismaService;
  let repository: PrismaLedgerRepository;

  class Rollback extends Error {}

  if (!dbAvailable) {
    if (explicitUrl) {
      it('reaches LEDGER_TEST_DATABASE_URL', () => {
        throw new Error(
          `LEDGER_TEST_DATABASE_URL is set but ${databaseUrl} is unreachable.`,
        );
      });
    } else {
      console.warn(
        `Postgres DB at ${databaseUrl} is unreachable. Skipping live ledger scan tests.`,
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
    repository = new PrismaLedgerRepository(prisma);
  }, 180_000);

  afterAll(async () => {
    if (prisma) {
      await prisma.$disconnect();
    }
  });

  /** Runs `work` in a transaction that is always rolled back. */
  async function rolledBack<T>(work: () => Promise<T>): Promise<T> {
    let result: T | undefined;
    await runInTransaction(prisma, async () => {
      result = await work();
      throw new Rollback();
    }).catch((error: unknown) => {
      if (!(error instanceof Rollback)) {
        throw error;
      }
    });
    return result as T;
  }

  let base: Date;
  let minute: number;

  /**
   * Seeds are dated before every existing journal, so rows left behind by
   * other runs can neither precede them under the scan's LIMIT nor match
   * their run-unique ids.
   */
  async function startSeeding(): Promise<void> {
    const [{ oldest }] = await currentClient(prisma).$queryRaw<
      Array<{ oldest: Date | null }>
    >`SELECT min(created_at) AS oldest FROM ledger_journals`;
    const floor = new Date('2026-01-01T00:00:00.000Z');
    base = new Date(
      Math.min(oldest?.getTime() ?? floor.getTime(), floor.getTime()) -
        24 * 60 * 60_000,
    );
    minute = 0;
  }

  /** The created_at of the next seeded journal. */
  function nextTime(): Date {
    return new Date(base.getTime() + minute++ * 60_000);
  }

  async function journal(
    idempotencyKey: string,
    options: { description?: string; reverses?: string } = {},
  ): Promise<string> {
    const row = await currentClient(prisma).ledgerJournal.create({
      data: {
        idempotencyKey,
        description: options.description ?? null,
        reversesJournalId: options.reverses ?? null,
        createdAt: nextTime(),
      },
    });
    return row.id;
  }

  const credit = (attemptId: string) =>
    journal(`external-completion:${attemptId}`);
  const hold = (caseId: string, attemptId: string) =>
    journal(disputeHoldKey(caseId), {
      description: disputeHoldDescription(attemptId, caseId),
    });
  const resolution = (caseId: string, action: 'release' | 'refund') =>
    journal(disputeResolutionKey(caseId, action));
  const reversal = (targetId: string) =>
    journal(`reversal:${randomUUID()}`, { reverses: targetId });

  liveIt(
    'returns exactly the matured, unreleased, unreversed, unsettled credits',
    async () => {
      const run = randomUUID();
      const id = (name: string) => `${name}-${run}`;

      const result = await rolledBack(async () => {
        await startSeeding();
        const seeded: string[] = [];
        const returned: string[] = [];
        const seed = async (attemptId: string, expectReturned: boolean) => {
          const creditId = await credit(attemptId);
          seeded.push(creditId);
          if (expectReturned) returned.push(creditId);
          return creditId;
        };

        await seed(id('plain'), true);

        await seed(id('open-hold'), true);
        await hold(id('case-open'), id('open-hold'));

        await seed(id('resolved-release'), false);
        await hold(id('case-release'), id('resolved-release'));
        await resolution(id('case-release'), 'release');

        await seed(id('resolved-refund'), false);
        await hold(id('case-refund'), id('resolved-refund'));
        await resolution(id('case-refund'), 'refund');

        await seed(id('resolution-reversed'), true);
        await hold(id('case-res-rev'), id('resolution-reversed'));
        await reversal(await resolution(id('case-res-rev'), 'refund'));

        // Hold reversed while its resolution stands: the hold no longer
        // settles the credit.
        await seed(id('hold-reversed'), true);
        const reversedHold = await hold(
          id('case-hold-rev'),
          id('hold-reversed'),
        );
        await resolution(id('case-hold-rev'), 'release');
        await reversal(reversedHold);

        await seed(id('released'), false);
        await journal(`release-pending:${id('released')}`);

        await reversal(await seed(id('reversed-credit'), false));

        // Attempt ids that are prefixes of each other never collide: only
        // the settled one of each pair is left out.
        await seed(id('prefix-a'), false);
        await hold(id('case-pa'), id('prefix-a'));
        await resolution(id('case-pa'), 'refund');
        await seed(`${id('prefix-a')}0`, true);

        await seed(id('prefix-b'), true);
        await seed(`${id('prefix-b')}0`, false);
        await hold(id('case-pb'), `${id('prefix-b')}0`);
        await resolution(id('case-pb'), 'release');

        // Case ids with `)`, regex metacharacters and spaces still parse.
        for (const [name, caseId] of [
          ['paren-case', `${id('case')})x`],
          ['meta-case', `${id('case')}.*[x]+?`],
          ['spaced-case', `${id('case')} (Case y)`],
        ]) {
          await seed(id(name), false);
          await hold(caseId, id(name));
          await resolution(caseId, 'refund');
        }

        // Holds whose description names another case, or carries other
        // trailing text, do not settle.
        await seed(id('mismatched'), true);
        await journal(disputeHoldKey(id('case-mis')), {
          description: `Dispute hold placed for external attempt: ${id('mismatched')} (Case other)`,
        });
        await resolution(id('case-mis'), 'refund');

        await seed(id('trailing'), true);
        await journal(disputeHoldKey(id('case-trail')), {
          description: `${disputeHoldDescription(id('trailing'), id('case-trail'))} (note)`,
        });
        await resolution(id('case-trail'), 'refund');

        const cutoff = new Date(base.getTime() + (minute - 1) * 60_000);
        // Created after the cutoff: not yet matured.
        await seed(id('too-young'), false);

        const matured = await repository.findMaturedPendingCredits({
          cutoff,
          limit: 500,
        });
        const seededIds = new Set(seeded);
        return {
          returned,
          matured: matured
            .map((row) => row.id)
            .filter((rowId) => seededIds.has(rowId)),
        };
      });

      expect(result.matured).toEqual(result.returned);
    },
  );

  liveIt('applies the limit after the exclusions, oldest first', async () => {
    const run = randomUUID();

    const result = await rolledBack(async () => {
      await startSeeding();
      await credit(`settled-${run}`);
      await hold(`case-${run}`, `settled-${run}`);
      await resolution(`case-${run}`, 'refund');
      const first = await credit(`first-${run}`);
      const second = await credit(`second-${run}`);
      await credit(`third-${run}`);

      const matured = await repository.findMaturedPendingCredits({
        cutoff: new Date(base.getTime() + (minute - 1) * 60_000),
        limit: 2,
      });
      return { expected: [first, second], matured: matured.map((r) => r.id) };
    });

    expect(result.matured).toEqual(result.expected);
  });
});
