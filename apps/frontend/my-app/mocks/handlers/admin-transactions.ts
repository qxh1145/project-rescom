import { http, type RequestHandler } from "msw";
import { z } from "zod";
import { isAfterJournalCursor, isTransactionFilter, parseJournalCursor } from "@/lib/admin/admin-transactions";
import { apiUrl } from "@/lib/api/config";
import { adminLedgerSummary, listAdminJournals } from "../data/admin-transactions";
import { fail, ok } from "../envelope";
import { applyScenario } from "../scenarios";
import { requireMockAdmin } from "./admin";

/** Admin ledger view (Figma 11f). Both routes are ASSUMED API CONTRACT (`lib/admin/transactions-service.ts`). */

const journalsQuerySchema = z
  .object({
    type: z.string().refine(isTransactionFilter, "Unknown transaction type").optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    before: z.string().refine((value) => parseJournalCursor(value) !== null, "Invalid cursor").optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

export const adminTransactionHandlers: RequestHandler[] = [
  // ASSUMED API CONTRACT: GET /admin/ledger/journals?type&from&to&before&limit (keyset cursor)
  http.get(apiUrl("/admin/ledger/journals"), async ({ request }) => {
    const forced = await applyScenario("admin");
    if (forced) return forced;
    const admin = await requireMockAdmin();
    if (admin instanceof Response) return admin;
    const parsed = journalsQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) {
      return fail(400, "VALIDATION_ERROR", "Invalid query.", { details: parsed.error.format() });
    }
    const { type, from, to, before, limit } = parsed.data;
    const cursor = before ? parseJournalCursor(before) : null;
    const all = listAdminJournals(type && isTransactionFilter(type) ? type : "all", from ?? null, to ?? null);
    const rest = cursor ? all.filter((journal) => isAfterJournalCursor(journal, cursor)) : all;
    const items = rest.slice(0, limit);
    return ok({ items, limit, hasMore: items.length < rest.length });
  }),

  // ASSUMED API CONTRACT: GET /admin/ledger/summary
  http.get(apiUrl("/admin/ledger/summary"), async () => {
    const forced = await applyScenario("admin");
    if (forced) return forced;
    const admin = await requireMockAdmin();
    if (admin instanceof Response) return admin;
    return ok(adminLedgerSummary());
  }),
];
