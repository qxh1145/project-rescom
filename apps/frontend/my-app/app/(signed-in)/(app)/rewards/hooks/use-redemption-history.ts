"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RedemptionHistoryEntryDto, RedemptionHistoryListDto } from "@rescom/schemas";
import { useApiQuery } from "@/lib/api/use-api-query";
import { listRedemptionHistory } from "@/lib/rewards/rewards-service";

/** Pages loaded with "Xem thêm", tied to the first page they continue (a reload drops them). */
interface MorePages {
  first: RedemptionHistoryListDto;
  items: RedemptionHistoryEntryDto[];
  latest: RedemptionHistoryListDto;
}

export function useRedemptionHistory() {
  const query = useApiQuery("rewards-history", useCallback((signal) => listRedemptionHistory(0, signal), []));
  const first = query.data;
  const [more, setMore] = useState<MorePages | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const extra = more && more.first === first ? more : null;
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  const history = useMemo<RedemptionHistoryListDto | undefined>(() => {
    if (!first) return undefined;
    return { ...(extra?.latest ?? first), monthSummary: first.monthSummary, items: [...first.items, ...(extra?.items ?? [])] };
  }, [first, extra]);

  const loadMore = useCallback(async () => {
    if (!first || !history?.hasMore || loadingMore) return;
    setLoadingMore(true);
    setLoadMoreFailed(false);
    controller.current = new AbortController();
    try {
      const page = await listRedemptionHistory(history.items.length, controller.current.signal);
      const seen = new Set(history.items.map((item) => item.id));
      setMore({ first, items: [...(extra?.items ?? []), ...page.items.filter((item) => !seen.has(item.id))], latest: page });
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === "AbortError")) setLoadMoreFailed(true);
    } finally {
      setLoadingMore(false);
    }
  }, [first, history, loadingMore, extra]);

  return { history, loading: query.loading, error: query.error, reload: query.reload, loadMore, loadingMore, loadMoreFailed };
}
