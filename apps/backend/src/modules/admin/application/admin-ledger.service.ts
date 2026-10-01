import {
  ADMIN_LEDGER_FILTER_KEY_PREFIXES,
  AdminJournal,
  AdminJournalList,
  AdminLedgerSummary,
  ListAdminJournalsQuery,
  parseKeysetCursor,
  vietnamStartOfDay,
} from '@rescom/schemas';
import type {
  AdminEconomyStatsPort,
  AdminJournalKeyFilter,
  AdminJournalRecord,
} from '../../economy/application/ports/admin-economy-stats.port';
import type { FormTitleLookupPort } from '../../forms/application/ports/form-title-lookup.port';
import type { UserProfileRepositoryPort } from '../../users/application/ports/user-profile.repository.port';
import type { Clock } from '../../../common/time/clock';

export interface AdminLedgerDependencies {
  economyStats: AdminEconomyStatsPort;
  formTitles: FormTitleLookupPort;
  profiles: Pick<UserProfileRepositoryPort, 'findDisplayLabels'>;
  /** The shared `CLOCK`; the system time when absent. */
  clock?: Clock;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The uuid right after `prefix` in `key` (`close-refund:{formId}:c1`), else null. */
function idAfter(key: string, prefix: string): string | null {
  if (!key.startsWith(prefix)) return null;
  const candidate = key.slice(prefix.length).split(':')[0];
  return UUID.test(candidate) ? candidate.toLowerCase() : null;
}

/** Form named by an escrow key: refund / reopen keys carry the form id. */
function formIdOf(key: string): string | null {
  return idAfter(key, 'close-refund:') ?? idAfter(key, 'reopen-escrow:');
}

/** Publish keys carry the published form version id. */
function formVersionIdOf(key: string): string | null {
  return idAfter(key, 'publish:');
}

function filterOf(
  type: ListAdminJournalsQuery['type'],
): AdminJournalKeyFilter | null {
  if (!type || type === 'all') return null;
  return {
    keyPrefixes: ADMIN_LEDGER_FILTER_KEY_PREFIXES[type],
    includeReversals: type === 'refund',
  };
}

/**
 * Admin ledger view (mock-off plan 4.3): journals and the summary cards read
 * through the Economy-owned port; survey titles through Forms and owner
 * display names through Identity (AD-16). A journal page costs three bounded
 * queries (journals with entries, titles, display names).
 */
export class AdminLedgerService {
  private readonly now: () => Date;

  constructor(private readonly deps: AdminLedgerDependencies) {
    this.now = () => deps.clock?.now() ?? new Date();
  }

  async listJournals(query: ListAdminJournalsQuery): Promise<AdminJournalList> {
    const cursor = query.before ? parseKeysetCursor(query.before) : null;
    const rows = await this.deps.economyStats.listJournals({
      filter: filterOf(query.type),
      from: query.from ? new Date(query.from) : null,
      to: query.to ? new Date(query.to) : null,
      before: cursor
        ? { createdAt: new Date(cursor.createdAt), id: cursor.id }
        : null,
      limit: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    return {
      items: await this.toJournals(page),
      limit: query.limit,
      hasMore: rows.length > query.limit,
    };
  }

  async getSummary(): Promise<AdminLedgerSummary> {
    const [pendingTopUps, balances, refunds] = await Promise.all([
      this.deps.economyStats.pendingTopUpSummary(),
      this.deps.economyStats.balanceTotals(),
      this.deps.economyStats.escrowRefundsSince(vietnamStartOfDay(this.now())),
    ]);
    return {
      pendingTopUps,
      escrowTotal: balances.escrow,
      pendingTotal: balances.pending,
      refundedToday: refunds,
    };
  }

  private async toJournals(
    rows: readonly AdminJournalRecord[],
  ): Promise<AdminJournal[]> {
    const formIds = rows
      .map((row) => formIdOf(row.idempotencyKey))
      .filter((id): id is string => id !== null);
    const formVersionIds = rows
      .map((row) => formVersionIdOf(row.idempotencyKey))
      .filter((id): id is string => id !== null);
    const ownerIds = [
      ...new Set(
        rows.flatMap((row) =>
          row.entries
            .map((entry) => entry.ownerUserId)
            .filter((id): id is string => id !== null),
        ),
      ),
    ];

    const [titles, names] = await Promise.all([
      formIds.length + formVersionIds.length > 0
        ? this.deps.formTitles.findTitles({ formIds, formVersionIds })
        : Promise.resolve({ byFormId: new Map(), byFormVersionId: new Map() }),
      ownerIds.length > 0
        ? this.deps.profiles.findDisplayLabels(ownerIds)
        : Promise.resolve(new Map<string, string | null>()),
    ]);

    return rows.map((row) => {
      const formId = formIdOf(row.idempotencyKey);
      const formVersionId = formVersionIdOf(row.idempotencyKey);
      const related =
        (formId ? titles.byFormId.get(formId) : undefined) ??
        (formVersionId
          ? titles.byFormVersionId.get(formVersionId)?.title
          : undefined) ??
        null;
      return {
        id: row.id,
        idempotencyKey: row.idempotencyKey,
        description: row.description,
        reversesJournalId: row.reversesJournalId,
        createdAt: row.createdAt.toISOString(),
        entries: row.entries.map((entry) => ({
          id: entry.id,
          journalId: row.id,
          accountId: entry.accountId,
          amount: entry.amount,
          createdAt: entry.createdAt.toISOString(),
          accountClass: entry.accountClass,
          ownerName: entry.ownerUserId
            ? names.get(entry.ownerUserId)?.trim() || null
            : null,
        })),
        related: related || null,
        attemptId: idAfter(row.idempotencyKey, 'external-completion:'),
      };
    });
  }
}
