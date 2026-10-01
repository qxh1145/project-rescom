import { ESCROW_REFUND_KEY_PREFIX } from '@rescom/schemas';
import {
  AdminEconomyStatsPort,
  AdminJournalListParams,
  AdminJournalRecord,
  PendingTopUpRecord,
  PendingTopUpSummary,
} from '../application/ports/admin-economy-stats.port';

/** Test double of `PrismaAdminEconomyStats` over seeded rows. */
export class InMemoryAdminEconomyStats implements AdminEconomyStatsPort {
  pendingTopUps: PendingTopUpRecord[] = [];
  balances = { escrow: 0, pending: 0 };
  journals: AdminJournalRecord[] = [];
  calls = 0;

  clear(): void {
    this.pendingTopUps = [];
    this.balances = { escrow: 0, pending: 0 };
    this.journals = [];
    this.calls = 0;
  }

  async pendingTopUpSummary(): Promise<PendingTopUpSummary> {
    this.calls += 1;
    return {
      count: this.pendingTopUps.length,
      points: this.pendingTopUps.reduce((sum, row) => sum + row.amount, 0),
      amountVnd: this.pendingTopUps.reduce(
        (sum, row) => sum + row.amountVnd,
        0,
      ),
    };
  }

  async oldestPendingTopUp(): Promise<PendingTopUpRecord | null> {
    this.calls += 1;
    return (
      [...this.pendingTopUps].sort(
        (a, b) =>
          a.createdAt.getTime() - b.createdAt.getTime() ||
          a.id.localeCompare(b.id),
      )[0] ?? null
    );
  }

  async balanceTotals(): Promise<{ escrow: number; pending: number }> {
    this.calls += 1;
    return { ...this.balances };
  }

  async escrowRefundsSince(
    since: Date,
  ): Promise<{ points: number; surveys: number }> {
    this.calls += 1;
    const reversed = new Set(
      this.journals
        .map((journal) => journal.reversesJournalId)
        .filter((id): id is string => id !== null),
    );
    const refunds = this.journals.filter(
      (journal) =>
        journal.idempotencyKey.startsWith(ESCROW_REFUND_KEY_PREFIX) &&
        journal.reversesJournalId === null &&
        !reversed.has(journal.id) &&
        journal.createdAt >= since,
    );
    return {
      points: refunds.reduce(
        (sum, journal) =>
          sum +
          journal.entries.reduce(
            (total, entry) => total + Math.max(0, entry.amount),
            0,
          ),
        0,
      ),
      surveys: new Set(
        refunds.map((journal) => journal.idempotencyKey.split(':')[1]),
      ).size,
    };
  }

  async listJournals(
    params: AdminJournalListParams,
  ): Promise<AdminJournalRecord[]> {
    this.calls += 1;
    const { filter, from, to, before } = params;
    return this.journals
      .filter((journal) => {
        if (from && journal.createdAt < from) return false;
        if (to && journal.createdAt > to) return false;
        if (
          before &&
          !(
            journal.createdAt < before.createdAt ||
            (journal.createdAt.getTime() === before.createdAt.getTime() &&
              journal.id < before.id)
          )
        ) {
          return false;
        }
        if (!filter) return true;
        if (journal.reversesJournalId !== null) return filter.includeReversals;
        return filter.keyPrefixes.some((prefix) =>
          journal.idempotencyKey.startsWith(prefix),
        );
      })
      .sort(
        (a, b) =>
          b.createdAt.getTime() - a.createdAt.getTime() ||
          (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
      )
      .slice(0, params.limit);
  }
}
