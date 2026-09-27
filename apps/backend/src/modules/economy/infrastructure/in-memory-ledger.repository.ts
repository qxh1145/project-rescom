import { LedgerAccountClass } from '@rescom/schemas';
import {
  LedgerRepositoryPort,
  PostJournalTransactionOptions,
  UserLedgerTransactionRecord,
} from '../application/ports/ledger-repository.port';
import { LedgerAccountEntity } from '../domain/ledger-account.entity';
import { LedgerJournalEntity } from '../domain/ledger-journal.entity';
import { LedgerEntryEntity } from '../domain/ledger-entry.entity';
import {
  AccountNotFoundException,
  IdempotencyConflictException,
  InsufficientBalanceException,
  InvalidLedgerOperationException,
  JournalAlreadyReversedException,
  UnbalancedJournalException,
} from '../application/exceptions/economy.exceptions';
import {
  DISPUTE_HOLD_KEY_PREFIX,
  attemptIdFromDisputeHold,
  disputeResolutionKey,
} from '../domain/dispute-hold';

export class InMemoryLedgerRepository implements LedgerRepositoryPort {
  private readonly accounts = new Map<string, LedgerAccountEntity>();
  private readonly journals = new Map<string, LedgerJournalEntity>();
  private readonly entries: LedgerEntryEntity[] = [];

  clear(): void {
    this.accounts.clear();
    this.journals.clear();
    this.entries.length = 0;
  }

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

