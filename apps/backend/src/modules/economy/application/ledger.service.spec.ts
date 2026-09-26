import { InMemoryLedgerRepository } from '../infrastructure/in-memory-ledger.repository';
import { LedgerService } from './ledger.service';
import { LedgerAccountEntity } from '../domain/ledger-account.entity';
import { LedgerJournalEntity } from '../domain/ledger-journal.entity';
import { LedgerEntryEntity } from '../domain/ledger-entry.entity';
import { PostJournalTransactionOptions } from './ports/ledger-repository.port';
import {
  DisputeHoldActiveException,
  DownstreamJournalExistsException,
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

const HOUR_MS = 60 * 60 * 1000;

/**
 * In-memory repository that mimics the Prisma adapter's ordering: rows are
 * locked and balances checked before the journal row (unique idempotency key)
 * is inserted, atomically with the insert.
 */
class PrismaOrderingLedgerRepository extends InMemoryLedgerRepository {
  lockedBalanceRejections = 0;

  async postJournalTransaction(
    journal: LedgerJournalEntity,
    entries: LedgerEntryEntity[],
    options?: PostJournalTransactionOptions,
  ): Promise<LedgerJournalEntity> {
    const accounts = (
      this as unknown as { accounts: Map<string, LedgerAccountEntity> }
    ).accounts;
    for (const entry of entries) {
      const account = accounts.get(entry.accountId);
      if (account?.wouldOverdraft(entry.amount)) {
        this.lockedBalanceRejections++;
        throw new InsufficientBalanceException(
          `Account ${account.id} balance ${account.balance} is insufficient.`,
        );
      }
    }
    return super.postJournalTransaction(journal, entries, options);
  }
}

/**
 * Runs `beforeNextPost` once before the next posting reaches the repository,
 * so a command committed between a service pre-check and the insert can be
 * simulated (review F1).
 */
class RacingLedgerRepository extends InMemoryLedgerRepository {
  beforeNextPost: (() => Promise<void>) | null = null;

  async postJournalTransaction(
    journal: LedgerJournalEntity,
    entries: LedgerEntryEntity[],
    options?: PostJournalTransactionOptions,
  ): Promise<LedgerJournalEntity> {
    const interleaved = this.beforeNextPost;
    this.beforeNextPost = null;
    if (interleaved) {
      await interleaved();
    }
    return super.postJournalTransaction(journal, entries, options);
  }
}

describe('Story 6.1: Double-Entry Ledger Core & Idempotency - LedgerService', () => {
  let repo: InMemoryLedgerRepository;
  let service: LedgerService;

  const user1Id = '11111111-1111-4111-8111-111111111111';
  const user2Id = '22222222-2222-4222-8222-222222222222';

  beforeEach(() => {
    repo = new InMemoryLedgerRepository();
    service = new LedgerService(repo);
  });

  describe('Account Management', () => {
    it('creates account with initial balance 0 if it does not exist', async () => {
      const account = await service.getOrCreateAccount(
        user1Id,
        'USER_AVAILABLE',
      );
      expect(account.id).toBeDefined();
      expect(account.userId).toBe(user1Id);
      expect(account.accountClass).toBe('USER_AVAILABLE');
      expect(account.balance).toBe(0);
    });

    it('returns existing account without duplicating', async () => {
      const first = await service.getOrCreateAccount(user1Id, 'USER_AVAILABLE');
      const second = await service.getOrCreateAccount(
        user1Id,
        'USER_AVAILABLE',
      );
      expect(first.id).toBe(second.id);
    });

    it('creates only one account under concurrent get-or-create calls', async () => {
      const [first, second] = await Promise.all([
        service.getOrCreateAccount(user1Id, 'USER_AVAILABLE'),
        service.getOrCreateAccount(user1Id, 'USER_AVAILABLE'),
      ]);

      expect(first.id).toBe(second.id);
      expect(await service.getUserAccounts(user1Id)).toHaveLength(1);
    });

    it('rejects invalid user/system account ownership combinations', async () => {
      await expect(
        service.getOrCreateAccount(user1Id, 'SYSTEM_ISSUANCE'),
      ).rejects.toThrow(InvalidLedgerOperationException);
      await expect(
        service.getOrCreateAccount(null, 'USER_AVAILABLE'),
      ).rejects.toThrow(InvalidLedgerOperationException);
    });
  });

  describe('Double-Entry Zero-Sum Invariant (FR-30)', () => {
    it('successfully posts a balanced two-legged journal', async () => {
      const systemAccount = await service.getOrCreateAccount(
        null,
        'SYSTEM_ISSUANCE',
      );
      const userAccount = await service.getOrCreateAccount(
        user1Id,
        'USER_AVAILABLE',
      );

      const journal = await service.postJournal({
        idempotencyKey: 'cmd-issue-100',
        description: 'Starter points issuance',
        entries: [
          { accountId: systemAccount.id, amount: -100 },
          { accountId: userAccount.id, amount: 100 },
        ],
      });

      expect(journal.id).toBeDefined();
      expect(journal.idempotencyKey).toBe('cmd-issue-100');
      expect(journal.entries).toHaveLength(2);

      const updatedSystem = await service.getAccount(systemAccount.id);
      const updatedUser = await service.getAccount(userAccount.id);

      expect(updatedSystem.balance).toBe(-100);
      expect(updatedUser.balance).toBe(100);
    });

    it('successfully posts a balanced multi-legged journal', async () => {
      const systemAccount = await service.getOrCreateAccount(
        null,
        'SYSTEM_ISSUANCE',
      );
      const user1 = await service.getOrCreateAccount(user1Id, 'USER_AVAILABLE');
      const user2 = await service.getOrCreateAccount(user2Id, 'USER_AVAILABLE');

      const journal = await service.postJournal({
        idempotencyKey: 'cmd-multi-split',
        description: 'Split issuance',
        entries: [
          { accountId: systemAccount.id, amount: -300 },
          { accountId: user1.id, amount: 200 },
          { accountId: user2.id, amount: 100 },
        ],
      });

      expect(journal.entries).toHaveLength(3);
      expect((await service.getAccount(user1.id)).balance).toBe(200);
      expect((await service.getAccount(user2.id)).balance).toBe(100);
      expect((await service.getAccount(systemAccount.id)).balance).toBe(-300);
    });

    it('rejects an unbalanced journal where entries do not sum to zero', async () => {
      const systemAccount = await service.getOrCreateAccount(
        null,
        'SYSTEM_ISSUANCE',
      );
      const userAccount = await service.getOrCreateAccount(
        user1Id,
        'USER_AVAILABLE',
      );

      await expect(
        service.postJournal({
          idempotencyKey: 'cmd-unbalanced',
          entries: [
            { accountId: systemAccount.id, amount: -100 },
            { accountId: userAccount.id, amount: 80 },
          ],
        }),
      ).rejects.toThrow(UnbalancedJournalException);
    });

    it('maps an out-of-range entry amount to an invalid operation, not an unbalanced journal (Epic 6 review P12)', async () => {
      const systemAccount = await service.getOrCreateAccount(
        null,
        'SYSTEM_ISSUANCE',
      );
      const userAccount = await service.getOrCreateAccount(
        user1Id,
        'USER_AVAILABLE',
      );

      await expect(
        service.postJournal({
          idempotencyKey: 'overflow-journal',
          entries: [
            { accountId: systemAccount.id, amount: -3_000_000_000 },
            { accountId: userAccount.id, amount: 3_000_000_000 },
          ],
        }),
      ).rejects.toThrow(InvalidLedgerOperationException);
    });
  });

  describe('Overdraft Protection & Ascending Lock Order', () => {
    it('rejects point deduction that would overdraft USER_AVAILABLE account', async () => {
      const user1Available = await service.getOrCreateAccount(
        user1Id,
        'USER_AVAILABLE',
      );
      const user2Available = await service.getOrCreateAccount(
        user2Id,
        'USER_AVAILABLE',
      );

      // user1 has balance 0, cannot transfer 50
      await expect(
        service.transfer({
          fromAccountId: user1Available.id,
          toAccountId: user2Available.id,
          amount: 50,
          idempotencyKey: 'tx-overdraft-test',
        }),
      ).rejects.toThrow(InsufficientBalanceException);

      expect((await service.getAccount(user1Available.id)).balance).toBe(0);
      expect((await service.getAccount(user2Available.id)).balance).toBe(0);
    });

    it('prevents overdraft on PENDING, FROZEN, ESCROW, and INTEGRITY_HOLD accounts', async () => {
      const escrow = await service.getOrCreateAccount(user1Id, 'ESCROW');
      const frozen = await service.getOrCreateAccount(user1Id, 'FROZEN');
      const systemSink = await service.getOrCreateAccount(null, 'SYSTEM_SINK');

      await expect(
        service.transfer({
          fromAccountId: escrow.id,
          toAccountId: systemSink.id,
          amount: 10,
          idempotencyKey: 'escrow-overdraft',
        }),
      ).rejects.toThrow(InsufficientBalanceException);

      await expect(
        service.transfer({
          fromAccountId: frozen.id,
          toAccountId: systemSink.id,
          amount: 10,
          idempotencyKey: 'frozen-overdraft',
        }),
      ).rejects.toThrow(InsufficientBalanceException);
    });

    it('allows system accounts (SYSTEM_ISSUANCE, SYSTEM_SINK, SYSTEM_CLEARING) to carry negative balances', async () => {
      const systemIssuance = await service.getOrCreateAccount(
        null,
        'SYSTEM_ISSUANCE',
      );
      const userAccount = await service.getOrCreateAccount(
        user1Id,
        'USER_AVAILABLE',
      );

      await service.transfer({
        fromAccountId: systemIssuance.id,
        toAccountId: userAccount.id,
        amount: 500,
        idempotencyKey: 'tx-system-issuance',
      });

      expect((await service.getAccount(systemIssuance.id)).balance).toBe(-500);
      expect((await service.getAccount(userAccount.id)).balance).toBe(500);
    });

    it('rejects journals that mix currencies', async () => {
      const points = await service.getOrCreateAccount(
        null,
        'SYSTEM_ISSUANCE',
        'POINTS',
      );
      const usd = await service.getOrCreateAccount(
        null,
        'SYSTEM_CLEARING',
        'USD',
      );

      await expect(
        service.transfer({
          fromAccountId: points.id,
          toAccountId: usd.id,
          amount: 10,
          idempotencyKey: 'mixed-currency',
        }),
      ).rejects.toThrow(InvalidLedgerOperationException);
    });
  });

  describe('Idempotency & Replay Protection (FR-ADD-11)', () => {
    it('returns existing journal without creating duplicate entries when replayed with identical payload', async () => {
      const systemAccount = await service.getOrCreateAccount(
        null,
        'SYSTEM_ISSUANCE',
      );
      const userAccount = await service.getOrCreateAccount(
        user1Id,
        'USER_AVAILABLE',
      );

      const first = await service.postJournal({
        idempotencyKey: 'cmd-idempotent-key',
        description: 'First attempt',
        entries: [
          { accountId: systemAccount.id, amount: -150 },
          { accountId: userAccount.id, amount: 150 },
        ],
      });

      const second = await service.postJournal({
        idempotencyKey: 'cmd-idempotent-key',
        description: 'First attempt',
        entries: [
          { accountId: systemAccount.id, amount: -150 },
          { accountId: userAccount.id, amount: 150 },
        ],
      });

      expect(second.id).toBe(first.id);
      expect((await service.getAccount(userAccount.id)).balance).toBe(150); // Not doubled to 300
    });

    it('rejects with IdempotencyConflictException if same idempotency key is reused with different parameters', async () => {
      const systemAccount = await service.getOrCreateAccount(
        null,
        'SYSTEM_ISSUANCE',
      );
      const user1 = await service.getOrCreateAccount(user1Id, 'USER_AVAILABLE');
      const user2 = await service.getOrCreateAccount(user2Id, 'USER_AVAILABLE');

      await service.postJournal({
        idempotencyKey: 'cmd-conflict-key',
        entries: [
          { accountId: systemAccount.id, amount: -100 },
          { accountId: user1.id, amount: 100 },
        ],
      });

      await expect(
        service.postJournal({
          idempotencyKey: 'cmd-conflict-key',
          entries: [
            { accountId: systemAccount.id, amount: -100 },
            { accountId: user2.id, amount: 100 },
          ],
        }),
      ).rejects.toThrow(IdempotencyConflictException);
    });

    it('rejects a replay with the same legs but a different description', async () => {
      const system = await service.getOrCreateAccount(null, 'SYSTEM_ISSUANCE');
      const user = await service.getOrCreateAccount(user1Id, 'USER_AVAILABLE');
      const entries = [
        { accountId: system.id, amount: -10 },
        { accountId: user.id, amount: 10 },
      ];

      await service.postJournal({
        idempotencyKey: 'description-conflict',
        description: 'Original command',
        entries,
      });

      await expect(
        service.postJournal({
          idempotencyKey: 'description-conflict',
          description: 'Changed command',
          entries,
        }),
      ).rejects.toThrow(IdempotencyConflictException);
    });

    it('compares replay entries as a multiset including duplicate multiplicity', async () => {
      const issuance = await service.getOrCreateAccount(
        null,
        'SYSTEM_ISSUANCE',
      );
      const clearing = await service.getOrCreateAccount(
        null,
        'SYSTEM_CLEARING',
      );
      const user = await service.getOrCreateAccount(user1Id, 'USER_AVAILABLE');

      await service.postJournal({
        idempotencyKey: 'duplicate-multiset',
        entries: [
          { accountId: issuance.id, amount: -50 },
          { accountId: issuance.id, amount: -50 },
          { accountId: clearing.id, amount: -50 },
          { accountId: user.id, amount: 150 },
        ],
      });

      await expect(
        service.postJournal({
          idempotencyKey: 'duplicate-multiset',
          entries: [
            { accountId: issuance.id, amount: -50 },
            { accountId: clearing.id, amount: -50 },
            { accountId: clearing.id, amount: -50 },
            { accountId: user.id, amount: 150 },
          ],
        }),
      ).rejects.toThrow(IdempotencyConflictException);
    });

    it('deduplicates concurrent identical in-memory requests', async () => {
      const system = await service.getOrCreateAccount(null, 'SYSTEM_ISSUANCE');
      const user = await service.getOrCreateAccount(user1Id, 'USER_AVAILABLE');
      const command = {
        idempotencyKey: 'concurrent-identical',
        description: 'Concurrent retry',
        entries: [
          { accountId: system.id, amount: -25 },
          { accountId: user.id, amount: 25 },
        ],
      };

      const [first, second] = await Promise.all([
        service.postJournal(command),
        service.postJournal(command),
      ]);

      expect(first.id).toBe(second.id);
      expect((await service.getAccount(user.id)).balance).toBe(25);
    });
  });

  describe('Append-Only Immutability & Reversals', () => {
    it('reverses an existing journal by posting exact equal-and-opposite negation entries', async () => {
      const systemAccount = await service.getOrCreateAccount(
        null,
        'SYSTEM_ISSUANCE',
      );
      const userAccount = await service.getOrCreateAccount(
        user1Id,
        'USER_AVAILABLE',
      );

      const originalJournal = await service.postJournal({
        idempotencyKey: 'cmd-to-reverse',
        entries: [
          { accountId: systemAccount.id, amount: -200 },
          { accountId: userAccount.id, amount: 200 },
        ],
      });

      expect((await service.getAccount(userAccount.id)).balance).toBe(200);

      const reversalJournal = await service.reverseJournal({
        targetJournalId: originalJournal.id,
        reason: 'Faulty issuance',
      });

      expect(reversalJournal.reversesJournalId).toBe(originalJournal.id);
      expect(reversalJournal.entries).toHaveLength(2);

      // Balances must be exactly negated
      expect((await service.getAccount(userAccount.id)).balance).toBe(0);
      expect((await service.getAccount(systemAccount.id)).balance).toBe(0);
    });

    it('enforces that each journal can be reversed at most once', async () => {
      const systemAccount = await service.getOrCreateAccount(
        null,
        'SYSTEM_ISSUANCE',
      );
      const userAccount = await service.getOrCreateAccount(
        user1Id,
        'USER_AVAILABLE',
      );

      const originalJournal = await service.postJournal({
        idempotencyKey: 'cmd-single-reversal',
        entries: [
          { accountId: systemAccount.id, amount: -100 },
          { accountId: userAccount.id, amount: 100 },
        ],
      });

      await service.reverseJournal({
        targetJournalId: originalJournal.id,
      });

      await expect(
        service.reverseJournal({
          targetJournalId: originalJournal.id,
          idempotencyKey: 'second-reversal-attempt',
        }),
      ).rejects.toThrow(JournalAlreadyReversedException);
    });

    it('returns the original reversal for an identical retry', async () => {
      const system = await service.getOrCreateAccount(null, 'SYSTEM_ISSUANCE');
      const user = await service.getOrCreateAccount(user1Id, 'USER_AVAILABLE');
      const original = await service.postJournal({
        idempotencyKey: 'reversal-retry-original',
        entries: [
          { accountId: system.id, amount: -30 },
          { accountId: user.id, amount: 30 },
        ],
      });

      const first = await service.reverseJournal({
        targetJournalId: original.id,
      });
      const retry = await service.reverseJournal({
        targetJournalId: original.id,
      });

      expect(retry.id).toBe(first.id);
      expect((await service.getAccount(user.id)).balance).toBe(0);
    });

    it('rejects a reversal key already owned by an unrelated journal', async () => {
      const system = await service.getOrCreateAccount(null, 'SYSTEM_ISSUANCE');
      const user = await service.getOrCreateAccount(user1Id, 'USER_AVAILABLE');
      const target = await service.postJournal({
        idempotencyKey: 'target-for-key-collision',
        entries: [
          { accountId: system.id, amount: -20 },
          { accountId: user.id, amount: 20 },
        ],
      });
      await service.postJournal({
        idempotencyKey: 'unrelated-key',
        entries: [
          { accountId: system.id, amount: -5 },
          { accountId: user.id, amount: 5 },
        ],
      });

      await expect(
        service.reverseJournal({
          targetJournalId: target.id,
          idempotencyKey: 'unrelated-key',
        }),
      ).rejects.toThrow(IdempotencyConflictException);
    });

    it('rejects reversal of non-existent journal with JournalNotFoundException', async () => {
      await expect(
        service.reverseJournal({
          targetJournalId: '99999999-9999-4999-8999-999999999999',
        }),
      ).rejects.toThrow(JournalNotFoundException);
    });

    it('supports reversal chains where reversing a reversal restores the original state', async () => {
      const systemAccount = await service.getOrCreateAccount(
        null,
        'SYSTEM_ISSUANCE',
      );
      const userAccount = await service.getOrCreateAccount(
        user1Id,
        'USER_AVAILABLE',
      );

      // J1: Issue 100
      const j1 = await service.postJournal({
        idempotencyKey: 'chain-j1',
        entries: [
          { accountId: systemAccount.id, amount: -100 },
          { accountId: userAccount.id, amount: 100 },
        ],
      });
      expect((await service.getAccount(userAccount.id)).balance).toBe(100);

      // J2: Reverse J1 (balance back to 0)
      const j2 = await service.reverseJournal({
        targetJournalId: j1.id,
        idempotencyKey: 'chain-j2-reverses-j1',
      });
      expect((await service.getAccount(userAccount.id)).balance).toBe(0);

      // J3: Reverse J2 (balance restored back to 100)
      const j3 = await service.reverseJournal({
        targetJournalId: j2.id,
        idempotencyKey: 'chain-j3-reverses-j2',
      });
      expect(j3.reversesJournalId).toBe(j2.id);
      expect((await service.getAccount(userAccount.id)).balance).toBe(100);
    });
  });

  describe('Balance Derivability & Ledger Integrity', () => {
    it('verifies that projected balance equals calculated sum of immutable entries', async () => {
      const systemAccount = await service.getOrCreateAccount(
        null,
        'SYSTEM_ISSUANCE',
      );
      const userAccount = await service.getOrCreateAccount(
        user1Id,
        'USER_AVAILABLE',
      );

      await service.transfer({
        fromAccountId: systemAccount.id,
        toAccountId: userAccount.id,
        amount: 300,
        idempotencyKey: 'deriv-1',
      });

      await service.transfer({
        fromAccountId: systemAccount.id,
        toAccountId: userAccount.id,
        amount: 200,
        idempotencyKey: 'deriv-2',
      });

      const verification = await service.verifyAccountBalance(userAccount.id);
      expect(verification.projectedBalance).toBe(500);
      expect(verification.calculatedBalance).toBe(500);
      expect(verification.isConsistent).toBe(true);
    });

    it('reconciles and repairs projected balance if drift occurred', async () => {
      const systemAccount = await service.getOrCreateAccount(
        null,
        'SYSTEM_ISSUANCE',
      );
      const userAccount = await service.getOrCreateAccount(
        user1Id,
        'USER_AVAILABLE',
      );

      await service.transfer({
        fromAccountId: systemAccount.id,
        toAccountId: userAccount.id,
        amount: 200,
        idempotencyKey: 'reconcile-1',
      });

      // Artificially corrupt the in-memory projection
      await repo.rebuildAccountBalance(userAccount.id, 999);
      expect((await service.getAccount(userAccount.id)).balance).toBe(999);

      // Reconcile
      const result = await service.reconcileAccountBalance(userAccount.id);
      expect(result.priorBalance).toBe(999);
      expect(result.correctedBalance).toBe(200);

      // Re-verify
      const after = await service.getAccount(userAccount.id);
      expect(after.balance).toBe(200);
    });

    it('verifies that whole-system balance is zero-sum', async () => {
      const systemAccount = await service.getOrCreateAccount(
        null,
        'SYSTEM_ISSUANCE',
      );
      const user1 = await service.getOrCreateAccount(user1Id, 'USER_AVAILABLE');
      const user2 = await service.getOrCreateAccount(user2Id, 'USER_AVAILABLE');

      await service.transfer({
        fromAccountId: systemAccount.id,
        toAccountId: user1.id,
        amount: 400,
        idempotencyKey: 'sys-1',
      });

      await service.transfer({
        fromAccountId: user1.id,
        toAccountId: user2.id,
        amount: 150,
        idempotencyKey: 'sys-2',
      });

      const report = await service.verifyLedgerIntegrity();
      expect(report.totalSystemBalance).toBe(0);
      expect(report.isZeroSum).toBe(true);
    });
  });

  describe('Wallet Balance Aggregation & Presentation (Story 6.2 - FR-31)', () => {
    it('auto-provisions all 5 user account classes with 0 balance and empty transactions for new user', async () => {
      const wallet = await service.getWallet(user1Id);

      expect(wallet.balance).toEqual({
        available: 0,
        pending: 0,
        escrow: 0,
        frozen: 0,
        integrityHold: 0,
        total: 0,
      });

      expect(wallet.transactions).toEqual([]);
      expect(wallet.accounts).toHaveLength(5);
      const classes = wallet.accounts.map((a) => a.accountClass);
      expect(classes).toContain('USER_AVAILABLE');
      expect(classes).toContain('PENDING');
      expect(classes).toContain('FROZEN');
      expect(classes).toContain('ESCROW');
      expect(classes).toContain('INTEGRITY_HOLD');
    });

    it('accurately aggregates non-zero balances across all 5 account classes and computes total', async () => {
      const system = await service.getOrCreateAccount(null, 'SYSTEM_ISSUANCE');
      const available = await service.getOrCreateAccount(
        user1Id,
        'USER_AVAILABLE',
      );
      const pending = await service.getOrCreateAccount(user1Id, 'PENDING');
      const escrow = await service.getOrCreateAccount(user1Id, 'ESCROW');
      const frozen = await service.getOrCreateAccount(user1Id, 'FROZEN');
      const integrityHold = await service.getOrCreateAccount(
        user1Id,
        'INTEGRITY_HOLD',
      );

      // Issue points across user accounts
      await service.transfer({
        fromAccountId: system.id,
        toAccountId: available.id,
        amount: 300,
        idempotencyKey: 'tx-wallet-avail',
        description: 'Earned survey rewards',
      });

      await service.transfer({
        fromAccountId: system.id,
        toAccountId: pending.id,
        amount: 50,
        idempotencyKey: 'tx-wallet-pend',
        description: 'External survey pending',
      });

      await service.transfer({
        fromAccountId: system.id,
        toAccountId: escrow.id,
        amount: 120,
        idempotencyKey: 'tx-wallet-escrow',
        description: 'Survey publishing deposit',
      });

      await service.transfer({
        fromAccountId: system.id,
        toAccountId: frozen.id,
        amount: 100,
        idempotencyKey: 'tx-wallet-frozen',
        description: 'Starter onboarding points',
      });

      await service.transfer({
        fromAccountId: system.id,
        toAccountId: integrityHold.id,
        amount: 25,
        idempotencyKey: 'tx-wallet-hold',
        description: 'Integrity review hold',
      });

      const wallet = await service.getWallet(user1Id);

      expect(wallet.balance.available).toBe(300);
      expect(wallet.balance.pending).toBe(50);
      expect(wallet.balance.escrow).toBe(120);
      expect(wallet.balance.frozen).toBe(100);
      expect(wallet.balance.integrityHold).toBe(25);
      expect(wallet.balance.total).toBe(595);

      // Verify transaction history
      expect(wallet.transactions).toHaveLength(5);
      expect(wallet.transactions[0].description).toBe('Integrity review hold');
      expect(wallet.transactions[0].amount).toBe(25);
      expect(wallet.transactions[0].accountClass).toBe('INTEGRITY_HOLD');
    });

    it('returns only the requesting user transactions without leaking other users transactions', async () => {
      const system = await service.getOrCreateAccount(null, 'SYSTEM_ISSUANCE');
      const user1Avail = await service.getOrCreateAccount(
        user1Id,
        'USER_AVAILABLE',
      );
      const user2Avail = await service.getOrCreateAccount(
        user2Id,
        'USER_AVAILABLE',
      );

      await service.transfer({
        fromAccountId: system.id,
        toAccountId: user1Avail.id,
        amount: 100,
        idempotencyKey: 'tx-user1-only',
        description: 'User 1 reward',
      });

      await service.transfer({
        fromAccountId: system.id,
        toAccountId: user2Avail.id,
        amount: 200,
        idempotencyKey: 'tx-user2-only',
        description: 'User 2 reward',
      });

      const wallet1 = await service.getWallet(user1Id);
      expect(wallet1.transactions).toHaveLength(1);
      expect(wallet1.transactions[0].description).toBe('User 1 reward');
      expect(wallet1.balance.available).toBe(100);

      const wallet2 = await service.getWallet(user2Id);
      expect(wallet2.transactions).toHaveLength(1);
      expect(wallet2.transactions[0].description).toBe('User 2 reward');
      expect(wallet2.balance.available).toBe(200);
    });
  });

  describe('Story 6.3: Escrow Lock, Release & Refund (FR-15, FR-32, FR-33)', () => {
    const versionId = '33333333-3333-4333-8333-333333333333';
    const formId = '44444444-4444-4444-8444-444444444444';

    beforeEach(async () => {
      // Seed user1 with 500 available points from system issuance
      const system = await service.getOrCreateAccount(null, 'SYSTEM_ISSUANCE');
      const userAvail = await service.getOrCreateAccount(
        user1Id,
        'USER_AVAILABLE',
      );
      await service.transfer({
        fromAccountId: system.id,
        toAccountId: userAvail.id,
        amount: 500,
        idempotencyKey: 'seed-user1-500',
        description: 'Initial seed',
      });
    });

    describe('reserveEscrow (FR-15)', () => {
      it('locks required points from USER_AVAILABLE to ESCROW', async () => {
        const journal = await service.reserveEscrow({
          userId: user1Id,
          formVersionId: versionId,
          amount: 200,
          formTitle: 'Market Research 2026',
        });

        expect(journal).not.toBeNull();
        expect(journal?.idempotencyKey).toBe(`publish:${versionId}`);

        const wallet = await service.getWallet(user1Id);
        expect(wallet.balance.available).toBe(300);
        expect(wallet.balance.escrow).toBe(200);
        expect(wallet.balance.total).toBe(500);
      });

      it('returns null and does not move funds if amount is 0 (free survey)', async () => {
        const journal = await service.reserveEscrow({
          userId: user1Id,
          formVersionId: versionId,
          amount: 0,
        });

        expect(journal).toBeNull();
        const wallet = await service.getWallet(user1Id);
        expect(wallet.balance.available).toBe(500);
        expect(wallet.balance.escrow).toBe(0);
      });

      it('rejects with InsufficientEscrowBalanceException if available balance is inadequate', async () => {
        await expect(
          service.reserveEscrow({
            userId: user1Id,
            formVersionId: versionId,
            amount: 600, // available is 500
          }),
        ).rejects.toThrow(InsufficientEscrowBalanceException);

        // Verify balance did not change
        const wallet = await service.getWallet(user1Id);
        expect(wallet.balance.available).toBe(500);
        expect(wallet.balance.escrow).toBe(0);
      });

      it('safely handles idempotent retries for the same formVersionId', async () => {
        const first = await service.reserveEscrow({
          userId: user1Id,
          formVersionId: versionId,
          amount: 150,
        });

        const retry = await service.reserveEscrow({
          userId: user1Id,
          formVersionId: versionId,
          amount: 150,
        });

        expect(first?.id).toBe(retry?.id);
        const wallet = await service.getWallet(user1Id);
        expect(wallet.balance.available).toBe(350);
        expect(wallet.balance.escrow).toBe(150);
      });

      it('rejects a replay of the same key with another amount (Epic 6 review P8)', async () => {
        await service.reserveEscrow({
          userId: user1Id,
          formVersionId: versionId,
          amount: 150,
        });

        await expect(
          service.reserveEscrow({
            userId: user1Id,
            formVersionId: versionId,
            amount: 200,
          }),
        ).rejects.toThrow(IdempotencyConflictException);
        const wallet = await service.getWallet(user1Id);
        expect(wallet.balance.escrow).toBe(150);
      });

      it('keeps the INSUFFICIENT_ESCROW_BALANCE contract when the locked balance check fails (Epic 6 review P11)', async () => {
        // The unlocked pre-check passes, the locked check inside the posting
        // fails (a concurrent spend).
        const racingRepo = new InMemoryLedgerRepository();
        const racingService = new LedgerService(racingRepo);
        const system = await racingService.getOrCreateAccount(
          null,
          'SYSTEM_ISSUANCE',
        );
        const avail = await racingService.getOrCreateAccount(
          user1Id,
          'USER_AVAILABLE',
        );
        await racingService.transfer({
          fromAccountId: system.id,
          toAccountId: avail.id,
          amount: 500,
          idempotencyKey: 'seed-racing',
        });
        jest
          .spyOn(racingRepo, 'postJournalTransaction')
          .mockRejectedValueOnce(
            new InsufficientBalanceException(
              'Insufficient balance for ledger posting.',
            ),
          );

        const error = await racingService
          .reserveEscrow({
            userId: user1Id,
            formVersionId: versionId,
            amount: 200,
          })
          .catch((e) => e);

        expect(error).toBeInstanceOf(InsufficientEscrowBalanceException);
        expect(error.code).toBe('INSUFFICIENT_ESCROW_BALANCE');
        expect(error.availableBalance).toBe(500);
        expect(error.requiredAmount).toBe(200);
      });

      it('Story 8.1: reports the points reserved for a FormVersion (0 when none)', async () => {
        expect(await service.getEscrowReservation(versionId)).toBe(0);

        await service.reserveEscrow({
          userId: user1Id,
          formVersionId: versionId,
          amount: 180,
        });

        expect(await service.getEscrowReservation(versionId)).toBe(180);
        expect(
          await service.getEscrowReservation(
            '99999999-9999-4999-8999-999999999999',
          ),
        ).toBe(0);
      });
    });

    describe('refundUnusedEscrow (FR-32)', () => {
      beforeEach(async () => {
        // Lock 200 points into Escrow first
        await service.reserveEscrow({
          userId: user1Id,
          formVersionId: versionId,
          amount: 200,
        });
      });

      it('refunds unused points from ESCROW back to USER_AVAILABLE', async () => {
        const journal = await service.refundUnusedEscrow({
          userId: user1Id,
          formId,
          closeVersion: 1,
          unusedAmount: 80,
          formTitle: 'Market Research 2026',
        });

        expect(journal).not.toBeNull();
        expect(journal?.idempotencyKey).toBe(`close-refund:${formId}:1`);

        const wallet = await service.getWallet(user1Id);
        expect(wallet.balance.escrow).toBe(120);
        expect(wallet.balance.available).toBe(380);
      });

      it('returns null if unusedAmount is 0 (all quotas fulfilled)', async () => {
        const journal = await service.refundUnusedEscrow({
          userId: user1Id,
          formId,
          closeVersion: 1,
          unusedAmount: 0,
        });

        expect(journal).toBeNull();
        const wallet = await service.getWallet(user1Id);
        expect(wallet.balance.escrow).toBe(200);
        expect(wallet.balance.available).toBe(300);
      });

      it('caps refund amount to current escrow balance if unusedAmount exceeds escrow', async () => {
        const journal = await service.refundUnusedEscrow({
          userId: user1Id,
          formId,
          closeVersion: 1,
          unusedAmount: 300, // escrow only has 200
        });

        expect(journal).not.toBeNull();
        const wallet = await service.getWallet(user1Id);
        expect(wallet.balance.escrow).toBe(0);
        expect(wallet.balance.available).toBe(500);
      });

      it('describes the refund with the unused slots (6.3 AC4.3, Epic 6 review P16)', async () => {
        const journal = await service.refundUnusedEscrow({
          userId: user1Id,
          formId,
          closeVersion: 'c1',
          unusedAmount: 80,
          unusedCompletions: 10,
          formTitle: 'Market Research 2026',
        });

        expect(journal?.idempotencyKey).toBe(`close-refund:${formId}:c1`);
        expect(journal?.description).toBe(
          'Escrow refund on survey close: Market Research 2026 (10 unused slots)',
        );
      });

      it('replays a refund by accounts only (the amount is balance-capped) (Epic 6 review P8)', async () => {
        const first = await service.refundUnusedEscrow({
          userId: user1Id,
          formId,
          closeVersion: 'c1',
          unusedAmount: 100,
        });
        const replay = await service.refundUnusedEscrow({
          userId: user1Id,
          formId,
          closeVersion: 'c1',
          unusedAmount: 60,
        });

        expect(replay?.id).toBe(first?.id);
        const wallet = await service.getWallet(user1Id);
        expect(wallet.balance.escrow).toBe(100);

        await expect(
          service.refundUnusedEscrow({
            userId: user2Id,
            formId,
            closeVersion: 'c1',
            unusedAmount: 100,
          }),
        ).rejects.toThrow(IdempotencyConflictException);
      });

      it('safely handles idempotent retries for survey close refund', async () => {
        const first = await service.refundUnusedEscrow({
          userId: user1Id,
          formId,
          closeVersion: 1,
          unusedAmount: 100,
        });

        const retry = await service.refundUnusedEscrow({
          userId: user1Id,
          formId,
          closeVersion: 1,
          unusedAmount: 100,
        });

        expect(first?.id).toBe(retry?.id);
        const wallet = await service.getWallet(user1Id);
        expect(wallet.balance.escrow).toBe(100);
        expect(wallet.balance.available).toBe(400);
      });
    });

    describe('reopenEscrow (FR-33)', () => {
      it('locks additional points from USER_AVAILABLE to ESCROW', async () => {
        const journal = await service.reopenEscrow({
          userId: user1Id,
          formId,
          reopenVersion: 2,
          additionalAmount: 100,
          formTitle: 'Market Research 2026',
        });

        expect(journal.idempotencyKey).toBe(`reopen-escrow:${formId}:2`);

        const wallet = await service.getWallet(user1Id);
        expect(wallet.balance.available).toBe(400);
        expect(wallet.balance.escrow).toBe(100);
      });

      it('rejects a reopen replay with another amount (Epic 6 review P8)', async () => {
        const first = await service.reopenEscrow({
          userId: user1Id,
          formId,
          reopenVersion: 'c1',
          additionalAmount: 100,
        });
        const replay = await service.reopenEscrow({
          userId: user1Id,
          formId,
          reopenVersion: 'c1',
          additionalAmount: 100,
        });
        expect(replay.id).toBe(first.id);

        await expect(
          service.reopenEscrow({
            userId: user1Id,
            formId,
            reopenVersion: 'c1',
            additionalAmount: 120,
          }),
        ).rejects.toThrow(IdempotencyConflictException);
      });

      it('rejects reopen if available points are insufficient', async () => {
        await expect(
          service.reopenEscrow({
            userId: user1Id,
            formId,
            reopenVersion: 2,
            additionalAmount: 600,
          }),
        ).rejects.toThrow(InsufficientEscrowBalanceException);
      });
    });
  });

  describe('Story 6.4: Respondent Point Credit & Pending Logic', () => {
    const publisherId = '11111111-1111-4111-8111-111111111111';
    const respondentId = '22222222-2222-4222-8222-222222222222';
    const responseId = '33333333-3333-4333-8333-333333333333';
    const attemptId = '44444444-4444-4444-8444-444444444444';
    const caseId = '55555555-5555-4555-8555-555555555555';

    beforeEach(async () => {
      // Seed publisher escrow account with 200 points
      const systemAccount = await service.getOrCreateAccount(
        null,
        'SYSTEM_ISSUANCE',
      );
      const publisherEscrow = await service.getOrCreateAccount(
        publisherId,
        'ESCROW',
      );
      await service.postJournal({
        idempotencyKey: 'seed-publisher-escrow',
        entries: [
          { accountId: systemAccount.id, amount: -200 },
          { accountId: publisherEscrow.id, amount: 200 },
        ],
      });
    });

    describe('creditInternalReward (FR-29)', () => {
      it('instantly credits USER_AVAILABLE for authenticated internal survey in SHADOW mode', async () => {
        const result = await service.creditInternalReward({
          responseId,
          publisherId,
          respondentId,
          amount: 25,
          policyMode: 'SHADOW',
        });

        expect(result.status).toBe('SETTLED');
        expect(result.amount).toBe(25);
        expect(result.targetAccountClass).toBe('USER_AVAILABLE');
        expect(result.journalId).not.toBeNull();
        expect(result.journalId).toEqual(expect.any(String));

        const respondentWallet = await service.getWallet(respondentId);
        expect(respondentWallet.balance.available).toBe(25);

        // Decision E6-D1 (option B): Escrow pays round(0.8 x 25) = 20, the
        // platform subsidises the other 5.
        const publisherWallet = await service.getWallet(publisherId);
        expect(publisherWallet.balance.escrow).toBe(180);
      });

      it('posts ONE balanced journal: ESCROW -effective, SYSTEM_ISSUANCE -discount, respondent +reward (decision E6-D1)', async () => {
        const system = await service.getOrCreateAccount(
          null,
          'SYSTEM_ISSUANCE',
        );
        const issuanceBefore = system.balance;

        const result = await service.creditInternalReward({
          responseId,
          publisherId,
          respondentId,
          amount: 25,
          policyMode: 'SHADOW',
        });

        const journal = await service.findJournalByIdempotencyKey(
          `internal-reward:${responseId}`,
        );
        expect(journal?.id).toBe(result.journalId);
        const escrow = await service.getOrCreateAccount(publisherId, 'ESCROW');
        const available = await service.getOrCreateAccount(
          respondentId,
          'USER_AVAILABLE',
        );
        expect(
          journal!.entries
            .map((entry) => ({
              accountId: entry.accountId,
              amount: entry.amount,
            }))
            .sort((a, b) => a.amount - b.amount),
        ).toEqual([
          { accountId: escrow.id, amount: -20 },
          { accountId: system.id, amount: -5 },
          { accountId: available.id, amount: 25 },
        ]);
        expect(
          (await service.getOrCreateAccount(null, 'SYSTEM_ISSUANCE')).balance,
        ).toBe(issuanceBefore - 5);
        expect(result.amount).toBe(25);
      });

      it('posts a two-entry journal when rounding leaves no subsidy (reward 2 -> Escrow 2)', async () => {
        await service.creditInternalReward({
          responseId,
          publisherId,
          respondentId,
          amount: 2,
        });

        const journal = await service.findJournalByIdempotencyKey(
          `internal-reward:${responseId}`,
        );
        expect(journal!.entries.map((entry) => entry.amount).sort()).toEqual([
          -2, 2,
        ]);
        expect((await service.getWallet(publisherId)).balance.escrow).toBe(198);
      });

      it('checks the Escrow draw, not the full reward, against the Escrow balance', async () => {
        // Leave exactly 20 in Escrow: a 25-point reward draws 20 of it.
        const escrow = await service.getOrCreateAccount(publisherId, 'ESCROW');
        const sink = await service.getOrCreateAccount(
          publisherId,
          'USER_AVAILABLE',
        );
        await service.transfer({
          fromAccountId: escrow.id,
          toAccountId: sink.id,
          amount: 180,
          idempotencyKey: 'drain-escrow-to-20',
        });

        const result = await service.creditInternalReward({
          responseId,
          publisherId,
          respondentId,
          amount: 25,
        });

        expect(result.status).toBe('SETTLED');
        expect((await service.getWallet(publisherId)).balance.escrow).toBe(0);
        expect((await service.getWallet(respondentId)).balance.available).toBe(
          25,
        );
      });

      it('credits INTEGRITY_HOLD for authenticated survey under ENFORCED policy', async () => {
        const result = await service.creditInternalReward({
          responseId,
          publisherId,
          respondentId,
          amount: 30,
          policyMode: 'ENFORCED',
        });

        expect(result.status).toBe('HELD_IN_INTEGRITY');
        expect(result.amount).toBe(30);
        expect(result.targetAccountClass).toBe('INTEGRITY_HOLD');

        const respondentWallet = await service.getWallet(respondentId);
        expect(respondentWallet.balance.available).toBe(0);
        expect(respondentWallet.balance.integrityHold).toBe(30);

        // The full reward is held; Escrow pays round(0.8 x 30) = 24.
        const publisherWallet = await service.getWallet(publisherId);
        expect(publisherWallet.balance.escrow).toBe(176);
      });

      it('skips ledger movement and returns SKIPPED_GUEST for guest submissions', async () => {
        const result = await service.creditInternalReward({
          responseId,
          publisherId,
          respondentId: null,
          amount: 25,
          policyMode: 'SHADOW',
        });

        expect(result.status).toBe('SKIPPED_GUEST');
        expect(result.amount).toBe(0);
        expect(result.journalId).toBeNull();
        expect(result.targetAccountClass).toBeNull();

        const publisherWallet = await service.getWallet(publisherId);
        expect(publisherWallet.balance.escrow).toBe(200);
      });

      it('idempotently returns previous result on retry', async () => {
        const first = await service.creditInternalReward({
          responseId,
          publisherId,
          respondentId,
          amount: 25,
          policyMode: 'SHADOW',
        });

        const retry = await service.creditInternalReward({
          responseId,
          publisherId,
          respondentId,
          amount: 25,
          policyMode: 'SHADOW',
        });

        expect(first.journalId).toBe(retry.journalId);
        expect(retry.status).toBe('SETTLED');

        const respondentWallet = await service.getWallet(respondentId);
        expect(respondentWallet.balance.available).toBe(25);
        // One journal only: the replay neither drew Escrow nor minted again.
        expect((await service.getWallet(publisherId)).balance.escrow).toBe(180);
        const journals = await repo.findJournalsByIdempotencyKeyPrefix(
          `internal-reward:${responseId}`,
        );
        expect(journals).toHaveLength(1);
      });

      it('rejects a replay with another amount or publisher and reports the posted amount (Epic 6 review P8)', async () => {
        const first = await service.creditInternalReward({
          responseId,
          publisherId,
          respondentId,
          amount: 25,
        });

        await expect(
          service.creditInternalReward({
            responseId,
            publisherId,
            respondentId,
            amount: 40,
          }),
        ).rejects.toThrow(IdempotencyConflictException);
        await expect(
          service.creditInternalReward({
            responseId,
            publisherId: respondentId,
            respondentId,
            amount: 25,
          }),
        ).rejects.toThrow(IdempotencyConflictException);

        const replay = await service.creditInternalReward({
          responseId,
          publisherId,
          respondentId,
          amount: 25,
        });
        expect(replay).toEqual(first);
        expect(replay.amount).toBe(25);
        const respondentWallet = await service.getWallet(respondentId);
        expect(respondentWallet.balance.available).toBe(25);
      });

      it('never rewards one response twice by switching the policy mode (Epic 6 review P9)', async () => {
        await service.creditInternalReward({
          responseId,
          publisherId,
          respondentId,
          amount: 25,
          policyMode: 'SHADOW',
        });

        await expect(
          service.creditInternalReward({
            responseId,
            publisherId,
            respondentId,
            amount: 25,
            policyMode: 'ENFORCED',
          }),
        ).rejects.toThrow('Response already settled under another policy mode');

        const respondentWallet = await service.getWallet(respondentId);
        expect(respondentWallet.balance.available).toBe(25);
        expect(respondentWallet.balance.integrityHold).toBe(0);
        const publisherWallet = await service.getWallet(publisherId);
        expect(publisherWallet.balance.escrow).toBe(180);
      });

      it('looks up an existing settlement without posting (Epic 6 review P5)', async () => {
        expect(await service.findInternalRewardSettlement(responseId)).toBe(
          null,
        );
        const posted = await service.creditInternalReward({
          responseId,
          publisherId,
          respondentId,
          amount: 25,
          policyMode: 'ENFORCED',
        });

        expect(await service.findInternalRewardSettlement(responseId)).toEqual(
          posted,
        );
      });

      it('throws InsufficientEscrowBalanceException when publisher escrow is insufficient', async () => {
        await expect(
          service.creditInternalReward({
            responseId,
            publisherId,
            respondentId,
            amount: 500,
            policyMode: 'SHADOW',
          }),
        ).rejects.toThrow(InsufficientEscrowBalanceException);
      });
    });

    describe('releaseIntegrityHold & failOpenIntegrityHold (AD-14)', () => {
      beforeEach(async () => {
        // Put 30 points into integrity hold
        await service.creditInternalReward({
          responseId,
          publisherId,
          respondentId,
          amount: 30,
          policyMode: 'ENFORCED',
        });
      });

      it('releases points from INTEGRITY_HOLD to USER_AVAILABLE upon decision', async () => {
        const decisionId = '66666666-6666-4666-8666-666666666666';
        const journal = await service.releaseIntegrityHold({
          respondentId,
          responseId,
          decisionId,
          amount: 30,
        });

        expect(journal.idempotencyKey).toBe(`integrity-decision:${decisionId}`);

        const wallet = await service.getWallet(respondentId);
        expect(wallet.balance.integrityHold).toBe(0);
        expect(wallet.balance.available).toBe(30);
      });

      it('fail-open releases points from INTEGRITY_HOLD to USER_AVAILABLE upon timeout', async () => {
        const journal = await service.failOpenIntegrityHold({
          respondentId,
          responseId,
          amount: 30,
          reason: 'Assessment deadline expired',
        });

        expect(journal.idempotencyKey).toBe(
          `integrity-fail-open:${responseId}`,
        );

        const wallet = await service.getWallet(respondentId);
        expect(wallet.balance.integrityHold).toBe(0);
        expect(wallet.balance.available).toBe(30);
      });
    });

    describe('creditPendingReward (FR-24)', () => {
      it('credits points from ESCROW to PENDING for external survey completion', async () => {
        const result = await service.creditPendingReward({
          attemptId,
          publisherId,
          respondentId,
          amount: 20,
        });

        expect(result.status).toBe('PENDING');
        expect(result.amount).toBe(20);
        expect(result.targetAccountClass).toBe('PENDING');

        const respondentWallet = await service.getWallet(respondentId);
        expect(respondentWallet.balance.available).toBe(0);
        expect(respondentWallet.balance.pending).toBe(20);

        const publisherWallet = await service.getWallet(publisherId);
        expect(publisherWallet.balance.escrow).toBe(180);
      });

      it('is idempotent on retry', async () => {
        const first = await service.creditPendingReward({
          attemptId,
          publisherId,
          respondentId,
          amount: 20,
        });

        const retry = await service.creditPendingReward({
          attemptId,
          publisherId,
          respondentId,
          amount: 20,
        });

        expect(first.journalId).toBe(retry.journalId);
      });

      it('rejects a replay with another amount and reports the posted amount (Epic 6 review P8)', async () => {
        await service.creditPendingReward({
          attemptId,
          publisherId,
          respondentId,
          amount: 20,
        });

        await expect(
          service.creditPendingReward({
            attemptId,
            publisherId,
            respondentId,
            amount: 50,
          }),
        ).rejects.toThrow(IdempotencyConflictException);
        const existing = await service.findPendingRewardSettlement(attemptId);
        expect(existing).toEqual(
          expect.objectContaining({ status: 'PENDING', amount: 20 }),
        );
      });
    });

    describe('releasePendingReward & dispute holds (FR-24)', () => {
      const creditTime = new Date('2026-09-20T08:00:00.000Z');
      let now: Date;

      beforeEach(async () => {
        // Epic 6 review P2: an injectable clock drives the 48-hour window.
        now = creditTime;
        service = new LedgerService(repo, { clock: () => now });
        // Credit 20 pending points
        await service.creditPendingReward({
          attemptId,
          publisherId,
          respondentId,
          amount: 20,
        });
      });

      it('releases matured pending points to USER_AVAILABLE when no dispute exists', async () => {
        now = new Date(creditTime.getTime() + 48 * HOUR_MS);
        const journal = await service.releasePendingReward({
          attemptId,
          respondentId,
          amount: 20,
        });

        expect(journal.idempotencyKey).toBe(`release-pending:${attemptId}`);

        const wallet = await service.getWallet(respondentId);
        expect(wallet.balance.pending).toBe(0);
        expect(wallet.balance.available).toBe(20);
      });

      it('refuses a release before the 48-hour review window ends (Epic 6 review P2)', async () => {
        now = new Date(creditTime.getTime() + 48 * HOUR_MS - 1);

        const error = await service
          .releasePendingReward({ attemptId })
          .catch((e) => e);

        expect(error).toBeInstanceOf(PendingRewardNotMaturedException);
        expect(error.maturesAt).toEqual(
          new Date(creditTime.getTime() + 48 * HOUR_MS),
        );
        const wallet = await service.getWallet(respondentId);
        expect(wallet.balance.pending).toBe(20);
        expect(wallet.balance.available).toBe(0);
      });

      it('derives owner and amount from the credit and releases exactly once', async () => {
        now = new Date(creditTime.getTime() + 49 * HOUR_MS);

        const first = await service.releasePendingReward({ attemptId });
        const replay = await service.releasePendingReward({
          attemptId,
          respondentId,
        });

        expect(replay.id).toBe(first.id);
        expect(first.entries.map((entry) => entry.amount).sort()).toEqual([
          -20, 20,
        ]);
        const wallet = await service.getWallet(respondentId);
        expect(wallet.balance.available).toBe(20);
        expect(wallet.balance.pending).toBe(0);
      });

      it('rejects a caller-supplied amount that differs from the credit', async () => {
        now = new Date(creditTime.getTime() + 49 * HOUR_MS);

        await expect(
          service.releasePendingReward({ attemptId, amount: 25 }),
        ).rejects.toThrow(IdempotencyConflictException);
      });

      it("rejects another respondent's credit", async () => {
        now = new Date(creditTime.getTime() + 49 * HOUR_MS);

        await expect(
          service.releasePendingReward({
            attemptId,
            respondentId: publisherId,
          }),
        ).rejects.toThrow(PendingRewardForbiddenException);
      });

      it('rejects an attempt that was never credited', async () => {
        now = new Date(creditTime.getTime() + 49 * HOUR_MS);

        await expect(
          service.releasePendingReward({
            attemptId: '66666666-6666-4666-8666-666666666666',
          }),
        ).rejects.toThrow(PendingCreditNotFoundException);
      });

      it('rejects a reversed credit (upheld dispute)', async () => {
        const credit = await service.findJournalByIdempotencyKey(
          `external-completion:${attemptId}`,
        );
        await service.reverseJournal({ targetJournalId: credit!.id });
        now = new Date(creditTime.getTime() + 49 * HOUR_MS);

        await expect(
          service.releasePendingReward({ attemptId }),
        ).rejects.toThrow(PendingCreditNotFoundException);
      });

      it('scans matured, unreleased, unreversed credits oldest first', async () => {
        const secondAttempt = '77777777-7777-4777-8777-777777777777';
        now = new Date(creditTime.getTime() + 10 * HOUR_MS);
        await service.creditPendingReward({
          attemptId: secondAttempt,
          publisherId,
          respondentId,
          amount: 10,
        });

        const cutoff = new Date(creditTime.getTime() + 5 * HOUR_MS);
        const matured = await service.findMaturedPendingCredits({
          cutoff,
          limit: 10,
        });
        expect(matured.map((journal) => journal.idempotencyKey)).toEqual([
          `external-completion:${attemptId}`,
        ]);

        now = new Date(creditTime.getTime() + 60 * HOUR_MS);
        await service.releasePendingReward({ attemptId });
        const later = await service.findMaturedPendingCredits({
          cutoff: new Date(creditTime.getTime() + 12 * HOUR_MS),
          limit: 10,
        });
        expect(later.map((journal) => journal.idempotencyKey)).toEqual([
          `external-completion:${secondAttempt}`,
        ]);
      });

      it('places dispute hold, moving points from PENDING to INTEGRITY_HOLD', async () => {
        const journal = await service.placeDisputeHold({
          caseId,
          attemptId,
          respondentId,
          amount: 20,
        });

        expect(journal.idempotencyKey).toBe(`external-dispute:${caseId}`);

        const wallet = await service.getWallet(respondentId);
        expect(wallet.balance.pending).toBe(0);
        expect(wallet.balance.integrityHold).toBe(20);
      });

      it('resolves dispute in favor of respondent: INTEGRITY_HOLD -> USER_AVAILABLE', async () => {
        await service.placeDisputeHold({
          caseId,
          attemptId,
          respondentId,
          amount: 20,
        });

        const journal = await service.resolveDisputeHold({
          caseId,
          respondentId,
          publisherId,
          amount: 20,
          outcome: 'RELEASE_TO_RESPONDENT',
        });

        expect(journal.idempotencyKey).toBe(
          `dispute-resolution:${caseId}:release`,
        );

        const wallet = await service.getWallet(respondentId);
        expect(wallet.balance.integrityHold).toBe(0);
        expect(wallet.balance.available).toBe(20);
      });

      it('resolves dispute in favor of publisher: INTEGRITY_HOLD -> Publisher Available', async () => {
        await service.placeDisputeHold({
          caseId,
          attemptId,
          respondentId,
          amount: 20,
        });

        const journal = await service.resolveDisputeHold({
          caseId,
          respondentId,
          publisherId,
          amount: 20,
          outcome: 'REFUND_TO_PUBLISHER',
        });

        expect(journal.idempotencyKey).toBe(
          `dispute-resolution:${caseId}:refund`,
        );

        const respondentWallet = await service.getWallet(respondentId);
        expect(respondentWallet.balance.integrityHold).toBe(0);
        expect(respondentWallet.balance.available).toBe(0);

        const publisherWallet = await service.getWallet(publisherId);
        expect(publisherWallet.balance.available).toBe(20);
      });
    });

    describe('under-lock re-checks of release and dispute hold (review F1)', () => {
      const creditTime = new Date('2026-09-20T08:00:00.000Z');
      const otherAttemptId = '77777777-7777-4777-8777-777777777777';
      let now: Date;
      let racingRepo: RacingLedgerRepository;

      beforeEach(async () => {
        now = creditTime;
        racingRepo = new RacingLedgerRepository();
        service = new LedgerService(racingRepo, { clock: () => now });
        const systemAccount = await service.getOrCreateAccount(
          null,
          'SYSTEM_ISSUANCE',
        );
        const publisherEscrow = await service.getOrCreateAccount(
          publisherId,
          'ESCROW',
        );
        await service.postJournal({
          idempotencyKey: 'seed-publisher-escrow',
          entries: [
            { accountId: systemAccount.id, amount: -200 },
            { accountId: publisherEscrow.id, amount: 200 },
          ],
        });
        // Two credits pool in the same Pending account.
        await service.creditPendingReward({
          attemptId,
          publisherId,
          respondentId,
          amount: 20,
        });
        await service.creditPendingReward({
          attemptId: otherAttemptId,
          publisherId,
          respondentId,
          amount: 20,
        });
      });

      async function creditJournal() {
        return (await service.findJournalByIdempotencyKey(
          `external-completion:${attemptId}`,
        ))!;
      }

      it('refuses a release when the credit is reversed after the pre-check, keeping pooled Pending intact', async () => {
        const credit = await creditJournal();
        racingRepo.beforeNextPost = async () => {
          await service.reverseJournal({ targetJournalId: credit.id });
        };
        now = new Date(creditTime.getTime() + 49 * HOUR_MS);

        const error = await service
          .releasePendingReward({ attemptId })
          .catch((e) => e);

        expect(error).toBeInstanceOf(PendingCreditNotFoundException);
        expect(await service.isJournalReversed(credit.id)).toBe(true);
        expect(
          await service.findJournalByIdempotencyKey(
            `release-pending:${attemptId}`,
          ),
        ).toBeNull();
        const wallet = await service.getWallet(respondentId);
        // Only the other credit's 20 points remain, and they stay Pending.
        expect(wallet.balance.pending).toBe(20);
        expect(wallet.balance.available).toBe(0);
      });

      it('refuses a release when a dispute hold is placed after the pre-check', async () => {
        racingRepo.beforeNextPost = async () => {
          await service.placeDisputeHold({
            caseId,
            attemptId,
            respondentId,
            amount: 20,
          });
        };
        now = new Date(creditTime.getTime() + 49 * HOUR_MS);

        const error = await service
          .releasePendingReward({ attemptId })
          .catch((e) => e);

        expect(error).toBeInstanceOf(DisputeHoldActiveException);
        expect(
          await service.findJournalByIdempotencyKey(
            `release-pending:${attemptId}`,
          ),
        ).toBeNull();
        const wallet = await service.getWallet(respondentId);
        expect(wallet.balance.pending).toBe(20);
        expect(wallet.balance.integrityHold).toBe(20);
        expect(wallet.balance.available).toBe(0);
      });

      it('does not let an open hold of another attempt block the release', async () => {
        await service.placeDisputeHold({
          caseId,
          attemptId,
          respondentId,
          amount: 20,
        });
        now = new Date(creditTime.getTime() + 49 * HOUR_MS);

        const journal = await service.releasePendingReward({
          attemptId: otherAttemptId,
        });

        expect(journal.idempotencyKey).toBe(
          `release-pending:${otherAttemptId}`,
        );
        const wallet = await service.getWallet(respondentId);
        expect(wallet.balance.pending).toBe(0);
        expect(wallet.balance.integrityHold).toBe(20);
        expect(wallet.balance.available).toBe(20);
      });

      it('refuses a dispute hold on a credit reversed after the pre-check', async () => {
        const credit = await creditJournal();
        racingRepo.beforeNextPost = async () => {
          await service.reverseJournal({ targetJournalId: credit.id });
        };

        const error = await service
          .placeDisputeHold({ caseId, attemptId, respondentId, amount: 20 })
          .catch((e) => e);

        expect(error).toBeInstanceOf(PendingCreditNotFoundException);
        expect(
          await service.findJournalByIdempotencyKey(
            `external-dispute:${caseId}`,
          ),
        ).toBeNull();
        const wallet = await service.getWallet(respondentId);
        expect(wallet.balance.pending).toBe(20);
        expect(wallet.balance.integrityHold).toBe(0);
      });

      it('refuses a dispute hold on an already reversed credit', async () => {
        const credit = await creditJournal();
        await service.reverseJournal({ targetJournalId: credit.id });

        await expect(
          service.placeDisputeHold({
            caseId,
            attemptId,
            respondentId,
            amount: 20,
          }),
        ).rejects.toThrow(PendingCreditNotFoundException);
        const wallet = await service.getWallet(respondentId);
        expect(wallet.balance.pending).toBe(20);
        expect(wallet.balance.integrityHold).toBe(0);
      });
    });

    describe('dispute hold and resolution guards (BE-5)', () => {
      const creditTime = new Date('2026-09-20T08:00:00.000Z');
      const otherAttemptId = '77777777-7777-4777-8777-777777777777';
      const otherCaseId = '88888888-8888-4888-8888-888888888888';
      let now: Date;

      beforeEach(async () => {
        now = creditTime;
        service = new LedgerService(repo, { clock: () => now });
        // Two credits pool in the same Pending account, so the balance
        // pre-checks alone cannot catch a hold or resolution of the wrong
        // attempt.
        await service.creditPendingReward({
          attemptId,
          publisherId,
          respondentId,
          amount: 20,
        });
        await service.creditPendingReward({
          attemptId: otherAttemptId,
          publisherId,
          respondentId,
          amount: 20,
        });
      });

      function hold(id = caseId, attempt = attemptId, amount = 20) {
        return service.placeDisputeHold({
          caseId: id,
          attemptId: attempt,
          respondentId,
          amount,
        });
      }

      function resolve(
        outcome: 'RELEASE_TO_RESPONDENT' | 'REFUND_TO_PUBLISHER',
        id = caseId,
        amount = 20,
      ) {
        return service.resolveDisputeHold({
          caseId: id,
          respondentId,
          publisherId,
          amount,
          outcome,
        });
      }

      async function release() {
        now = new Date(creditTime.getTime() + 49 * HOUR_MS);
        return service.releasePendingReward({ attemptId });
      }

      async function expectNoHoldPosted() {
        expect(
          await service.findJournalByIdempotencyKey(
            `external-dispute:${caseId}`,
          ),
        ).toBeNull();
      }

      describe('placeDisputeHold', () => {
        it('refuses an attempt without a completion credit', async () => {
          const error = await hold(
            caseId,
            '66666666-6666-4666-8666-666666666666',
          ).catch((e) => e);

          expect(error).toBeInstanceOf(PendingCreditNotFoundException);
          await expectNoHoldPosted();
          const wallet = await service.getWallet(respondentId);
          expect(wallet.balance.pending).toBe(40);
          expect(wallet.balance.integrityHold).toBe(0);
        });

        it('refuses a reversed credit', async () => {
          const credit = await service.findJournalByIdempotencyKey(
            `external-completion:${attemptId}`,
          );
          await service.reverseJournal({ targetJournalId: credit!.id });

          await expect(hold()).rejects.toThrow(PendingCreditNotFoundException);
          await expectNoHoldPosted();
          expect((await service.getWallet(respondentId)).balance.pending).toBe(
            20,
          );
        });

        it.each([15, 40])(
          'refuses an amount (%d) that differs from the credit',
          async (amount) => {
            await expect(hold(caseId, attemptId, amount)).rejects.toThrow(
              IdempotencyConflictException,
            );
            await expectNoHoldPosted();
            const wallet = await service.getWallet(respondentId);
            expect(wallet.balance.pending).toBe(40);
            expect(wallet.balance.integrityHold).toBe(0);
          },
        );

        it('refuses a credit already released to Available', async () => {
          await release();

          await expect(hold()).rejects.toThrow(InvalidLedgerOperationException);
          await expectNoHoldPosted();
          const wallet = await service.getWallet(respondentId);
          // The other attempt's 20 pooled points stay Pending.
          expect(wallet.balance.pending).toBe(20);
          expect(wallet.balance.integrityHold).toBe(0);
          expect(wallet.balance.available).toBe(20);
        });

        it('allows a hold once the release is reversed', async () => {
          const releaseJournal = await release();
          await service.reverseJournal({ targetJournalId: releaseJournal.id });

          await expect(hold()).resolves.toBeDefined();
          const wallet = await service.getWallet(respondentId);
          expect(wallet.balance.pending).toBe(20);
          expect(wallet.balance.integrityHold).toBe(20);
        });

        it('refuses a second hold of the same attempt, even once the first is resolved', async () => {
          await hold();

          await expect(hold(otherCaseId)).rejects.toThrow(
            DisputeHoldActiveException,
          );
          await resolve('RELEASE_TO_RESPONDENT');
          await expect(hold(otherCaseId)).rejects.toThrow(
            DisputeHoldActiveException,
          );
          expect(
            await service.findJournalByIdempotencyKey(
              `external-dispute:${otherCaseId}`,
            ),
          ).toBeNull();
          const wallet = await service.getWallet(respondentId);
          // The other attempt's 20 pooled points stay Pending.
          expect(wallet.balance.pending).toBe(20);
          expect(wallet.balance.integrityHold).toBe(0);
        });

        it('allows a new hold of the attempt once the first hold is reversed', async () => {
          const first = await hold();
          await service.reverseJournal({ targetJournalId: first.id });

          await expect(hold(otherCaseId)).resolves.toBeDefined();
          expect(
            (await service.getWallet(respondentId)).balance.integrityHold,
          ).toBe(20);
        });

        it('replays an identical hold and refuses a different one under the same case', async () => {
          const first = await hold();

          expect((await hold()).id).toBe(first.id);
          await expect(hold(caseId, attemptId, 15)).rejects.toThrow(
            IdempotencyConflictException,
          );
          await expect(hold(caseId, otherAttemptId)).rejects.toThrow(
            IdempotencyConflictException,
          );
          expect(
            (await service.getWallet(respondentId)).balance.integrityHold,
          ).toBe(20);
        });
      });

      describe('resolveDisputeHold', () => {
        it('refuses a case without a dispute hold', async () => {
          // Another attempt's hold funds the pooled Integrity Hold.
          await hold(otherCaseId, otherAttemptId);

          await expect(resolve('REFUND_TO_PUBLISHER')).rejects.toThrow(
            InvalidLedgerOperationException,
          );
          expect(
            await service.findJournalByIdempotencyKey(
              `dispute-resolution:${caseId}:refund`,
            ),
          ).toBeNull();
          expect(
            (await service.getWallet(respondentId)).balance.integrityHold,
          ).toBe(20);
          expect((await service.getWallet(publisherId)).balance.available).toBe(
            0,
          );
        });

        it('refuses a case whose dispute hold is reversed', async () => {
          const first = await hold();
          await hold(otherCaseId, otherAttemptId);
          await service.reverseJournal({ targetJournalId: first.id });

          await expect(resolve('RELEASE_TO_RESPONDENT')).rejects.toThrow(
            InvalidLedgerOperationException,
          );
          const wallet = await service.getWallet(respondentId);
          expect(wallet.balance.integrityHold).toBe(20);
          expect(wallet.balance.available).toBe(0);
        });

        it.each([10, 40])(
          'refuses an amount (%d) that differs from the hold',
          async (amount) => {
            await hold();
            await hold(otherCaseId, otherAttemptId);

            await expect(
              resolve('RELEASE_TO_RESPONDENT', caseId, amount),
            ).rejects.toThrow(IdempotencyConflictException);
            const wallet = await service.getWallet(respondentId);
            expect(wallet.balance.integrityHold).toBe(40);
            expect(wallet.balance.available).toBe(0);
          },
        );

        it('refuses the opposite resolution while the first stands, and allows it once reversed', async () => {
          await hold();
          await hold(otherCaseId, otherAttemptId);
          const refund = await resolve('REFUND_TO_PUBLISHER');

          await expect(resolve('RELEASE_TO_RESPONDENT')).rejects.toThrow(
            IdempotencyConflictException,
          );
          expect(
            (await service.getWallet(respondentId)).balance.integrityHold,
          ).toBe(20);

          await service.reverseJournal({ targetJournalId: refund.id });
          await expect(resolve('RELEASE_TO_RESPONDENT')).resolves.toBeDefined();
          const wallet = await service.getWallet(respondentId);
          expect(wallet.balance.integrityHold).toBe(20);
          expect(wallet.balance.available).toBe(20);
          expect((await service.getWallet(publisherId)).balance.available).toBe(
            0,
          );
        });
      });

      describe('getExternalCreditState', () => {
        it('reads PENDING again once the release is reversed', async () => {
          const releaseJournal = await release();
          expect(await service.getExternalCreditState(attemptId)).toBe(
            'RELEASED',
          );

          await service.reverseJournal({ targetJournalId: releaseJournal.id });

          expect(await service.getExternalCreditState(attemptId)).toBe(
            'PENDING',
          );
          expect(await service.getExternalSettlementState(attemptId)).toBe(
            'PENDING',
          );
        });
      });
    });

    describe('reverseJournal downstream guard (review 3.2)', () => {
      const creditTime = new Date('2026-09-20T08:00:00.000Z');
      const otherAttemptId = '77777777-7777-4777-8777-777777777777';
      let now: Date;

      beforeEach(async () => {
        now = creditTime;
        service = new LedgerService(repo, { clock: () => now });
        await service.creditPendingReward({
          attemptId,
          publisherId,
          respondentId,
          amount: 20,
        });
        // A second credit pools in the same Pending account: without the
        // guard, reversing the released credit would silently drain it.
        await service.creditPendingReward({
          attemptId: otherAttemptId,
          publisherId,
          respondentId,
          amount: 20,
        });
      });

      async function creditJournal(id = attemptId) {
        return (await service.findJournalByIdempotencyKey(
          `external-completion:${id}`,
        ))!;
      }

      async function release() {
        now = new Date(creditTime.getTime() + 49 * HOUR_MS);
        return service.releasePendingReward({ attemptId });
      }

      async function placeHold() {
        return service.placeDisputeHold({
          caseId,
          attemptId,
          respondentId,
          amount: 20,
        });
      }

      it('refuses to reverse a released credit and posts nothing (409)', async () => {
        const releaseJournal = await release();
        const credit = await creditJournal();
        const entriesBefore = await repo.sumAllEntries();
        const pendingBefore = (await service.getWallet(respondentId)).balance
          .pending;

        const error = await service
          .reverseJournal({ targetJournalId: credit.id })
          .catch((e) => e);

        expect(error).toBeInstanceOf(DownstreamJournalExistsException);
        expect(error.code).toBe('LEDGER_DOWNSTREAM_JOURNAL_EXISTS');
        expect(error.targetIdempotencyKey).toBe(
          `external-completion:${attemptId}`,
        );
        expect(error.blockingIdempotencyKey).toBe(
          releaseJournal.idempotencyKey,
        );
        expect(await repo.findReversalJournal(credit.id)).toBeNull();
        expect(await repo.sumAllEntries()).toBe(entriesBefore);
        expect((await service.getWallet(respondentId)).balance.pending).toBe(
          pendingBefore,
        );
        // The other attempt's pooled credit can still be released.
        await expect(
          service.releasePendingReward({ attemptId: otherAttemptId }),
        ).resolves.toBeDefined();
      });

      it('reverses the release first, then the credit', async () => {
        const releaseJournal = await release();
        const credit = await creditJournal();

        await service.reverseJournal({ targetJournalId: releaseJournal.id });
        const reversal = await service.reverseJournal({
          targetJournalId: credit.id,
        });

        expect(reversal.reversesJournalId).toBe(credit.id);
        const wallet = await service.getWallet(respondentId);
        expect(wallet.balance.available).toBe(0);
        expect(wallet.balance.pending).toBe(20);
        await expect(
          service.releasePendingReward({ attemptId: otherAttemptId }),
        ).resolves.toBeDefined();
      });

      it('refuses to reverse a credit under an open dispute hold (409)', async () => {
        const hold = await placeHold();
        const credit = await creditJournal();

        const error = await service
          .reverseJournal({ targetJournalId: credit.id })
          .catch((e) => e);

        expect(error).toBeInstanceOf(DownstreamJournalExistsException);
        expect(error.blockingIdempotencyKey).toBe(hold.idempotencyKey);
        expect(await repo.findReversalJournal(credit.id)).toBeNull();
      });

      it('refuses to reverse a dispute hold or re-instate the release once the dispute is resolved', async () => {
        // BE-5: a live release blocks the hold, so the release is reversed
        // before the dispute is opened.
        const releaseJournal = await release();
        const releaseReversal = await service.reverseJournal({
          targetJournalId: releaseJournal.id,
        });
        const hold = await placeHold();
        const resolution = await service.resolveDisputeHold({
          caseId,
          respondentId,
          publisherId,
          amount: 20,
          outcome: 'REFUND_TO_PUBLISHER',
        });

        for (const target of [hold, releaseReversal]) {
          const error = await service
            .reverseJournal({ targetJournalId: target.id })
            .catch((e) => e);
          expect(error).toBeInstanceOf(DownstreamJournalExistsException);
          expect(error.blockingIdempotencyKey).toBe(resolution.idempotencyKey);
        }

        // Unwinding in order: resolution, hold, then the release is free.
        await service.reverseJournal({ targetJournalId: resolution.id });
        await service.reverseJournal({ targetJournalId: hold.id });
        await expect(
          service.reverseJournal({
            targetJournalId: releaseReversal.id,
            idempotencyKey: 'reinstate-release',
          }),
        ).resolves.toBeDefined();
      });

      it('leaves unrelated journals reversible', async () => {
        await release();
        const other = await creditJournal(otherAttemptId);
        const system = await service.getOrCreateAccount(
          null,
          'SYSTEM_ISSUANCE',
        );
        const available = await service.getOrCreateAccount(
          respondentId,
          'USER_AVAILABLE',
        );
        const manual = await service.postJournal({
          idempotencyKey: 'manual-adjustment',
          entries: [
            { accountId: system.id, amount: -5 },
            { accountId: available.id, amount: 5 },
          ],
        });

        await expect(
          service.reverseJournal({ targetJournalId: other.id }),
        ).resolves.toBeDefined();
        await expect(
          service.reverseJournal({ targetJournalId: manual.id }),
        ).resolves.toBeDefined();
      });

      describe('reversal of a reversal (re-instatement)', () => {
        async function unwindReleaseThenCredit() {
          const releaseJournal = await release();
          const releaseReversal = await service.reverseJournal({
            targetJournalId: releaseJournal.id,
          });
          const creditReversal = await service.reverseJournal({
            targetJournalId: (await creditJournal()).id,
          });
          return { releaseReversal, creditReversal };
        }

        it('refuses to re-instate a release while its credit is reversed, keeping Pending intact', async () => {
          const { releaseReversal } = await unwindReleaseThenCredit();
          const pendingBefore = (await service.getWallet(respondentId)).balance
            .pending;
          expect(pendingBefore).toBe(20);

          const error = await service
            .reverseJournal({
              targetJournalId: releaseReversal.id,
              idempotencyKey: 'reinstate-release',
            })
            .catch((e) => e);

          expect(error).toBeInstanceOf(DownstreamJournalExistsException);
          expect(error.code).toBe('LEDGER_DOWNSTREAM_JOURNAL_EXISTS');
          expect(error.blockingIdempotencyKey).toBe(
            `external-completion:${attemptId}`,
          );
          expect(await repo.findReversalJournal(releaseReversal.id)).toBeNull();
          const wallet = await service.getWallet(respondentId);
          expect(wallet.balance.pending).toBe(pendingBefore);
          expect(wallet.balance.available).toBe(0);
          // The other attempt's pooled credit is still releasable.
          await expect(
            service.releasePendingReward({ attemptId: otherAttemptId }),
          ).resolves.toBeDefined();
        });

        it('re-instates the credit first, then the release', async () => {
          const { releaseReversal, creditReversal } =
            await unwindReleaseThenCredit();

          await service.reverseJournal({
            targetJournalId: creditReversal.id,
            idempotencyKey: 'reinstate-credit',
          });
          await service.reverseJournal({
            targetJournalId: releaseReversal.id,
            idempotencyKey: 'reinstate-release',
          });

          const wallet = await service.getWallet(respondentId);
          expect(wallet.balance.pending).toBe(20);
          expect(wallet.balance.available).toBe(20);
          expect(await service.getExternalCreditState(attemptId)).toBe(
            'RELEASED',
          );
        });

        it('refuses to re-instate a dispute resolution while its hold is reversed', async () => {
          const hold = await placeHold();
          const resolution = await service.resolveDisputeHold({
            caseId,
            respondentId,
            publisherId,
            amount: 20,
            outcome: 'REFUND_TO_PUBLISHER',
          });
          const resolutionReversal = await service.reverseJournal({
            targetJournalId: resolution.id,
          });
          await service.reverseJournal({ targetJournalId: hold.id });

          const error = await service
            .reverseJournal({
              targetJournalId: resolutionReversal.id,
              idempotencyKey: 'reinstate-resolution',
            })
            .catch((e) => e);

          expect(error).toBeInstanceOf(DownstreamJournalExistsException);
          expect(error.blockingIdempotencyKey).toBe(hold.idempotencyKey);
        });

        it('still re-reverses through a double reversal when the chain allows it', async () => {
          const credit = await creditJournal(otherAttemptId);
          const reversal = await service.reverseJournal({
            targetJournalId: credit.id,
          });
          const reinstated = await service.reverseJournal({
            targetJournalId: reversal.id,
            idempotencyKey: 'reinstate-other-credit',
          });

          await expect(
            service.reverseJournal({
              targetJournalId: reinstated.id,
              idempotencyKey: 're-reverse-other-credit',
            }),
          ).resolves.toBeDefined();
          expect(await service.getExternalCreditState(otherAttemptId)).toBe(
            'REVERSED',
          );
        });

        it('still reverses the reversal of a manual journal', async () => {
          const system = await service.getOrCreateAccount(
            null,
            'SYSTEM_ISSUANCE',
          );
          const available = await service.getOrCreateAccount(
            respondentId,
            'USER_AVAILABLE',
          );
          const manual = await service.postJournal({
            idempotencyKey: 'manual-to-reinstate',
            entries: [
              { accountId: system.id, amount: -7 },
              { accountId: available.id, amount: 7 },
            ],
          });
          const reversal = await service.reverseJournal({
            targetJournalId: manual.id,
          });

          const reinstated = await service.reverseJournal({
            targetJournalId: reversal.id,
            idempotencyKey: 'reinstate-manual',
          });

          expect(reinstated.reversesJournalId).toBe(reversal.id);
          expect(await service.isJournalReversed(manual.id)).toBe(false);
          expect(
            (await service.getWallet(respondentId)).balance.available,
          ).toBe(7);
        });
      });

      describe('getExternalSettlementState (review 3.5)', () => {
        it('reads NONE, PENDING and RELEASED from the credit and release', async () => {
          expect(
            await service.getExternalSettlementState(
              '88888888-8888-4888-8888-888888888888',
            ),
          ).toBe('NONE');
          expect(await service.getExternalSettlementState(attemptId)).toBe(
            'PENDING',
          );
          await release();
          expect(await service.getExternalSettlementState(attemptId)).toBe(
            'RELEASED',
          );
        });

        it('reads HELD under an open dispute hold, for that attempt only', async () => {
          await placeHold();
          expect(await service.getExternalSettlementState(attemptId)).toBe(
            'HELD',
          );
          expect(await service.getExternalSettlementState(otherAttemptId)).toBe(
            'PENDING',
          );
        });

        it('reads the dispute resolution outcome', async () => {
          await placeHold();
          const refund = await service.resolveDisputeHold({
            caseId,
            respondentId,
            publisherId,
            amount: 20,
            outcome: 'REFUND_TO_PUBLISHER',
          });
          expect(await service.getExternalSettlementState(attemptId)).toBe(
            'REFUNDED_TO_PUBLISHER',
          );

          await service.reverseJournal({ targetJournalId: refund.id });
          expect(await service.getExternalSettlementState(attemptId)).toBe(
            'HELD',
          );

          await service.resolveDisputeHold({
            caseId,
            respondentId,
            publisherId,
            amount: 20,
            outcome: 'RELEASE_TO_RESPONDENT',
          });
          expect(await service.getExternalSettlementState(attemptId)).toBe(
            'RELEASED',
          );
        });

        it('reads REVERSED after a reversed credit', async () => {
          await service.reverseJournal({
            targetJournalId: (await creditJournal()).id,
          });
          expect(await service.getExternalSettlementState(attemptId)).toBe(
            'REVERSED',
          );
        });
      });
    });

    describe('Starter Points Operations (FR-4, FR-5, FR-8)', () => {
      const newUserId = '99999999-9999-4999-8999-999999999999';

      describe('grantStarterPoints (FR-4)', () => {
        it('grants 100 points from SYSTEM_ISSUANCE to user FROZEN account', async () => {
          const journal = await service.grantStarterPoints(newUserId);

          expect(journal.idempotencyKey).toBe(`starter-grant:${newUserId}`);
          expect(journal.entries).toHaveLength(2);

          const wallet = await service.getWallet(newUserId);
          expect(wallet.balance.frozen).toBe(100);
          expect(wallet.balance.available).toBe(0);
          expect(wallet.balance.total).toBe(100);
        });

        it('is idempotent on repeated calls for the same user', async () => {
          const first = await service.grantStarterPoints(newUserId);
          const second = await service.grantStarterPoints(newUserId);

          expect(first.id).toBe(second.id);
          const wallet = await service.getWallet(newUserId);
          expect(wallet.balance.frozen).toBe(100);
        });

        it('rejects non-positive grant amount', async () => {
          await expect(
            service.grantStarterPoints(newUserId, 0),
          ).rejects.toThrow();
          await expect(
            service.grantStarterPoints(newUserId, -10),
          ).rejects.toThrow();
        });
      });

      describe('unlockStarterPoints (FR-8)', () => {
        beforeEach(async () => {
          await service.grantStarterPoints(newUserId);
        });

        it('transfers 100 points from FROZEN to USER_AVAILABLE upon unlock', async () => {
          const journal = await service.unlockStarterPoints(newUserId);

          expect(journal.idempotencyKey).toBe(`starter-unlock:${newUserId}`);
          const wallet = await service.getWallet(newUserId);
          expect(wallet.balance.frozen).toBe(0);
          expect(wallet.balance.available).toBe(100);
          expect(wallet.balance.total).toBe(100);
        });

        it('is idempotent on duplicate unlock calls', async () => {
          const first = await service.unlockStarterPoints(newUserId);
          const second = await service.unlockStarterPoints(newUserId);

          expect(first.id).toBe(second.id);
          const wallet = await service.getWallet(newUserId);
          expect(wallet.balance.frozen).toBe(0);
          expect(wallet.balance.available).toBe(100);
        });

        it('throws if user has insufficient frozen balance to unlock', async () => {
          const otherUserId = '88888888-8888-4888-8888-888888888888';
          await expect(
            service.unlockStarterPoints(otherUserId),
          ).rejects.toThrow(/insufficient/i);
        });

        it('converges concurrent unlocks on one journal (Story 7.2, FR-8)', async () => {
          const results = await Promise.all([
            service.unlockStarterPoints(newUserId),
            service.unlockStarterPoints(newUserId),
            service.unlockStarterPoints(newUserId),
          ]);

          expect(new Set(results.map((journal) => journal.id)).size).toBe(1);
          const wallet = await service.getWallet(newUserId);
          expect(wallet.balance.frozen).toBe(0);
          expect(wallet.balance.available).toBe(100);
        });

        it('converges when the loser fails the locked balance check (Prisma ordering)', async () => {
          // Prisma locks the balance rows and checks sufficiency BEFORE
          // inserting the journal, so a concurrent loser sees
          // InsufficientBalance instead of an idempotency conflict.
          const prismaLikeRepo = new PrismaOrderingLedgerRepository();
          const prismaLikeService = new LedgerService(prismaLikeRepo);
          await prismaLikeService.grantStarterPoints(newUserId);

          const [first, second] = await Promise.all([
            prismaLikeService.unlockStarterPoints(newUserId),
            prismaLikeService.unlockStarterPoints(newUserId),
          ]);

          expect(prismaLikeRepo.lockedBalanceRejections).toBe(1);
          expect(first.id).toBe(second.id);
          const wallet = await prismaLikeService.getWallet(newUserId);
          expect(wallet.balance.frozen).toBe(0);
          expect(wallet.balance.available).toBe(100);
        });

        it('converges when the loser reads the Frozen balance after the winner committed', async () => {
          const winner = await service.unlockStarterPoints(newUserId);
          // The loser's fast-path lookup ran before the winner committed.
          jest
            .spyOn(repo, 'findJournalByIdempotencyKey')
            .mockResolvedValueOnce(null);

          const loser = await service.unlockStarterPoints(newUserId);

          expect(loser.id).toBe(winner.id);
          const wallet = await service.getWallet(newUserId);
          expect(wallet.balance.available).toBe(100);
        });

        it('does not mask an expiry that won the race', async () => {
          await service.expireStarterPoints(newUserId);

          await expect(service.unlockStarterPoints(newUserId)).rejects.toThrow(
            /insufficient/i,
          );
          expect(
            await service.findJournalByIdempotencyKey(
              `starter-unlock:${newUserId}`,
            ),
          ).toBeNull();
        });
      });

      describe('isJournalReversed', () => {
        it('reports whether a reversal journal exists', async () => {
          const journal = await service.grantStarterPoints(newUserId);
          expect(await service.isJournalReversed(journal.id)).toBe(false);

          await service.reverseJournal({
            targetJournalId: journal.id,
            idempotencyKey: `reverse:${journal.id}`,
          });

          expect(await service.isJournalReversed(journal.id)).toBe(true);
        });

        it('treats a reversed reversal as reinstating the original journal', async () => {
          const journal = await service.grantStarterPoints(newUserId);
          const reversal = await service.reverseJournal({
            targetJournalId: journal.id,
          });
          await service.reverseJournal({ targetJournalId: reversal.id });

          expect(await service.isJournalReversed(journal.id)).toBe(false);
        });
      });

      describe('expireStarterPoints (FR-5)', () => {
        beforeEach(async () => {
          await service.grantStarterPoints(newUserId);
        });

        it('voids frozen points from FROZEN to SYSTEM_SINK', async () => {
          const journal = await service.expireStarterPoints(newUserId);

          expect(journal).not.toBeNull();
          expect(journal!.idempotencyKey).toBe(`starter-expiry:${newUserId}`);

          const wallet = await service.getWallet(newUserId);
          expect(wallet.balance.frozen).toBe(0);
          expect(wallet.balance.available).toBe(0);
          expect(wallet.balance.total).toBe(0);
        });

        it('returns null if user has zero frozen points', async () => {
          const zeroUserId = '77777777-7777-4777-8777-777777777777';
          const journal = await service.expireStarterPoints(zeroUserId);
          expect(journal).toBeNull();
        });

        it('is idempotent on repeated expiry calls', async () => {
          const first = await service.expireStarterPoints(newUserId);
          const second = await service.expireStarterPoints(newUserId);

          expect(first!.id).toBe(second!.id);
        });

        it('never expires after the starter points were unlocked (Story 7.2)', async () => {
          await service.unlockStarterPoints(newUserId);
          // Even with Frozen points left over from another credit.
          const issuance = await service.getOrCreateAccount(
            null,
            'SYSTEM_ISSUANCE',
          );
          const frozen = await service.getOrCreateAccount(newUserId, 'FROZEN');
          await service.postJournal({
            idempotencyKey: 'extra-frozen-credit',
            entries: [
              { accountId: issuance.id, amount: -40 },
              { accountId: frozen.id, amount: 40 },
            ],
          });

          await expect(
            service.expireStarterPoints(newUserId),
          ).resolves.toBeNull();
          expect((await service.getWallet(newUserId)).balance.frozen).toBe(40);
        });
      });
    });
  });

  describe('Story 6.6: Manual top-up approval credit (FR-35, AD-16)', () => {
    const topUpId = '66666666-6666-4666-8666-666666666666';

    it('credits Available from SYSTEM_CLEARING under topup-approval:{topUpId}', async () => {
      const journal = await service.creditApprovedTopUp({
        topUpId,
        userId: user1Id,
        amount: 250,
        transferReference: 'RESCOMABCDEFGH',
      });

      expect(journal.idempotencyKey).toBe(`topup-approval:${topUpId}`);
      expect(journal.entries).toHaveLength(2);
      const clearing = await service.getOrCreateAccount(
        null,
        'SYSTEM_CLEARING',
      );
      const available = await service.getOrCreateAccount(
        user1Id,
        'USER_AVAILABLE',
      );
      expect(clearing.balance).toBe(-250);
      expect(available.balance).toBe(250);
      expect((await service.verifyLedgerIntegrity()).isZeroSum).toBe(true);
    });

    it('returns the original journal on retry without crediting twice', async () => {
      const params = {
        topUpId,
        userId: user1Id,
        amount: 100,
        transferReference: 'RESCOMABCDEFGH',
      };
      const first = await service.creditApprovedTopUp(params);
      const second = await service.creditApprovedTopUp(params);

      expect(second.id).toBe(first.id);
      const wallet = await service.getWallet(user1Id);
      expect(wallet.balance.available).toBe(100);
    });

    it('rejects a retry that would change the credited amount', async () => {
      await service.creditApprovedTopUp({
        topUpId,
        userId: user1Id,
        amount: 100,
        transferReference: 'RESCOMABCDEFGH',
      });

      await expect(
        service.creditApprovedTopUp({
          topUpId,
          userId: user1Id,
          amount: 500,
          transferReference: 'RESCOMABCDEFGH',
        }),
      ).rejects.toBeInstanceOf(IdempotencyConflictException);
    });

    it('rejects non-positive or fractional amounts', async () => {
      await expect(
        service.creditApprovedTopUp({
          topUpId,
          userId: user1Id,
          amount: 0,
          transferReference: 'RESCOMABCDEFGH',
        }),
      ).rejects.toBeInstanceOf(InvalidLedgerOperationException);
      await expect(
        service.creditApprovedTopUp({
          topUpId,
          userId: user1Id,
          amount: 10.5,
          transferReference: 'RESCOMABCDEFGH',
        }),
      ).rejects.toBeInstanceOf(InvalidLedgerOperationException);
    });
  });
});
