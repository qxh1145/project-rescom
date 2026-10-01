import { marketplaceFeedResponseSchema, marketplaceSurveyCardSchema } from "@rescom/schemas";
import { z } from "zod";
import { apiRequest } from "../api/client.ts";
import { toFeedQueryParams, type MarketplaceFilters } from "./marketplace-query.ts";

/**
 * Survey card of the feed. VERIFIED since plan 2.2: `topic` is a shared
 * `FORM_TOPICS` value (or null); the card shows its Vietnamese label
 * (`topicLabel`).
 */
export const marketplaceCardSchema = marketplaceSurveyCardSchema;
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
