"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import {
  DEFAULT_FILTERS,
  parseMarketplaceParams,
  serializeMarketplaceParams,
  type MarketplaceFilters,
} from "@/lib/marketplace/marketplace-query";

/**
 * Khám phá filters live in the URL (shareable; back/forward restore them).
 * Filter and sort changes push a history entry; search keystrokes replace it.
 */
export function useMarketplaceFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const filters = useMemo(() => parseMarketplaceParams(searchParams), [searchParams]);

  const setFilters = useCallback(
    (patch: Partial<MarketplaceFilters>, mode: "push" | "replace" = "push") => {
      // Read the live URL, not a render snapshot, so a debounced search commit
      // never overwrites a filter chosen in the meantime.
      const current = new URLSearchParams(window.location.search);
      const query = serializeMarketplaceParams({ ...parseMarketplaceParams(current), ...patch }, current);
      if (query === current.toString()) return;
      const href = query ? `${pathname}?${query}` : pathname;
      if (mode === "replace") router.replace(href, { scroll: false });
      else router.push(href, { scroll: false });
    },
    [pathname, router],
  );

  const resetFilters = useCallback(() => setFilters(DEFAULT_FILTERS), [setFilters]);

  return { filters, setFilters, resetFilters };
}
