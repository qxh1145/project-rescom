import { z } from 'zod';
import { ledgerAccountClassSchema, ledgerAccountSchema } from './ledger-account.schema';

export const walletBalanceSchema = z
  .object({
    available: z.number().int().nonnegative(),
    pending: z.number().int().nonnegative(),
    escrow: z.number().int().nonnegative(),
    frozen: z.number().int().nonnegative(),
    integrityHold: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  })
  .refine(
    (b) =>
      b.total ===
      b.available + b.pending + b.escrow + b.frozen + b.integrityHold,
    {
      message: 'Wallet total must equal the sum of all 5 balance tiers',
      path: ['total'],
    },
  );

export type WalletBalanceDto = z.infer<typeof walletBalanceSchema>;

export const walletTransactionItemSchema = z.object({
  id: z.string().uuid(),
  journalId: z.string().uuid(),
  amount: z.number().int(),
  accountClass: ledgerAccountClassSchema,
  description: z.string().nullable(),
  idempotencyKey: z.string(),
  createdAt: z.string().datetime(),
  reversesJournalId: z.string().uuid().nullable(),
});

export type WalletTransactionItemDto = z.infer<typeof walletTransactionItemSchema>;

export const walletDetailsSchema = z.object({
  balance: walletBalanceSchema,
  transactions: z.array(walletTransactionItemSchema),
  accounts: z.array(ledgerAccountSchema),
});

export type WalletDetailsDto = z.infer<typeof walletDetailsSchema>;

export function calculateWalletTotal(balance: {
  available: number;
  pending: number;
  escrow: number;
  frozen: number;
  integrityHold: number;
}): number {
  return (
    balance.available +
    balance.pending +
    balance.escrow +
    balance.frozen +
    balance.integrityHold
  );
}
