import { LedgerAccountClass } from '@rescom/schemas';
import { LedgerRepositoryPort } from '../application/ports/ledger-repository.port';
import { LedgerAccountEntity } from '../domain/ledger-account.entity';
import { LedgerJournalEntity } from '../domain/ledger-journal.entity';
import { LedgerEntryEntity } from '../domain/ledger-entry.entity';
import {
  AccountNotFoundException,
  InsufficientBalanceException,
  JournalAlreadyReversedException,
  UnbalancedJournalException,
} from '../application/exceptions/economy.exceptions';

export class InMemoryLedgerRepository implements LedgerRepositoryPort {
  private readonly accounts = new Map<string, LedgerAccountEntity>();
  private readonly journals = new Map<string, LedgerJournalEntity>();
  private readonly entries: LedgerEntryEntity[] = [];

  async findAccountById(id: string): Promise<LedgerAccountEntity | null> {
    const acc = this.accounts.get(id);
    return acc ? this.cloneAccount(acc) : null;
  }

  async findAccountByUserAndClass(
    userId: string | null,
    accountClass: LedgerAccountClass,
    currency = 'POINTS',
  ): Promise<LedgerAccountEntity | null> {
    for (const acc of this.accounts.values()) {
      if (
        acc.userId === userId &&
        acc.accountClass === accountClass &&
        acc.currency === currency
      ) {
        return this.cloneAccount(acc);
      }
    }
    return null;
  }

  async findAccountsByUserId(userId: string): Promise<LedgerAccountEntity[]> {
    const list: LedgerAccountEntity[] = [];
    for (const acc of this.accounts.values()) {
      if (acc.userId === userId) {
        list.push(this.cloneAccount(acc));
      }
    }
    return list;
  }

  async createAccount(account: LedgerAccountEntity): Promise<LedgerAccountEntity> {
    const cloned = this.cloneAccount(account);
    this.accounts.set(account.id, cloned);
    return this.cloneAccount(cloned);
  }

  async findJournalById(id: string): Promise<LedgerJournalEntity | null> {
    const j = this.journals.get(id);
    if (!j) return null;
    return this.enrichJournalWithEntries(j);
  }

  async findJournalByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<LedgerJournalEntity | null> {
    for (const j of this.journals.values()) {
      if (j.idempotencyKey === idempotencyKey) {
        return this.enrichJournalWithEntries(j);
      }
    }
    return null;
  }

  async findReversalJournal(
    targetJournalId: string,
  ): Promise<LedgerJournalEntity | null> {
    for (const j of this.journals.values()) {
      if (j.reversesJournalId === targetJournalId) {
        return this.enrichJournalWithEntries(j);
      }
    }
    return null;
  }

  async postJournalTransaction(
    journal: LedgerJournalEntity,
    entries: LedgerEntryEntity[],
  ): Promise<LedgerJournalEntity> {
    // 1. Invariant: Entries must sum to zero
    const sum = entries.reduce((acc, e) => acc + e.amount, 0);
    if (sum !== 0 || entries.length < 2) {
      throw new UnbalancedJournalException(
        `Journal ${journal.id} must have at least 2 entries and balance to zero. Current sum: ${sum}`,
      );
    }

    // 2. Reversal check
    if (journal.reversesJournalId) {
      for (const j of this.journals.values()) {
        if (j.reversesJournalId === journal.reversesJournalId) {
          throw new JournalAlreadyReversedException(
            `Journal ${journal.reversesJournalId} is already reversed.`,
          );
        }
      }
    }

    // 3. Ascending sort of distinct account IDs to guarantee deterministic deadlock-free locking
    const distinctAccountIds = Array.from(
      new Set(entries.map((e) => e.accountId)),
    ).sort();

    // 4. Calculate deltas per account
    const deltas = new Map<string, number>();
    for (const entry of entries) {
      deltas.set(entry.accountId, (deltas.get(entry.accountId) || 0) + entry.amount);
    }

    // 5. In ascending order, verify existence and sufficiency (no overdraft)
    for (const accountId of distinctAccountIds) {
      const acc = this.accounts.get(accountId);
      if (!acc) {
        throw new AccountNotFoundException(
          `Account ${accountId} does not exist in the ledger.`,
        );
      }

      const delta = deltas.get(accountId) || 0;
      if (acc.wouldOverdraft(delta)) {
        throw new InsufficientBalanceException(
          `Account ${accountId} (${acc.accountClass}) has balance ${acc.balance} and cannot overdraft by delta ${delta}.`,
        );
      }
    }

    // 6. Apply updates and append records
    for (const accountId of distinctAccountIds) {
      const acc = this.accounts.get(accountId)!;
      const delta = deltas.get(accountId) || 0;
      acc.applyDelta(delta);
    }

    const savedJournal = LedgerJournalEntity.create({
      id: journal.id,
      idempotencyKey: journal.idempotencyKey,
      description: journal.description,
      reversesJournalId: journal.reversesJournalId,
      createdAt: journal.createdAt,
    });

    this.journals.set(savedJournal.id, savedJournal);

    for (const e of entries) {
      this.entries.push(
        LedgerEntryEntity.create({
          id: e.id,
          journalId: savedJournal.id,
          accountId: e.accountId,
          amount: e.amount,
          createdAt: e.createdAt,
        }),
      );
    }

    return this.enrichJournalWithEntries(savedJournal);
  }

  async sumEntriesByAccountId(accountId: string): Promise<number> {
    return this.entries
      .filter((e) => e.accountId === accountId)
      .reduce((sum, e) => sum + e.amount, 0);
  }

  async sumAllEntries(): Promise<number> {
    return this.entries.reduce((sum, e) => sum + e.amount, 0);
  }

  async rebuildAccountBalance(accountId: string, newBalance: number): Promise<void> {
    const acc = this.accounts.get(accountId);
    if (!acc) {
      throw new AccountNotFoundException(`Account ${accountId} not found.`);
    }
    const currentDelta = newBalance - acc.balance;
    acc.applyDelta(currentDelta);
  }

  private cloneAccount(acc: LedgerAccountEntity): LedgerAccountEntity {
    return LedgerAccountEntity.create({
      id: acc.id,
      userId: acc.userId,
      accountClass: acc.accountClass,
      currency: acc.currency,
      balance: acc.balance,
      createdAt: acc.createdAt,
      updatedAt: acc.updatedAt,
    });
  }

  private enrichJournalWithEntries(journal: LedgerJournalEntity): LedgerJournalEntity {
    const journalEntries = this.entries
      .filter((e) => e.journalId === journal.id)
      .map((e) =>
        LedgerEntryEntity.create({
          id: e.id,
          journalId: e.journalId,
          accountId: e.accountId,
          amount: e.amount,
          createdAt: e.createdAt,
        }),
      );

    const enriched = LedgerJournalEntity.create({
      id: journal.id,
      idempotencyKey: journal.idempotencyKey,
      description: journal.description,
      reversesJournalId: journal.reversesJournalId,
      createdAt: journal.createdAt,
      entries: journalEntries,
    });

    return enriched;
  }
}
