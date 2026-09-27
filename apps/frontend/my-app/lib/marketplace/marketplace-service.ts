import { marketplaceFeedResponseSchema, marketplaceSurveyCardSchema } from "@rescom/schemas";
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
