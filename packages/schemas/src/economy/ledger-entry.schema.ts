import { z } from "zod";

export const POSTGRES_INTEGER_MIN = -2_147_483_648;
export const POSTGRES_INTEGER_MAX = 2_147_483_647;
export const REVERSIBLE_LEDGER_AMOUNT_MIN = -POSTGRES_INTEGER_MAX;

const ledgerAmountSchema = z
  .number()
  .int()
  .min(REVERSIBLE_LEDGER_AMOUNT_MIN)
  .max(POSTGRES_INTEGER_MAX);

export const ledgerEntrySchema = z.object({
  id: z.string().uuid(),
  journalId: z.string().uuid(),
  accountId: z.string().uuid(),
  amount: ledgerAmountSchema,
  createdAt: z.string().datetime(),
});

export type LedgerEntryDto = z.infer<typeof ledgerEntrySchema>;

export const postEntryInputSchema = z.object({
  accountId: z.string().uuid(),
  amount: z
    .number()
    .int()
    .min(REVERSIBLE_LEDGER_AMOUNT_MIN)
    .max(POSTGRES_INTEGER_MAX)
    .refine((val) => val !== 0, {
      message: "Entry amount cannot be zero",
    }),
});

export type PostEntryInput = z.infer<typeof postEntryInputSchema>;
