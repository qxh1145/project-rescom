/**
 * Khám phá (Figma page 3) filter state ↔ URL query ↔ `GET /marketplace/feed`
 * query. Pure helpers (no React/Next) shared by the page hook and tests.
 *
 * URL parameters (shareable, back button works): `q` search, `sort`, `type`,
 * `duration`, `hideDone=1`. Defaults are omitted so `/marketplace` is clean.
 */

/** Sort options drawn in Figma (desktop select, mobile chips). */
export const MARKETPLACE_SORTS = ["best_match", "duration_asc", "reward_desc"] as const;
export type MarketplaceSort = (typeof MARKETPLACE_SORTS)[number];

export const SORT_LABELS: Record<MarketplaceSort, string> = {
  best_match: "Phù hợp nhất",
  duration_asc: "Nhanh nhất",
  reward_desc: "Nhiều điểm",
};

/** Figma "Thời lượng" radios. */
export const DURATION_FILTERS = ["all", "under5", "5to10"] as const;
export type DurationFilter = (typeof DURATION_FILTERS)[number];

export const DURATION_LABELS: Record<DurationFilter, string> = {
  all: "Tất cả",
  under5: "Dưới 5 phút",
  "5to10": "5 – 10 phút",
};

export interface SurveyTypeFilter {
  /** "Trong Rescom" */
  internal: boolean;
  /** "Google Forms" */
  external: boolean;
}

export interface MarketplaceFilters {
  search: string;
  sort: MarketplaceSort;
  types: SurveyTypeFilter;
  duration: DurationFilter;
  hideCompleted: boolean;
}

/** Backend `search` is capped at 100 characters (`marketplaceFeedQuerySchema`). */
export const SEARCH_MAX_LENGTH = 100;

export const DEFAULT_FILTERS: MarketplaceFilters = {
  search: "",
  sort: "best_match",
  types: { internal: true, external: true },
  duration: "all",
  // Figma 62:582 leaves "Ẩn khảo sát đã làm" unchecked and shows a completed card.
  hideCompleted: false,
};

