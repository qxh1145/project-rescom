import { z } from "zod";
import { ledgerAccountClassSchema, ledgerEntrySchema, ledgerJournalSchema } from "@rescom/schemas";
import { apiRequest } from "../api/client.ts";
import type { TransactionFilter } from "./admin-transactions.ts";

/**
 * Admin ledger view (Figma 11f "Giao dịch điểm", 63:1629).
 *
 * The backend has no admin journal list: `ledger.controller.ts` only posts /
 * reverses journals, reads one account balance and `GET /economy/integrity`
 * (`{ totalSystemBalance, isZeroSum }` — not drawn on this screen), and
 * `admin-audit-logs.controller.ts` lists admin actions, not journals.
 *
 * ASSUMED API CONTRACT:
 * - `GET /admin/ledger/journals?type&from&limit&offset` → page of
 *   `ledgerJournalSchema` journals (newest first) with ASSUMED extras:
 *   `entries[].accountClass` / `entries[].ownerName` (the account's tier and
 *   owner, for "Từ → Đến · Linh N."), `related` (survey title) and
 *   `attemptId` (anonymous "#7F3A" code of reward journals).
 *   `type` = `top-up | escrow | reward | refund` (omitted = all), grouped by
 *   idempotency-key prefix like `matchesTransactionFilter`; `from` = ISO lower
 *   bound on `createdAt` (omitted = all time).
 * - `GET /admin/ledger/summary` → the four cards: pending top-ups (count,
 *   points, VND), total Ký quỹ, total Chờ 48h, escrow refunded today.
 */

export const adminJournalEntrySchema = ledgerEntrySchema.extend({
  accountClass: ledgerAccountClassSchema.optional(),
  ownerName: z.string().min(1).nullable().optional(),
});

export const adminJournalSchema = ledgerJournalSchema.extend({
  entries: z.array(adminJournalEntrySchema).default([]),
  related: z.string().min(1).nullable().optional(),
  attemptId: z.string().uuid().nullable().optional(),
});
export type AdminJournal = z.infer<typeof adminJournalSchema>;

export const adminJournalListSchema = z.object({
  items: z.array(adminJournalSchema),
  total: z.number().int().min(0),
  limit: z.number().int().min(1),
  offset: z.number().int().min(0),
  hasMore: z.boolean(),
});
export type AdminJournalList = z.infer<typeof adminJournalListSchema>;

export const adminLedgerSummarySchema = z.object({
  pendingTopUps: z.object({
    count: z.number().int().nonnegative(),
    points: z.number().int().nonnegative(),
    amountVnd: z.number().int().nonnegative(),
  }),
  /** Sum of every Ký quỹ balance (surveys running). */
  escrowTotal: z.number().int().nonnegative(),
  /** Sum of every Chờ 48h balance (Google Forms rewards in review). */
  pendingTotal: z.number().int().nonnegative(),
  /** Escrow given back since 00:00 Vietnam time. */
  refundedToday: z.object({
    points: z.number().int().nonnegative(),
    surveys: z.number().int().nonnegative(),
  }),
});
export type AdminLedgerSummary = z.infer<typeof adminLedgerSummarySchema>;

export const ADMIN_JOURNAL_PAGE_SIZE = 50;

export function listAdminJournals(
  query: { type: TransactionFilter; from: string | null; offset?: number },
  signal?: AbortSignal,
): Promise<AdminJournalList> {
  const params = new URLSearchParams({ limit: String(ADMIN_JOURNAL_PAGE_SIZE) });
  if (query.type !== "all") params.set("type", query.type);
  if (query.from) params.set("from", query.from);
  if (query.offset) params.set("offset", String(query.offset));
  return apiRequest(`/admin/ledger/journals?${params.toString()}`, { schema: adminJournalListSchema, signal });
}

export function getAdminLedgerSummary(signal?: AbortSignal): Promise<AdminLedgerSummary> {
  return apiRequest("/admin/ledger/summary", { schema: adminLedgerSummarySchema, signal });
}
