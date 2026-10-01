import {
  FRAUD_LOG_MAX_ACCOUNTS,
  FRAUD_LOG_MAX_SEARCH_CANDIDATES,
  FRAUD_LOG_SCAN_CAP,
  FRAUD_REPEAT_THRESHOLD,
  FRAUD_REPEAT_WINDOW_DAYS,
  FraudLogAccount,
  FraudLogEntry,
  FraudLogPage,
  ListFraudLogQuery,
  keysetCursorOf,
  parseKeysetCursor,
} from '@rescom/schemas';
import type {
  FraudLogReadFilter,
  FraudLogReadPort,
  FraudLogRecord,
} from '../../participation/application/ports/fraud-log-read.port';
import type { FormTitleLookupPort } from '../../forms/application/ports/form-title-lookup.port';
import type { AdminUserDirectoryPort } from '../../users/application/ports/admin-user-directory.port';
import type { Clock } from '../../../common/time/clock';

const DAY_MS = 86_400_000;

export interface AdminFraudLogDependencies {
  fraudLogs: FraudLogReadPort;
  formTitles: FormTitleLookupPort;
  directory: Pick<AdminUserDirectoryPort, 'findStatuses' | 'filterMatching'>;
  /** The shared `CLOCK`; the system time when absent. */
  clock?: Clock;
}

function detailsOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Admin · FraudLog (mock-off plan 4.2): read only view of the append-only
 * `fraud_logs` evidence, owned by Participation and read through its port.
 *
 * - `userId` takes precedence over `search`. A search starts from the
 *   evidence (AD-16): Participation returns the accounts with matching
 *   entries (at most `FRAUD_LOG_MAX_SEARCH_CANDIDATES`, latest entry first),
 *   then Identity keeps those whose short code, display name or e-mail match;
 * - `days` bounds `createdAt`; `type` is a displayed kind (`COMPLETION_CODE`
 *   for a wrong completion code). `COMPLAINT_UPHELD` belongs to the deferred
 *   disputes: no backend row has it, so it reads as an empty page;
 * - `total` and `accounts` aggregate at most the newest `FRAUD_LOG_SCAN_CAP`
 *   matching entries, so an all-time filter never scans the whole table;
 *   `totalCapped` says `total` is a lower bound;
 * - `accounts`: most entries first (ties by id), at most
 *   `FRAUD_LOG_MAX_ACCOUNTS`; `repeated` counts every entry of the last 14
 *   days, whatever the filter;
 * - `truncated`: one of the bounds above cut the result. Nothing is dropped
 *   silently.
 */
export class AdminFraudLogService {
  private readonly now: () => Date;

  constructor(private readonly deps: AdminFraudLogDependencies) {
    this.now = () => deps.clock?.now() ?? new Date();
  }

  async list(query: ListFraudLogQuery): Promise<FraudLogPage> {
    const windowDays = query.days ?? null;
    const empty = (truncated = false): FraudLogPage => ({
      items: [],
      total: 0,
      totalCapped: false,
      truncated,
      windowDays,
      accounts: [],
      nextCursor: null,
    });
    if (query.type === 'COMPLAINT_UPHELD') return empty();

    const now = this.now().getTime();
    const base: FraudLogReadFilter = {
      since: windowDays ? new Date(now - windowDays * DAY_MS) : undefined,
      kind: query.type,
    };

    let userIds: string[] | undefined;
    let searchTruncated = false;
    if (query.userId) {
      userIds = [query.userId];
    } else if (query.search) {
      const candidates = await this.deps.fraudLogs.candidateUserIds(
        base,
        FRAUD_LOG_MAX_SEARCH_CANDIDATES + 1,
        FRAUD_LOG_SCAN_CAP + 1,
      );
      searchTruncated = candidates.length > FRAUD_LOG_MAX_SEARCH_CANDIDATES;
      userIds = await this.deps.directory.filterMatching(
        query.search,
        candidates.slice(0, FRAUD_LOG_MAX_SEARCH_CANDIDATES),
      );
      if (userIds.length === 0) return empty(searchTruncated);
    }

    const filter: FraudLogReadFilter = { ...base, userIds };
    const before = query.cursor ? parseKeysetCursor(query.cursor) : null;

    const [rows, counted, accountCounts] = await Promise.all([
      this.deps.fraudLogs.list(filter, before, query.limit + 1),
      this.deps.fraudLogs.countCapped(filter, FRAUD_LOG_SCAN_CAP + 1),
      this.deps.fraudLogs.countByAccount(
        filter,
        FRAUD_LOG_MAX_ACCOUNTS + 1,
        FRAUD_LOG_SCAN_CAP,
      ),
    ]);
    const page = rows.slice(0, query.limit);
    const last = page[page.length - 1];
    const totalCapped = counted > FRAUD_LOG_SCAN_CAP;
    const accounts = accountCounts.slice(0, FRAUD_LOG_MAX_ACCOUNTS);

    const accountIds = accounts.map((account) => account.userId);
    const [recent, statuses, items] = await Promise.all([
      accountIds.length > 0
        ? this.deps.fraudLogs.countByAccount(
            {
              userIds: accountIds,
              since: new Date(now - FRAUD_REPEAT_WINDOW_DAYS * DAY_MS),
            },
            accountIds.length,
            FRAUD_LOG_SCAN_CAP,
          )
        : Promise.resolve([]),
      this.deps.directory.findStatuses(accountIds),
      this.toEntries(page),
    ]);
    const recentCount = new Map(
      recent.map((account) => [account.userId, account.count]),
    );

    return {
      items,
      total: Math.min(counted, FRAUD_LOG_SCAN_CAP),
      totalCapped,
      truncated:
        searchTruncated ||
        totalCapped ||
        accountCounts.length > FRAUD_LOG_MAX_ACCOUNTS,
      windowDays,
      accounts: accounts.map((account): FraudLogAccount => ({
        userId: account.userId,
        count: account.count,
        repeated:
          (recentCount.get(account.userId) ?? 0) >= FRAUD_REPEAT_THRESHOLD,
        status: statuses.get(account.userId) ?? 'ACTIVE',
      })),
      nextCursor:
        rows.length > query.limit && last ? keysetCursorOf(last) : null,
    };
  }

  /** Rows → entries, with the survey title looked up once for the page. */
  private async toEntries(
    rows: readonly FraudLogRecord[],
  ): Promise<FraudLogEntry[]> {
    const formIds = rows
      .map((row) => row.surveyId)
      .filter((id): id is string => Boolean(id));
    const formVersionIds = rows
      .map((row) => row.formVersionId)
      .filter((id): id is string => Boolean(id));
    const titles =
      formIds.length + formVersionIds.length > 0
        ? await this.deps.formTitles.findTitles({ formIds, formVersionIds })
        : { byFormId: new Map(), byFormVersionId: new Map() };

    return rows.map((row) => {
      let survey: FraudLogEntry['survey'] = null;
      if (row.surveyId && titles.byFormId.has(row.surveyId)) {
        survey = {
          id: row.surveyId,
          title: titles.byFormId.get(row.surveyId)!,
        };
      } else if (row.formVersionId) {
        const version = titles.byFormVersionId.get(row.formVersionId);
        if (version) survey = { id: version.formId, title: version.title };
      }
      return {
        id: row.id,
        userId: row.userId,
        type: row.type,
        survey,
        details: detailsOf(row.details),
        createdAt: row.createdAt,
      };
    });
  }
}
