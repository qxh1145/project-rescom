import { adminOverviewSchema, adminQueueCountsSchema } from '@rescom/schemas';
import {
  AdminOverviewService,
  shortReferenceOf,
  UNTITLED_SURVEY,
} from './admin-overview.service';
import { InMemoryFormAdminReads } from '../../forms/infrastructure/in-memory-form-admin-reads';
import { InMemoryAdminEconomyStats } from '../../economy/infrastructure/in-memory-admin-economy-stats';
import { InMemoryFraudLogReader } from '../../participation/infrastructure/in-memory-fraud-log-reader';
import { InMemoryMissingCodeReportStats } from '../../participation/infrastructure/in-memory-missing-code-report-stats';
import { AdminUserLabel } from '../../users/application/ports/admin-user-directory.port';
import { FixedClock } from '../../../common/time/clock';

const NOW = new Date('2026-10-01T10:00:00.000Z');
const DAY = 86_400_000;
const PUBLISHER = '11111111-1111-4111-8111-111111111111';
const REQUESTER = '22222222-2222-4222-8222-222222222222';
const OFFENDER = '7f3a0c52-8d14-4e6b-9a21-3c5d7e9f1b01';
const OTHER = 'a9016d3e-5f72-4a84-b196-2e3f4a5b6c07';

