import { randomUUID } from 'crypto';
import {
  DisputeHoldOutcome,
  EXTERNAL_COMPLETION_REVIEW_HOURS,
  LedgerAccountClass,
  LedgerAccountDto,
  PostJournalInput,
  ReverseJournalInput,
  RewardPolicyMode,
  RewardSettlementResultDto,
  STARTER_POINTS_DEFAULT_AMOUNT,
  WalletBalanceDto,
  WalletDetailsDto,
  WalletTransactionItemDto,
  canAccountClassOverdraft,
  calculateWalletTotal,
  internalRewardFunding,
  postJournalInputSchema,
  reverseJournalInputSchema,
  topUpApprovalKey,
} from '@rescom/schemas';
import { LedgerRepositoryPort } from './ports/ledger-repository.port';
import { LedgerAccountEntity } from '../domain/ledger-account.entity';
import { LedgerJournalEntity } from '../domain/ledger-journal.entity';
import { LedgerEntryEntity } from '../domain/ledger-entry.entity';
import {
  AccountNotFoundException,
  IdempotencyConflictException,
  InsufficientBalanceException,
  InsufficientEscrowBalanceException,
  InvalidLedgerOperationException,
  JournalAlreadyReversedException,
  JournalNotFoundException,
  PendingCreditNotFoundException,
  PendingRewardForbiddenException,
  PendingRewardNotMaturedException,
  UnbalancedJournalException,
} from './exceptions/economy.exceptions';

/** FR-24: External completion credits mature after the 48-hour review window. */
export const PENDING_REWARD_MATURITY_MS =
  EXTERNAL_COMPLETION_REVIEW_HOURS * 60 * 60 * 1000;

const EXTERNAL_COMPLETION_KEY_PREFIX = 'external-completion:';

/** Idempotency key of the External completion credit of `attemptId`. */
export function externalCompletionKey(attemptId: string): string {
  return `${EXTERNAL_COMPLETION_KEY_PREFIX}${attemptId}`;
}

/** Idempotency key of the Pending release of `attemptId`. */
export function releasePendingKey(attemptId: string): string {
  return `release-pending:${attemptId}`;
}

/** Attempt id of an `external-completion:{attemptId}` key, or null. */
export function attemptIdFromExternalCompletionKey(
  idempotencyKey: string,
): string | null {
  return idempotencyKey.startsWith(EXTERNAL_COMPLETION_KEY_PREFIX)
    ? idempotencyKey.slice(EXTERNAL_COMPLETION_KEY_PREFIX.length)
    : null;
}

export interface LedgerServiceLogger {
  warn(message: string): void;
}

export interface LedgerServiceOptions {
  /** Injectable clock (journal timestamps, FR-24 maturity). */
  clock?: () => Date;
  logger?: LedgerServiceLogger;
}

/** Expected shape of a replayed command, resolved to account owners. */
interface ExpectedReplayEntry {
  userId: string | null;
  accountClass: LedgerAccountClass;
  amount: number;
}

export interface TransferParams {
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  idempotencyKey: string;
  description?: string;
}

export interface ReserveEscrowParams {
  userId: string;
  formVersionId: string;
  amount: number;
  formTitle?: string;
}

export interface RefundUnusedEscrowParams {
  userId: string;
  formId: string;
  /**
   * Close identity of the key `close-refund:{formId}:{closeVersion}`. New
   * closes pass `c{closeCount}` (Epic 6 review P3); older journals used the
   * FormVersion number.
   */
  closeVersion: number | string;
  unusedAmount: number;
  /** Unused quota slots, shown in the journal description (6.3 AC4.3). */
  unusedCompletions?: number;
  formTitle?: string;
}

export interface ReopenEscrowParams {
  userId: string;
  formId: string;
  reopenVersion: number | string;
  additionalAmount: number;
  formTitle?: string;
}

export interface CreditInternalRewardParams {
  responseId: string;
  publisherId: string;
  respondentId: string | null;
  amount: number;
  policyMode?: RewardPolicyMode;
}

export interface CreditPendingRewardParams {
  attemptId: string;
  publisherId: string;
  respondentId: string;
  amount: number;
}

/**
 * Epic 6 review P2: the respondent and the amount come from the
 * `external-completion:{attemptId}` credit journal, never from the caller.
 * Optional values are checked against it.
 */
export interface ReleasePendingRewardParams {
  attemptId: string;
  /** When given, the credit must belong to this respondent (else 403). */
  respondentId?: string;
  /** When given, must equal the credited amount (else idempotency conflict). */
  amount?: number;
}

export interface ReleaseIntegrityHoldParams {
  respondentId: string;
  responseId: string;
  decisionId: string;
  amount: number;
}

export interface FailOpenIntegrityHoldParams {
  respondentId: string;
  responseId: string;
  amount: number;
  reason?: string;
}

export interface PlaceDisputeHoldParams {
  caseId: string;
  attemptId: string;
  respondentId: string;
  amount: number;
}

export interface ResolveDisputeHoldParams {
  caseId: string;
  respondentId: string;
  publisherId: string;
  amount: number;
  outcome: DisputeHoldOutcome;
}

export interface CreditApprovedTopUpParams {
  topUpId: string;
  userId: string;
  amount: number;
  transferReference: string;
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

/** Epic 6 review P4: what the ledger says about one logical form's Escrow. */
export interface FormEscrowPositionQuery {
  publisherId: string;
  formId: string;
  /** Every FormVersion of the form (their `publish:{versionId}` reservations). */
  versionIds: string[];
  /** Internal responses whose `internal-reward:` / `integrity-hold:` payouts draw this form's Escrow. */
  internalResponseIds: string[];
  /** External attempts whose `external-completion:` credits draw this form's Escrow. */
  externalAttemptIds: string[];
}

export interface FormEscrowPosition {
  /** Σ `publish:{versionId}` + `reopen-escrow:{formId}:*` locks. */
  reserved: number;
  /** Σ `close-refund:{formId}:*` refunds. */
  refunded: number;
  /** Σ Escrow debits of the form's payout journals (reversed ones excluded). */
  consumed: number;
  /** Responses that already have a payout journal (reversed ones included). */
  settledResponseIds: Set<string>;
  /** Attempts that already have a credit journal (reversed ones included). */
  settledAttemptIds: Set<string>;
}

export class LedgerService {
  private readonly clock: () => Date;
  private readonly logger?: LedgerServiceLogger;

  constructor(
    private readonly ledgerRepo: LedgerRepositoryPort,
    options: LedgerServiceOptions = {},
  ) {
    this.clock = options.clock ?? (() => new Date());
    this.logger = options.logger;
  }

  /** The ledger's clock (journal timestamps and FR-24 maturity). */
  now(): Date {
    return this.clock();
  }

