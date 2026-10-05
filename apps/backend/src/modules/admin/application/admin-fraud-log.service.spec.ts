import { fraudLogPageSchema, listFraudLogQuerySchema } from '@rescom/schemas';
import { AdminFraudLogService } from './admin-fraud-log.service';
import { InMemoryFraudLogReader } from '../../participation/infrastructure/in-memory-fraud-log-reader';
import { InMemoryFormAdminReads } from '../../forms/infrastructure/in-memory-form-admin-reads';
import { AdminUserDirectoryPort } from '../../users/application/ports/admin-user-directory.port';
import { FixedClock } from '../../../common/time/clock';

const NOW = new Date('2026-10-01T10:00:00.000Z');
const DAY = 86_400_000;
const KHANG = '7f3a0c52-8d14-4e6b-9a21-3c5d7e9f1b01';
const QUAN = 'a9016d3e-5f72-4a84-b196-2e3f4a5b6c07';
const FORM = '5a0c1f7e-2b4d-4c6a-8e1f-0a1b2c3d4e71';
const VERSION = '5a0c1f7e-2b4d-4c6a-8e1f-0a1b2c3d4e72';
const OTHER_FORM = '5a0c1f7e-2b4d-4c6a-8e1f-0a1b2c3d4e73';

const at = (daysAgo: number, minutes = 0) =>
  new Date(NOW.getTime() - daysAgo * DAY - minutes * 60_000);
const rowId = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const query = (input: Record<string, string> = {}) =>
  listFraudLogQuerySchema.parse(input);

