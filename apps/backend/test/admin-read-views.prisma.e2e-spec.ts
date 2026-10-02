import { execFileSync } from 'child_process';
import { randomUUID } from 'crypto';
import * as path from 'path';
import {
  adminJournalListSchema,
  fraudLogPageSchema,
  listAdminJournalsQuerySchema,
  listFraudLogQuerySchema,
  WRONG_COMPLETION_CODE_ACTION,
} from '@rescom/schemas';
import { PrismaService } from '../src/common/database/prisma.service';
import { PrismaFraudLogReader } from '../src/modules/participation/infrastructure/prisma-fraud-log-reader';
import { PrismaFormAdminReads } from '../src/modules/forms/infrastructure/prisma-form-admin-reads';
import { PrismaAdminEconomyStats } from '../src/modules/economy/infrastructure/prisma-admin-economy-stats';
import { PrismaAdminUserDirectory } from '../src/modules/users/infrastructure/prisma-admin-user-directory';
import { PrismaUserProfileRepository } from '../src/modules/users/infrastructure/prisma-user-profile.repository';
import { PrismaUserRepository } from '../src/modules/users/infrastructure/prisma-user.repository';
import { PrismaUserAdminTransactionAdapter } from '../src/modules/users/infrastructure/prisma-user-admin-transaction.adapter';
import { PrismaIdentityAuditRepository } from '../src/modules/auth/infrastructure/prisma-identity-audit.repository';
import { UserAdminService } from '../src/modules/users/application/user-admin.service';
import { AdminFraudLogService } from '../src/modules/admin/application/admin-fraud-log.service';
import { AdminLedgerService } from '../src/modules/admin/application/admin-ledger.service';
import { PrismaMissingCodeReportStats } from '../src/modules/participation/infrastructure/prisma-missing-code-report-stats';

/**
 * Admin read views of mock-off Phase 4 against PostgreSQL: the raw FraudLog
 * SQL (displayed kinds, the attempt join, keyset, UTC bounds, grouped
 * counts), the Identity search and lock reasons, the Forms counters and the
 * Economy reads (keyset with tied timestamps, grouped balance sums).
 *
 * Applies pending migrations (`prisma migrate deploy`) to a dedicated
 * database whose name ends in `_test`. Ledger and identity audit rows are
 * append-only and other runs may have left rows behind, so global numbers
 * are asserted as deltas and lists are scoped to this run's rows. Skipped
 * when the database is unreachable; fails instead when
 * `ADMIN_READS_TEST_DATABASE_URL` is set explicitly.
 */
const explicitUrl = process.env.ADMIN_READS_TEST_DATABASE_URL;
const databaseUrl =
  explicitUrl ??
  'postgresql://rescom_admin:rescom_password@localhost:5433/rescom_phase4_check_test?schema=public';
const backendDir = path.resolve(__dirname, '..');