function oneOf<T extends string>(values: readonly T[], raw: string | null, fallback: T): T {
  return raw !== null && (values as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

export function normalizeSearch(raw: string | null | undefined): string {
  return (raw ?? "").trim().slice(0, SEARCH_MAX_LENGTH);
}

/** Reads the filters from the page URL; unknown or invalid values fall back to the defaults. */
export function parseMarketplaceParams(params: { get(name: string): string | null }): MarketplaceFilters {
  const type = params.get("type");
  return {
    search: normalizeSearch(params.get("q")),
    sort: oneOf(MARKETPLACE_SORTS, params.get("sort"), DEFAULT_FILTERS.sort),
    types:
      type === "internal"
        ? { internal: true, external: false }
        : type === "external"
          ? { internal: false, external: true }
          : { internal: true, external: true },
    duration: oneOf(DURATION_FILTERS, params.get("duration"), DEFAULT_FILTERS.duration),
    hideCompleted: params.get("hideDone") === "1",
  };
}

function typeParam(types: SurveyTypeFilter): "internal" | "external" | null {
  if (types.internal && !types.external) return "internal";
  if (types.external && !types.internal) return "external";
  // Both (or, defensively, neither) = every type.
  return null;
}

/**
 * Writes the filters back into `base` (other parameters such as `activation`
 * or `msw` are kept). Returns the query string without `?`.
 */
export function serializeMarketplaceParams(filters: MarketplaceFilters, base?: URLSearchParams): string {
  const params = new URLSearchParams(base);
  const set = (key: string, value: string | null) => {
    if (value === null) params.delete(key);
    else params.set(key, value);
  };
  const search = normalizeSearch(filters.search);
  set("q", search === "" ? null : search);
  set("sort", filters.sort === DEFAULT_FILTERS.sort ? null : filters.sort);
  set("type", typeParam(filters.types));
  set("duration", filters.duration === DEFAULT_FILTERS.duration ? null : filters.duration);
  set("hideDone", filters.hideCompleted ? "1" : null);
  return params.toString();
}

/**
 * Backend has only `maxDuration` (seconds, inclusive): "Dưới 5 phút" = up to
 * 4:59; "5 – 10 phút" = up to 10:00 plus a client-side lower bound
 * (`matchesClientFilters`). ASSUMED: no `minDuration` on the backend yet.
 */
const DURATION_BOUNDS: Record<DurationFilter, { minSeconds: number | null; maxSeconds: number | null }> = {
  all: { minSeconds: null, maxSeconds: null },
  under5: { minSeconds: null, maxSeconds: 5 * 60 - 1 },
  "5to10": { minSeconds: 5 * 60, maxSeconds: 10 * 60 },
};

/**
 * `GET /marketplace/feed` query (VERIFIED `marketplaceFeedQuerySchema`).
 * `hideCompleted` is always sent: the backend defaults it to `true`, the
 * Figma default is `false`.
 */
export function toFeedQueryParams(filters: MarketplaceFilters): URLSearchParams {
  const params = new URLSearchParams();
  params.set("sortBy", filters.sort);
  params.set("hideCompleted", filters.hideCompleted ? "true" : "false");
  const type = typeParam(filters.types);
  params.set("type", type === "internal" ? "INTERNAL" : type === "external" ? "EXTERNAL" : "ALL");
  const search = normalizeSearch(filters.search);
  if (search) params.set("search", search);
  const { maxSeconds } = DURATION_BOUNDS[filters.duration];
  if (maxSeconds !== null) params.set("maxDuration", String(maxSeconds));
  return params;
}

/** The part of a duration filter the backend cannot express. */
export function matchesClientFilters(survey: { estimatedEffortSeconds: number }, filters: MarketplaceFilters): boolean {
  const { minSeconds } = DURATION_BOUNDS[filters.duration];
  return minSeconds === null || survey.estimatedEffortSeconds >= minSeconds;
}

/** True when search/type/duration narrow the feed (an empty result is then "no match", not 3b). */
export function hasNarrowingFilters(filters: MarketplaceFilters): boolean {
  return (
    filters.search !== "" ||
    typeParam(filters.types) !== null ||
    filters.duration !== DEFAULT_FILTERS.duration
  );
}

/** Filters behind the mobile "Bộ lọc" button (sort has its own chips). */
export function activeFilterCount(filters: MarketplaceFilters): number {
  return (
    (typeParam(filters.types) !== null ? 1 : 0) +
    (filters.duration !== DEFAULT_FILTERS.duration ? 1 : 0) +
    (filters.hideCompleted ? 1 : 0)
  );
}

/**
 * Toggling a type checkbox. At least one type stays checked (ASSUMED: the
 * backend has no "no type" filter), so unchecking the last one is refused.
 */
export function toggleSurveyType(types: SurveyTypeFilter, key: keyof SurveyTypeFilter): SurveyTypeFilter {
  const next = { ...types, [key]: !types[key] };
  return next.internal || next.external ? next : types;
}

/** Whole minutes for card meta ("5 phút"); at least 1. */
export function effortMinutes(seconds: number): number {
  return Math.max(1, Math.round(seconds / 60));
}

/** "Còn 38/100 suất" — never negative. */
export function remainingSlots(survey: { expectedCompletions: number; completedCompletions: number }): number {
  return Math.max(0, survey.expectedCompletions - survey.completedCompletions);
}

/**
 * 15f "Khảo sát nhanh cho bạn": the quickest open surveys (shortest first,
 * then highest reward).
 */
export function quickestSurveys<T extends { estimatedEffortSeconds: number; rewardPerResponse: number; isCompletedByCurrentUser: boolean }>(
  surveys: readonly T[],
  limit = 3,
): T[] {
  return surveys
    .filter((survey) => !survey.isCompletedByCurrentUser)
    .sort((a, b) => a.estimatedEffortSeconds - b.estimatedEffortSeconds || b.rewardPerResponse - a.rewardPerResponse)
    .slice(0, limit);
}
