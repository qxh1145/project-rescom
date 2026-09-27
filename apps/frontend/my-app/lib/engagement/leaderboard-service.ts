import { z } from "zod";
import { apiRequest } from "../api/client.ts";

/**
 * Figma 16b "Bảng xếp hạng" (63:3114 desktop, 63:4078 mobile).
 *
 * ASSUMED API CONTRACT: `GET /engagement/leaderboard?type=surveys|streak&period=week|all`.
 * The backend has no leaderboard module yet; this is the frontend-designed shape.
 * - `type`: `surveys` = "Nhiều khảo sát" (completed surveys in the period),
 *   `streak` = "Chuỗi dài nhất" (`week`: current streaks still alive this week,
 *   `all`: longest streak ever — ASSUMED reading of the period chips).
 * - `entries`: the top `size` rows in order, ranked 1…size (Figma numbers
 *   tied values consecutively).
 * - `me`: the signed-in user's own row; `rank` null = not ranked yet
 *   (nothing counted in the period).
 */
export const LEADERBOARD_TYPES = ["surveys", "streak"] as const;
export const LEADERBOARD_PERIODS = ["week", "all"] as const;
export type LeaderboardType = (typeof LEADERBOARD_TYPES)[number];
export type LeaderboardPeriod = (typeof LEADERBOARD_PERIODS)[number];

const leaderboardRowSchema = z.object({
  userId: z.string().min(1),
  rank: z.number().int().positive(),
  name: z.string().min(1),
  tierLevel: z.number().int().min(1).max(5),
  value: z.number().int().nonnegative(),
});

export const leaderboardSchema = z.object({
  type: z.enum(LEADERBOARD_TYPES),
  period: z.enum(LEADERBOARD_PERIODS),
  size: z.number().int().positive(),
  entries: z.array(leaderboardRowSchema),
  me: leaderboardRowSchema.extend({ rank: z.number().int().positive().nullable() }),
});
export type Leaderboard = z.infer<typeof leaderboardSchema>;
export type LeaderboardRow = Leaderboard["entries"][number];

export function getLeaderboard(
  type: LeaderboardType,
  period: LeaderboardPeriod,
  signal?: AbortSignal,
): Promise<Leaderboard> {
  const query = new URLSearchParams({ type, period });
  return apiRequest(`/engagement/leaderboard?${query.toString()}`, { schema: leaderboardSchema, signal });
}
