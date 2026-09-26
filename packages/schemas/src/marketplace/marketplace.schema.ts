import { z } from "zod";
import { surveyTargetingSchema } from "../forms/form-targeting.schema";

/**
 * Supported sorting options for the marketplace feed.
 */
export const marketplaceSortOptionSchema = z.enum([
  "best_match",
  "reward_desc",
  "reward_asc",
  "duration_asc",
  "duration_desc",
  "newest",
]);

export type MarketplaceSortOption = z.infer<typeof marketplaceSortOptionSchema>;

const normalizeSortBy = (val: unknown): unknown => {
  if (val === "reward") return "reward_desc";
  if (val === "duration") return "duration_asc";
  return val;
};

/**
 * Query-string integer: an empty or whitespace-only value means "not set";
 * only plain decimal digits are converted (so `"1e3"`, `"0x10"` or `" "` are
 * never silently read as numbers). Any other string fails validation.
 */
const queryInteger = (val: unknown): unknown => {
  if (typeof val !== "string") return val;
  const trimmed = val.trim();
  if (trimmed === "") return undefined;
  return /^\d+$/.test(trimmed) ? Number(trimmed) : val;
};

export const MARKETPLACE_FEED_MAX_MIN_REWARD = 10_000;
/** Upper bound of `maxDuration`, in seconds (24 hours). */
export const MARKETPLACE_FEED_MAX_DURATION_SECONDS = 86_400;

/**
 * Query schema for GET /api/marketplace/feed
 */
export const marketplaceFeedQuerySchema = z.object({
  sortBy: z.preprocess(
    normalizeSortBy,
    marketplaceSortOptionSchema.default("best_match"),
  ),
  hideCompleted: z.preprocess((val) => {
    if (typeof val === "string") {
      const lower = val.trim().toLowerCase();
      if (lower === "false" || lower === "0") return false;
      if (lower === "true" || lower === "1") return true;
    }
    return val;
  }, z.boolean().default(true)),
  search: z.string().trim().max(100).optional(),
  type: z.enum(["ALL", "INTERNAL", "EXTERNAL"]).default("ALL"),
  minReward: z.preprocess(
    queryInteger,
    z.number().int().nonnegative().max(MARKETPLACE_FEED_MAX_MIN_REWARD).optional(),
  ),
  /**
   * Longest expected effort to show, in SECONDS (compared with the survey's
   * `estimatedDurationMinutes * 60`, falling back to
   * `metadata.expectedEffortSeconds`), not minutes.
   */
  maxDuration: z.preprocess(
    queryInteger,
    z
      .number()
      .int()
      .positive()
      .max(MARKETPLACE_FEED_MAX_DURATION_SECONDS)
      .optional(),
  ),
});

export type MarketplaceFeedQueryDto = z.infer<
  typeof marketplaceFeedQuerySchema
>;

/**
 * Marketplace Survey Card DTO
 * Summary projection of an active, published survey presented in the Marketplace Feed.
 */
export const marketplaceSurveyCardSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable().optional(),
  type: z.enum(["INTERNAL", "EXTERNAL"]),
  status: z.literal("PUBLISHED"),
  rewardPerResponse: z.number().int().nonnegative(),
  expectedCompletions: z.number().int().positive(),
  completedCompletions: z.number().int().nonnegative().default(0),
  estimatedEffortSeconds: z.number().int().nonnegative().default(60),
  versionNumber: z.number().int().positive(),
  publishedAt: z.string().nullable().optional(),
  targetingJson: surveyTargetingSchema.nullable().optional(),
  hasTargeting: z.boolean(),
  isCompletedByCurrentUser: z.boolean().default(false),
});

export const marketplaceFeedResponseSchema = z.object({
  surveys: z.array(marketplaceSurveyCardSchema),
  total: z.number().int().nonnegative(),
  /**
   * Since Story 7.1 the feed is only served to respondents with a complete
   * demographic profile (403 DEMOGRAPHIC_PROFILE_REQUIRED otherwise), so a
   * successful response always carries `true`. Kept for compatibility.
   */
  profileCompleted: z.boolean(),
});

export type MarketplaceSurveyCardDto = z.infer<
  typeof marketplaceSurveyCardSchema
>;
export type MarketplaceFeedResponseDto = z.infer<
  typeof marketplaceFeedResponseSchema
>;
