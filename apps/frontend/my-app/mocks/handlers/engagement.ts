import { http, type RequestHandler } from "msw";
import { apiUrl } from "@/lib/api/config";
import { LEADERBOARD_PERIODS, LEADERBOARD_TYPES } from "@/lib/engagement/leaderboard-service";
import { engagementOf, leaderboardOf } from "../data/engagement";
import { getMockSessionUser } from "../db/session";
import { fail, ok, unauthorized } from "../envelope";
import { applyScenario } from "../scenarios";

/**
 * Figma page 16 — streak, tier, leaderboard. Both routes are ASSUMED API
 * CONTRACTS documented in `lib/engagement/engagement-service.ts` and
 * `lib/engagement/leaderboard-service.ts`.
 */

function isOneOf<T extends string>(values: readonly T[], value: string | null): value is T {
  return value !== null && (values as readonly string[]).includes(value);
}

export const engagementHandlers: RequestHandler[] = [
  // ASSUMED API CONTRACT: GET /engagement/me.
  http.get(apiUrl("/engagement/me"), async () => {
    const forced = await applyScenario("engagement");
    if (forced) return forced;
    const user = await getMockSessionUser();
    if (!user) return unauthorized();
    return ok(engagementOf(user));
  }),

  // ASSUMED API CONTRACT: GET /engagement/leaderboard?type=surveys|streak&period=week|all.
  http.get(apiUrl("/engagement/leaderboard"), async ({ request }) => {
    const forced = await applyScenario("engagement");
    if (forced) return forced;
    const user = await getMockSessionUser();
    if (!user) return unauthorized();
    const params = new URL(request.url).searchParams;
    const type = params.get("type") ?? "surveys";
    const period = params.get("period") ?? "week";
    if (!isOneOf(LEADERBOARD_TYPES, type) || !isOneOf(LEADERBOARD_PERIODS, period)) {
      return fail(400, "VALIDATION_ERROR", "Invalid leaderboard type or period.");
    }
    return ok(leaderboardOf(user, type, period));
  }),
];
