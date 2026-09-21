import { z } from 'zod';

export const ledgerEntrySchema = z.object({
  id: z.string().uuid(),
  journalId: z.string().uuid(),
  accountId: z.string().uuid(),
  amount: z.number().int(),
  createdAt: z.string().datetime(),
});

export type LedgerEntryDto = z.infer<typeof ledgerEntrySchema>;

export const postEntryInputSchema = z.object({
  accountId: z.string().uuid(),
  amount: z
    .number()
    .int()
    .refine((val) => val !== 0, {
      message: 'Entry amount cannot be zero',
    }),
});

export type PostEntryInput = z.infer<typeof postEntryInputSchema>;
