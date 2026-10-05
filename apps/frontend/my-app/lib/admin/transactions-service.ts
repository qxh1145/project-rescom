import {
  ADMIN_JOURNAL_DEFAULT_LIMIT,
  adminJournalListSchema,
  adminLedgerSummarySchema,
  type AdminJournalList,
  type AdminLedgerSummary,
} from "@rescom/schemas";
import { apiRequest } from "../api/client.ts";
import type { TransactionFilter } from "./admin-transactions.ts";

/**
 * Admin ledger view (Figma 11f "Giao dịch điểm", 63:1629).
 *
 * VERIFIED (`admin/presentation/admin-ledger.controller.ts`, shared schemas in
 * `@rescom/schemas` `admin/admin-ledger.schema.ts`), ADMIN only:
 * - `GET /admin/ledger/journals?type&from&to&before&limit` → page of journals
 *   (newest first, ties by id descending) with `entries[].accountClass` /
 *   `entries[].ownerName` (the account's tier and its owner's display name, for
 *   "Từ → Đến · Linh N."), `related` (survey title of escrow / refund journals)
 *   and `attemptId` (Google Forms rewards, anonymous "#7F3A" code).
 *   `type` = `top-up | escrow | reward | refund` (omitted = all), grouped by
 *   idempotency-key prefix (`ADMIN_LEDGER_FILTER_KEY_PREFIXES`, the same
 *   grouping as `matchesTransactionFilter`); `from` / `to` = ISO bounds on
 *   `createdAt` (`from` omitted = all time), frozen by the client at the first
 *   page; `before` = keyset cursor `<createdAt>:<id>` of the last row already
 *   shown (`journalCursorOf`), so a journal posted between pages cannot shift
 *   or repeat rows.
 * - `GET /admin/ledger/summary` → the four cards: pending top-ups (count,
 *   points, VND), total Ký quỹ, total Chờ 48h, escrow refunded since 00:00
 *   Vietnam time.
 */

export {
  adminJournalEntrySchema,
  adminJournalListSchema,
  adminJournalSchema,
  adminLedgerSummarySchema,
} from "@rescom/schemas";
export type { AdminJournal, AdminJournalList, AdminLedgerSummary } from "@rescom/schemas";

export const ADMIN_JOURNAL_PAGE_SIZE = ADMIN_JOURNAL_DEFAULT_LIMIT;

export function listAdminJournals(
  query: { type: TransactionFilter; from: string | null; to: string; before?: string },
  signal?: AbortSignal,
): Promise<AdminJournalList> {
  const params = new URLSearchParams({ limit: String(ADMIN_JOURNAL_PAGE_SIZE) });
  if (query.type !== "all") params.set("type", query.type);
  if (query.from) params.set("from", query.from);
  params.set("to", query.to);
  if (query.before) params.set("before", query.before);
  return apiRequest(`/admin/ledger/journals?${params.toString()}`, { schema: adminJournalListSchema, signal });
}

export function getAdminLedgerSummary(signal?: AbortSignal): Promise<AdminLedgerSummary> {
  return apiRequest("/admin/ledger/summary", { schema: adminLedgerSummarySchema, signal });
}
