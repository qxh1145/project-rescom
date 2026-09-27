import { z } from "zod";
import { apiRequest } from "../api/client.ts";

/**
 * Figma 15g "Tài khoản" (63:483/63:1426), 16 "Hạng thành viên" (63:4981),
 * 16a "Chuỗi ngày" (63:4629), 16b "Bảng xếp hạng" (63:3114/63:4078).
 *
 * ASSUMED API CONTRACT: `GET /engagement/me`. The backend has no streak,
 * tier or leaderboard module yet; this is the frontend-designed shape.
 * - `streak.week`: Monday → Sunday of the current week (7 items, local dates
 *   `YYYY-MM-DD`); `done` = at least one survey completed that day.
 * - `streak.countedToday`: today already counts toward the streak.
 * - `tier.level`: 1…5, see `TIERS` in `./tiers.ts`. Level 2 needs a completed
 *   profile + 1 survey, so it is not derivable from the count alone.
 * - `weeklyRank`: position on "Nhiều khảo sát · Tuần này"; null = unranked.
 */
export const engagementSummarySchema = z.object({
  streak: z.object({
    current: z.number().int().nonnegative(),
    longest: z.number().int().nonnegative(),
    countedToday: z.boolean(),
    week: z
      .array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), done: z.boolean() }))
      .length(7),
  }),
  tier: z.object({
    level: z.number().int().min(1).max(5),
  }),
  stats: z.object({
    completedSurveys: z.number().int().nonnegative(),
    publishedSurveys: z.number().int().nonnegative(),
  }),
  weeklyRank: z.number().int().positive().nullable(),
});
export type EngagementSummary = z.infer<typeof engagementSummarySchema>;

export function getEngagementSummary(signal?: AbortSignal): Promise<EngagementSummary> {
  return apiRequest("/engagement/me", { schema: engagementSummarySchema, signal });
}