  async createAccount(
    account: LedgerAccountEntity,
  ): Promise<LedgerAccountEntity> {
    for (const existing of this.accounts.values()) {
      if (
        existing.userId === account.userId &&
        existing.accountClass === account.accountClass &&
        existing.currency === account.currency
      ) {
        return this.cloneAccount(existing);
      }
    }

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

  async findJournalsByIdempotencyKeys(
    idempotencyKeys: string[],
  ): Promise<LedgerJournalEntity[]> {
    const keys = new Set(idempotencyKeys);
    return Array.from(this.journals.values())
      .filter((j) => keys.has(j.idempotencyKey))
      .map((j) => this.enrichJournalWithEntries(j));
  }

  async findJournalsByIdempotencyKeyPrefix(
    prefix: string,
  ): Promise<LedgerJournalEntity[]> {
    return Array.from(this.journals.values())
      .filter((j) => j.idempotencyKey.startsWith(prefix))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((j) => this.enrichJournalWithEntries(j));
  }

  async findJournalsByIdempotencyKeyPrefixAndDescription(
    prefix: string,
    descriptionFragment: string,
  ): Promise<LedgerJournalEntity[]> {
    return (await this.findJournalsByIdempotencyKeyPrefix(prefix)).filter((j) =>
      (j.description ?? '').includes(descriptionFragment),
    );
  }

  async findReversalJournalsFor(
    targetJournalIds: string[],
  ): Promise<LedgerJournalEntity[]> {
    const ids = new Set(targetJournalIds);
    return Array.from(this.journals.values())
      .filter((j) => j.reversesJournalId && ids.has(j.reversesJournalId))
      .map((j) => this.enrichJournalWithEntries(j));
  }

  async findMaturedPendingCredits(params: {
    cutoff: Date;
    limit: number;
  }): Promise<LedgerJournalEntity[]> {
    const prefix = 'external-completion:';
    const keys = new Set(
      Array.from(this.journals.values()).map((j) => j.idempotencyKey),
    );
    const reversed = new Set(
      Array.from(this.journals.values())
        .map((j) => j.reversesJournalId)
        .filter((id): id is string => Boolean(id)),
    );
    // BE-5: an unreversed dispute hold with an unreversed resolution settled
    // the credit; it can never be released, so it is not rescanned.
    const byKey = new Map(
      Array.from(this.journals.values()).map((j) => [j.idempotencyKey, j]),
    );
    const settledByDispute = new Set<string>();
    for (const hold of this.journals.values()) {
      if (
        !hold.idempotencyKey.startsWith(DISPUTE_HOLD_KEY_PREFIX) ||
        reversed.has(hold.id)
      ) {
        continue;
      }
      const caseId = hold.idempotencyKey.slice(DISPUTE_HOLD_KEY_PREFIX.length);
      const holdAttemptId = attemptIdFromDisputeHold(hold);
      if (!holdAttemptId) {
        continue;
      }
      const resolved = (['release', 'refund'] as const).some((action) => {
        const resolution = byKey.get(disputeResolutionKey(caseId, action));
        return resolution !== undefined && !reversed.has(resolution.id);
      });
      if (resolved) {
        settledByDispute.add(holdAttemptId);
      }
    }
    return Array.from(this.journals.values())
      .filter(
        (j) =>
          j.idempotencyKey.startsWith(prefix) &&
          j.createdAt.getTime() <= params.cutoff.getTime() &&
          !keys.has(
            `release-pending:${j.idempotencyKey.slice(prefix.length)}`,
          ) &&
          !reversed.has(j.id) &&
          !settledByDispute.has(j.idempotencyKey.slice(prefix.length)),
      )
      .sort(
        (a, b) =>
          a.createdAt.getTime() - b.createdAt.getTime() ||
          a.id.localeCompare(b.id),
      )
      .slice(0, Math.max(0, params.limit))
      .map((j) => this.enrichJournalWithEntries(j));
  }

  async postJournalTransaction(
    journal: LedgerJournalEntity,
    entries: LedgerEntryEntity[],
    options: PostJournalTransactionOptions = {},
  ): Promise<LedgerJournalEntity> {
    for (const existing of this.journals.values()) {
      if (existing.idempotencyKey === journal.idempotencyKey) {
        throw new IdempotencyConflictException(
          `Journal with key "${journal.idempotencyKey}" already exists.`,
        );
      }
    }

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

    // Same point as the Prisma adapter: before the balance checks and before
    // anything is written.
    if (options.assertBeforeInsert) {
      await options.assertBeforeInsert();
    }

    // 3. Ascending sort of distinct account IDs to guarantee deterministic deadlock-free locking
    const distinctAccountIds = Array.from(
      new Set(entries.map((e) => e.accountId)),
    ).sort();

    // 4. Calculate deltas per account
    const deltas = new Map<string, number>();
    for (const entry of entries) {
      deltas.set(
        entry.accountId,
        (deltas.get(entry.accountId) || 0) + entry.amount,
      );
    }

    // 5. In ascending order, verify existence and sufficiency (no overdraft)
    const currencies = new Set<string>();
    for (const accountId of distinctAccountIds) {
      const acc = this.accounts.get(accountId);
      if (!acc) {
        throw new AccountNotFoundException(
          `Account ${accountId} does not exist in the ledger.`,
        );
      }

      currencies.add(acc.currency);

      const delta = deltas.get(accountId) || 0;
      if (acc.wouldOverdraft(delta)) {
        throw new InsufficientBalanceException(
          `Account ${accountId} (${acc.accountClass}) has balance ${acc.balance} and cannot overdraft by delta ${delta}.`,
        );
      }
    }

    if (currencies.size !== 1) {
      throw new InvalidLedgerOperationException(
        'A ledger journal cannot mix account currencies.',
      );
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

  async rebuildAccountBalance(
    accountId: string,
    newBalance: number,
  ): Promise<void> {
    const acc = this.accounts.get(accountId);
    if (!acc) {
      throw new AccountNotFoundException(`Account ${accountId} not found.`);
    }
    const currentDelta = newBalance - acc.balance;
    acc.applyDelta(currentDelta);
  }

  async reconcileAccountBalance(accountId: string): Promise<{
    accountId: string;
    priorBalance: number;
    correctedBalance: number;
  }> {
    const account = this.accounts.get(accountId);
    if (!account) {
      throw new AccountNotFoundException(`Account ${accountId} not found.`);
    }

    const priorBalance = account.balance;
    const correctedBalance = this.entries
      .filter((entry) => entry.accountId === accountId)
      .reduce((sum, entry) => sum + entry.amount, 0);
    if (priorBalance !== correctedBalance) {
      account.applyDelta(correctedBalance - priorBalance);
    }

    return { accountId, priorBalance, correctedBalance };
  }

  async findTransactionsByUserId(
    userId: string,
    limit = 50,
    offset = 0,
  ): Promise<UserLedgerTransactionRecord[]> {
    const userAccountIds = new Set(
      Array.from(this.accounts.values())
        .filter((a) => a.userId === userId)
        .map((a) => a.id),
    );

    const userEntries = this.entries.filter((e) =>
      userAccountIds.has(e.accountId),
    );

    const entryIndices = new Map<LedgerEntryEntity, number>();
    this.entries.forEach((e, idx) => entryIndices.set(e, idx));

    userEntries.sort((a, b) => {
      const timeDiff = b.createdAt.getTime() - a.createdAt.getTime();
      if (timeDiff !== 0) return timeDiff;
      return (entryIndices.get(b) ?? 0) - (entryIndices.get(a) ?? 0);
    });

    const safeOffset = Math.max(0, offset);
    const safeLimit = Math.max(1, limit);
    const sliced = userEntries.slice(safeOffset, safeOffset + safeLimit);

    const records: UserLedgerTransactionRecord[] = [];
    for (const entry of sliced) {
      const journal = this.journals.get(entry.journalId);
      const account = this.accounts.get(entry.accountId);
      if (!journal || !account) continue;

      records.push({
        entry: LedgerEntryEntity.create({
          id: entry.id,
          journalId: entry.journalId,
          accountId: entry.accountId,
          amount: entry.amount,
          createdAt: entry.createdAt,
        }),
        journal: this.enrichJournalWithEntries(journal),
        account: this.cloneAccount(account),
      });
    }

    return records;
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

  private enrichJournalWithEntries(
    journal: LedgerJournalEntity,
  ): LedgerJournalEntity {
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
