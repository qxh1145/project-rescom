import { PrismaService } from '../../src/common/database/prisma.service';

export interface LedgerInvariantReport {
  /** Journals whose entries do not sum to 0. */
  unbalancedJournals: number;
  /** Accounts whose cached `balance` differs from the sum of their entries. */
  driftedAccounts: number;
  /** User-class accounts (Available / Pending / Frozen / Escrow) below 0. */
  negativeUserAccounts: number;
  /** Idempotency keys used by more than one journal (unique index: 0). */
  duplicateKeys: number;
}

/**
 * Story IR.2b T16: the no-double-journal / balanced-ledger invariant, read
 * straight from PostgreSQL (shared by the scheduler e2e suites).
 */
export async function ledgerInvariants(
  prisma: PrismaService,
): Promise<LedgerInvariantReport> {
  const [unbalanced] = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*) AS n FROM (
      SELECT journal_id FROM ledger_entries GROUP BY journal_id HAVING sum(amount) <> 0
    ) t`;
  const [drifted] = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*) AS n FROM (
      SELECT a.id FROM ledger_accounts a
      LEFT JOIN ledger_entries e ON e.account_id = a.id
      GROUP BY a.id, a.balance
      HAVING a.balance <> COALESCE(sum(e.amount), 0)
    ) t`;
  const [negative] = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*) AS n FROM ledger_accounts
    WHERE user_id IS NOT NULL AND balance < 0`;
  const [duplicates] = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*) AS n FROM (
      SELECT idempotency_key FROM ledger_journals GROUP BY 1 HAVING count(*) > 1
    ) t`;
  return {
    unbalancedJournals: Number(unbalanced.n),
    driftedAccounts: Number(drifted.n),
    negativeUserAccounts: Number(negative.n),
    duplicateKeys: Number(duplicates.n),
  };
}

export const BALANCED_LEDGER: LedgerInvariantReport = {
  unbalancedJournals: 0,
  driftedAccounts: 0,
  negativeUserAccounts: 0,
  duplicateKeys: 0,
};