  /**
   * Retrieves an existing ledger account or creates one if it doesn't exist.
   */
  async getOrCreateAccount(
    userId: string | null,
    accountClass: LedgerAccountClass,
    currency = 'POINTS',
  ): Promise<LedgerAccountEntity> {
    const isSystemAccount = canAccountClassOverdraft(accountClass);
    if (
      (isSystemAccount && userId !== null) ||
      (!isSystemAccount && userId === null)
    ) {
      throw new InvalidLedgerOperationException(
        isSystemAccount
          ? 'System ledger accounts cannot belong to a user.'
          : 'User ledger accounts require a userId.',
      );
    }

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
   * Aggregates a user's wallet across all 5 account classes,
   * auto-provisioning missing classes with balance 0, and returns
   * balances, recent transaction history, and account summaries (FR-31).
   */
  async getWallet(
    userId: string,
    limit = 50,
    offset = 0,
  ): Promise<WalletDetailsDto> {
    const userAccountClasses: LedgerAccountClass[] = [
      'USER_AVAILABLE',
      'PENDING',
      'FROZEN',
      'ESCROW',
      'INTEGRITY_HOLD',
    ];

    // Query existing accounts first to avoid sequential N+1 roundtrips
    let accounts = await this.getUserAccounts(userId);
    const existingClasses = new Set(accounts.map((a) => a.accountClass));
    const missingClasses = userAccountClasses.filter(
      (cls) => !existingClasses.has(cls),
    );

    if (missingClasses.length > 0) {
      for (const cls of missingClasses) {
        await this.getOrCreateAccount(userId, cls);
      }
      accounts = await this.getUserAccounts(userId);
    }

    const available =
      accounts.find((a) => a.accountClass === 'USER_AVAILABLE')?.balance ?? 0;
    const pending =
      accounts.find((a) => a.accountClass === 'PENDING')?.balance ?? 0;
    const escrow =
      accounts.find((a) => a.accountClass === 'ESCROW')?.balance ?? 0;
    const frozen =
      accounts.find((a) => a.accountClass === 'FROZEN')?.balance ?? 0;
    const integrityHold =
      accounts.find((a) => a.accountClass === 'INTEGRITY_HOLD')?.balance ?? 0;

    const total = calculateWalletTotal({
      available,
      pending,
      escrow,
      frozen,
      integrityHold,
    });

    const balance: WalletBalanceDto = {
      available,
      pending,
      escrow,
      frozen,
      integrityHold,
      total,
    };

    const safeLimit = Math.max(1, Math.min(limit, 100));
    const safeOffset = Math.max(0, offset);

    const transactionRecords = await this.ledgerRepo.findTransactionsByUserId(
      userId,
      safeLimit,
      safeOffset,
    );

    const transactions: WalletTransactionItemDto[] = transactionRecords.map(
      (r) => ({
        id: r.entry.id,
        journalId: r.journal.id,
        amount: r.entry.amount,
        accountClass: r.account.accountClass,
        description: r.journal.description,
        idempotencyKey: r.journal.idempotencyKey,
        createdAt: r.entry.createdAt.toISOString(),
        reversesJournalId: r.journal.reversesJournalId,
      }),
    );

    const serializedAccounts: LedgerAccountDto[] = accounts.map((a) => ({
      id: a.id,
      userId: a.userId,
      accountClass: a.accountClass,
      currency: a.currency,
      balance: a.balance,
      createdAt: a.createdAt.toISOString(),
      updatedAt: a.updatedAt.toISOString(),
    }));

    return {
      balance,
      transactions,
      accounts: serializedAccounts,
    };
  }

  /**
   * Posts a double-entry journal with at least 2 balanced entries.
   * Handles idempotency: returns existing journal on identical retry,
   * rejects on conflicting parameters for the same idempotency key.
   */
  async postJournal(input: PostJournalInput): Promise<LedgerJournalEntity> {
    const parseResult = postJournalInputSchema.safeParse(input);
    if (!parseResult.success) {
      const message = parseResult.error.errors.map((e) => e.message).join('; ');
      // Only the balance rules (sum = 0, at least two entries) are an
      // unbalanced journal; any other invalid value (for example an amount
      // outside the INTEGER range) is an invalid operation (Epic 6 review P12).
      const isBalanceRule = parseResult.error.errors.every(
        (issue) =>
          issue.path.length === 1 &&
          issue.path[0] === 'entries' &&
          (issue.code === 'custom' || issue.code === 'too_small'),
      );
      throw isBalanceRule
        ? new UnbalancedJournalException(message)
        : new InvalidLedgerOperationException(message);
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
    const postedAt = this.clock();
    const journal = LedgerJournalEntity.create({
      id: journalId,
      idempotencyKey: validated.idempotencyKey,
      description: validated.description ?? null,
      createdAt: postedAt,
    });

    const entries = validated.entries.map((entry) =>
      LedgerEntryEntity.create({
        journalId,
        accountId: entry.accountId,
        amount: entry.amount,
        createdAt: postedAt,
      }),
    );

    journal.setEntries(entries);

    try {
      return await this.ledgerRepo.postJournalTransaction(journal, entries);
    } catch (error) {
      if (!(error instanceof IdempotencyConflictException)) {
        throw error;
      }

      const winningJournal = await this.ledgerRepo.findJournalByIdempotencyKey(
        validated.idempotencyKey,
      );
      if (
        winningJournal &&
        this.isJournalCompatible(winningJournal, validated)
      ) {
        return winningJournal;
      }
      throw error;
    }
  }

  /**
   * Reverses an existing journal by creating an exact equal-and-opposite negation journal.
   * Each journal can be reversed at most once. Reversal of a reversal forms a non-branching chain.
   */
  async reverseJournal(
    input: ReverseJournalInput,
  ): Promise<LedgerJournalEntity> {
    const parsed = reverseJournalInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new InvalidLedgerOperationException(
        parsed.error.errors.map((error) => error.message).join('; '),
      );
    }
    const validated = parsed.data;

    const targetJournal = await this.ledgerRepo.findJournalById(
      validated.targetJournalId,
    );
    if (!targetJournal) {
      throw new JournalNotFoundException(
        `Target journal ${input.targetJournalId} for reversal was not found.`,
      );
    }

    if (targetJournal.entries.length === 0) {
      throw new InvalidLedgerOperationException(
        `Target journal ${targetJournal.id} has no entries to reverse.`,
      );
    }

    const idempotencyKey = validated.idempotencyKey;
    const description =
      validated.reason ?? `Reversal of journal ${targetJournal.id}`;
    const expectedEntries = targetJournal.entries.map((entry) => ({
      accountId: entry.accountId,
      amount: -entry.amount,
    }));

    const existingByKey =
      await this.ledgerRepo.findJournalByIdempotencyKey(idempotencyKey);
    if (existingByKey) {
      if (
        existingByKey.reversesJournalId === targetJournal.id &&
        this.isJournalCompatible(existingByKey, {
          idempotencyKey,
          description,
          entries: expectedEntries,
        })
      ) {
        return existingByKey;
      }
      throw new IdempotencyConflictException(
        `Idempotency conflict: key "${idempotencyKey}" does not identify the requested exact reversal.`,
      );
    }

    const existingReversal = await this.ledgerRepo.findReversalJournal(
      targetJournal.id,
    );
    if (existingReversal) {
      throw new JournalAlreadyReversedException(
        `Journal ${targetJournal.id} has already been reversed by journal ${existingReversal.id}.`,
      );
    }

    const reversalJournalId = randomUUID();
    const reversalJournal = LedgerJournalEntity.create({
      id: reversalJournalId,
      idempotencyKey,
      description,
      reversesJournalId: targetJournal.id,
    });

    const negationEntries =
      targetJournal.createNegationEntries(reversalJournalId);
    reversalJournal.setEntries(negationEntries);

    try {
      return await this.ledgerRepo.postJournalTransaction(
        reversalJournal,
        negationEntries,
      );
    } catch (error) {
      if (
        !(error instanceof IdempotencyConflictException) &&
        !(error instanceof JournalAlreadyReversedException)
      ) {
        throw error;
      }

      const winningJournal =
        await this.ledgerRepo.findJournalByIdempotencyKey(idempotencyKey);
      if (
        winningJournal?.reversesJournalId === targetJournal.id &&
        this.isJournalCompatible(winningJournal, {
          idempotencyKey,
          description,
          entries: expectedEntries,
        })
      ) {
        return winningJournal;
      }
      throw error;
    }
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
   * Locks points in Escrow from the Publisher's Available Balance when publishing a survey (FR-15, AD-16).
   * Keyed by idempotencyKey: `publish:${formVersionId}`.
   * If amount is 0 (e.g. non-reward survey), no ledger movement is performed and returns null.
   */
  async reserveEscrow(
    params: ReserveEscrowParams,
  ): Promise<LedgerJournalEntity | null> {
    if (params.amount <= 0) {
      return null;
    }

    const idempotencyKey = `publish:${params.formVersionId}`;

    // Fast-path idempotency check: only an identical command replays.
    const existing =
      await this.ledgerRepo.findJournalByIdempotencyKey(idempotencyKey);
    if (existing) {
      await this.assertReplayCompatible(existing, [
        {
          userId: params.userId,
          accountClass: 'USER_AVAILABLE',
          amount: -params.amount,
        },
        {
          userId: params.userId,
          accountClass: 'ESCROW',
          amount: params.amount,
        },
      ]);
      return existing;
    }

    const availableAccount = await this.getOrCreateAccount(
      params.userId,
      'USER_AVAILABLE',
    );
    const escrowAccount = await this.getOrCreateAccount(
      params.userId,
      'ESCROW',
    );

    if (availableAccount.balance < params.amount) {
      throw new InsufficientEscrowBalanceException(
        availableAccount.balance,
        params.amount,
      );
    }

    return this.postPublisherEscrowLock(
      {
        idempotencyKey,
        description: params.formTitle
          ? `Escrow lock for survey publish: ${params.formTitle}`
          : 'Escrow lock for survey publish',
        entries: [
          { accountId: availableAccount.id, amount: -params.amount },
          { accountId: escrowAccount.id, amount: params.amount },
        ],
      },
      availableAccount.id,
      params.amount,
    );
  }

  /**
   * Points actually locked into Escrow when a FormVersion was published
   * (the `publish:${formVersionId}` journal), or 0 when nothing was reserved
   * (free surveys, legacy rows).
   *
   * Read-only diagnostic kept for tests and operators (Epic 8 review P14):
   * production refunds and funding checks use the per-form position
   * (`getFormEscrowPosition`, Epic 6 review P4), never a single version's
   * reservation.
   */
  async getEscrowReservation(formVersionId: string): Promise<number> {
    const journal = await this.ledgerRepo.findJournalByIdempotencyKey(
      `publish:${formVersionId}`,
    );
    if (!journal) {
      return 0;
    }
    return this.positiveTotal(journal);
  }

  /**
   * Epic 6 review P4: the Escrow position of one logical form, derived from
   * its journals (one pooled ESCROW account per Publisher, so balances alone
   * cannot tell surveys apart). Reversed journals are excluded.
   */
  async getFormEscrowPosition(
    query: FormEscrowPositionQuery,
  ): Promise<FormEscrowPosition> {
    const [publishJournals, reopenJournals, refundJournals, payoutJournals] =
      await Promise.all([
        query.versionIds.length > 0
          ? this.ledgerRepo.findJournalsByIdempotencyKeys(
              query.versionIds.map((versionId) => `publish:${versionId}`),
            )
          : Promise.resolve([]),
        this.ledgerRepo.findJournalsByIdempotencyKeyPrefix(
          `reopen-escrow:${query.formId}:`,
        ),
        this.ledgerRepo.findJournalsByIdempotencyKeyPrefix(
          `close-refund:${query.formId}:`,
        ),
        this.ledgerRepo.findJournalsByIdempotencyKeys([
          ...query.internalResponseIds.flatMap((responseId) => [
            `internal-reward:${responseId}`,
            `integrity-hold:${responseId}`,
          ]),
          ...query.externalAttemptIds.map((attemptId) =>
            externalCompletionKey(attemptId),
          ),
        ]),
      ]);

    const reversed = await this.findReversedJournalIds([
      ...publishJournals,
      ...reopenJournals,
      ...refundJournals,
      ...payoutJournals,
    ]);
    const live = (journals: LedgerJournalEntity[]) =>
      journals.filter((journal) => !reversed.has(journal.id));

    const reserved = [...live(publishJournals), ...live(reopenJournals)].reduce(
      (sum, journal) => sum + this.positiveTotal(journal),
      0,
    );
    const refunded = live(refundJournals).reduce(
      (sum, journal) => sum + this.positiveTotal(journal),
      0,
    );

    const escrowAccount = await this.ledgerRepo.findAccountByUserAndClass(
      query.publisherId,
      'ESCROW',
    );
    const consumed = escrowAccount
      ? live(payoutJournals).reduce(
          (sum, journal) =>
            sum +
            journal.entries
              .filter(
                (entry) =>
                  entry.accountId === escrowAccount.id && entry.amount < 0,
              )
              .reduce((total, entry) => total - entry.amount, 0),
          0,
        )
      : 0;

    const settledResponseIds = new Set<string>();
    const settledAttemptIds = new Set<string>();
    for (const journal of payoutJournals) {
      const key = journal.idempotencyKey;
      const attemptId = attemptIdFromExternalCompletionKey(key);
      if (attemptId) {
        settledAttemptIds.add(attemptId);
      } else {
        settledResponseIds.add(key.slice(key.indexOf(':') + 1));
      }
    }

    return {
      reserved,
      refunded,
      consumed,
      settledResponseIds,
      settledAttemptIds,
    };
  }

  /**
   * Refunds remaining unused points from Escrow back to the Publisher's Available Balance
   * upon survey closure (FR-32, AD-16).
   * Keyed by idempotencyKey: `close-refund:${formId}:${closeVersion}`.
   */
  async refundUnusedEscrow(
    params: RefundUnusedEscrowParams,
  ): Promise<LedgerJournalEntity | null> {
    if (params.unusedAmount <= 0) {
      return null;
    }

    const idempotencyKey = `close-refund:${params.formId}:${params.closeVersion}`;

    // Fast-path idempotency check. The amount is capped by the balance at the
    // time of the close (not replay-stable), so only the accounts must match.
    const existing =
      await this.ledgerRepo.findJournalByIdempotencyKey(idempotencyKey);
    if (existing) {
      await this.assertReplayCompatible(
        existing,
        [
          { userId: params.userId, accountClass: 'ESCROW', amount: -1 },
          { userId: params.userId, accountClass: 'USER_AVAILABLE', amount: 1 },
        ],
        'accounts',
      );
      return existing;
    }

    const escrowAccount = await this.getOrCreateAccount(
      params.userId,
      'ESCROW',
    );
    const availableAccount = await this.getOrCreateAccount(
      params.userId,
      'USER_AVAILABLE',
    );

    // Safety net only: the caller computes the form's own remaining Escrow,
    // so a cap here signals an inconsistent ledger.
    const refundAmount = Math.min(escrowAccount.balance, params.unusedAmount);
    if (refundAmount < params.unusedAmount) {
      this.logger?.warn(
        `Escrow refund for form ${params.formId} was capped by the pooled Escrow balance; the form's Escrow position and the account balance disagree.`,
      );
    }
    if (refundAmount <= 0) {
      return null;
    }

    const slots =
      params.unusedCompletions !== undefined
        ? ` (${params.unusedCompletions} unused slots)`
        : '';
    return this.postJournal({
      idempotencyKey,
      description: params.formTitle
        ? `Escrow refund on survey close: ${params.formTitle}${slots}`
        : `Escrow refund on survey close${slots}`,
      entries: [
        { accountId: escrowAccount.id, amount: -refundAmount },
        { accountId: availableAccount.id, amount: refundAmount },
      ],
    });
  }

  /**
   * Locks additional points into Escrow when reopening a closed survey with increased sample quota (FR-33).
   * Keyed by idempotencyKey: `reopen-escrow:${formId}:${reopenVersion}`.
   */
  async reopenEscrow(params: ReopenEscrowParams): Promise<LedgerJournalEntity> {
    if (params.additionalAmount <= 0) {
      throw new InvalidLedgerOperationException(
        'Additional escrow amount must be a positive integer.',
      );
    }

    const idempotencyKey = `reopen-escrow:${params.formId}:${params.reopenVersion}`;

    // Fast-path idempotency check: only an identical command replays.
    const existing =
      await this.ledgerRepo.findJournalByIdempotencyKey(idempotencyKey);
    if (existing) {
      await this.assertReplayCompatible(existing, [
        {
          userId: params.userId,
          accountClass: 'USER_AVAILABLE',
          amount: -params.additionalAmount,
        },
        {
          userId: params.userId,
          accountClass: 'ESCROW',
          amount: params.additionalAmount,
        },
      ]);
      return existing;
    }

    const availableAccount = await this.getOrCreateAccount(
      params.userId,
      'USER_AVAILABLE',
    );
    const escrowAccount = await this.getOrCreateAccount(
      params.userId,
      'ESCROW',
    );

    if (availableAccount.balance < params.additionalAmount) {
      throw new InsufficientEscrowBalanceException(
        availableAccount.balance,
        params.additionalAmount,
      );
    }

    const journal = await this.postPublisherEscrowLock(
      {
        idempotencyKey,
        description: params.formTitle
          ? `Escrow lock for survey reopen: ${params.formTitle}`
          : 'Escrow lock for survey reopen',
        entries: [
          { accountId: availableAccount.id, amount: -params.additionalAmount },
          { accountId: escrowAccount.id, amount: params.additionalAmount },
        ],
      },
      availableAccount.id,
      params.additionalAmount,
    );
    return journal;
  }

  /**
   * Posts a Publisher Escrow lock. When the locked balance check inside the
   * posting fails (a concurrent spend after our unlocked pre-check), the
   * Publisher gets the same `INSUFFICIENT_ESCROW_BALANCE` contract as the
   * pre-check, with a re-read Available balance (Epic 6 review P11).
   */
  private async postPublisherEscrowLock(
    input: PostJournalInput,
    availableAccountId: string,
    requiredAmount: number,
  ): Promise<LedgerJournalEntity> {
    try {
      return await this.postJournal(input);
    } catch (error) {
      if (
        error instanceof InsufficientBalanceException &&
        !(error instanceof InsufficientEscrowBalanceException)
      ) {
        const available =
          await this.ledgerRepo.findAccountById(availableAccountId);
        throw new InsufficientEscrowBalanceException(
          available?.balance ?? 0,
          requiredAmount,
        );
      }
      throw error;
    }
  }

  /**
   * Credits survey reward to the respondent for an internal survey (FR-29, AD-16).
   * In SHADOW or ADVISORY mode, credits the Respondent's USER_AVAILABLE;
   * in ENFORCED mode, the Respondent's INTEGRITY_HOLD.
   * Decision E6-D1 (option B, platform subsidy): `amount` is the advertised
   * reward and is credited in full, in ONE balanced journal under the same
   * key: the Publisher's ESCROW pays `internalRewardFunding(amount).escrowDraw`
   * (= `escrowDrawPerCompletion`, what publish reserved per slot) and
   * SYSTEM_ISSUANCE mints the FR-19 discount (`platformSubsidy`, omitted
   * when rounding makes it 0). Paying 100% of a quota therefore drains
   * exactly the form's own Escrow.
   * Guest submissions omit point rewards and return SKIPPED_GUEST status.
   */
  async creditInternalReward(
    params: CreditInternalRewardParams,
  ): Promise<RewardSettlementResultDto> {
    const nowIso = this.clock().toISOString();

    // 1. Guest submissions do not receive points (FR-29, AD-16)
    if (!params.respondentId) {
      return {
        status: 'SKIPPED_GUEST',
        journalId: null,
        amount: 0,
        targetAccountClass: null,
        settledAt: nowIso,
      };
    }

    if (params.amount <= 0) {
      throw new InvalidLedgerOperationException(
        'Reward amount must be a positive integer.',
      );
    }

    const policyMode = params.policyMode ?? 'SHADOW';
    const isEnforced = policyMode === 'ENFORCED';
    const idempotencyKey = isEnforced
      ? `integrity-hold:${params.responseId}`
      : `internal-reward:${params.responseId}`;
    const targetAccountClass: LedgerAccountClass = isEnforced
      ? 'INTEGRITY_HOLD'
      : 'USER_AVAILABLE';
    const status = isEnforced ? 'HELD_IN_INTEGRITY' : 'SETTLED';
    const funding = internalRewardFunding(params.amount);

    // Fast-path idempotency check: only an identical command replays.
    const existing =
      await this.ledgerRepo.findJournalByIdempotencyKey(idempotencyKey);
    if (existing) {
      await this.assertReplayCompatible(existing, [
        {
          userId: params.publisherId,
          accountClass: 'ESCROW',
          amount: -funding.escrowDraw,
        },
        ...(funding.platformSubsidy > 0
          ? [
              {
                userId: null,
                accountClass: 'SYSTEM_ISSUANCE' as const,
                amount: -funding.platformSubsidy,
              },
            ]
          : []),
        {
          userId: params.respondentId,
          accountClass: targetAccountClass,
          amount: funding.respondentCredit,
        },
      ]);
      return this.toSettlementResult(existing, status, targetAccountClass);
    }

    // FR-29: one response is rewarded once, whatever the policy mode. The key
    // depends on the mode, so the sibling key is checked explicitly
    // (Epic 6 review P9).
    const siblingKey = isEnforced
      ? `internal-reward:${params.responseId}`
      : `integrity-hold:${params.responseId}`;
    if (await this.ledgerRepo.findJournalByIdempotencyKey(siblingKey)) {
      throw new IdempotencyConflictException(
        'Response already settled under another policy mode.',
      );
    }

    const publisherEscrow = await this.getOrCreateAccount(
      params.publisherId,
      'ESCROW',
    );
    if (publisherEscrow.balance < funding.escrowDraw) {
      throw new InsufficientEscrowBalanceException(
        publisherEscrow.balance,
        funding.escrowDraw,
        `Insufficient escrow points: Survey reward payout of ${funding.escrowDraw} Escrow points cannot be settled from publisher escrow balance of ${publisherEscrow.balance} points.`,
      );
    }

    const respondentTargetAccount = await this.getOrCreateAccount(
      params.respondentId,
      targetAccountClass,
    );
    const issuanceAccount =
      funding.platformSubsidy > 0
        ? await this.getOrCreateAccount(null, 'SYSTEM_ISSUANCE')
        : null;

    const description = isEnforced
      ? `Integrity hold for survey reward: ${params.responseId}`
      : `Survey reward credit: ${params.responseId}`;

    const journal = await this.postJournal({
      idempotencyKey,
      description,
      entries: [
        { accountId: publisherEscrow.id, amount: -funding.escrowDraw },
        ...(issuanceAccount
          ? [
              {
                accountId: issuanceAccount.id,
                amount: -funding.platformSubsidy,
              },
            ]
          : []),
        {
          accountId: respondentTargetAccount.id,
          amount: funding.respondentCredit,
        },
      ],
    });

    return this.toSettlementResult(journal, status, targetAccountClass);
  }

  /**
   * The posted settlement of an Internal response (`internal-reward:` or
   * `integrity-hold:` journal), or null when none exists yet.
   */
  async findInternalRewardSettlement(
    responseId: string,
  ): Promise<RewardSettlementResultDto | null> {
    const shadow = await this.ledgerRepo.findJournalByIdempotencyKey(
      `internal-reward:${responseId}`,
    );
    if (shadow) {
      return this.toSettlementResult(shadow, 'SETTLED', 'USER_AVAILABLE');
    }
    const held = await this.ledgerRepo.findJournalByIdempotencyKey(
      `integrity-hold:${responseId}`,
    );
    return held
      ? this.toSettlementResult(held, 'HELD_IN_INTEGRITY', 'INTEGRITY_HOLD')
      : null;
  }

  /**
   * The posted Pending credit of an External attempt, or null when none
   * exists yet.
   */
  async findPendingRewardSettlement(
    attemptId: string,
  ): Promise<RewardSettlementResultDto | null> {
    const credit = await this.ledgerRepo.findJournalByIdempotencyKey(
      externalCompletionKey(attemptId),
    );
    return credit
      ? this.toSettlementResult(credit, 'PENDING', 'PENDING')
      : null;
  }

  /**
   * Releases points held in INTEGRITY_HOLD to Respondent's USER_AVAILABLE upon successful integrity decision (AD-14, AD-16).
   * Keyed by idempotencyKey: `integrity-decision:${decisionId}`.
   */
  async releaseIntegrityHold(
    params: ReleaseIntegrityHoldParams,
  ): Promise<LedgerJournalEntity> {
    if (params.amount <= 0) {
      throw new InvalidLedgerOperationException(
        'Release amount must be a positive integer.',
      );
    }

    const idempotencyKey = `integrity-decision:${params.decisionId}`;

    // Fast-path idempotency check
    const existing =
      await this.ledgerRepo.findJournalByIdempotencyKey(idempotencyKey);
    if (existing) {
      return existing;
    }

    const respondentHold = await this.getOrCreateAccount(
      params.respondentId,
      'INTEGRITY_HOLD',
    );
    const respondentAvailable = await this.getOrCreateAccount(
      params.respondentId,
      'USER_AVAILABLE',
    );

    if (respondentHold.balance < params.amount) {
      throw new InsufficientBalanceException(
        `Insufficient integrity hold points: Cannot release ${params.amount} points from hold balance of ${respondentHold.balance} points.`,
      );
    }

    return this.postJournal({
      idempotencyKey,
      description: `Integrity decision release: ${params.decisionId} for response ${params.responseId}`,
      entries: [
        { accountId: respondentHold.id, amount: -params.amount },
        { accountId: respondentAvailable.id, amount: params.amount },
      ],
    });
  }

  /**
   * Fail-open release of points from INTEGRITY_HOLD to USER_AVAILABLE when assessment fails terminally or misses deadline (AD-14).
   * Keyed by idempotencyKey: `integrity-fail-open:${responseId}`.
   */
  async failOpenIntegrityHold(
    params: FailOpenIntegrityHoldParams,
  ): Promise<LedgerJournalEntity> {
    if (params.amount <= 0) {
      throw new InvalidLedgerOperationException(
        'Release amount must be a positive integer.',
      );
    }

    const idempotencyKey = `integrity-fail-open:${params.responseId}`;

    // Fast-path idempotency check
    const existing =
      await this.ledgerRepo.findJournalByIdempotencyKey(idempotencyKey);
    if (existing) {
      return existing;
    }

    const respondentHold = await this.getOrCreateAccount(
      params.respondentId,
      'INTEGRITY_HOLD',
    );
    const respondentAvailable = await this.getOrCreateAccount(
      params.respondentId,
      'USER_AVAILABLE',
    );

    const releaseAmount = Math.min(respondentHold.balance, params.amount);
    if (releaseAmount <= 0) {
      throw new InvalidLedgerOperationException(
        'No points available in integrity hold to fail open.',
      );
    }

    return this.postJournal({
      idempotencyKey,
      description: `Fail-open release from integrity hold: ${params.responseId} (${params.reason ?? 'Assessment timeout/error'})`,
      entries: [
        { accountId: respondentHold.id, amount: -releaseAmount },
        { accountId: respondentAvailable.id, amount: releaseAmount },
      ],
    });
  }

  /**
   * Credits survey reward to Respondent's PENDING account for an external survey (FR-24, AD-16).
   * Points are held for 48 hours before maturation.
   * Keyed by idempotencyKey: `external-completion:${attemptId}`.
   */
  async creditPendingReward(
    params: CreditPendingRewardParams,
  ): Promise<RewardSettlementResultDto> {
    if (params.amount <= 0) {
      throw new InvalidLedgerOperationException(
        'Pending reward amount must be a positive integer.',
      );
    }

    const idempotencyKey = externalCompletionKey(params.attemptId);

    // Fast-path idempotency check: only an identical command replays.
    const existing =
      await this.ledgerRepo.findJournalByIdempotencyKey(idempotencyKey);
    if (existing) {
      await this.assertReplayCompatible(existing, [
        {
          userId: params.publisherId,
          accountClass: 'ESCROW',
          amount: -params.amount,
        },
        {
          userId: params.respondentId,
          accountClass: 'PENDING',
          amount: params.amount,
        },
      ]);
      return this.toSettlementResult(existing, 'PENDING', 'PENDING');
    }

    const publisherEscrow = await this.getOrCreateAccount(
      params.publisherId,
      'ESCROW',
    );
    if (publisherEscrow.balance < params.amount) {
      throw new InsufficientEscrowBalanceException(
        publisherEscrow.balance,
        params.amount,
        `Insufficient escrow points: External survey pending reward payout of ${params.amount} points exceeds publisher escrow balance of ${publisherEscrow.balance} points.`,
      );
    }

    const respondentPending = await this.getOrCreateAccount(
      params.respondentId,
      'PENDING',
    );

    const journal = await this.postJournal({
      idempotencyKey,
      description: `Pending survey reward for external completion: ${params.attemptId}`,
      entries: [
        { accountId: publisherEscrow.id, amount: -params.amount },
        { accountId: respondentPending.id, amount: params.amount },
      ],
    });

    return this.toSettlementResult(journal, 'PENDING', 'PENDING');
  }

  /**
   * Releases a matured Pending credit to the Respondent's USER_AVAILABLE
   * account (FR-24). Keyed by `release-pending:${attemptId}`.
   *
   * Epic 6 review P2: everything is derived from the
   * `external-completion:{attemptId}` credit journal — its owner, its amount
   * and its age. The credit must exist, must not be reversed, and must be at
   * least 48 hours old (server clock). Open dispute holds are checked by
   * `RewardSettlementCoordinator` before this call.
   */
  async releasePendingReward(
    params: ReleasePendingRewardParams,
  ): Promise<LedgerJournalEntity> {
    const credit = await this.ledgerRepo.findJournalByIdempotencyKey(
      externalCompletionKey(params.attemptId),
    );
    if (!credit) {
      throw new PendingCreditNotFoundException(params.attemptId);
    }

    const creditEntry = credit.entries.find((entry) => entry.amount > 0);
    const pendingAccount = creditEntry
      ? await this.ledgerRepo.findAccountById(creditEntry.accountId)
      : null;
    if (
      !creditEntry ||
      !pendingAccount ||
      pendingAccount.accountClass !== 'PENDING' ||
      !pendingAccount.userId
    ) {
      throw new InvalidLedgerOperationException(
        'The completion credit of this attempt is not a Pending reward.',
      );
    }

    const respondentId = pendingAccount.userId;
    if (
      params.respondentId !== undefined &&
      params.respondentId !== respondentId
    ) {
      throw new PendingRewardForbiddenException();
    }

    const amount = creditEntry.amount;
    if (params.amount !== undefined && params.amount !== amount) {
      throw new IdempotencyConflictException(
        'The requested release amount does not match the pending credit.',
      );
    }

    const idempotencyKey = releasePendingKey(params.attemptId);
    const expectedEntries: ExpectedReplayEntry[] = [
      { userId: respondentId, accountClass: 'PENDING', amount: -amount },
      { userId: respondentId, accountClass: 'USER_AVAILABLE', amount },
    ];

    // Fast-path idempotency check: only an identical release replays.
    const existing =
      await this.ledgerRepo.findJournalByIdempotencyKey(idempotencyKey);
    if (existing) {
      await this.assertReplayCompatible(existing, expectedEntries);
      return existing;
    }

    // An upheld dispute reverses the credit (Phase 1): nothing to release.
    if (await this.isJournalReversed(credit.id)) {
      throw new PendingCreditNotFoundException(
        params.attemptId,
        'The pending reward of this attempt was reversed and can no longer be released.',
      );
    }

    const maturesAt = new Date(
      credit.createdAt.getTime() + PENDING_REWARD_MATURITY_MS,
    );
    if (this.clock().getTime() < maturesAt.getTime()) {
      throw new PendingRewardNotMaturedException(params.attemptId, maturesAt);
    }

    const respondentAvailable = await this.getOrCreateAccount(
      respondentId,
      'USER_AVAILABLE',
    );

    if (pendingAccount.balance < amount) {
      throw new InsufficientBalanceException(
        'Insufficient pending points to release this reward.',
      );
    }

    return this.postJournal({
      idempotencyKey,
      description: `Matured pending survey reward release: ${params.attemptId}`,
      entries: [
        { accountId: pendingAccount.id, amount: -amount },
        { accountId: respondentAvailable.id, amount },
      ],
    });
  }

  /**
   * FR-24 maturity scan (see `LedgerRepositoryPort.findMaturedPendingCredits`).
   */
  async findMaturedPendingCredits(params: {
    cutoff: Date;
    limit: number;
  }): Promise<LedgerJournalEntity[]> {
    return this.ledgerRepo.findMaturedPendingCredits(params);
  }

  /**
   * Moves pending points to INTEGRITY_HOLD when a dispute is opened during the 48-hour window (FR-24, AD-16).
   * Keyed by idempotencyKey: `external-dispute:${caseId}`.
   */
  async placeDisputeHold(
    params: PlaceDisputeHoldParams,
  ): Promise<LedgerJournalEntity> {
    if (params.amount <= 0) {
      throw new InvalidLedgerOperationException(
        'Dispute hold amount must be a positive integer.',
      );
    }

    const idempotencyKey = `external-dispute:${params.caseId}`;

    // Fast-path idempotency check
    const existing =
      await this.ledgerRepo.findJournalByIdempotencyKey(idempotencyKey);
    if (existing) {
      return existing;
    }

    const respondentPending = await this.getOrCreateAccount(
      params.respondentId,
      'PENDING',
    );
    const respondentHold = await this.getOrCreateAccount(
      params.respondentId,
      'INTEGRITY_HOLD',
    );

    if (respondentPending.balance < params.amount) {
      throw new InsufficientBalanceException(
        `Insufficient pending points to place dispute hold: ${params.amount} required, but pending balance is ${respondentPending.balance}.`,
      );
    }

    return this.postJournal({
      idempotencyKey,
      description: `Dispute hold placed for external attempt: ${params.attemptId} (Case ${params.caseId})`,
      entries: [
        { accountId: respondentPending.id, amount: -params.amount },
        { accountId: respondentHold.id, amount: params.amount },
      ],
    });
  }

  /**
   * Resolves a dispute hold, releasing points to Respondent or refunding them to Publisher (FR-24, AD-16).
   * Keyed by idempotencyKey: `dispute-resolution:${caseId}:${action}`.
   */
  async resolveDisputeHold(
    params: ResolveDisputeHoldParams,
  ): Promise<LedgerJournalEntity> {
    if (params.amount <= 0) {
      throw new InvalidLedgerOperationException(
        'Resolution amount must be a positive integer.',
      );
    }

    const isRelease = params.outcome === 'RELEASE_TO_RESPONDENT';
    const idempotencyKey = isRelease
      ? `dispute-resolution:${params.caseId}:release`
      : `dispute-resolution:${params.caseId}:refund`;

    // Fast-path idempotency check
    const existing =
      await this.ledgerRepo.findJournalByIdempotencyKey(idempotencyKey);
    if (existing) {
      return existing;
    }

    const respondentHold = await this.getOrCreateAccount(
      params.respondentId,
      'INTEGRITY_HOLD',
    );

    if (respondentHold.balance < params.amount) {
      throw new InsufficientBalanceException(
        `Insufficient integrity hold points for dispute resolution: ${params.amount} required, but hold balance is ${respondentHold.balance}.`,
      );
    }

    const destinationAccount = isRelease
      ? await this.getOrCreateAccount(params.respondentId, 'USER_AVAILABLE')
      : await this.getOrCreateAccount(params.publisherId, 'USER_AVAILABLE');

    const description = isRelease
      ? `Dispute resolution release to respondent: Case ${params.caseId}`
      : `Dispute resolution refund to publisher: Case ${params.caseId}`;

    return this.postJournal({
      idempotencyKey,
      description,
      entries: [
        { accountId: respondentHold.id, amount: -params.amount },
        { accountId: destinationAccount.id, amount: params.amount },
      ],
    });
  }

  /**
   * Verifies an account's denormalized balance against the mathematical sum of its immutable entries.
   */
  async verifyAccountBalance(
    accountId: string,
  ): Promise<AccountBalanceVerification> {
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
  async reconcileAccountBalance(
    accountId: string,
  ): Promise<AccountReconciliationResult> {
    return this.ledgerRepo.reconcileAccountBalance(accountId);
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

  /**
   * True when a correction journal reverses `journalId` (e.g. an Admin
   * reversal of a disputed External completion credit).
   */
  async isJournalReversed(journalId: string): Promise<boolean> {
    // Follow the non-branching correction chain: a reversed reversal
    // reinstates the original journal.
    let reversed = false;
    let current = journalId;
    for (let depth = 0; depth < 32; depth++) {
      const reversal = await this.ledgerRepo.findReversalJournal(current);
      if (!reversal) {
        break;
      }
      reversed = !reversed;
      current = reversal.id;
    }
    return reversed;
  }

  /**
   * Retrieves a journal by its unique idempotency key.
   */
  async findJournalByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<LedgerJournalEntity | null> {
    return this.ledgerRepo.findJournalByIdempotencyKey(idempotencyKey);
  }

  /**
   * Grants starter points from SYSTEM_ISSUANCE to the user's FROZEN account (FR-4, AD-16).
   * Keyed by idempotencyKey: `starter-grant:${userId}`.
   */
  async grantStarterPoints(
    userId: string,
    amount: number = STARTER_POINTS_DEFAULT_AMOUNT,
  ): Promise<LedgerJournalEntity> {
    if (amount <= 0) {
      throw new InvalidLedgerOperationException(
        'Starter points amount must be a positive integer.',
      );
    }

    const idempotencyKey = `starter-grant:${userId}`;
    const existing =
      await this.ledgerRepo.findJournalByIdempotencyKey(idempotencyKey);
    if (existing) {
      await this.assertReplayCompatible(existing, [
        { userId: null, accountClass: 'SYSTEM_ISSUANCE', amount: -amount },
        { userId, accountClass: 'FROZEN', amount },
      ]);
      return existing;
    }

    const systemAccount = await this.getOrCreateAccount(
      null,
      'SYSTEM_ISSUANCE',
    );
    const userFrozenAccount = await this.getOrCreateAccount(userId, 'FROZEN');

    return this.postJournal({
      idempotencyKey,
      description: `Starter points grant: ${userId}`,
      entries: [
        { accountId: systemAccount.id, amount: -amount },
        { accountId: userFrozenAccount.id, amount },
      ],
    });
  }

  /**
   * Unlocks starter points from the user's FROZEN account to USER_AVAILABLE upon onboarding completion (FR-8, AD-16).
   * Keyed by idempotencyKey: `starter-unlock:${userId}`.
   */
  async unlockStarterPoints(
    userId: string,
    amount: number = STARTER_POINTS_DEFAULT_AMOUNT,
  ): Promise<LedgerJournalEntity> {
    if (amount <= 0) {
      throw new InvalidLedgerOperationException(
        'Unlock amount must be a positive integer.',
      );
    }

    const idempotencyKey = `starter-unlock:${userId}`;
    const existing =
      await this.ledgerRepo.findJournalByIdempotencyKey(idempotencyKey);
    if (existing) {
      await this.assertReplayCompatible(existing, [
        { userId, accountClass: 'FROZEN', amount: -amount },
        { userId, accountClass: 'USER_AVAILABLE', amount },
      ]);
      return existing;
    }

    try {
      const userFrozenAccount = await this.getOrCreateAccount(userId, 'FROZEN');
      const userAvailableAccount = await this.getOrCreateAccount(
        userId,
        'USER_AVAILABLE',
      );

      if (userFrozenAccount.balance < amount) {
        throw new InvalidLedgerOperationException(
          `Insufficient frozen balance (${userFrozenAccount.balance}) to unlock ${amount} starter points.`,
        );
      }

      return await this.postJournal({
        idempotencyKey,
        description: `Starter points onboarding unlock: ${userId}`,
        entries: [
          { accountId: userFrozenAccount.id, amount: -amount },
          { accountId: userAvailableAccount.id, amount },
        ],
      });
    } catch (error) {
      // Story 7.2 (FR-8, exactly once): a concurrent unlock may have committed
      // between our fast-path lookup and the locked balance check. The loser
      // then sees an empty Frozen balance (Prisma locks + checks before the
      // journal insert) — converge on the winning journal instead of failing.
      const winner =
        await this.ledgerRepo.findJournalByIdempotencyKey(idempotencyKey);
      if (winner) {
        return winner;
      }
      throw error;
    }
  }

  /**
   * Automatically expires (voids) unmatured frozen starter points to SYSTEM_SINK (FR-5, AD-16).
   * Keyed by idempotencyKey: `starter-expiry:${userId}`.
   */
  async expireStarterPoints(
    userId: string,
    amount?: number,
  ): Promise<LedgerJournalEntity | null> {
    const idempotencyKey = `starter-expiry:${userId}`;
    const existing =
      await this.ledgerRepo.findJournalByIdempotencyKey(idempotencyKey);
    if (existing) {
      // The voided amount is the Frozen balance at expiry time (not
      // replay-stable), so only the accounts must match.
      await this.assertReplayCompatible(
        existing,
        [
          { userId, accountClass: 'FROZEN', amount: -1 },
          { userId: null, accountClass: 'SYSTEM_SINK', amount: 1 },
        ],
        'accounts',
      );
      return existing;
    }

    // Story 7.2 (FR-5 vs FR-8): activated starter points can never expire.
    const unlock = await this.ledgerRepo.findJournalByIdempotencyKey(
      `starter-unlock:${userId}`,
    );
    if (unlock) {
      return null;
    }

    const userFrozenAccount = await this.getOrCreateAccount(userId, 'FROZEN');
    const pointsToVoid = amount ?? userFrozenAccount.balance;

    if (pointsToVoid <= 0) {
      return null;
    }

    const systemSinkAccount = await this.getOrCreateAccount(
      null,
      'SYSTEM_SINK',
    );

    return this.postJournal({
      idempotencyKey,
      description: `Starter points 30-day onboarding expiry: ${userId}`,
      entries: [
        { accountId: userFrozenAccount.id, amount: -pointsToVoid },
        { accountId: systemSinkAccount.id, amount: pointsToVoid },
      ],
    });
  }

  /**
   * Credits an Admin-approved manual top-up (FR-35, AD-16): moves `amount`
   * Points from the external-settlement `SYSTEM_CLEARING` account to the
   * user's `USER_AVAILABLE` account. Keyed by `topup-approval:${topUpId}`, so
   * one approval can post at most one journal; a retry returns the original
   * journal and a retry with different parameters is rejected.
   */
  async creditApprovedTopUp(
    params: CreditApprovedTopUpParams,
  ): Promise<LedgerJournalEntity> {
    if (!Number.isInteger(params.amount) || params.amount <= 0) {
      throw new InvalidLedgerOperationException(
        'Top-up amount must be a positive integer.',
      );
    }

    const clearingAccount = await this.getOrCreateAccount(
      null,
      'SYSTEM_CLEARING',
    );
    const availableAccount = await this.getOrCreateAccount(
      params.userId,
      'USER_AVAILABLE',
    );

    // No fast path: postJournal returns the existing journal only when the
    // replayed command is identical, otherwise it raises a conflict.
    return this.postJournal({
      idempotencyKey: topUpApprovalKey(params.topUpId),
      description: `Manual top-up approval: ${params.transferReference} (${params.amount} points)`,
      entries: [
        { accountId: clearingAccount.id, amount: -params.amount },
        { accountId: availableAccount.id, amount: params.amount },
      ],
    });
  }

  /**
   * Epic 6 review P8: a fast-path replay returns the stored journal only when
   * it is the same command — the same accounts with the same amounts
   * (`exact`), or the same accounts on the same sides when the amount is
   * derived from a balance at posting time (`accounts`). Descriptions are
   * not compared (titles change). Anything else is an idempotency conflict.
   */
  private async assertReplayCompatible(
    existing: LedgerJournalEntity,
    expected: ExpectedReplayEntry[],
    mode: 'exact' | 'accounts' = 'exact',
  ): Promise<void> {
    const expectedKeys: string[] = [];
    for (const entry of expected) {
      const account = await this.ledgerRepo.findAccountByUserAndClass(
        entry.userId,
        entry.accountClass,
      );
      if (!account) {
        throw this.replayConflict(existing.idempotencyKey);
      }
      expectedKeys.push(this.replayEntryKey(account.id, entry.amount, mode));
    }

    const storedKeys = existing.entries
      .map((entry) => this.replayEntryKey(entry.accountId, entry.amount, mode))
      .sort();
    expectedKeys.sort();

    const isSame =
      storedKeys.length === expectedKeys.length &&
      storedKeys.every((key, index) => key === expectedKeys[index]);
    if (!isSame) {
      throw this.replayConflict(existing.idempotencyKey);
    }
  }

  private replayEntryKey(
    accountId: string,
    amount: number,
    mode: 'exact' | 'accounts',
  ): string {
    return mode === 'exact'
      ? `${accountId}:${amount}`
      : `${accountId}:${Math.sign(amount)}`;
  }

  private replayConflict(idempotencyKey: string): IdempotencyConflictException {
    return new IdempotencyConflictException(
      `Idempotency conflict: key "${idempotencyKey}" was already used for a different ledger command.`,
    );
  }

  /** Sum of a journal's positive entries (the amount it moved). */
  private positiveTotal(journal: LedgerJournalEntity): number {
    return journal.entries
      .filter((entry) => entry.amount > 0)
      .reduce((sum, entry) => sum + entry.amount, 0);
  }

  /** Reward DTO built from the posted journal, never from the request. */
  private toSettlementResult(
    journal: LedgerJournalEntity,
    status: RewardSettlementResultDto['status'],
    targetAccountClass: LedgerAccountClass,
  ): RewardSettlementResultDto {
    return {
      status,
      journalId: journal.id,
      amount: this.positiveTotal(journal),
      targetAccountClass,
      settledAt: journal.createdAt.toISOString(),
    };
  }

  /**
   * Ids of `journals` that are currently reversed (an odd-length correction
   * chain), looked up in one batch; only already-reversed journals follow
   * their chain further.
   */
  private async findReversedJournalIds(
    journals: LedgerJournalEntity[],
  ): Promise<Set<string>> {
    const reversed = new Set<string>();
    if (journals.length === 0) {
      return reversed;
    }
    const reversals = await this.ledgerRepo.findReversalJournalsFor(
      journals.map((journal) => journal.id),
    );
    for (const reversal of reversals) {
      if (
        reversal.reversesJournalId &&
        (await this.isJournalReversed(reversal.reversesJournalId))
      ) {
        reversed.add(reversal.reversesJournalId);
      }
    }
    return reversed;
  }

  private isJournalCompatible(
    existing: LedgerJournalEntity,
    command: PostJournalInput,
  ): boolean {
    if ((existing.description ?? null) !== (command.description ?? null)) {
      return false;
    }

    if (existing.entries.length !== command.entries.length) {
      return false;
    }

    const existingEntries = existing.entries
      .map((entry) => `${entry.accountId}:${entry.amount}`)
      .sort();
    const commandEntries = command.entries
      .map((entry) => `${entry.accountId}:${entry.amount}`)
      .sort();

    return existingEntries.every(
      (entry, index) => entry === commandEntries[index],
    );
  }
}
