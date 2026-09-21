import { z } from 'zod';

export const ledgerAccountClassSchema = z.enum([
  'USER_AVAILABLE',
  'PENDING',
  'FROZEN',
  'ESCROW',
  'INTEGRITY_HOLD',
  'SYSTEM_ISSUANCE',
  'SYSTEM_SINK',
  'SYSTEM_CLEARING',
]);

export type LedgerAccountClass = z.infer<typeof ledgerAccountClassSchema>;

export const NON_OVERDRAFTABLE_ACCOUNT_CLASSES: readonly LedgerAccountClass[] = [
  'USER_AVAILABLE',
  'PENDING',
  'FROZEN',
  'ESCROW',
  'INTEGRITY_HOLD',
] as const;

export const SYSTEM_ACCOUNT_CLASSES: readonly LedgerAccountClass[] = [
  'SYSTEM_ISSUANCE',
  'SYSTEM_SINK',
  'SYSTEM_CLEARING',
] as const;

export function canAccountClassOverdraft(accountClass: LedgerAccountClass): boolean {
  return (SYSTEM_ACCOUNT_CLASSES as readonly string[]).includes(accountClass);
}

export const ledgerAccountSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid().nullable(),
  accountClass: ledgerAccountClassSchema,
  currency: z.string().default('POINTS'),
  balance: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type LedgerAccountDto = z.infer<typeof ledgerAccountSchema>;

export const createAccountInputSchema = z.object({
  userId: z.string().uuid().nullable().optional(),
  accountClass: ledgerAccountClassSchema,
  currency: z.string().default('POINTS').optional(),
});

export type CreateAccountInput = z.infer<typeof createAccountInputSchema>;
