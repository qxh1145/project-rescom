import {
  calculateWalletTotal,
  walletBalanceSchema,
  walletDetailsSchema,
  walletTransactionItemSchema,
} from './index';

describe('Economy & Wallet Schemas (Story 6.2)', () => {
  const accountId = '11111111-1111-4111-8111-111111111111';
  const journalId = '22222222-2222-4222-8222-222222222222';
  const userId = '33333333-3333-4333-8333-333333333333';

  describe('walletBalanceSchema', () => {
    it('validates a correct wallet balance object', () => {
      const balance = {
        available: 500,
        pending: 100,
        escrow: 200,
        frozen: 100,
        integrityHold: 0,
        total: 900,
      };

      const result = walletBalanceSchema.safeParse(balance);
      expect(result.success).toBe(true);
    });

    it('rejects if a balance component is missing', () => {
      const missingPending = {
        available: 500,
        escrow: 200,
        frozen: 100,
        integrityHold: 0,
        total: 800,
      };

      const result = walletBalanceSchema.safeParse(missingPending);
      expect(result.success).toBe(false);
    });

    it('rejects if total does not equal sum of balance components', () => {
      const mismatchedBalance = {
        available: 500,
        pending: 100,
        escrow: 200,
        frozen: 100,
        integrityHold: 0,
        total: 1000, // Should be 900
      };

      const result = walletBalanceSchema.safeParse(mismatchedBalance);
      expect(result.success).toBe(false);
    });

    it('rejects negative balances', () => {
      const negativeBalance = {
        available: -10,
        pending: 0,
        escrow: 0,
        frozen: 0,
        integrityHold: 0,
        total: -10,
      };

      const result = walletBalanceSchema.safeParse(negativeBalance);
      expect(result.success).toBe(false);
    });

    it('rejects non-integer balances', () => {
      const floatBalance = {
        available: 50.5,
        pending: 0,
        escrow: 0,
        frozen: 0,
        integrityHold: 0,
        total: 50.5,
      };

      const result = walletBalanceSchema.safeParse(floatBalance);
      expect(result.success).toBe(false);
    });
  });

  describe('walletTransactionItemSchema', () => {
    it('validates a positive transaction credit', () => {
      const tx = {
        id: '44444444-4444-4444-8444-444444444444',
        journalId,
        amount: 150,
        accountClass: 'USER_AVAILABLE',
        description: 'Survey completion reward',
        idempotencyKey: 'reward-attempt-1',
        createdAt: new Date().toISOString(),
        reversesJournalId: null,
      };

      const result = walletTransactionItemSchema.safeParse(tx);
      expect(result.success).toBe(true);
    });

    it('validates a negative transaction debit', () => {
      const tx = {
        id: '44444444-4444-4444-8444-444444444444',
        journalId,
        amount: -200,
        accountClass: 'USER_AVAILABLE',
        description: 'Publish survey escrow lock',
        idempotencyKey: 'escrow-lock-survey-1',
        createdAt: new Date().toISOString(),
        reversesJournalId: null,
      };

      const result = walletTransactionItemSchema.safeParse(tx);
      expect(result.success).toBe(true);
    });
  });

  describe('walletDetailsSchema', () => {
    it('validates complete wallet aggregate', () => {
      const details = {
        balance: {
          available: 250,
          pending: 50,
          escrow: 100,
          frozen: 100,
          integrityHold: 0,
          total: 500,
        },
        transactions: [
          {
            id: '55555555-5555-4555-8555-555555555555',
            journalId,
            amount: 250,
            accountClass: 'USER_AVAILABLE',
            description: 'Starter credit',
            idempotencyKey: 'init-starter',
            createdAt: new Date().toISOString(),
            reversesJournalId: null,
          },
        ],
        accounts: [
          {
            id: accountId,
            userId,
            accountClass: 'USER_AVAILABLE',
            currency: 'POINTS',
            balance: 250,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      };

      const result = walletDetailsSchema.safeParse(details);
      expect(result.success).toBe(true);
    });
  });

  describe('calculateWalletTotal', () => {
    it('accurately sums all five balance types', () => {
      const total = calculateWalletTotal({
        available: 300,
        pending: 50,
        escrow: 150,
        frozen: 100,
        integrityHold: 25,
      });

      expect(total).toBe(625);
    });
  });
});
