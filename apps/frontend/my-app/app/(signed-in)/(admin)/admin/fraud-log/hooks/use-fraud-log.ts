"use client";

import { useCallback, useMemo, useState } from "react";
import { newJournalRows } from "@/lib/admin/admin-transactions";
import { listFraudLog, type FraudLogEntry, type FraudLogPage, type FraudLogQuery } from "@/lib/admin/fraud-log-service";
import { initialUserText, parseFraudWindow, resolveUserFilter } from "@/lib/admin/fraud-log-view";
import { useApiQuery } from "@/lib/api/use-api-query";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { useSessionLossRedirect } from "@/lib/session/use-session-loss";

/** The first page and the query it was read with ("Tải thêm" keeps the same filter). */
interface FirstPage {
  page: FraudLogPage;
  query: FraudLogQuery;
}

/** Older entries loaded with "Tải thêm", tied to the first page they continue. */
interface OlderPages {
  base: FirstPage;
  items: FraudLogEntry[];
  nextCursor: string | null;
}

/**
 * `/admin/fraud-log[?userId=<uuid|#code>]` data (VERIFIED `GET /admin/fraud-log`).
 * Default window: 14 days (Figma "14 ngày qua"). Newest first; "Tải thêm"
 * follows `nextCursor` (keyset), so entries written meanwhile never repeat rows.
 */
export function useFraudLog(urlUserId: string | null) {
  const [userText, setUserText] = useState(() => initialUserText(urlUserId));
  const [windowValue, setWindowValue] = useState("14");
  const [type, setType] = useState("");
  const debouncedUser = useDebouncedValue(userText, 300);

  const userFilter = resolveUserFilter(debouncedUser, urlUserId);
  const days = parseFraudWindow(windowValue);
  const key = `admin:fraud-log:${userFilter.userId ?? ""}:${userFilter.search ?? ""}:${days ?? "all"}:${type}`;
  const first = useApiQuery(key, async (signal): Promise<FirstPage> => {
    const query: FraudLogQuery = { ...userFilter, days, type: type || undefined };
    return { page: await listFraudLog(query, signal), query };
  });
  const [older, setOlder] = useState<OlderPages | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<unknown>(null);
  const sessionLost = useSessionLossRedirect(first.error, loadMoreError);

  const base = first.data;
  // A new filter or a reload starts again from the first page.
  const extra = older && older.base === base ? older : null;
  const items = useMemo(() => (base ? [...base.page.items, ...(extra?.items ?? [])] : []), [base, extra]);
  const nextCursor = extra ? extra.nextCursor : (base?.page.nextCursor ?? null);

  const loadMore = useCallback(async () => {
    if (!base || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const page = await listFraudLog({ ...base.query, cursor: nextCursor });
      setOlder({ base, items: [...(extra?.items ?? []), ...newJournalRows(items, page.items)], nextCursor: page.nextCursor });
    } catch (error) {
      setLoadMoreError(error);
    } finally {
      setLoadingMore(false);
    }
  }, [base, extra, items, nextCursor, loadingMore]);

  return {
    userText,
    setUserText,
    windowValue,
    setWindowValue,
    type,
    setType,
    data: base?.page,
    items,
    loading: first.loading || sessionLost,
    error: sessionLost ? null : first.error,
    reload: first.reload,
    hasMore: nextCursor !== null,
    loadMore,
    loadingMore,
    loadMoreFailed: Boolean(loadMoreError) && !sessionLost,
  };
}
