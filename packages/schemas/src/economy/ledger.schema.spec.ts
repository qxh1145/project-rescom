import {
  canAccountClassOverdraft,
  ledgerAccountClassSchema,
  ledgerAccountSchema,
  NON_OVERDRAFTABLE_ACCOUNT_CLASSES,
  postJournalInputSchema,
  reverseJournalInputSchema,
  SYSTEM_ACCOUNT_CLASSES,
  transferPointsInputSchema,
} from "./index";

describe("Economy & Ledger Schemas", () => {
  const account1Id = "11111111-1111-4111-8111-111111111111";
  const account2Id = "22222222-2222-4222-8222-222222222222";
  const account3Id = "33333333-3333-4333-8333-333333333333";
  const user1Id = "44444444-4444-4444-8444-444444444444";
  const journalId = "55555555-5555-4555-8555-555555555555";

  describe("ledgerAccountClassSchema & Overdraft Policy", () => {
    it("accepts all standard account classes", () => {
      const classes = [
        "USER_AVAILABLE",
        "PENDING",
        "FROZEN",
        "ESCROW",
        "INTEGRITY_HOLD",
        "SYSTEM_ISSUANCE",
        "SYSTEM_SINK",
        "SYSTEM_CLEARING",
      ];

      for (const cls of classes) {
        expect(ledgerAccountClassSchema.safeParse(cls).success).toBe(true);
      }
    });

    it("rejects invalid account class", () => {
      expect(ledgerAccountClassSchema.safeParse("UNKNOWN_CLASS").success).toBe(
        false,
      );
    });

    it("identifies non-overdraftable vs system overdraftable account classes", () => {
      for (const cls of NON_OVERDRAFTABLE_ACCOUNT_CLASSES) {
        expect(canAccountClassOverdraft(cls)).toBe(false);
      }

      for (const cls of SYSTEM_ACCOUNT_CLASSES) {
        expect(canAccountClassOverdraft(cls)).toBe(true);
      }
    });
  });

  describe("ledgerAccountSchema", () => {
    it("validates a valid ledger account", () => {
      const validAccount = {
        id: account1Id,
        userId: user1Id,
        accountClass: "USER_AVAILABLE",
        currency: "POINTS",
        balance: 500,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const result = ledgerAccountSchema.safeParse(validAccount);
      expect(result.success).toBe(true);
    });

    it("allows null userId for system accounts", () => {
      const systemAccount = {
        id: account1Id,
        userId: null,
        accountClass: "SYSTEM_ISSUANCE",
        currency: "POINTS",
        balance: -500,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const result = ledgerAccountSchema.safeParse(systemAccount);
      expect(result.success).toBe(true);
    });

    it("rejects user-owned system accounts and ownerless user accounts", () => {
      const base = {
        id: account1Id,
        currency: "POINTS",
        balance: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      expect(
        ledgerAccountSchema.safeParse({
          ...base,
          userId: user1Id,
          accountClass: "SYSTEM_ISSUANCE",
        }).success,
      ).toBe(false);
      expect(
        ledgerAccountSchema.safeParse({
          ...base,
          userId: null,
          accountClass: "USER_AVAILABLE",
        }).success,
      ).toBe(false);
    });
  });

  describe("postJournalInputSchema (Zero-Sum Invariant & Entries)", () => {
    it("accepts a balanced two-legged journal (sum is 0)", () => {
      const validJournal = {
        idempotencyKey: "cmd-test-1",
        description: "Transfer points",
        entries: [
          { accountId: account1Id, amount: -100 },
          { accountId: account2Id, amount: 100 },
        ],
      };

      const result = postJournalInputSchema.safeParse(validJournal);
      expect(result.success).toBe(true);
    });

    it("accepts a balanced multi-legged journal (sum is 0 across 3 entries)", () => {
      const validMulti = {
        idempotencyKey: "cmd-multi-1",
        description: "Split escrow payout",
        entries: [
          { accountId: account1Id, amount: -100 },
          { accountId: account2Id, amount: 80 },
          { accountId: account3Id, amount: 20 },
        ],
      };

      const result = postJournalInputSchema.safeParse(validMulti);
      expect(result.success).toBe(true);
    });

    it("rejects an unbalanced journal where sum != 0", () => {
      const unbalanced = {
        idempotencyKey: "cmd-unbalanced-1",
        entries: [
          { accountId: account1Id, amount: -100 },
          { accountId: account2Id, amount: 90 }, // sum is -10
        ],
      };

      const result = postJournalInputSchema.safeParse(unbalanced);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toContain(
          "must balance to zero",
        );
      }
    });

    it("rejects journal with fewer than 2 entries", () => {
      const singleEntry = {
        idempotencyKey: "cmd-single-1",
        entries: [{ accountId: account1Id, amount: 0 }],
      };

      const result = postJournalInputSchema.safeParse(singleEntry);
      expect(result.success).toBe(false);
    });

    it("rejects entry with zero amount", () => {
      const zeroAmount = {
        idempotencyKey: "cmd-zero-1",
        entries: [
          { accountId: account1Id, amount: 0 },
          { accountId: account2Id, amount: 0 },
        ],
      };

      const result = postJournalInputSchema.safeParse(zeroAmount);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toContain("cannot be zero");
      }
    });

    it("rejects amounts outside PostgreSQL INTEGER range", () => {
      const result = postJournalInputSchema.safeParse({
        idempotencyKey: "cmd-overflow",
        entries: [
          { accountId: account1Id, amount: -2_147_483_648 },
          { accountId: account2Id, amount: 1_073_741_824 },
          { accountId: account3Id, amount: 1_073_741_824 },
        ],
      });

      expect(result.success).toBe(false);
    });
  });

  describe("reverseJournalInputSchema", () => {
    it("accepts valid targetJournalId", () => {
      const validReversal = {
        targetJournalId: journalId,
        idempotencyKey: "custom-reversal-key",
        reason: "Refund customer",
      };

      const result = reverseJournalInputSchema.safeParse(validReversal);
      expect(result.success).toBe(true);
    });

    it("rejects non-uuid targetJournalId", () => {
      const invalid = { targetJournalId: "not-a-uuid" };
      const result = reverseJournalInputSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it("defaults the idempotency key deterministically from the target journal", () => {
      const result = reverseJournalInputSchema.parse({
        targetJournalId: journalId,
      });
      expect(result.idempotencyKey).toBe(`reversal:${journalId}`);
    });
  });

  describe("transferPointsInputSchema", () => {
    it("accepts valid transfer input", () => {
      const valid = {
        fromAccountId: account1Id,
        toAccountId: account2Id,
        amount: 250,
        idempotencyKey: "tx-123",
        description: "Survey reward",
      };

      const result = transferPointsInputSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it("rejects non-positive amount", () => {
      const negative = {
        fromAccountId: account1Id,
        toAccountId: account2Id,
        amount: -50,
        idempotencyKey: "tx-124",
      };

      const result = transferPointsInputSchema.safeParse(negative);
      expect(result.success).toBe(false);
    });
  });
});
