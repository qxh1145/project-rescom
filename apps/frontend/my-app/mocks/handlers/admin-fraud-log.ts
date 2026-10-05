import { http } from "msw";
import {
  FRAUD_LOG_MAX_ACCOUNTS,
  FRAUD_LOG_MAX_SEARCH_CANDIDATES,
  FRAUD_LOG_SCAN_CAP,
  fraudLogPageSchema,
  keysetCursorOf,
  listFraudLogQuerySchema,
  parseKeysetCursor,
  shortCodePrefixOf,
} from "@rescom/schemas";
import { apiUrl } from "@/lib/api/config";
import { isRepeatOffender, queryFraudLog, type MockFraudLogEntry } from "../data/admin-fraud-log";
import { listMockAdminUsers, type MockAdminUser } from "../data/admin-users";
import { fail, ok } from "../envelope";
import { applyScenario } from "../scenarios";
import { requireMockAdmin } from "./admin";

/** Backend `filterMatching`: short code (`shortCodePrefixOf`), e-mail or display name. */
function matchesTerm(user: Pick<MockAdminUser, "id" | "email" | "name">, term: string): boolean {
  const needle = term.trim().toLowerCase();
  const code = shortCodePrefixOf(term);
  return (
    user.email.toLowerCase().includes(needle) ||
    (user.name?.toLowerCase().includes(needle) ?? false) ||
    (code !== null && user.id.replace(/-/g, "").toLowerCase().startsWith(code))
  );
}

/** Distinct accounts of entries already newest first: the latest entry decides the order. */
function distinctUsers(entries: readonly MockFraudLogEntry[]): string[] {
  const ids: string[] = [];
  for (const entry of entries) if (!ids.includes(entry.userId)) ids.push(entry.userId);
  return ids;
}

/**
 * VERIFIED: GET /admin/fraud-log (`lib/admin/fraud-log-service.ts`). Read only. The query and the
 * page parse with the same shared schemas as the backend controller, with the same bounds: a
 * search checks at most `FRAUD_LOG_MAX_SEARCH_CANDIDATES` accounts with matching entries, `total`
 * and `accounts` cover at most the newest `FRAUD_LOG_SCAN_CAP` entries, and `truncated` /
 * `totalCapped` say when a bound was hit.
 */
export const adminFraudLogHandlers = [
  http.get(apiUrl("/admin/fraud-log"), async ({ request }) => {
    const forced = await applyScenario("admin");
    if (forced) return forced;
    const admin = await requireMockAdmin();
    if (admin instanceof Response) return admin;

    const parsed = listFraudLogQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) {
      return fail(400, "VALIDATION_ERROR", parsed.error.errors[0]?.message ?? "Validation failed", {
        details: parsed.error.format(),
      });
    }
    const { userId, search, days, type, limit, cursor } = parsed.data;
    const windowDays = days ?? null;

    const users = listMockAdminUsers();
    let userIds: string[] | undefined;
    let searchTruncated = false;
    if (userId) {
      userIds = [userId];
    } else if (search) {
      const candidates = distinctUsers(queryFraudLog({ days: windowDays, type }).slice(0, FRAUD_LOG_SCAN_CAP + 1));
      searchTruncated = candidates.length > FRAUD_LOG_MAX_SEARCH_CANDIDATES;
      const checked = new Set(candidates.slice(0, FRAUD_LOG_MAX_SEARCH_CANDIDATES));
      userIds = users.filter((user) => checked.has(user.id) && matchesTerm(user, search)).map((user) => user.id);
    }
    const matching = queryFraudLog({ userIds, days: windowDays, type });
    const bounded = matching.slice(0, FRAUD_LOG_SCAN_CAP);
    const totalCapped = matching.length > FRAUD_LOG_SCAN_CAP;

    const counts = new Map<string, number>();
    for (const item of bounded) counts.set(item.userId, (counts.get(item.userId) ?? 0) + 1);
    const statusOf = new Map(users.map((user) => [user.id, user.status]));
    const ranked = [...counts.entries()]
      // Backend order: most entries first, ties by account id.
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([id, count]) => ({
        userId: id,
        count,
        repeated: isRepeatOffender(id),
        status: statusOf.get(id) ?? "ACTIVE",
      }));

    // Keyset: the rows after the cursor row in list order (newest first, ties by id descending).
    const after = cursor ? parseKeysetCursor(cursor) : null;
    const rest = after
      ? matching.filter(
          (item) => item.createdAt < after.createdAt || (item.createdAt === after.createdAt && item.id < after.id),
        )
      : matching;
    const items = rest.slice(0, limit);
    const last = items[items.length - 1];
    return ok(
      fraudLogPageSchema.parse({
        items,
        total: bounded.length,
        totalCapped,
        truncated: searchTruncated || totalCapped || ranked.length > FRAUD_LOG_MAX_ACCOUNTS,
        windowDays,
        accounts: ranked.slice(0, FRAUD_LOG_MAX_ACCOUNTS),
        nextCursor: rest.length > limit && last ? keysetCursorOf(last) : null,
      }),
    );
  }),
];
