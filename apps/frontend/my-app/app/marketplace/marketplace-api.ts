import type {
  MarketplaceFeedQueryDto,
  MarketplaceFeedResponseDto,
} from "@rescom/schemas";

export { formMutationFetch } from "../forms/forms-api";

export async function fetchMarketplaceFeed(
  query?: MarketplaceFeedQueryDto,
): Promise<MarketplaceFeedResponseDto> {
  const params = new URLSearchParams();
  if (query?.sortBy) params.set("sortBy", query.sortBy);
  if (query?.hideCompleted !== undefined)
    params.set("hideCompleted", String(query.hideCompleted));
  if (query?.search) params.set("search", query.search);
  if (query?.type && query.type !== "ALL") params.set("type", query.type);
  if (query?.minReward !== undefined)
    params.set("minReward", String(query.minReward));
  if (query?.maxDuration !== undefined)
    params.set("maxDuration", String(query.maxDuration));

  const qs = params.toString();
  const url = qs ? `/api/marketplace/feed?${qs}` : "/api/marketplace/feed";

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error("Failed to load marketplace feed");
  }
  const json = await res.json();
  return json.data;
}