describe('AdminOverviewService', () => {
  let forms: InMemoryFormAdminReads;
  let economy: InMemoryAdminEconomyStats;
  let fraud: InMemoryFraudLogReader;
  let missingCodes: InMemoryMissingCodeReportStats;
  let labels: Map<string, AdminUserLabel>;
  let labelQueries: number;
  let service: AdminOverviewService;

  beforeEach(() => {
    forms = new InMemoryFormAdminReads();
    economy = new InMemoryAdminEconomyStats();
    fraud = new InMemoryFraudLogReader();
    missingCodes = new InMemoryMissingCodeReportStats();
    labels = new Map([
      [PUBLISHER, { email: 'pub@fpt.edu.vn', displayName: null }],
      [REQUESTER, { email: 'req@fpt.edu.vn', displayName: null }],
    ]);
    labelQueries = 0;
    service = new AdminOverviewService({
      queueStats: forms,
      economyStats: economy,
      fraudLogs: fraud,
      missingCodeReports: missingCodes,
      directory: {
        findLabels: async (ids: readonly string[]) => {
          labelQueries += 1;
          return new Map(
            ids
              .filter((id) => labels.has(id))
              .map((id) => [id, labels.get(id)!] as const),
          );
        },
      },
      clock: new FixedClock(NOW),
    });
  });

  it('answers zeros, an empty to-do list and no flagged account when every queue is empty', async () => {
    const overview = await service.getOverview();
    expect(adminOverviewSchema.parse(overview)).toEqual({
      pendingSurveys: { count: 0 },
      pendingTopUps: { count: 0, points: 0, amountVnd: 0 },
      openIssues: { disputes: 0, missingCodeReports: 0 },
      escrow: { points: 0, runningSurveys: 0 },
      todo: [],
      flaggedAccounts: [],
    });
    expect(labelQueries).toBe(0);
  });

  it('builds the oldest item of each queue with moreCount and the label fallbacks', async () => {
    forms.seed(
      {
        id: '33333333-3333-4333-8333-333333333333',
        title: 'Newer',
        type: 'INTERNAL',
        status: 'MODERATION_QUEUE',
        publisherId: REQUESTER,
        updatedAt: new Date(NOW.getTime() - 1_000),
      },
      {
        id: '44444444-4444-4444-8444-444444444444',
        title: 'Oldest',
        type: 'EXTERNAL',
        status: 'MODERATION_QUEUE',
        publisherId: PUBLISHER,
        updatedAt: new Date(NOW.getTime() - 60_000),
      },
      {
        id: '55555555-5555-4555-8555-555555555555',
        title: 'Running',
        type: 'INTERNAL',
        status: 'PUBLISHED',
        publisherId: PUBLISHER,
        updatedAt: NOW,
      },
    );
    economy.pendingTopUps = [
      {
        id: '66666666-6666-4666-8666-666666666666',
        userId: REQUESTER,
        amount: 100,
        amountVnd: 20_000,
        transferReference: 'RESCOMAAAA',
        createdAt: new Date(NOW.getTime() - DAY),
      },
      {
        id: '77777777-7777-4777-8777-777777777777',
        userId: PUBLISHER,
        amount: 50,
        amountVnd: 10_000,
        transferReference: 'RESCOMBBBB',
        createdAt: NOW,
      },
    ];
    economy.balances = { escrow: 300, pending: 12 };
    labels.set(REQUESTER, { email: 'req@fpt.edu.vn', displayName: 'Linh' });
    missingCodes.unresolved = 2;

    const overview = adminOverviewSchema.parse(await service.getOverview());

    expect(overview.pendingSurveys).toEqual({ count: 2 });
    expect(overview.pendingTopUps).toEqual({
      count: 2,
      points: 150,
      amountVnd: 30_000,
    });
    expect(overview.escrow).toEqual({ points: 300, runningSurveys: 1 });
    // Unresolved missing-code reports are real; disputes stay 0 (decision Q1).
    expect(overview.openIssues).toEqual({ disputes: 0, missingCodeReports: 2 });
    expect(overview.todo).toEqual([
      {
        kind: 'SURVEY_REVIEW',
        id: '44444444-4444-4444-8444-444444444444',
        createdAt: new Date(NOW.getTime() - 60_000).toISOString(),
        moreCount: 1,
        priority: false,
        surveyTitle: 'Oldest',
        // No display name: the e-mail.
        publisherName: 'pub@fpt.edu.vn',
        surveyType: 'EXTERNAL',
      },
      {
        kind: 'TOP_UP',
        id: '66666666-6666-4666-8666-666666666666',
        createdAt: new Date(NOW.getTime() - DAY).toISOString(),
        moreCount: 1,
        priority: false,
        points: 100,
        amountVnd: 20_000,
        requesterName: 'Linh',
        transferReference: 'RESCOMAAAA',
      },
    ]);
  });

  it('flags the accounts with FraudLog entries in the last 14 days', async () => {
    const at = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * DAY);
    fraud.rows = [
      {
        id: 'a1',
        userId: OFFENDER,
        type: 'TIME_BARRIER',
        details: null,
        createdAt: at(1),
      },
      {
        id: 'a2',
        userId: OFFENDER,
        type: 'SECURITY_VIOLATION',
        details: { action: 'COMPLETION_CODE_VERIFICATION_FAILED' },
        createdAt: at(2),
      },
      {
        id: 'a3',
        userId: OFFENDER,
        type: 'TIME_BARRIER',
        details: null,
        createdAt: at(3),
      },
      {
        id: 'b1',
        userId: OTHER,
        type: 'RATE_LIMIT',
        details: null,
        createdAt: at(2),
      },
      // Outside the window.
      {
        id: 'b2',
        userId: OTHER,
        type: 'RATE_LIMIT',
        details: null,
        createdAt: at(20),
      },
    ];

    const { flaggedAccounts } = await service.getOverview();

    expect(flaggedAccounts).toEqual([
      {
        userId: OFFENDER,
        reference: '7F3A',
        violationCount: 3,
        windowDays: 14,
        types: ['COMPLETION_CODE', 'TIME_BARRIER'],
        repeated: true,
      },
      {
        userId: OTHER,
        reference: 'A901',
        violationCount: 1,
        windowDays: 14,
        types: ['RATE_LIMIT'],
        repeated: false,
      },
    ]);
  });

  it('runs a fixed number of port calls whatever the data size', async () => {
    const seedQueue = (n: number) => {
      for (let i = 0; i < n; i += 1) {
        forms.seed({
          id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
          title: `Form ${i}`,
          type: 'INTERNAL',
          status: 'MODERATION_QUEUE',
          publisherId: PUBLISHER,
          updatedAt: new Date(NOW.getTime() - i * 1_000),
        });
      }
    };
    seedQueue(2);
    await service.getOverview();
    const queries = () =>
      forms.calls +
      economy.calls +
      fraud.calls +
      missingCodes.calls +
      labelQueries;
    const small = queries();
    // At most 8 queries (IR.4b AC C5): 7 aggregates and one label query.
    expect(small).toBeLessThanOrEqual(8);

    forms.clear();
    economy.clear();
    fraud.clear();
    missingCodes.calls = 0;
    labelQueries = 0;
    seedQueue(200);
    await service.getOverview();
    expect(queries()).toBe(small);
  });

  it('counts the real queues and answers 0 for the deferred ones', async () => {
    forms.seed({
      id: '44444444-4444-4444-8444-444444444444',
      title: 'Queued',
      type: 'INTERNAL',
      status: 'MODERATION_QUEUE',
      publisherId: PUBLISHER,
      updatedAt: NOW,
    });
    economy.pendingTopUps = [
      {
        id: '66666666-6666-4666-8666-666666666666',
        userId: REQUESTER,
        amount: 100,
        amountVnd: 20_000,
        transferReference: 'RESCOMAAAA',
        createdAt: NOW,
      },
    ];

    expect(
      adminQueueCountsSchema.parse(await service.getQueueCounts()),
    ).toEqual({
      surveys: 1,
      topUps: 1,
      disputes: 0,
      quality: 0,
    });
  });

  it('shows a blank survey title as untitled', async () => {
    forms.seed({
      id: '44444444-4444-4444-8444-444444444444',
      title: '   ',
      type: 'INTERNAL',
      status: 'MODERATION_QUEUE',
      publisherId: PUBLISHER,
      updatedAt: NOW,
    });
    const overview = adminOverviewSchema.parse(await service.getOverview());
    expect(overview.todo[0]).toMatchObject({ surveyTitle: UNTITLED_SURVEY });
  });

  it('labels an unknown user with its short code', async () => {
    labels.clear();
    economy.pendingTopUps = [
      {
        id: '66666666-6666-4666-8666-666666666666',
        userId: REQUESTER,
        amount: 100,
        amountVnd: 20_000,
        transferReference: 'RESCOMAAAA',
        createdAt: NOW,
      },
    ];
    const [item] = (await service.getOverview()).todo;
    expect(item).toMatchObject({ kind: 'TOP_UP', requesterName: '#2222' });
    expect(shortReferenceOf(OFFENDER)).toBe('7F3A');
  });
});