if (!new URL(databaseUrl).pathname.slice(1).endsWith('_test')) {
  throw new Error(
    'ADMIN_READS_TEST_DATABASE_URL must target a dedicated database ending in _test',
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
const TITLE_PREFIX = 'phase4-admin-read';
const DAY = 86_400_000;

describe('Admin read views PostgreSQL integration', () => {
  let prisma: PrismaService;
  const createdUserIds: string[] = [];
  const createdFormIds: string[] = [];

  if (!dbAvailable) {
    if (explicitUrl) {
      it('reaches ADMIN_READS_TEST_DATABASE_URL', () => {
        throw new Error(
          `ADMIN_READS_TEST_DATABASE_URL is set but ${databaseUrl} is unreachable.`,
        );
      });
    } else {
      console.warn(
        `Postgres DB at ${databaseUrl} is unreachable. Skipping live DB tests.`,
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
    // Leftovers of an interrupted run would change "the oldest queued form".
    const stale = await prisma.form.findMany({
      where: { title: { startsWith: TITLE_PREFIX } },
      select: { id: true },
    });
    await removeForms(stale.map((form) => form.id));
    await prisma.topUpRequest.deleteMany({
      where: { transferReference: { startsWith: TITLE_PREFIX } },
    });
  }, 180_000);

  afterAll(async () => {
    if (!prisma) return;
    await removeForms(createdFormIds);
    // Users owning ledger accounts stay: posted ledger rows are append-only.
    await prisma.fraudLog.deleteMany({
      where: { userId: { in: createdUserIds } },
    });
    await prisma.topUpRequest.deleteMany({
      where: { transferReference: { startsWith: TITLE_PREFIX } },
    });
    const withLedger = await prisma.ledgerAccount.findMany({
      where: { userId: { in: createdUserIds } },
      select: { userId: true },
    });
    const keep = new Set(withLedger.map((account) => account.userId));
    await prisma.user.deleteMany({
      where: { id: { in: createdUserIds.filter((id) => !keep.has(id)) } },
    });
    await prisma.$disconnect();
  });

  async function removeForms(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await prisma.completionCodeLimitReset.deleteMany({
      where: { formVersion: { formId: { in: ids } } },
    });
    await prisma.surveyAttempt.deleteMany({ where: { surveyId: { in: ids } } });
    await prisma.form.deleteMany({ where: { id: { in: ids } } });
  }

  async function createUser(
    role: 'ADMIN' | 'PUBLISHER' | 'RESPONDENT' = 'RESPONDENT',
    email = `phase4-${randomUUID()}@example.com`,
  ) {
    const user = await prisma.user.create({
      data: { email, passwordHash: 'hash', role, status: 'ACTIVE' },
    });
    createdUserIds.push(user.id);
    return user;
  }

  async function createForm(
    publisherId: string,
    status: 'MODERATION_QUEUE' | 'PUBLISHED' | 'DRAFT' | 'CLOSED',
    updatedAt = new Date(),
  ) {
    const form = await prisma.form.create({
      data: {
        publisherId,
        type: 'INTERNAL',
        status,
        title: `${TITLE_PREFIX} ${randomUUID().slice(0, 8)}`,
        rewardPerResponse: 10,
        expectedCompletions: 5,
        updatedAt,
        versions: { create: { versionNumber: 1, schemaJson: [] } },
      },
      include: { versions: true },
    });
    createdFormIds.push(form.id);
    return form;
  }

  liveIt(
    'reads the FraudLog: kinds, survey of the evidence, keyset, UTC window and account counts',
    async () => {
      const publisher = await createUser('PUBLISHER');
      const offender = await createUser();
      const other = await createUser();
      const form = await createForm(publisher.id, 'PUBLISHED');
      const version = form.versions[0];
      const attempt = await prisma.surveyAttempt.create({
        data: {
          respondentId: offender.id,
          surveyId: form.id,
          formVersionId: version.id,
        },
      });
      const now = Date.now();
      const tied = new Date(now - 60 * 60_000);
      const log = (
        userId: string,
        type: 'TIME_BARRIER' | 'RATE_LIMIT' | 'SECURITY_VIOLATION',
        details: Record<string, unknown> | undefined,
        createdAt: Date,
      ) =>
        prisma.fraudLog.create({
          data: { userId, type, details: details as any, createdAt },
        });
      await log(
        offender.id,
        'TIME_BARRIER',
        { formId: form.id, attemptId: attempt.id, elapsedSeconds: 30 },
        new Date(now - 5 * 60_000),
      );
      await log(
        offender.id,
        'SECURITY_VIOLATION',
        {
          attemptId: attempt.id,
          formVersionId: version.id,
          action: WRONG_COMPLETION_CODE_ACTION,
          failureCount: 1,
        },
        tied,
      );
      await log(offender.id, 'RATE_LIMIT', { attemptId: attempt.id }, tied);
      // A security violation without details stays SECURITY_VIOLATION.
      await log(
        offender.id,
        'SECURITY_VIOLATION',
        undefined,
        new Date(now - 2 * DAY),
      );
      await log(
        other.id,
        'RATE_LIMIT',
        { attemptId: 'not-a-uuid' },
        new Date(now - 20 * DAY),
      );

      const reader = new PrismaFraudLogReader(prisma);
      const scope = { userIds: [offender.id, other.id] };

      const all = await reader.list(scope, null, 10);
      expect(all).toHaveLength(5);
      expect(all[0].type).toBe('TIME_BARRIER');
      expect(
        all
          .slice(1, 3)
          .map((row) => row.type)
          .sort(),
      ).toEqual(['RATE_LIMIT', 'SECURITY_VIOLATION']);
      expect(all[3].type).toBe('SECURITY_VIOLATION');
      expect(all[4].type).toBe('RATE_LIMIT');
      // Tied instants: id descending.
      expect(all[1].id > all[2].id).toBe(true);
      expect(all[1].createdAt).toBe(tied.toISOString());
      // Survey: details.formId, else the attempt of details.attemptId; never a bad uuid.
      expect(all[0].surveyId).toBe(form.id);
      expect(all.slice(1, 3).map((row) => row.surveyId)).toEqual([
        form.id,
        form.id,
      ]);
      expect(all[3].surveyId).toBeNull();
      expect(all[4].surveyId).toBeNull();

      // Keyset across the tie: no row repeated or skipped.
      const firstPage = await reader.list(scope, null, 2);
      const secondPage = await reader.list(
        scope,
        { createdAt: firstPage[1].createdAt, id: firstPage[1].id },
        10,
      );
      expect([...firstPage, ...secondPage].map((row) => row.id)).toEqual(
        all.map((row) => row.id),
      );

      const kinds = async (kind: string) =>
        (await reader.list({ ...scope, kind }, null, 10)).map((row) => row.id);
      expect(await kinds('COMPLETION_CODE')).toEqual([
        all.find((row) => row.details && (row.details as any).action)!.id,
      ]);
      expect(await kinds('SECURITY_VIOLATION')).toEqual([all[3].id]);

      const since = new Date(now - DAY);
      await expect(
        reader.countCapped({ ...scope, since }, 10_000),
      ).resolves.toBe(3);
      // The aggregate reads at most `cap` entries.
      await expect(reader.countCapped(scope, 2)).resolves.toBe(2);
      await expect(reader.countCapped({ userIds: [] }, 10_000)).resolves.toBe(
        0,
      );
      await expect(reader.countByAccount(scope, 10, 10_000)).resolves.toEqual([
        { userId: offender.id, count: 4 },
        { userId: other.id, count: 1 },
      ]);
      // Over the newest 3 entries only: all the offender's.
      await expect(reader.countByAccount(scope, 10, 3)).resolves.toEqual([
        { userId: offender.id, count: 3 },
      ]);
      // Accounts with entries, latest entry first.
      await expect(reader.candidateUserIds(scope, 10, 10_000)).resolves.toEqual(
        [offender.id, other.id],
      );
      await expect(
        reader.candidateUserIds(
          { ...scope, kind: 'RATE_LIMIT', since },
          10,
          10_000,
        ),
      ).resolves.toEqual([offender.id]);

      const flagged = (
        await reader.topAccountsSince(new Date(now - 14 * DAY), 50)
      ).find((account) => account.userId === offender.id);
      expect(flagged?.count).toBe(4);
      expect([...flagged!.kinds].sort()).toEqual([
        'COMPLETION_CODE',
        'RATE_LIMIT',
        'SECURITY_VIOLATION',
        'TIME_BARRIER',
      ]);

      // The admin service end to end on the real adapters.
      const service = new AdminFraudLogService({
        fraudLogs: reader,
        formTitles: new PrismaFormAdminReads(prisma),
        directory: new PrismaAdminUserDirectory(prisma),
      });
      const page = fraudLogPageSchema.parse(
        await service.list(
          listFraudLogQuerySchema.parse({ userId: offender.id, days: '7' }),
        ),
      );
      expect(page.total).toBe(4);
      expect(page.items.slice(0, 3).map((item) => item.survey?.title)).toEqual([
        form.title,
        form.title,
        form.title,
      ]);
      expect(page.accounts).toEqual([
        { userId: offender.id, count: 4, repeated: true, status: 'ACTIVE' },
      ]);
    },
  );

  liveIt(
    'searches accounts by e-mail, display name and short code',
    async () => {
      const tag = randomUUID().slice(0, 8);
      const byEmail = await createUser(
        'RESPONDENT',
        `phase4_${tag}%x@example.com`,
      );
      const byName = await createUser();
      await new PrismaUserProfileRepository(prisma).upsertPartial(byName.id, {
        displayName: `Đỗ Khang ${tag}`,
      });
      const directory = new PrismaAdminUserDirectory(prisma);

      const ids = [byEmail.id, byName.id, randomUUID()];

      await expect(directory.filterMatching(`${tag}%x`, ids)).resolves.toEqual([
        byEmail.id,
      ]);
      // LIKE metacharacters are literal.
      await expect(
        directory.filterMatching(`phase4_${tag}_`, ids),
      ).resolves.toEqual([]);
      await expect(
        directory.filterMatching(`khang ${tag}`, ids),
      ).resolves.toEqual([byName.id]);
      const code = `#${byName.id.replace(/-/g, '').slice(0, 12).toUpperCase()}`;
      await expect(directory.filterMatching(code, ids)).resolves.toEqual([
        byName.id,
      ]);
      // Only among the given ids.
      await expect(
        directory.filterMatching(`khang ${tag}`, [byEmail.id]),
      ).resolves.toEqual([]);

      const labels = await directory.findLabels(ids);
      expect(labels.get(byName.id)).toEqual({
        email: byName.email,
        displayName: `Đỗ Khang ${tag}`,
      });
      expect(labels.get(byEmail.id)).toEqual({
        email: byEmail.email,
        displayName: null,
      });
      expect(labels.size).toBe(2);

      const statuses = await directory.findStatuses([
        byEmail.id,
        byName.id,
        randomUUID(),
      ]);
      expect([...statuses.values()]).toEqual(['ACTIVE', 'ACTIVE']);
    },
  );

  liveIt(
    'reads the lock reason of the latest effective lock from the audit log',
    async () => {
      const admin = await createUser('ADMIN');
      await createUser('ADMIN');
      const target = await createUser();
      const audit = new PrismaIdentityAuditRepository(prisma);
      const service = new UserAdminService(
        new PrismaUserRepository(prisma),
        new PrismaUserAdminTransactionAdapter(prisma),
        audit,
        audit,
      );

      const locked = await service.updateUserStatus(
        admin.id,
        target.id,
        'LOCKED',
        {
          reason: 'Vi phạm lặp lại: nộp quá nhanh',
        },
      );
      await service.updateUserStatus(admin.id, target.id, 'LOCKED', {
        reason: 'No-op, không thay lý do',
      });
      await expect(service.findLockReasons([locked])).resolves.toEqual(
        new Map([[target.id, 'Vi phạm lặp lại: nộp quá nhanh']]),
      );

      await service.updateUserStatus(admin.id, target.id, 'ACTIVE');
      await expect(audit.findLatestLockReasons([target.id])).resolves.toEqual(
        new Map(),
      );
    },
  );

  liveIt(
    'counts the moderation queue and finds its oldest form without versions',
    async () => {
      const reads = new PrismaFormAdminReads(prisma);
      const before = await reads.countByStatus();
      const publisher = await createUser('PUBLISHER');
      const oldest = await createForm(
        publisher.id,
        'MODERATION_QUEUE',
        new Date('1990-01-01T00:00:00.000Z'),
      );
      await createForm(publisher.id, 'MODERATION_QUEUE');
      await createForm(publisher.id, 'PUBLISHED');
      await createForm(publisher.id, 'DRAFT');

      await expect(reads.countByStatus()).resolves.toEqual({
        queued: before.queued + 2,
        published: before.published + 1,
      });
      await expect(reads.oldestQueued()).resolves.toEqual({
        formId: oldest.id,
        title: oldest.title,
        type: 'INTERNAL',
        publisherId: publisher.id,
        submittedAt: new Date('1990-01-01T00:00:00.000Z'),
      });
      const titles = await reads.findTitles({
        formIds: [oldest.id, randomUUID()],
        formVersionIds: [oldest.versions[0].id],
      });
      expect([...titles.byFormId]).toEqual([[oldest.id, oldest.title]]);
      expect(titles.byFormVersionId.get(oldest.versions[0].id)).toEqual({
        formId: oldest.id,
        title: oldest.title,
      });
    },
  );

  liveIt(
    'reads the ledger: grouped balances, refunds since a bound and keyset journals',
    async () => {
      const stats = new PrismaAdminEconomyStats(prisma);
      const runStart = new Date(Date.now() - 1_000);
      const balancesBefore = await stats.balanceTotals();
      const refundsBefore = await stats.escrowRefundsSince(runStart);

      const owner = await createUser('PUBLISHER');
      await new PrismaUserProfileRepository(prisma).upsertPartial(owner.id, {
        displayName: 'Nguyễn Thuỳ Linh',
      });
      const available = await prisma.ledgerAccount.create({
        data: { userId: owner.id, accountClass: 'USER_AVAILABLE', balance: 0 },
      });
      const escrow = await prisma.ledgerAccount.create({
        data: { userId: owner.id, accountClass: 'ESCROW', balance: 300 },
      });
      const pending = await prisma.ledgerAccount.create({
        data: { userId: owner.id, accountClass: 'PENDING', balance: 7 },
      });
      const form = await createForm(owner.id, 'PUBLISHED');

      const tied = new Date();
      const post = (
        key: string,
        amount: number,
        createdAt: Date,
        from = escrow.id,
        to = available.id,
      ) =>
        prisma.ledgerJournal.create({
          data: {
            idempotencyKey: key,
            createdAt,
            entries: {
              create: [
                { accountId: from, amount: -amount, createdAt },
                { accountId: to, amount, createdAt },
              ],
            },
          },
        });
      const refundA = await post(
        `close-refund:${form.id}:c${randomUUID()}`,
        40,
        tied,
      );
      const refundB = await post(
        `close-refund:${form.id}:c${randomUUID()}`,
        60,
        tied,
      );
      const reward = await post(
        `external-completion:${randomUUID()}`,
        10,
        tied,
        escrow.id,
        pending.id,
      );
      const publish = await post(
        `publish:${form.versions[0].id}`,
        100,
        new Date(tied.getTime() - 1_000),
        available.id,
        escrow.id,
      );

      await expect(stats.balanceTotals()).resolves.toEqual({
        escrow: balancesBefore.escrow + 300,
        pending: balancesBefore.pending + 7,
      });
      // Two refunds of the same survey: one survey.
      await expect(stats.escrowRefundsSince(runStart)).resolves.toEqual({
        points: refundsBefore.points + 100,
        surveys: refundsBefore.surveys + 1,
      });

      const service = new AdminLedgerService({
        economyStats: stats,
        formTitles: new PrismaFormAdminReads(prisma),
        profiles: new PrismaUserProfileRepository(prisma),
      });
      const window = {
        from: runStart.toISOString(),
        to: new Date(Date.now() + 60_000).toISOString(),
      };
      const all = adminJournalListSchema.parse(
        await service.listJournals(listAdminJournalsQuerySchema.parse(window)),
      );
      const tiedIds = [refundA.id, refundB.id, reward.id].sort().reverse();
      expect(all.items.map((item) => item.id)).toEqual([
        ...tiedIds,
        publish.id,
      ]);
      expect(all.items.find((item) => item.id === publish.id)?.related).toBe(
        form.title,
      );
      expect(all.items.find((item) => item.id === refundA.id)).toMatchObject({
        related: form.title,
        attemptId: null,
      });
      expect(
        all.items
          .find((item) => item.id === refundA.id)
          ?.entries.map((entry) => [
            entry.accountClass,
            entry.amount,
            entry.ownerName,
          ])
          // Entries of one journal share an instant: order by amount to compare.
          .sort((a, b) => (a[1] as number) - (b[1] as number)),
      ).toEqual([
        ['ESCROW', -40, 'Nguyễn Thuỳ Linh'],
        ['USER_AVAILABLE', 40, 'Nguyễn Thuỳ Linh'],
      ]);

      // Keyset through the tie, one row per page.
      const seen: string[] = [];
      let before: string | undefined;
      for (let page = 0; page < 5; page += 1) {
        const result = await service.listJournals(
          listAdminJournalsQuerySchema.parse({
            ...window,
            limit: '1',
            ...(before ? { before } : {}),
          }),
        );
        seen.push(...result.items.map((item) => item.id));
        if (!result.hasMore) break;
        before = `${result.items[0].createdAt}:${result.items[0].id}`;
      }
      expect(seen).toEqual(all.items.map((item) => item.id));

      const refunds = await service.listJournals(
        listAdminJournalsQuerySchema.parse({ ...window, type: 'refund' }),
      );
      expect(refunds.items.map((item) => item.id).sort()).toEqual(
        [refundA.id, refundB.id].sort(),
      );
      const escrows = await service.listJournals(
        listAdminJournalsQuerySchema.parse({ ...window, type: 'escrow' }),
      );
      expect(escrows.items.map((item) => item.id)).toEqual([publish.id]);

      // A refund reversed since is not "refunded today".
      const otherForm = await createForm(owner.id, 'CLOSED');
      const refundC = await post(
        `close-refund:${otherForm.id}:c1`,
        25,
        new Date(),
      );
      await prisma.ledgerJournal.create({
        data: {
          idempotencyKey: `reversal:${refundC.id}`,
          reversesJournalId: refundC.id,
          entries: {
            create: [
              { accountId: available.id, amount: -25 },
              { accountId: escrow.id, amount: 25 },
            ],
          },
        },
      });
      await expect(stats.escrowRefundsSince(runStart)).resolves.toEqual({
        points: refundsBefore.points + 100,
        surveys: refundsBefore.surveys + 1,
      });
    },
  );

  liveIt('summarises PENDING top-ups and finds the oldest one', async () => {
    const stats = new PrismaAdminEconomyStats(prisma);
    const before = await stats.pendingTopUpSummary();
    const user = await createUser();
    const topUp = (
      amount: number,
      status: 'PENDING' | 'APPROVED',
      createdAt: Date,
    ) =>
      prisma.topUpRequest.create({
        data: {
          userId: user.id,
          amount,
          amountVnd: amount * 200,
          transferReference: `${TITLE_PREFIX}-${randomUUID()}`,
          status,
          createdAt,
        },
      });
    const oldest = await topUp(
      100,
      'PENDING',
      new Date('1990-01-01T00:00:00.000Z'),
    );
    await topUp(50, 'PENDING', new Date());
    await topUp(999, 'APPROVED', new Date());

    await expect(stats.pendingTopUpSummary()).resolves.toEqual({
      count: before.count + 2,
      points: before.points + 150,
      amountVnd: before.amountVnd + 30_000,
    });
    await expect(stats.oldestPendingTopUp()).resolves.toMatchObject({
      id: oldest.id,
      userId: user.id,
      amount: 100,
      amountVnd: 20_000,
      createdAt: new Date('1990-01-01T00:00:00.000Z'),
    });
  });

  liveIt('counts unresolved missing-code reports only', async () => {
    const reports = new PrismaMissingCodeReportStats(prisma);
    const before = await reports.countUnresolved();
    const publisher = await createUser('PUBLISHER');
    const admin = await createUser('ADMIN');
    const form = await createForm(publisher.id, 'PUBLISHED');
    const versionId = form.versions[0].id;
    const reportedAt = new Date(Date.now() - 60_000);
    const attempt = async (
      status: 'IN_PROGRESS' | 'COMPLETED' | 'LOCKED' | 'ABANDONED',
      reported: boolean,
    ) => {
      const respondent = await createUser();
      await prisma.surveyAttempt.create({
        data: {
          respondentId: respondent.id,
          surveyId: form.id,
          formVersionId: versionId,
          status,
          missingCodeReportedAt: reported ? reportedAt : null,
          missingCodeReason: reported ? 'Không thấy mã' : null,
        },
      });
      return respondent;
    };
    await attempt('IN_PROGRESS', true); // open
    await attempt('ABANDONED', true); // open: expired after the report
    await attempt('COMPLETED', true); // resolved: rewarded
    await attempt('LOCKED', false); // never reported
    const reset = await attempt('LOCKED', true);
    const resetBefore = await attempt('LOCKED', true);
    const resetRow = (respondentId: string, createdAt: Date) =>
      prisma.completionCodeLimitReset.create({
        data: {
          respondentId,
          formVersionId: versionId,
          failuresForgiven: 3,
          resetById: admin.id,
          reason: 'Đã xác minh báo thiếu mã',
          policyVersion: 'completion-code-policy-v1',
          createdAt,
        },
      });
    await resetRow(reset.id, new Date()); // resolved: limit reset after the report
    await resetRow(resetBefore.id, new Date(reportedAt.getTime() - 60_000)); // reset before: still open

    await expect(reports.countUnresolved()).resolves.toBe(before + 3);

    // The list shows the same unresolved set, newest first, keyset-paged.
    const listed = (await reports.listUnresolved(null, 10_000)).filter(
      (row) => row.surveyId === form.id,
    );
    expect(listed).toHaveLength(3);
    expect(listed.map((row) => row.attemptStatus).sort()).toEqual([
      'ABANDONED',
      'IN_PROGRESS',
      'LOCKED',
    ]);
    expect(listed[0]).toMatchObject({ reason: 'Không thấy mã' });
    const first = (await reports.listUnresolved(null, 1))[0];
    const next = await reports.listUnresolved(
      { createdAt: first.reportedAt.toISOString(), id: first.attemptId },
      1,
    );
    expect(next[0]?.attemptId).not.toBe(first.attemptId);
  });
});