describe('AdminFraudLogService', () => {
  let reader: InMemoryFraudLogReader;
  let forms: InMemoryFormAdminReads;
  let searches: string[];
  let service: AdminFraudLogService;

  beforeEach(() => {
    reader = new InMemoryFraudLogReader();
    forms = new InMemoryFormAdminReads();
    forms.seed(
      {
        id: FORM,
        title: 'Thói quen đọc sách',
        type: 'INTERNAL',
        status: 'PUBLISHED',
        publisherId: QUAN,
        updatedAt: NOW,
        versionIds: [VERSION],
      },
      {
        id: OTHER_FORM,
        title: 'Nhà trọ',
        type: 'EXTERNAL',
        status: 'PUBLISHED',
        publisherId: QUAN,
        updatedAt: NOW,
      },
    );
    searches = [];
    const directory: AdminUserDirectoryPort = {
      findStatuses: async (ids) =>
        new Map(ids.map((id) => [id, id === QUAN ? 'LOCKED' : 'ACTIVE'])),
      findLabels: async () => new Map(),
      filterMatching: async (term, ids) => {
        searches.push(term);
        return term.includes('7f3a') ? ids.filter((id) => id === KHANG) : [];
      },
    };
    reader.rows = [
      {
        id: rowId(1),
        userId: KHANG,
        type: 'TIME_BARRIER',
        details: { formId: FORM, elapsedSeconds: 40, requiredSeconds: 120 },
        createdAt: at(1),
      },
      {
        id: rowId(2),
        userId: KHANG,
        type: 'SECURITY_VIOLATION',
        details: {
          action: 'COMPLETION_CODE_VERIFICATION_FAILED',
          formVersionId: VERSION,
          failureCount: 3,
          isLocked: true,
        },
        createdAt: at(2),
      },
      {
        id: rowId(3),
        userId: KHANG,
        type: 'RATE_LIMIT',
        details: { attemptId: rowId(99) },
        createdAt: at(3),
        attemptSurveyId: OTHER_FORM,
      },
      {
        id: rowId(4),
        userId: QUAN,
        type: 'RATE_LIMIT',
        details: null,
        createdAt: at(20),
      },
    ];
    service = new AdminFraudLogService({
      fraudLogs: reader,
      formTitles: forms,
      directory,
      clock: new FixedClock(NOW),
    });
  });

  it('lists every entry newest first with the survey of its evidence and the account summary', async () => {
    const page = fraudLogPageSchema.parse(await service.list(query()));

    expect(page.items.map((item) => item.id)).toEqual([
      rowId(1),
      rowId(2),
      rowId(3),
      rowId(4),
    ]);
    expect(page.items.map((item) => item.survey)).toEqual([
      { id: FORM, title: 'Thói quen đọc sách' },
      { id: FORM, title: 'Thói quen đọc sách' },
      { id: OTHER_FORM, title: 'Nhà trọ' },
      null,
    ]);
    expect(page.items[1].details).toMatchObject({ failureCount: 3 });
    expect(page.total).toBe(4);
    expect(page.totalCapped).toBe(false);
    expect(page.truncated).toBe(false);
    expect(page.windowDays).toBeNull();
    expect(page.nextCursor).toBeNull();
    expect(page.accounts).toEqual([
      { userId: KHANG, count: 3, repeated: true, status: 'ACTIVE' },
      // One entry, 20 days old: not a repeat offender.
      { userId: QUAN, count: 1, repeated: false, status: 'LOCKED' },
    ]);
  });

  it('filters by window and displayed kind', async () => {
    const recent = await service.list(query({ days: '7' }));
    expect(recent.windowDays).toBe(7);
    expect(recent.total).toBe(3);
    expect(recent.accounts.map((account) => account.userId)).toEqual([KHANG]);

    const wrongCodes = await service.list(query({ type: 'COMPLETION_CODE' }));
    expect(wrongCodes.items.map((item) => item.id)).toEqual([rowId(2)]);

    const security = await service.list(query({ type: 'SECURITY_VIOLATION' }));
    expect(security.items).toEqual([]);
  });

  it('answers an empty page for COMPLAINT_UPHELD without reading', async () => {
    const page = await service.list(query({ type: 'COMPLAINT_UPHELD' }));
    expect(page).toEqual({
      items: [],
      total: 0,
      totalCapped: false,
      truncated: false,
      windowDays: null,
      accounts: [],
      nextCursor: null,
    });
    expect(reader.calls).toBe(0);
  });

  it('resolves a search among the accounts with entries; no match reads no page', async () => {
    const found = await service.list(query({ search: '#7f3a' }));
    expect(found.items.map((item) => item.id)).toEqual([
      rowId(1),
      rowId(2),
      rowId(3),
    ]);
    expect(found.truncated).toBe(false);

    reader.calls = 0;
    const none = await service.list(query({ search: 'nobody' }));
    expect(none.items).toEqual([]);
    expect(none.total).toBe(0);
    // Only the candidate accounts were read.
    expect(reader.calls).toBe(1);
    expect(searches).toEqual(['#7f3a', 'nobody']);
  });

  it('prefers userId over search', async () => {
    const page = await service.list(query({ userId: QUAN, search: '7f3a' }));
    expect(page.items.map((item) => item.userId)).toEqual([QUAN]);
    expect(searches).toEqual([]);
  });

  it('pages with a keyset cursor without repeating or skipping rows', async () => {
    const first = await service.list(query({ limit: '2' }));
    expect(first.items.map((item) => item.id)).toEqual([rowId(1), rowId(2)]);
    expect(first.nextCursor).toBe(`${at(2).toISOString()}:${rowId(2)}`);

    // A row written between the two requests does not shift the next page.
    reader.rows.push({
      id: rowId(5),
      userId: KHANG,
      type: 'TIME_BARRIER',
      details: null,
      createdAt: NOW,
    });
    const second = await service.list(
      query({ limit: '2', cursor: first.nextCursor! }),
    );
    expect(second.items.map((item) => item.id)).toEqual([rowId(3), rowId(4)]);
    expect(second.nextCursor).toBeNull();
  });

  it('flags the bounds instead of dropping rows silently', async () => {
    // 1 001 accounts with one recent entry each: more than the 100 accounts
    // summarized and the 1 000 accounts a search checks.
    reader.rows = Array.from({ length: 1_001 }, (_, n) => ({
      id: rowId(1_000 + n),
      userId: `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
      type: 'RATE_LIMIT',
      details: null,
      createdAt: at(0, n),
    }));
    const all = await service.list(query());
    expect(all.accounts).toHaveLength(100);
    expect(all.total).toBe(1_001);
    expect(all.totalCapped).toBe(false);
    expect(all.truncated).toBe(true);

    const searched = await service.list(query({ search: 'nobody' }));
    expect(searched.items).toEqual([]);
    expect(searched.truncated).toBe(true);

    // More than 10 000 matching entries: total is a lower bound.
    reader.rows = Array.from({ length: 10_001 }, (_, n) => ({
      id: rowId(20_000 + n),
      userId: KHANG,
      type: 'TIME_BARRIER',
      details: null,
      createdAt: at(0, n),
    }));
    const capped = await service.list(query({ limit: '1' }));
    expect(capped.total).toBe(10_000);
    expect(capped.totalCapped).toBe(true);
    expect(capped.truncated).toBe(true);
    expect(capped.accounts).toEqual([
      { userId: KHANG, count: 10_000, repeated: true, status: 'ACTIVE' },
    ]);
  });
});
