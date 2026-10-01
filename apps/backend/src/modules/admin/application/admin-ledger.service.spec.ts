import {
  adminJournalListSchema,
  adminLedgerSummarySchema,
  listAdminJournalsQuerySchema,
} from '@rescom/schemas';
import { AdminLedgerService } from './admin-ledger.service';
import { InMemoryAdminEconomyStats } from '../../economy/infrastructure/in-memory-admin-economy-stats';
import { InMemoryFormAdminReads } from '../../forms/infrastructure/in-memory-form-admin-reads';
import { AdminJournalRecord } from '../../economy/application/ports/admin-economy-stats.port';
import { FixedClock } from '../../../common/time/clock';

const NOW = new Date('2026-09-26T18:30:00.000Z'); // 27/09 01:30 in Vietnam
const LINH = '11111111-1111-4111-8111-111111111111';
const FORM = '22222222-2222-4222-8222-222222222222';
const VERSION = '33333333-3333-4333-8333-333333333333';
const ATTEMPT = '7f3a9c2e-1d4b-4a6c-8e5f-0a1b2c3d4e5f';
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function journal(
  n: number,
  key: string,
  createdAt: Date,
  amount: number,
  options: { reverses?: string; owner?: string | null } = {},
): AdminJournalRecord {
  return {
    id: id(n),
    idempotencyKey: key,
    description: null,
    reversesJournalId: options.reverses ?? null,
    createdAt,
    entries: [
      {
        id: id(100 + n),
        accountId: id(200),
        amount: -amount,
        createdAt,
        accountClass: 'ESCROW',
        ownerUserId: options.owner === undefined ? LINH : options.owner,
      },
      {
        id: id(300 + n),
        accountId: id(201),
        amount,
        createdAt,
        accountClass: 'USER_AVAILABLE',
        ownerUserId: options.owner === undefined ? LINH : options.owner,
      },
    ],
  };
}

describe('AdminLedgerService', () => {
  let economy: InMemoryAdminEconomyStats;
  let forms: InMemoryFormAdminReads;
  let service: AdminLedgerService;
  const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

  beforeEach(() => {
    economy = new InMemoryAdminEconomyStats();
    forms = new InMemoryFormAdminReads();
    forms.seed({
      id: FORM,
      title: 'Hành vi tiêu dùng',
      type: 'INTERNAL',
      status: 'CLOSED',
      publisherId: LINH,
      updatedAt: NOW,
      versionIds: [VERSION],
    });
    economy.journals = [
      journal(1, `close-refund:${FORM}:c1`, minutesAgo(10), 120),
      journal(2, `publish:${VERSION}`, minutesAgo(20), 100),
      journal(3, `external-completion:${ATTEMPT}`, minutesAgo(30), 10, {
        owner: null,
      }),
      journal(4, `topup-approval:${id(9)}`, minutesAgo(40), 50),
      journal(5, `reversal:${id(4)}`, minutesAgo(50), 50, { reverses: id(4) }),
      journal(6, `starter-grant:${LINH}`, minutesAgo(60), 100),
      // Yesterday in Vietnam: not refunded "today".
      journal(7, `close-refund:${FORM}:c0`, minutesAgo(120), 30),
    ];
    economy.balances = { escrow: 400, pending: 18 };
    economy.pendingTopUps = [
      {
        id: id(9),
        userId: LINH,
        amount: 100,
        amountVnd: 20_000,
        transferReference: 'RESCOMAAAA',
        createdAt: NOW,
      },
    ];
    service = new AdminLedgerService({
      economyStats: economy,
      formTitles: forms,
      profiles: {
        findDisplayLabels: async (ids) =>
          new Map(
            ids.map((userId) => [
              userId,
              userId === LINH ? 'Nguyễn Thuỳ Linh' : null,
            ]),
          ),
      },
      clock: new FixedClock(NOW),
    });
  });

  it('maps journals with entry tiers, owner names, survey titles and the attempt', async () => {
    const list = adminJournalListSchema.parse(
      await service.listJournals(listAdminJournalsQuerySchema.parse({})),
    );
    expect(list.items.map((item) => item.id)).toEqual(
      [1, 2, 3, 4, 5, 6, 7].map(id),
    );
    expect(list.hasMore).toBe(false);
    expect(list.items[0]).toMatchObject({
      related: 'Hành vi tiêu dùng',
      attemptId: null,
    });
    expect(list.items[0].entries[1]).toEqual({
      id: id(301),
      journalId: id(1),
      accountId: id(201),
      amount: 120,
      createdAt: minutesAgo(10).toISOString(),
      accountClass: 'USER_AVAILABLE',
      ownerName: 'Nguyễn Thuỳ Linh',
    });
    expect(list.items[1].related).toBe('Hành vi tiêu dùng');
    expect(list.items[2]).toMatchObject({ related: null, attemptId: ATTEMPT });
    expect(list.items[2].entries[0].ownerName).toBeNull();
  });

  it('groups journals by key prefix; reversals are refunds only', async () => {
    const ids = async (type: string) =>
      (
        await service.listJournals(listAdminJournalsQuerySchema.parse({ type }))
      ).items.map((item) => item.id);

    expect(await ids('top-up')).toEqual([id(4)]);
    expect(await ids('escrow')).toEqual([id(2)]);
    expect(await ids('reward')).toEqual([id(3)]);
    expect(await ids('refund')).toEqual([id(1), id(5), id(7)]);
    expect(await ids('all')).toHaveLength(7);
  });

  it('pages with the before cursor and bounds by from/to', async () => {
    const first = await service.listJournals(
      listAdminJournalsQuerySchema.parse({ limit: '3' }),
    );
    expect(first.hasMore).toBe(true);
    const last = first.items[2];
    const second = await service.listJournals(
      listAdminJournalsQuerySchema.parse({
        limit: '3',
        before: `${last.createdAt}:${last.id}`,
      }),
    );
    expect(second.items.map((item) => item.id)).toEqual([id(4), id(5), id(6)]);

    const window = await service.listJournals(
      listAdminJournalsQuerySchema.parse({
        from: minutesAgo(35).toISOString(),
        to: minutesAgo(15).toISOString(),
      }),
    );
    expect(window.items.map((item) => item.id)).toEqual([id(2), id(3)]);
  });

  it('sums the cards: refunds since 00:00 Vietnam time, distinct surveys, reversals excluded', async () => {
    const otherForm = id(50);
    economy.journals.push(
      // A second refund of the same survey today: one survey, both amounts.
      journal(8, `close-refund:${FORM}:c2`, minutesAgo(15), 20),
      // A refund of another survey, reversed since: not counted.
      journal(9, `close-refund:${otherForm}:c1`, minutesAgo(5), 70),
      journal(10, `reversal:${id(9)}`, minutesAgo(4), 70, { reverses: id(9) }),
    );
    expect(adminLedgerSummarySchema.parse(await service.getSummary())).toEqual({
      pendingTopUps: { count: 1, points: 100, amountVnd: 20_000 },
      escrowTotal: 400,
      pendingTotal: 18,
      refundedToday: { points: 140, surveys: 1 },
    });
  });
});
