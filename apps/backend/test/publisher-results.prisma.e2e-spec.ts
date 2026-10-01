import { execFileSync } from 'child_process';
import { randomUUID } from 'crypto';
import * as path from 'path';
import {
  publisherAnalyticsSchema,
  publisherProgressSchema,
  publisherProgressWindow,
  publisherResponsesPageSchema,
} from '@rescom/schemas';
import { PrismaService } from '../src/common/database/prisma.service';
import { PrismaFormRepository } from '../src/modules/forms/infrastructure/prisma-form.repository';
import { PrismaPublisherResponseReadRepository } from '../src/modules/participation/infrastructure/prisma-publisher-response-read.repository';
import { PublisherResultsService } from '../src/modules/participation/application/publisher-results.service';
import { PublisherFormReadsService } from '../src/modules/forms/application/publisher-form-reads.service';
import { FormsEscrowCoordinator } from '../src/modules/forms/application/forms-escrow.coordinator';
import { LedgerService } from '../src/modules/economy/application/ledger.service';
import { PrismaLedgerRepository } from '../src/modules/economy/infrastructure/prisma-ledger.repository';
import { PublisherAnalyticsLimitExceededException } from '../src/modules/forms/application/exceptions/form.exceptions';

/**
 * Story IR.4a on PostgreSQL: the progress buckets (Responses + External
 * attempts, local-midnight boundaries), the keyset feed of one version
 * (status filter, attempt join, index use), the moderation rejection read,
 * and the analytics timings at 2 000 / 5 000 responses (evidence for NFR-1,
 * not a CI gate — OQ-22 owns the formal profile).
 *
 * Creates (if missing) and migrates (`prisma migrate deploy`) a scratch
 * database: by default `rescom_publisher_results_test` on the local Docker
 * Postgres; override with `PUBLISHER_RESULTS_TEST_DATABASE_URL` (name must end
 * in `_test` or `_check`, never the dev `rescom_db`; see the backend README).
 * Skipped when the server is unreachable; fails instead when the variable is
 * set. Assertions only look at rows this suite created.
 */
const explicitUrl = process.env.PUBLISHER_RESULTS_TEST_DATABASE_URL;
const databaseUrl =
  explicitUrl ??
  'postgresql://rescom_admin:rescom_password@localhost:5433/rescom_publisher_results_test?schema=public';
const backendDir = path.resolve(__dirname, '..');

if (!/_(test|check)$/.test(new URL(databaseUrl).pathname.slice(1))) {
  throw new Error(
    'PUBLISHER_RESULTS_TEST_DATABASE_URL must target a scratch database ending in _test or _check',
  );
}

