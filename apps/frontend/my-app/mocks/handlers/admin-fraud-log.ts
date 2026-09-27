import { http } from "msw";
import { z } from "zod";
import { apiUrl } from "@/lib/api/config";
import { isRepeatOffender, queryFraudLog } from "../data/admin-fraud-log";
import { listMockAdminUsers, matchesUserSearch } from "../data/admin-users";
import { fail, ok } from "../envelope";
import { applyScenario } from "../scenarios";
import { requireMockAdmin } from "./admin";

/** ASSUMED API CONTRACT: GET /admin/fraud-log (see `lib/admin/fraud-log-service.ts`). Read only. */
const querySchema = z
  .object({
    userId: z.string().uuid().optional(),
    search: z.string().trim().max(100).optional(),
    days: z.enum(["7", "14", "30"]).optional(),
    type: z.string().trim().max(40).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(100),
  })
  .strict();

export const adminFraudLogHandlers = [
  http.get(apiUrl("/admin/fraud-log"), async ({ request }) => {
    const forced = await applyScenario("admin");
    if (forced) return forced;
    const admin = await requireMockAdmin();
    if (admin instanceof Response) return admin;

    const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) {
      return fail(400, "VALIDATION_ERROR", parsed.error.errors[0]?.message ?? "Validation failed", {
        details: parsed.error.format(),
      });
    }
    const { userId, search, days, type, limit } = parsed.data;

    const users = listMockAdminUsers();
    const userIds = userId
      ? [userId]
      : search
        ? users.filter((user) => matchesUserSearch(user, search)).map((user) => user.id)
        : undefined;
    const windowDays = days ? Number(days) : null;
    const matching = queryFraudLog({ userIds, days: windowDays, type: type || undefined });

    const counts = new Map<string, number>();
    for (const item of matching) counts.set(item.userId, (counts.get(item.userId) ?? 0) + 1);
    const statusOf = new Map(users.map((user) => [user.id, user.status]));
    const accounts = [...counts.entries()]
      .map(([id, count]) => ({
        userId: id,
        count,
        repeated: isRepeatOffender(id),
        status: statusOf.get(id) ?? "ACTIVE",
      }))
      .sort((a, b) => b.count - a.count);

    return ok({ items: matching.slice(0, limit), total: matching.length, windowDays, accounts });
  }),
];
