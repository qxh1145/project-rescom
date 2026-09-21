import { randomUUID } from 'crypto';
import {
  LedgerAccountClass,
  PostJournalInput,
  ReverseJournalInput,
  postJournalInputSchema,
} from '@rescom/schemas';
import { LedgerRepositoryPort } from './ports/ledger-repository.port';
import { LedgerAccountEntity } from '../domain/ledger-account.entity';
import { LedgerJournalEntity } from '../domain/ledger-journal.entity';
import { LedgerEntryEntity } from '../domain/ledger-entry.entity';
import {
  AccountNotFoundException,
  IdempotencyConflictException,
  InvalidLedgerOperationException,
  JournalAlreadyReversedException,
  JournalNotFoundException,
  UnbalancedJournalException,
} from './exceptions/economy.exceptions';

export interface TransferParams {
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  idempotencyKey: string;
  description?: string;
}

export interface AccountBalanceVerification {
  accountId: string;
  projectedBalance: number;
  calculatedBalance: number;
  isConsistent: boolean;
}

export interface AccountReconciliationResult {
  accountId: string;
  priorBalance: number;
  correctedBalance: number;
}

export interface LedgerIntegrityReport {
  totalSystemBalance: number;
  isZeroSum: boolean;
}

export class LedgerService {
  constructor(private readonly ledgerRepo: LedgerRepositoryPort) {}

  /**
   * Retrieves an existing ledger account or creates one if it doesn't exist.
   */
  async getOrCreateAccount(
    userId: string | null,
    accountClass: LedgerAccountClass,
    currency = 'POINTS',
  ): Promise<LedgerAccountEntity> {
    const existing = await this.ledgerRepo.findAccountByUserAndClass(
      userId,
      accountClass,
      currency,
    );
    if (existing) {
      return existing;
    }

    const newAccount = LedgerAccountEntity.create({
      userId,
      accountClass,
      currency,
      balance: 0,
    });

    return this.ledgerRepo.createAccount(newAccount);
  }

  /**
   * Retrieves a ledger account by its ID. Throws AccountNotFoundException if missing.
   */
  async getAccount(id: string): Promise<LedgerAccountEntity> {
    const account = await this.ledgerRepo.findAccountById(id);
    if (!account) {
      throw new AccountNotFoundException(`Ledger account ${id} was not found.`);
    }
    return account;
  }

  /**
   * Retrieves all ledger accounts belonging to a specific user.
   */
  async getUserAccounts(userId: string): Promise<LedgerAccountEntity[]> {
    return this.ledgerRepo.findAccountsByUserId(userId);
  }

  /**
   * Posts a double-entry journal with at least 2 balanced entries.
   * Handles idempotency: returns existing journal on identical retry,
   * rejects on conflicting parameters for the same idempotency key.
   */
  async postJournal(input: PostJournalInput): Promise<LedgerJournalEntity> {
    const parseResult = postJournalInputSchema.safeParse(input);
    if (!parseResult.success) {
      throw new UnbalancedJournalException(
        parseResult.error.errors.map((e) => e.message).join('; '),
      );
    }

    const validated = parseResult.data;

    // Idempotency check: see if journal with same key already exists
    const existingJournal = await this.ledgerRepo.findJournalByIdempotencyKey(
      validated.idempotencyKey,
    );

    if (existingJournal) {
      // Check if command is identical (same number of entries, matching account IDs and amounts)
      const isCompatible = this.isJournalCompatible(existingJournal, validated);
      if (isCompatible) {
        return existingJournal;
      }
      throw new IdempotencyConflictException(
        `Idempotency conflict: A journal with key "${validated.idempotencyKey}" already exists with different transaction parameters.`,
      );
    }

    const journalId = randomUUID();
    const journal = LedgerJournalEntity.create({
      id: journalId,
      idempotencyKey: validated.idempotencyKey,
      description: validated.description ?? null,
    });

    const entries = validated.entries.map((entry) =>
      LedgerEntryEntity.create({
        journalId,
        accountId: entry.accountId,
        amount: entry.amount,
      }),
    );

    journal.setEntries(entries);

    return this.ledgerRepo.postJournalTransaction(journal, entries);
  }

