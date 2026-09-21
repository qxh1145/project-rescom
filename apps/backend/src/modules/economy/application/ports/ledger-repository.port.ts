import { LedgerAccountClass } from '@rescom/schemas';
import { LedgerAccountEntity } from '../../domain/ledger-account.entity';
import { LedgerJournalEntity } from '../../domain/ledger-journal.entity';
import { LedgerEntryEntity } from '../../domain/ledger-entry.entity';

export const LEDGER_REPOSITORY_PORT = Symbol('LEDGER_REPOSITORY_PORT');

export interface LedgerRepositoryPort {
  findAccountById(id: string): Promise<LedgerAccountEntity | null>;
  findAccountByUserAndClass(
    userId: string | null,
    accountClass: LedgerAccountClass,
    currency?: string,
  ): Promise<LedgerAccountEntity | null>;
  findAccountsByUserId(userId: string): Promise<LedgerAccountEntity[]>;
  createAccount(account: LedgerAccountEntity): Promise<LedgerAccountEntity>;

  findJournalById(id: string): Promise<LedgerJournalEntity | null>;
  findJournalByIdempotencyKey(idempotencyKey: string): Promise<LedgerJournalEntity | null>;
  findReversalJournal(targetJournalId: string): Promise<LedgerJournalEntity | null>;

  /**
   * Atomically posts a journal and its entries in one database transaction,
   * acquiring row locks on affected accounts in strictly ascending account-ID order,
   * verifying overdraft sufficiency, inserting journal and entries, and updating
   * denormalized balance projections.
   */
  postJournalTransaction(
    journal: LedgerJournalEntity,
    entries: LedgerEntryEntity[],
  ): Promise<LedgerJournalEntity>;

  /**
   * Sums all entry amounts for a given account. Source of financial truth.
   */
  sumEntriesByAccountId(accountId: string): Promise<number>;

  /**
   * Sums all entries across the entire ledger. Must equal 0 in a closed double-entry system.
   */
  sumAllEntries(): Promise<number>;

  /**
   * Updates an account's denormalized balance to match the calculated sum of entries.
   */
  rebuildAccountBalance(accountId: string, newBalance: number): Promise<void>;
}
