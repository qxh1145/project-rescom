import { z } from "zod";
import { ledgerAccountClassSchema } from "../economy/ledger-account.schema";
import { ledgerEntrySchema } from "../economy/ledger-entry.schema";
import { ledgerJournalSchema } from "../economy/ledger-journal.schema";
import { keysetCursorSchema } from "./keyset-cursor";

/**
 * Admin ledger view (Figma 11f "Giao dịch điểm", 63:1629; mock-off plan 4.3).
 *
 * - `GET /admin/ledger/journals?type&from&to&before&limit`: journals newest
 *   first (ties by id descending). `type` groups journals by idempotency-key
 *   prefix (`ADMIN_LEDGER_FILTER_KEY_PREFIXES`); `from` / `to` are ISO bounds
 *   on `createdAt`; `before` is the keyset cursor `<createdAt>:<id>` of the
 *   last row already shown.
 * - `GET /admin/ledger/summary`: the four cards.
 */

export const adminLedgerFilterSchema = z.enum(["all", "top-up", "escrow", "reward", "refund"]);
export type AdminLedgerFilter = z.infer<typeof adminLedgerFilterSchema>;

/**
 * Journal idempotency-key prefixes per "Loại giao dịch" segment (keys written
 * by `ledger.service.ts`, `reward-settlement.coordinator.ts`, the escrow and
 * top-up services). Starter-point journals only show under "Tất cả". A
 * reversal (`reversesJournalId` set) is a "Hoàn" whatever its key, and only
 * that.
 */
export const ADMIN_LEDGER_FILTER_KEY_PREFIXES: Record<Exclude<AdminLedgerFilter, "all">, readonly string[]> = {
  "top-up": ["topup-approval:"],
  escrow: ["publish:", "reopen-escrow:"],
  reward: [
    "internal-reward:",
    "external-completion:",
    "integrity-hold:",
    "release-pending:",
    "integrity-decision:",
    "integrity-fail-open:",
    "external-dispute:",
  ],
  refund: ["close-refund:", "dispute-resolution:"],
};

/** Key prefix of the escrow refund journals counted by `refundedToday`. */
export const ESCROW_REFUND_KEY_PREFIX = "close-refund:";

export const ADMIN_JOURNAL_MAX_LIMIT = 100;
export const ADMIN_JOURNAL_DEFAULT_LIMIT = 50;

export const listAdminJournalsQuerySchema = z
  .object({
    type: adminLedgerFilterSchema.optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    before: keysetCursorSchema.optional(),
    limit: z.coerce.number().int().min(1).max(ADMIN_JOURNAL_MAX_LIMIT).default(ADMIN_JOURNAL_DEFAULT_LIMIT),
  })
  .strict()
  .refine((query) => !query.from || !query.to || Date.parse(query.from) <= Date.parse(query.to), {
    message: "from cannot be after to",
    path: ["from"],
  });
export type ListAdminJournalsQuery = z.infer<typeof listAdminJournalsQuerySchema>;

export const adminJournalEntrySchema = ledgerEntrySchema
  .extend({
    /** Tier of the entry's account ("Từ → Đến"). */
    accountClass: ledgerAccountClassSchema.optional(),
    /** Display name of the account owner; null for system accounts and users without one. */
    ownerName: z.string().min(1).nullable().optional(),
  })
  .strict();
export type AdminJournalEntry = z.infer<typeof adminJournalEntrySchema>;

export const adminJournalSchema = ledgerJournalSchema
  .extend({
    entries: z.array(adminJournalEntrySchema).default([]),
    /** Title of the survey the journal is about, when its key names one. */
    related: z.string().min(1).nullable().optional(),
    /** Survey attempt of a Google Forms reward (`external-completion:{attemptId}`). */
    attemptId: z.string().uuid().nullable().optional(),
  })
  .strict();
export type AdminJournal = z.infer<typeof adminJournalSchema>;

export const adminJournalListSchema = z
  .object({
    items: z.array(adminJournalSchema),
    limit: z.number().int().min(1),
    hasMore: z.boolean(),
  })
  .strict();
export type AdminJournalList = z.infer<typeof adminJournalListSchema>;

const points = z.number().int().nonnegative();

export const adminLedgerSummarySchema = z
  .object({
    pendingTopUps: z
      .object({
        count: points,
        points,
        amountVnd: points,
      })
      .strict(),
    /** Sum of every Ký quỹ (ESCROW) balance. */
    escrowTotal: points,
    /** Sum of every Chờ 48h (PENDING) balance. */
    pendingTotal: points,
    /** Escrow given back (`close-refund:` journals) since 00:00 Vietnam time. */
    refundedToday: z
      .object({
        points,
        surveys: points,
      })
      .strict(),
  })
  .strict();
export type AdminLedgerSummary = z.infer<typeof adminLedgerSummarySchema>;

const VIETNAM_OFFSET_MS = 7 * 3_600_000;
const DAY_MS = 86_400_000;

/** 00:00 of the current Vietnam calendar day (UTC+7, no DST). */
export function vietnamStartOfDay(now: Date): Date {
  const local = now.getTime() + VIETNAM_OFFSET_MS;
  return new Date(local - (((local % DAY_MS) + DAY_MS) % DAY_MS) - VIETNAM_OFFSET_MS);
}