  /**
   * Reverses an existing journal by creating an exact equal-and-opposite negation journal.
   * Each journal can be reversed at most once. Reversal of a reversal forms a non-branching chain.
   */
  async reverseJournal(input: ReverseJournalInput): Promise<LedgerJournalEntity> {
    const targetJournal = await this.ledgerRepo.findJournalById(input.targetJournalId);
    if (!targetJournal) {
      throw new JournalNotFoundException(
        `Target journal ${input.targetJournalId} for reversal was not found.`,
      );
    }

    // Check if target journal was already reversed
    const existingReversal = await this.ledgerRepo.findReversalJournal(targetJournal.id);
    if (existingReversal) {
      throw new JournalAlreadyReversedException(
        `Journal ${targetJournal.id} has already been reversed by journal ${existingReversal.id}.`,
      );
    }

    if (targetJournal.entries.length === 0) {
      throw new InvalidLedgerOperationException(
        `Target journal ${targetJournal.id} has no entries to reverse.`,
      );
    }

    const idempotencyKey =
      input.idempotencyKey ?? `reversal:${targetJournal.id}`;

    // Safe idempotency check for retrying the reversal
    const existingByKey = await this.ledgerRepo.findJournalByIdempotencyKey(idempotencyKey);
    if (existingByKey) {
      return existingByKey;
    }

    const reversalJournalId = randomUUID();
    const reversalJournal = LedgerJournalEntity.create({
      id: reversalJournalId,
      idempotencyKey,
      description:
        input.reason ?? `Reversal of journal ${targetJournal.id}`,
      reversesJournalId: targetJournal.id,
    });

    const negationEntries = targetJournal.createNegationEntries(reversalJournalId);
    reversalJournal.setEntries(negationEntries);

    return this.ledgerRepo.postJournalTransaction(reversalJournal, negationEntries);
  }

  /**
   * Convenience transfer method between two accounts.
   */
  async transfer(params: TransferParams): Promise<LedgerJournalEntity> {
    if (params.amount <= 0) {
      throw new InvalidLedgerOperationException(
        'Transfer amount must be a positive integer.',
      );
    }

    if (params.fromAccountId === params.toAccountId) {
      throw new InvalidLedgerOperationException(
        'Transfer cannot be executed between the exact same account.',
      );
    }

    return this.postJournal({
      idempotencyKey: params.idempotencyKey,
      description: params.description ?? 'Point transfer',
      entries: [
        { accountId: params.fromAccountId, amount: -params.amount },
        { accountId: params.toAccountId, amount: params.amount },
      ],
    });
  }

  /**
   * Verifies an account's denormalized balance against the mathematical sum of its immutable entries.
   */
  async verifyAccountBalance(accountId: string): Promise<AccountBalanceVerification> {
    const account = await this.getAccount(accountId);
    const calculated = await this.ledgerRepo.sumEntriesByAccountId(accountId);
    return {
      accountId,
      projectedBalance: account.balance,
      calculatedBalance: calculated,
      isConsistent: account.balance === calculated,
    };
  }

  /**
   * Reconciles and repairs an account's denormalized balance projection if it drifted from the sum of entries.
   */
  async reconcileAccountBalance(accountId: string): Promise<AccountReconciliationResult> {
    const account = await this.getAccount(accountId);
    const calculated = await this.ledgerRepo.sumEntriesByAccountId(accountId);

    if (account.balance !== calculated) {
      await this.ledgerRepo.rebuildAccountBalance(accountId, calculated);
    }

    return {
      accountId,
      priorBalance: account.balance,
      correctedBalance: calculated,
    };
  }

  /**
   * Audits the entire ledger to verify that the closed double-entry system balances to zero.
   */
  async verifyLedgerIntegrity(): Promise<LedgerIntegrityReport> {
    const total = await this.ledgerRepo.sumAllEntries();
    return {
      totalSystemBalance: total,
      isZeroSum: total === 0,
    };
  }

  private isJournalCompatible(
    existing: LedgerJournalEntity,
    command: PostJournalInput,
  ): boolean {
    if (existing.entries.length !== command.entries.length) {
      return false;
    }

    for (const cmdEntry of command.entries) {
      const match = existing.entries.find(
        (e) => e.accountId === cmdEntry.accountId && e.amount === cmdEntry.amount,
      );
      if (!match) {
        return false;
      }
    }

    return true;
  }
}
