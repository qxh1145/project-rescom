import { http, type RequestHandler } from "msw";
import {
  adminJournalListSchema,
  adminLedgerSummarySchema,
  listAdminJournalsQuerySchema,
  parseKeysetCursor,
} from "@rescom/schemas";
import { isAfterJournalCursor } from "@/lib/admin/admin-transactions";
import { apiUrl } from "@/lib/api/config";
import { adminLedgerSummary, listAdminJournals } from "../data/admin-transactions";
import { fail, ok } from "../envelope";
import { applyScenario } from "../scenarios";
import { requireMockAdmin } from "./admin";

/**
 * Admin ledger view (Figma 11f). Both routes are VERIFIED (`lib/admin/transactions-service.ts`); the
 * query and the responses parse with the same shared schemas as the backend controller.
 */
export const adminTransactionHandlers: RequestHandler[] = [
  // VERIFIED: GET /admin/ledger/journals?type&from&to&before&limit (keyset cursor)
  http.get(apiUrl("/admin/ledger/journals"), async ({ request }) => {
    const forced = await applyScenario("admin");
    if (forced) return forced;
    const admin = await requireMockAdmin();
    if (admin instanceof Response) return admin;
    const parsed = listAdminJournalsQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) {
      return fail(400, "VALIDATION_ERROR", "Invalid query.", { details: parsed.error.format() });
    }
    const { type, from, to, before, limit } = parsed.data;
    const cursor = before ? parseKeysetCursor(before) : null;
    const all = listAdminJournals(type ?? "all", from ?? null, to ?? null);
    const rest = cursor ? all.filter((journal) => isAfterJournalCursor(journal, cursor)) : all;
    const items = rest.slice(0, limit);
    return ok(adminJournalListSchema.parse({ items, limit, hasMore: items.length < rest.length }));
  }),

  // VERIFIED: GET /admin/ledger/summary
  http.get(apiUrl("/admin/ledger/summary"), async () => {
    const forced = await applyScenario("admin");
    if (forced) return forced;
    const admin = await requireMockAdmin();
    if (admin instanceof Response) return admin;
    return ok(adminLedgerSummarySchema.parse(adminLedgerSummary()));
  }),
];
