import { http, type RequestHandler } from "msw";
import { z } from "zod";
import { isTransactionFilter } from "@/lib/admin/admin-transactions";
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
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

export const adminTransactionHandlers: RequestHandler[] = [
  // ASSUMED API CONTRACT: GET /admin/ledger/journals?type&from&limit&offset
  http.get(apiUrl("/admin/ledger/journals"), async ({ request }) => {
    const forced = await applyScenario("admin");
    if (forced) return forced;
    const admin = await requireMockAdmin();
    if (admin instanceof Response) return admin;
    const parsed = journalsQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) {
      return fail(400, "VALIDATION_ERROR", "Invalid query.", { details: parsed.error.format() });
    }
    const { type, from, limit, offset } = parsed.data;
    const all = listAdminJournals(type && isTransactionFilter(type) ? type : "all", from ?? null);
    const items = all.slice(offset, offset + limit);
    return ok({ items, total: all.length, limit, offset, hasMore: offset + items.length < all.length });
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
