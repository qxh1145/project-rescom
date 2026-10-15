import {
  VOUCHER_CATEGORIES,
  VOUCHER_SORTS,
  type VoucherCategory,
  type VoucherSort,
} from "@rescom/schemas";

export interface PointRange {
  id: "lt100" | "100-200" | "gt200";
  label: string;
  minPoints?: number;
  maxPoints?: number;
}

export const POINT_RANGES: readonly PointRange[] = [
  { id: "lt100", label: "Dưới 100", maxPoints: 99 },
  { id: "100-200", label: "100–200", minPoints: 100, maxPoints: 200 },
  { id: "gt200", label: "Trên 200", minPoints: 201 },
] as const;

export interface RewardsFilters {
  q: string;
  category: VoucherCategory[];
  brand: string[];
  points: "lt100" | "100-200" | "gt200" | null;
  sale: boolean;
  afford: boolean;
  sort: VoucherSort;
}

export const DEFAULT_REWARDS_FILTERS: RewardsFilters = {
  q: "",
  category: [],
  brand: [],
  points: null,
  sale: false,
  afford: false,
  sort: "BEST_DEAL",
};

export const REWARDS_BRANDS = [
  { id: "highlands", name: "Highlands Coffee" },
  { id: "lotteria", name: "Lotteria" },
  { id: "phuc-long", name: "Phúc Long" },
  { id: "kfc", name: "KFC" },
  { id: "gong-cha", name: "Gong Cha" },
  { id: "the-coffee-house", name: "The Coffee House" },
] as const;

const KNOWN_CATEGORIES = new Set<string>(VOUCHER_CATEGORIES);
const KNOWN_BRANDS = new Set<string>(REWARDS_BRANDS.map((b) => b.id));
const KNOWN_SORTS = new Set<string>(VOUCHER_SORTS);
const KNOWN_POINT_RANGE_IDS = new Set(["lt100", "100-200", "gt200"]);

const unique = <T>(values: T[]): T[] => [...new Set(values)];

export function parseRewardsParams(params: URLSearchParams): RewardsFilters {
  const q = (params.get("q") ?? "").trim().slice(0, 100);

  const rawCat = params.get("category");
  const category: VoucherCategory[] = rawCat
    ? (unique(rawCat.split(",").map((s) => s.trim()).filter((s) => KNOWN_CATEGORIES.has(s))) as VoucherCategory[])
    : [];

  const rawBrand = params.get("brand");
  const brand: string[] = rawBrand
    ? unique(rawBrand.split(",").map((s) => s.trim()).filter((s) => KNOWN_BRANDS.has(s)))
    : [];

  const rawPoints = params.get("points");
  const points = rawPoints && KNOWN_POINT_RANGE_IDS.has(rawPoints)
    ? (rawPoints as RewardsFilters["points"])
    : null;

  const sale = params.get("sale") === "1";
  const afford = params.get("afford") === "1";

  const rawSort = params.get("sort");
  const sort: VoucherSort = rawSort && KNOWN_SORTS.has(rawSort)
    ? (rawSort as VoucherSort)
    : "BEST_DEAL";

  return { q, category, brand, points, sale, afford, sort };
}

export function serializeRewardsParams(filters: RewardsFilters, current?: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(current);

  if (filters.q) next.set("q", filters.q);
  else next.delete("q");

  if (filters.category.length > 0) next.set("category", filters.category.join(","));
  else next.delete("category");

  if (filters.brand.length > 0) next.set("brand", filters.brand.join(","));
  else next.delete("brand");

  if (filters.points) next.set("points", filters.points);
  else next.delete("points");

  if (filters.sale) next.set("sale", "1");
  else next.delete("sale");

  if (filters.afford) next.set("afford", "1");
  else next.delete("afford");

  if (filters.sort !== "BEST_DEAL") next.set("sort", filters.sort);
  else next.delete("sort");

  return next;
}

export function toCatalogQuery(filters: RewardsFilters): string {
  const params = new URLSearchParams();

  // Schema: q is trim().min(1).max(100); never send whitespace-only or longer input.
  const q = filters.q.trim().slice(0, 100).trim();
  if (q) params.set("q", q);
  if (filters.category.length > 0) params.set("category", filters.category.join(","));
  if (filters.brand.length > 0) params.set("brand", filters.brand.join(","));

  if (filters.points) {
    const range = POINT_RANGES.find((r) => r.id === filters.points);
    if (range) {
      if (range.minPoints !== undefined) params.set("minPoints", String(range.minPoints));
      if (range.maxPoints !== undefined) params.set("maxPoints", String(range.maxPoints));
    }
  }

  if (filters.sale) params.set("onSale", "true");
  if (filters.afford) params.set("affordable", "true");
  if (filters.sort !== "BEST_DEAL") params.set("sort", filters.sort);

  return params.toString();
}

export function activeFilterCount(filters: RewardsFilters): number {
  let count = 0;
  if (filters.category.length > 0) count += filters.category.length;
  if (filters.brand.length > 0) count += filters.brand.length;
  if (filters.points !== null) count += 1;
  if (filters.sale) count += 1;
  if (filters.afford) count += 1;
  return count;
}
