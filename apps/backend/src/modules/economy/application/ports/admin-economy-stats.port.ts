import type { LedgerAccountClass } from '@rescom/schemas';

/**
 * Economy-owned reads for the Admin console (Story IR.4b part C, mock-off plan
 * 4.1 and 4.3, AD-16): top-up queue totals, ledger balance totals and the
 * admin journal list. Every method runs a bounded number of queries; the
 * journal list is keyset-paginated and never loads more than `limit` rows.
 */
export const ADMIN_ECONOMY_STATS_PORT = Symbol('ADMIN_ECONOMY_STATS_PORT');

export interface PendingTopUpSummary {
  count: number;
  points: number;
  amountVnd: number;
}

export interface PendingTopUpRecord {
  id: string;
  userId: string;
  amount: number;
  amountVnd: number;
  transferReference: string;
  createdAt: Date;
}

/**
 * Journal filter: keys starting with one of `keyPrefixes` (and not a
 * reversal), plus every reversal when `includeReversals`.
 */
export interface AdminJournalKeyFilter {
  keyPrefixes: readonly string[];
  includeReversals: boolean;
}

export interface AdminJournalListParams {
  /** null = every journal */
  filter: AdminJournalKeyFilter | null;
  from: Date | null;
  to: Date | null;
  /** Keyset: rows strictly after this one in (createdAt desc, id desc) order. */
  before: { createdAt: Date; id: string } | null;
  limit: number;
}

export interface AdminJournalEntryRecord {
  id: string;
  accountId: string;
  amount: number;
  createdAt: Date;
  accountClass: LedgerAccountClass;
  /** Owner of the account; null for system accounts. */
  ownerUserId: string | null;
}

export interface AdminJournalRecord {
  id: string;
  idempotencyKey: string;
  description: string | null;
  reversesJournalId: string | null;
  createdAt: Date;
  entries: AdminJournalEntryRecord[];
}

export interface AdminEconomyStatsPort {
  /** One aggregate over `PENDING` top-ups. */
  pendingTopUpSummary(): Promise<PendingTopUpSummary>;
  /** Oldest `PENDING` top-up (the review queue order). */
  oldestPendingTopUp(): Promise<PendingTopUpRecord | null>;
  /** Sums of every ESCROW and every PENDING ledger balance, in one grouped query. */
  balanceTotals(): Promise<{ escrow: number; pending: number }>;
  /**
   * Escrow refunds (`close-refund:{formId}:…` journals) posted since `since`
   * and not reversed since: the points they gave back and the number of
   * distinct surveys refunded.
   */
  escrowRefundsSince(since: Date): Promise<{ points: number; surveys: number }>;
  /** Journals newest first (ties by id descending), at most `limit`, with their entries. */
  listJournals(params: AdminJournalListParams): Promise<AdminJournalRecord[]>;
}
