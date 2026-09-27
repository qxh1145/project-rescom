import { z } from "zod";

export const ledgerAccountClassSchema = z.enum([
  "USER_AVAILABLE",
  "PENDING",
  "FROZEN",
  "ESCROW",
  "INTEGRITY_HOLD",
  "SYSTEM_ISSUANCE",
  "SYSTEM_SINK",
  "SYSTEM_CLEARING",
]);

export type LedgerAccountClass = z.infer<typeof ledgerAccountClassSchema>;

export const NON_OVERDRAFTABLE_ACCOUNT_CLASSES: readonly LedgerAccountClass[] =
  ["USER_AVAILABLE", "PENDING", "FROZEN", "ESCROW", "INTEGRITY_HOLD"] as const;

export const SYSTEM_ACCOUNT_CLASSES: readonly LedgerAccountClass[] = [
  "SYSTEM_ISSUANCE",
  "SYSTEM_SINK",
  "SYSTEM_CLEARING",
] as const;

export function canAccountClassOverdraft(
  accountClass: LedgerAccountClass,
): boolean {
  return (SYSTEM_ACCOUNT_CLASSES as readonly string[]).includes(accountClass);
}

function enforceAccountOwnerInvariant(
  account: { userId?: string | null; accountClass: LedgerAccountClass },
  ctx: z.RefinementCtx,
): void {
  const isSystemAccount = canAccountClassOverdraft(account.accountClass);
  const userId = account.userId ?? null;

  if (isSystemAccount && userId !== null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["userId"],
      message: "System ledger accounts cannot belong to a user",
    });
  }

  if (!isSystemAccount && userId === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["userId"],
      message: "User ledger accounts require a userId",
    });
  }
}

export const ledgerAccountSchema = z
  .object({
    id: z.string().uuid(),
    userId: z.string().uuid().nullable(),
    accountClass: ledgerAccountClassSchema,
    currency: z.string().min(1).default("POINTS"),
    balance: z.number().int(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .superRefine(enforceAccountOwnerInvariant);

export type LedgerAccountDto = z.infer<typeof ledgerAccountSchema>;

export const createAccountInputSchema = z
  .object({
    userId: z.string().uuid().nullable().optional(),
    accountClass: ledgerAccountClassSchema,
    currency: z.string().min(1).default("POINTS").optional(),
  })
  .superRefine(enforceAccountOwnerInvariant);

export type CreateAccountInput = z.infer<typeof createAccountInputSchema>;
