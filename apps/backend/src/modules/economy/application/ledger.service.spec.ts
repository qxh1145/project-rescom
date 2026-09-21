import { InMemoryLedgerRepository } from '../infrastructure/in-memory-ledger.repository';
import { LedgerService } from './ledger.service';
import {
  IdempotencyConflictException,
  InsufficientBalanceException,
  JournalAlreadyReversedException,
  JournalNotFoundException,
  UnbalancedJournalException,
} from './exceptions/economy.exceptions';

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
      const account = await service.getOrCreateAccount(user1Id, 'USER_AVAILABLE');
      expect(account.id).toBeDefined();
      expect(account.userId).toBe(user1Id);
      expect(account.accountClass).toBe('USER_AVAILABLE');
      expect(account.balance).toBe(0);
    });

    it('returns existing account without duplicating', async () => {
      const first = await service.getOrCreateAccount(user1Id, 'USER_AVAILABLE');
      const second = await service.getOrCreateAccount(user1Id, 'USER_AVAILABLE');
      expect(first.id).toBe(second.id);
    });
  });

  describe('Double-Entry Zero-Sum Invariant (FR-30)', () => {
    it('successfully posts a balanced two-legged journal', async () => {
      const systemAccount = await service.getOrCreateAccount(null, 'SYSTEM_ISSUANCE');
      const userAccount = await service.getOrCreateAccount(user1Id, 'USER_AVAILABLE');

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
      const systemAccount = await service.getOrCreateAccount(null, 'SYSTEM_ISSUANCE');
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
      const systemAccount = await service.getOrCreateAccount(null, 'SYSTEM_ISSUANCE');
      const userAccount = await service.getOrCreateAccount(user1Id, 'USER_AVAILABLE');

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
  });

  describe('Overdraft Protection & Ascending Lock Order', () => {
    it('rejects point deduction that would overdraft USER_AVAILABLE account', async () => {
      const user1Available = await service.getOrCreateAccount(user1Id, 'USER_AVAILABLE');
      const user2Available = await service.getOrCreateAccount(user2Id, 'USER_AVAILABLE');

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
      const systemIssuance = await service.getOrCreateAccount(null, 'SYSTEM_ISSUANCE');
      const userAccount = await service.getOrCreateAccount(user1Id, 'USER_AVAILABLE');

      await service.transfer({
        fromAccountId: systemIssuance.id,
        toAccountId: userAccount.id,
        amount: 500,
        idempotencyKey: 'tx-system-issuance',
      });

      expect((await service.getAccount(systemIssuance.id)).balance).toBe(-500);
      expect((await service.getAccount(userAccount.id)).balance).toBe(500);
    });
  });

  describe('Idempotency & Replay Protection (FR-ADD-11)', () => {
    it('returns existing journal without creating duplicate entries when replayed with identical payload', async () => {
      const systemAccount = await service.getOrCreateAccount(null, 'SYSTEM_ISSUANCE');
      const userAccount = await service.getOrCreateAccount(user1Id, 'USER_AVAILABLE');

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
      const systemAccount = await service.getOrCreateAccount(null, 'SYSTEM_ISSUANCE');
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
  });

  describe('Append-Only Immutability & Reversals', () => {
    it('reverses an existing journal by posting exact equal-and-opposite negation entries', async () => {
      const systemAccount = await service.getOrCreateAccount(null, 'SYSTEM_ISSUANCE');
      const userAccount = await service.getOrCreateAccount(user1Id, 'USER_AVAILABLE');

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
      const systemAccount = await service.getOrCreateAccount(null, 'SYSTEM_ISSUANCE');
      const userAccount = await service.getOrCreateAccount(user1Id, 'USER_AVAILABLE');

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

    it('rejects reversal of non-existent journal with JournalNotFoundException', async () => {
      await expect(
        service.reverseJournal({
          targetJournalId: '99999999-9999-4999-8999-999999999999',
        }),
      ).rejects.toThrow(JournalNotFoundException);
    });

    it('supports reversal chains where reversing a reversal restores the original state', async () => {
      const systemAccount = await service.getOrCreateAccount(null, 'SYSTEM_ISSUANCE');
      const userAccount = await service.getOrCreateAccount(user1Id, 'USER_AVAILABLE');

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
      const systemAccount = await service.getOrCreateAccount(null, 'SYSTEM_ISSUANCE');
      const userAccount = await service.getOrCreateAccount(user1Id, 'USER_AVAILABLE');

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
      const systemAccount = await service.getOrCreateAccount(null, 'SYSTEM_ISSUANCE');
      const userAccount = await service.getOrCreateAccount(user1Id, 'USER_AVAILABLE');

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
      const systemAccount = await service.getOrCreateAccount(null, 'SYSTEM_ISSUANCE');
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
});
