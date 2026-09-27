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
  findJournalByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<LedgerJournalEntity | null>;
  findReversalJournal(
    targetJournalId: string,
  ): Promise<LedgerJournalEntity | null>;

  /**
   * Journals (with entries) for every existing key in `idempotencyKeys`;
   * unknown keys are skipped. Large key sets are looked up in chunks.
   */
  findJournalsByIdempotencyKeys(
    idempotencyKeys: string[],
  ): Promise<LedgerJournalEntity[]>;

  /** Journals whose idempotency key starts with `prefix`, oldest first. */
  findJournalsByIdempotencyKeyPrefix(
    prefix: string,
  ): Promise<LedgerJournalEntity[]>;

  /**
   * Journals whose idempotency key starts with any of `prefixes` (one
   * lookup for a whole page of forms, Phase 5 M-1), oldest first.
   */
  findJournalsByIdempotencyKeyPrefixes(
    prefixes: string[],
  ): Promise<LedgerJournalEntity[]>;

  /**
   * Journals whose idempotency key starts with `prefix` and whose description
   * contains `descriptionFragment`, oldest first.
   */
  findJournalsByIdempotencyKeyPrefixAndDescription(
    prefix: string,
    descriptionFragment: string,
  ): Promise<LedgerJournalEntity[]>;

  /** Direct reversal journals of any of `targetJournalIds`. */
  findReversalJournalsFor(
    targetJournalIds: string[],
  ): Promise<LedgerJournalEntity[]>;

  /**
   * FR-24 maturity scan: `external-completion:{attemptId}` credits created at
   * or before `cutoff` that have no `release-pending:{attemptId}` journal and
   * no reversal, oldest first, at most `limit`.
   */
  findMaturedPendingCredits(params: {
    cutoff: Date;
    limit: number;
  }): Promise<LedgerJournalEntity[]>;

  /**
   * Atomically posts a journal and its entries in one database transaction,
   * acquiring row locks on affected accounts in strictly ascending account-ID order,
   * verifying overdraft sufficiency, inserting journal and entries, and updating
   * denormalized balance projections.
   *
   * `options.assertBeforeInsert` runs inside that transaction once the
   * account rows are locked, before the balance checks and before anything is
   * written; its repository reads join the transaction, and a throw aborts
   * the posting.
   */
  postJournalTransaction(
    journal: LedgerJournalEntity,
    entries: LedgerEntryEntity[],
    options?: PostJournalTransactionOptions,
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

  /**
   * Locks an account, derives its balance from entries, and repairs the
   * projection atomically so concurrent postings cannot be overwritten.
   */
  reconcileAccountBalance(accountId: string): Promise<{
    accountId: string;
    priorBalance: number;
    correctedBalance: number;
  }>;

  /**
   * Retrieves transaction history for accounts belonging to a given user.
   */
  findTransactionsByUserId(
    userId: string,
    limit?: number,
    offset?: number,
  ): Promise<UserLedgerTransactionRecord[]>;
}

export interface UserLedgerTransactionRecord {
  entry: LedgerEntryEntity;
  journal: LedgerJournalEntity;
  account: LedgerAccountEntity;
}

export interface PostJournalTransactionOptions {
  /** Guard run under the account locks, before the journal is inserted. */
  assertBeforeInsert?: () => Promise<void>;
}
