"use client";

import { useCallback, useMemo, useState } from "react";
import type { VoucherCatalogDto, VoucherListItemDto } from "@rescom/schemas";
import { useApiQuery } from "@/lib/api/use-api-query";
import { toCatalogQuery, type RewardsFilters } from "@/lib/rewards/catalog-query";
import { listFlashSales, listVouchers } from "@/lib/rewards/rewards-service";
import { serverOffset } from "@/lib/rewards/server-clock";

const PAGE_SIZE = 20;

/** Pages loaded with "Xem thêm", tied to the first page they continue (a reload or new filter drops them). */
interface MorePages {
  first: VoucherCatalogDto;
  items: VoucherListItemDto[];
  latest: VoucherCatalogDto;
}

export function useRewardsCatalog(filters: RewardsFilters) {
  const baseQuery = useMemo(() => {
    const searchParams = new URLSearchParams(toCatalogQuery(filters));
    searchParams.set("limit", String(PAGE_SIZE));
    return searchParams.toString();
  }, [filters]);

  const catalogQuery = useApiQuery(
    `rewards-catalog:${baseQuery}`,
    useCallback((signal) => listVouchers(baseQuery, signal), [baseQuery]),
  );

  const flashSalesQuery = useApiQuery(
    "rewards-flash-sales",
    useCallback((signal) => listFlashSales(signal), []),
  );

  // useApiQuery empties `data` on a new key; keep the last first page so the list does not blank while filtering.
  const fresh = catalogQuery.data;
  const [previous, setPrevious] = useState(fresh);
  if (fresh && fresh !== previous) setPrevious(fresh);
  const first = fresh ?? previous;
  const stale = !fresh && Boolean(previous);

  const [more, setMore] = useState<MorePages | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const extra = more && more.first === first ? more : null;

  const catalog = useMemo<VoucherCatalogDto | undefined>(() => {
    if (!first) return undefined;
    const latest = extra?.latest ?? first;
    return { ...latest, items: [...first.items, ...(extra?.items ?? [])] };
  }, [first, extra]);

  const loadMore = useCallback(async () => {
    if (!fresh || !catalog?.hasMore || loadingMore) return;
    setLoadingMore(true);
    setLoadMoreFailed(false);
    try {
      const params = new URLSearchParams(baseQuery);
      params.set("offset", String(catalog.items.length));
      const page = await listVouchers(params.toString());
      const seen = new Set(catalog.items.map((item) => item.id));
      setMore({
        first: fresh,
        items: [...(extra?.items ?? []), ...page.items.filter((item) => !seen.has(item.id))],
        latest: page,
      });
    } catch {
      setLoadMoreFailed(true);
    } finally {
      setLoadingMore(false);
    }
  }, [fresh, catalog, loadingMore, baseQuery, extra]);

  const { reload: reloadCatalog } = catalogQuery;
  const { reload: reloadFlashSales } = flashSalesQuery;
  const reloadAll = useCallback(() => {
    reloadCatalog();
    reloadFlashSales();
  }, [reloadCatalog, reloadFlashSales]);

  const serverTime = first?.serverTime ?? flashSalesQuery.data?.serverTime ?? null;
  const offsetMs = useMemo(() => {
    if (!serverTime) return 0;
    return serverOffset(serverTime);
  }, [serverTime]);

  return {
    catalog,
    /** The shown list belongs to the previous filters while the new ones load. */
    stale,
    flashSales: flashSalesQuery.data,
    catalogLoading: catalogQuery.loading,
    flashLoading: flashSalesQuery.loading,
    error: catalogQuery.error,
    flashError: flashSalesQuery.error,
    serverTime,
    offsetMs,
    reloadAll,
    loadMore,
    loadingMore,
    loadMoreFailed,
  };
}
