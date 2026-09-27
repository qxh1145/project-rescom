import { formStatusEnum, marketplaceFeedResponseSchema, marketplaceSurveyCardSchema } from "@rescom/schemas";
import { z } from "zod";
import { apiRequest } from "../api/client.ts";
import { toFeedQueryParams, type MarketplaceFilters } from "./marketplace-query.ts";

/**
 * Survey card of the feed. `topic` ("Marketing", "CNTT" on the Figma cards)
 * is an ASSUMED API CONTRACT extension — the backend DTO has no such field
 * yet, so it is optional and the card simply omits it when absent.
 */
export const marketplaceCardSchema = marketplaceSurveyCardSchema.extend({
  topic: z.string().trim().min(1).nullable().optional(),
});
export type MarketplaceCard = z.infer<typeof marketplaceCardSchema>;

export const marketplaceFeedSchema = marketplaceFeedResponseSchema.extend({
  surveys: z.array(marketplaceCardSchema),
});
export type MarketplaceFeed = z.infer<typeof marketplaceFeedSchema>;

/**
 * VERIFIED: `GET /marketplace/feed` (`marketplace.controller.ts`, session
 * required) → `marketplaceFeedResponseSchema`. 403
 * `DEMOGRAPHIC_PROFILE_REQUIRED` until the demographic profile is complete;
 * 400 `VALIDATION_ERROR` on a bad query.
 */
export function getMarketplaceFeed(filters: MarketplaceFilters, signal?: AbortSignal): Promise<MarketplaceFeed> {
  return apiRequest(`/marketplace/feed?${toFeedQueryParams(filters).toString()}`, {
    schema: marketplaceFeedSchema,
    signal,
  });
}

/**
 * ASSUMED API CONTRACT: `GET /surveys/:id/summary` — public facts about one
 * survey for screens reached without the feed (18.7 "Khảo sát đã đủ người").
 * No backend route yet. 404 `SURVEY_NOT_FOUND`.
 */
export const surveySummarySchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  status: formStatusEnum,
  expectedCompletions: z.number().int().nonnegative(),
  completedCompletions: z.number().int().nonnegative(),
});
export type SurveySummary = z.infer<typeof surveySummarySchema>;

export function getSurveySummary(surveyId: string, signal?: AbortSignal): Promise<SurveySummary> {
  return apiRequest(`/surveys/${encodeURIComponent(surveyId)}/summary`, { schema: surveySummarySchema, signal });
}
