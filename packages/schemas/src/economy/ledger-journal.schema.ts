import { z } from "zod";
import { ledgerEntrySchema, postEntryInputSchema } from "./ledger-entry.schema";

export const ledgerJournalSchema = z.object({
  id: z.string().uuid(),
  idempotencyKey: z.string().min(1).max(255),
  description: z.string().nullable(),
  reversesJournalId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  entries: z.array(ledgerEntrySchema).default([]),
});

export type LedgerJournalDto = z.infer<typeof ledgerJournalSchema>;

export const postJournalInputSchema = z
  .object({
    idempotencyKey: z
      .string()
      .min(1, "Idempotency key is required")
      .max(255, "Idempotency key must be at most 255 characters"),
    description: z.string().max(500).optional(),
    entries: z
      .array(postEntryInputSchema)
      .min(2, "A ledger journal must have at least two entries"),
  })
  .refine(
    (data) => {
      const sum = data.entries.reduce((acc, entry) => acc + entry.amount, 0);
      return sum === 0;
    },
    {
      message:
        "Ledger journal entries must balance to zero (sum of debits and credits must be 0)",
      path: ["entries"],
    },
  );

export type PostJournalInput = z.infer<typeof postJournalInputSchema>;

export const reverseJournalInputSchema = z
  .object({
    targetJournalId: z.string().uuid("Invalid target journal ID"),
    idempotencyKey: z.string().min(1).max(255).optional(),
    reason: z.string().max(500).optional(),
  })
  .transform((input) => ({
    ...input,
    idempotencyKey: input.idempotencyKey ?? `reversal:${input.targetJournalId}`,
  }));

export type ReverseJournalInput = z.input<typeof reverseJournalInputSchema>;
export type ReverseJournalDto = z.infer<typeof reverseJournalInputSchema>;

export const transferPointsInputSchema = z.object({
  fromAccountId: z.string().uuid("Invalid fromAccountId"),
  toAccountId: z.string().uuid("Invalid toAccountId"),
  amount: z.number().int().positive("Transfer amount must be positive"),
  idempotencyKey: z.string().min(1).max(255),
  description: z.string().max(500).optional(),
});

export type TransferPointsInput = z.infer<typeof transferPointsInputSchema>;
