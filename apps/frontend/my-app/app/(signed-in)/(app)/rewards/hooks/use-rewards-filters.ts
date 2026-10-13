"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import {
  DEFAULT_REWARDS_FILTERS,
  parseRewardsParams,
  serializeRewardsParams,
  type RewardsFilters,
} from "@/lib/rewards/catalog-query";

export function useRewardsFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const filters = useMemo(() => parseRewardsParams(searchParams), [searchParams]);

  const setFilters = useCallback(
    (patch: Partial<RewardsFilters>, mode: "push" | "replace" = "push") => {
      const current = new URLSearchParams(window.location.search);
      const query = serializeRewardsParams(
        { ...parseRewardsParams(current), ...patch },
        current,
      ).toString();
      if (query === current.toString()) return;
      const href = query ? `${pathname}?${query}` : pathname;
      if (mode === "replace") router.replace(href, { scroll: false });
      else router.push(href, { scroll: false });
    },
    [pathname, router],
  );

  const resetFilters = useCallback(() => setFilters(DEFAULT_REWARDS_FILTERS), [setFilters]);

  return { filters, setFilters, resetFilters };
}