function probeDatabase(): boolean {
  try {
    execFileSync(
      process.execPath,
      [
        '-e',
        // Creates the scratch database on first use (connecting to the
        // server's `postgres` database), then checks it answers.
        "const { PrismaClient } = require('@prisma/client');" +
          'const target = new URL(process.env.PROBE_URL);' +
          'const name = target.pathname.slice(1);' +
          "const admin = new URL(target); admin.pathname = '/postgres';" +
          'const a = new PrismaClient({ datasources: { db: { url: admin.toString() } } });' +
          "const create = a.$executeRawUnsafe('CREATE DATABASE \"' + name + '\"').catch(() => undefined).finally(() => a.$disconnect());" +
          'create.then(() => {' +
          '  const p = new PrismaClient({ datasources: { db: { url: process.env.PROBE_URL } } });' +
          "  return p.$queryRawUnsafe('SELECT 1');" +
          '}).then(() => process.exit(0), () => process.exit(1));',
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

describe('Story IR.4a publisher results on PostgreSQL', () => {
  let prisma: PrismaService;
  let forms: PrismaFormRepository;
  let reads: PrismaPublisherResponseReadRepository;

  if (!dbAvailable) {
    if (explicitUrl) {
      it('reaches PUBLISHER_RESULTS_TEST_DATABASE_URL', () => {
        throw new Error(
          `PUBLISHER_RESULTS_TEST_DATABASE_URL is set but ${databaseUrl} is unreachable.`,
        );
      });
    } else {
      console.warn(
        `Postgres DB at ${databaseUrl} is unreachable. Skipping live publisher results tests.`,
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
    forms = new PrismaFormRepository(prisma);
    reads = new PrismaPublisherResponseReadRepository(prisma);
  }, 180_000);

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
  });

  const blocks = [
    { id: 'q-name', type: 'text', title: 'Tên', order: 0, required: true },
    {
      id: 'q-rate',
      type: 'rating',
      title: 'Chấm',
      order: 1,
      required: false,
      maxRating: 5,
    },
  ];

  async function user(role: 'PUBLISHER' | 'RESPONDENT' | 'ADMIN') {
    const id = randomUUID();
    await prisma.user.create({
      data: { id, email: `ir4a-${id}@example.com`, passwordHash: 'h', role },
    });
    return id;
  }

  async function form(
    publisherId: string,
    type: 'INTERNAL' | 'EXTERNAL',
    versions = 1,
  ): Promise<{ formId: string; versionIds: string[] }> {
    const formId = randomUUID();
    await prisma.form.create({
      data: {
        id: formId,
        publisherId,
        type,
        status: 'PUBLISHED',
        title: `IR.4a ${type}`,
        rewardPerResponse: 10,
        expectedCompletions: 10_000,
      },
    });
    const versionIds: string[] = [];
    for (let number = 1; number <= versions; number += 1) {
      const id = randomUUID();
      versionIds.push(id);
      await prisma.formVersion.create({
        data: {
          id,
          formId,
          versionNumber: number,
          schemaJson: { title: 'x', blocks },
          isPublished: true,
          publishedAt: new Date('2026-09-01T00:00:00Z'),
          externalUrl:
            type === 'EXTERNAL'
              ? 'https://docs.google.com/forms/d/e/x/viewform'
              : null,
        },
      });
    }
    return { formId, versionIds };
  }

  async function response(
    formId: string,
    versionId: string,
    submittedAt: Date,
    options: {
      status?: 'SUBMITTED' | 'VALIDATED' | 'IN_PROGRESS' | 'REJECTED';
      respondentId?: string;
      startedAt?: Date;
    } = {},
  ): Promise<string> {
    let attemptId: string | null = null;
    if (options.respondentId) {
      attemptId = randomUUID();
      await prisma.surveyAttempt.create({
        data: {
          id: attemptId,
          respondentId: options.respondentId,
          surveyId: formId,
          formVersionId: versionId,
          status: 'COMPLETED',
          startedAt:
            options.startedAt ?? new Date(submittedAt.getTime() - 60_000),
          submittedAt,
        },
      });
    }
    const id = randomUUID();
    await prisma.response.create({
      data: {
        id,
        formId,
        formVersionId: versionId,
        attemptId,
        respondentId: options.respondentId ?? null,
        status: options.status ?? 'VALIDATED',
        answersJson: { 'q-name': 'An', 'q-rate': 4 },
        ipAddress: '203.0.113.1',
        isGuest: !options.respondentId,
        submittedAt,
      },
    });
    return id;
  }

  liveIt(
    'buckets Responses and External attempts at Vietnam local-midnight boundaries',
    async () => {
      const publisherId = await user('PUBLISHER');
      const internal = await form(publisherId, 'INTERNAL');
      // Day window around Thu 01/10 00:00 local (= 2026-09-30T17:00Z).
      const window = publisherProgressWindow(
        'day',
        new Date('2026-09-30T17:00:00Z'),
      );
      await response(
        internal.formId,
        internal.versionIds[0],
        new Date('2026-09-30T16:59:59.999Z'),
      );
      await response(
        internal.formId,
        internal.versionIds[0],
        new Date('2026-09-30T17:00:00Z'),
      );
      await response(
        internal.formId,
        internal.versionIds[0],
        new Date('2026-09-30T18:00:00Z'),
        { status: 'IN_PROGRESS' },
      );
      expect(
        await forms.countCompletionsInBuckets(internal.formId, window),
      ).toEqual([0, 0, 0, 0, 0, 1, 1]);

      const external = await form(publisherId, 'EXTERNAL');
      const respondentId = await user('RESPONDENT');
      for (const submittedAt of [
        new Date('2026-09-29T17:00:00Z'),
        new Date('2026-09-30T20:00:00Z'),
      ]) {
        await prisma.surveyAttempt.create({
          data: {
            respondentId: await user('RESPONDENT'),
            surveyId: external.formId,
            formVersionId: external.versionIds[0],
            status: 'COMPLETED',
            startedAt: new Date(submittedAt.getTime() - 60_000),
            submittedAt,
          },
        });
      }
      await prisma.surveyAttempt.create({
        data: {
          respondentId,
          surveyId: external.formId,
          formVersionId: external.versionIds[0],
          status: 'IN_PROGRESS',
          startedAt: new Date('2026-09-30T20:00:00Z'),
        },
      });
      expect(
        await forms.countCompletionsInBuckets(external.formId, window),
      ).toEqual([0, 0, 0, 0, 0, 1, 1]);
      expect(
        await forms.countExternalCompletionsSince(
          external.formId,
          new Date('2026-09-30T00:00:00Z'),
        ),
      ).toBe(1);
    },
  );

  liveIt('reads the latest moderation rejection of a form', async () => {
    const publisherId = await user('PUBLISHER');
    const adminId = await user('ADMIN');
    const { formId, versionIds } = await form(publisherId, 'INTERNAL');
    expect(await forms.findLatestRejection(formId)).toBeNull();
    await prisma.surveyModerationDecision.create({
      data: {
        formId,
        formVersionId: versionIds[0],
        versionNumber: 1,
        outcome: 'REJECTED',
        adminId,
        reason: 'Thiếu mô tả',
        refundAmount: 120,
        correlationId: randomUUID(),
        decidedAt: new Date('2026-09-25T08:00:00Z'),
      },
    });
    expect(await forms.findLatestRejection(formId)).toEqual({
      reason: 'Thiếu mô tả',
      refundAmount: 120,
      decidedAt: new Date('2026-09-25T08:00:00Z'),
    });
  });

  liveIt(
    'walks the keyset feed of one version: ties by id, status filter, attempt join, no other version',
    async () => {
      const publisherId = await user('PUBLISHER');
      const { formId, versionIds } = await form(publisherId, 'INTERNAL', 2);
      const [v1, v2] = versionIds;
      const tie = new Date('2026-09-20T00:00:00Z');
      const expected: string[] = [];
      const listed: Array<{ id: string; at: number }> = [];
      for (let index = 0; index < 7; index += 1) {
        const at = index < 3 ? tie : new Date(tie.getTime() - index * 60_000);
        expected.push(
          await response(
            formId,
            v1,
            at,
            index === 0
              ? {
                  respondentId: await user('RESPONDENT'),
                  startedAt: new Date(tie.getTime() - 125_000),
                }
              : {},
          ),
        );
        listed.push({ id: expected[index], at: at.getTime() });
      }
      await response(formId, v1, new Date(tie.getTime() + 1000), {
        status: 'REJECTED',
      });
      await response(formId, v1, new Date(tie.getTime() + 2000), {
        status: 'IN_PROGRESS',
      });
      const v2Row = await response(formId, v2, new Date(tie.getTime() + 3000));

      const service = new PublisherResultsService(forms, reads);
      const seen: string[] = [];
      let cursor: string | undefined;
      for (let guard = 0; guard < 10; guard += 1) {
        const page = publisherResponsesPageSchema.parse(
          await service.getResponsesPage(
            formId,
            { userId: publisherId },
            { versionNumber: 1, limit: 3, cursor },
          ),
        );
        if (page.availability !== 'AVAILABLE') throw new Error('expected rows');
        expect(page.totalCount).toBe(7);
        seen.push(...page.responses.map((row) => row.id));
        const timed = page.responses.find((row) => row.id === expected[0]);
        if (timed) expect(timed.durationSeconds).toBe(125);
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }
      // submitted_at DESC, id DESC (uuid order = lowercase hex order).
      const order = listed
        .sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1))
        .map((row) => row.id);
      expect(seen).toEqual(order);
      const latest = await service.getResponsesPage(
        formId,
        { userId: publisherId },
        { limit: 50 },
      );
      expect(
        latest.availability === 'AVAILABLE' &&
          latest.responses.map((row) => row.id),
      ).toEqual([v2Row]);
      expect(
        (await reads.versionIdsWithListedResponses(formId)).sort(),
      ).toEqual([v1, v2].sort());
    },
  );

  liveIt(
    'page, count and version reads use the partial indexes even under a generic (parameterized) plan',
    async () => {
      // Literal statuses in the SQL keep the partial-index predicate provable
      // when only the ids/instants are bind parameters.
      const plans = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
        await tx.$executeRawUnsafe(
          'SET LOCAL plan_cache_mode = force_generic_plan',
        );
        const explain = async (name: string, sql: string, args: string) => {
          await tx.$executeRawUnsafe(`PREPARE ${name} AS ${sql}`);
          const rows = await tx.$queryRawUnsafe<
            Array<{ 'QUERY PLAN': string }>
          >(`EXPLAIN EXECUTE ${name}(${args})`);
          await tx.$executeRawUnsafe(`DEALLOCATE ${name}`);
          return rows.map((row) => row['QUERY PLAN']).join('\n');
        };
        const version = `'${randomUUID()}'`;
        return {
          page: await explain(
            'ir4a_page',
            `SELECT r.id FROM responses r
             WHERE r.form_version_id = $1::uuid
               AND r.status IN ('SUBMITTED', 'VALIDATED')
               AND r.submitted_at IS NOT NULL
               AND (r.submitted_at, r.id) < ($2::timestamp, $3::uuid)
             ORDER BY r.submitted_at DESC, r.id DESC LIMIT 101`,
            `${version}, '2026-09-20T00:00:00', '${randomUUID()}'`,
          ),
          count: await explain(
            'ir4a_count',
            `SELECT COUNT(*) FROM responses r
             WHERE r.form_version_id = $1::uuid
               AND r.status IN ('SUBMITTED', 'VALIDATED')
               AND r.submitted_at IS NOT NULL`,
            version,
          ),
          versions: await explain(
            'ir4a_versions',
            `SELECT DISTINCT r.form_version_id FROM responses r
             WHERE r.form_id = $1::uuid
               AND r.status IN ('SUBMITTED', 'VALIDATED')
               AND r.submitted_at IS NOT NULL`,
            `'${randomUUID()}'`,
          ),
        };
      });
      console.log(
        `[IR.4a] generic plans:\n${Object.entries(plans)
          .map(([name, plan]) => `${name}:\n${plan}`)
          .join('\n')}`,
      );
      expect(plans.page).toContain('responses_version_completed_feed_idx');
      expect(plans.count).toContain('responses_version_completed_feed_idx');
      expect(plans.versions).toContain(
        'responses_form_completed_submitted_idx',
      );
    },
  );

  liveIt(
    'timings at 2 000 and 5 000 responses (NFR-1 evidence) and the analytics cap',
    async () => {
      const publisherId = await user('PUBLISHER');
      const { formId, versionIds } = await form(publisherId, 'INTERNAL');
      const ledger = new LedgerService(new PrismaLedgerRepository(prisma));
      const progressReads = new PublisherFormReadsService(
        forms,
        new FormsEscrowCoordinator(forms, ledger),
      );
      const results = new PublisherResultsService(forms, reads);
      const insert = async (count: number, offset: number) => {
        const rows = Array.from({ length: count }, (_, index) => ({
          id: randomUUID(),
          formId,
          formVersionId: versionIds[0],
          status: 'VALIDATED' as const,
          answersJson: {
            'q-name': `Người ${offset + index}`,
            'q-rate': (index % 5) + 1,
          },
          ipAddress: '203.0.113.1',
          isGuest: true,
          submittedAt: new Date(Date.now() - (offset + index) * 60_000),
        }));
        for (let start = 0; start < rows.length; start += 1000) {
          await prisma.response.createMany({
            data: rows.slice(start, start + 1000),
          });
        }
      };
      const timed = async <T>(fn: () => Promise<T>) => {
        const started = performance.now();
        const value = await fn();
        return { value, ms: Math.round(performance.now() - started) };
      };
      const owner = { userId: publisherId };
      const report: string[] = [];
      for (const [target, add] of [
        [2000, 2000],
        [5000, 3000],
      ] as const) {
        await insert(add, target - add);
        await prisma.$executeRawUnsafe('ANALYZE responses');
        const progress = await timed(() =>
          progressReads.getProgress(formId, owner, 'month'),
        );
        publisherProgressSchema.parse(progress.value);
        const page = await timed(() =>
          results.getResponsesPage(formId, owner, { limit: 100 }),
        );
        const analytics = await timed(() =>
          results.getAnalytics(formId, owner, {}),
        );
        const parsed = publisherAnalyticsSchema.parse(analytics.value);
        expect(
          parsed.availability === 'AVAILABLE' && parsed.totalResponses,
        ).toBe(target);
        report.push(
          `${target} responses: progress(month) ${progress.ms} ms, responses page(100) ${page.ms} ms, analytics ${analytics.ms} ms`,
        );
      }
      console.log(
        `[IR.4a] timings (local Docker Postgres):\n${report.join('\n')}`,
      );

      await insert(1, 5000);
      await expect(
        results.getAnalytics(formId, owner, {}),
      ).rejects.toBeInstanceOf(PublisherAnalyticsLimitExceededException);
    },
    180_000,
  );
});
