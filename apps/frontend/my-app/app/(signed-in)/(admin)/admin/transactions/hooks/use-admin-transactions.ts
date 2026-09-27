"use client";

import { useCallback, useMemo, useState } from "react";
import {
  periodStartIso,
  toTransactionRow,
  type TransactionFilter,
  type TransactionPeriod,
} from "@/lib/admin/admin-transactions";
import {
  getAdminLedgerSummary,
  listAdminJournals,
  type AdminJournal,
  type AdminJournalList,
} from "@/lib/admin/transactions-service";
import { useApiQuery } from "@/lib/api/use-api-query";
import { useSessionLossRedirect } from "@/lib/session/use-session-loss";

/** Older pages loaded with "Tải thêm", tied to the first page they continue. */
interface OlderPages {
  base: AdminJournalList;
  items: AdminJournal[];
  hasMore: boolean;
}

/** `/admin/transactions`: summary cards + journal list (type segments, period select, "Tải thêm"). */
export function useAdminTransactions() {
  const [filter, setFilter] = useState<TransactionFilter>("all");
  const [period, setPeriod] = useState<TransactionPeriod>("today");
  const summary = useApiQuery("admin:ledger-summary", (signal) => getAdminLedgerSummary(signal));
  const journals = useApiQuery(`admin:journals:${filter}:${period}`, (signal) =>
    listAdminJournals({ type: filter, from: periodStartIso(period, new Date()) }, signal),
  );
  const [older, setOlder] = useState<OlderPages | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<unknown>(null);
  const sessionLost = useSessionLossRedirect(summary.error, journals.error, loadMoreError);

  const base = journals.data;
  // A new filter or a reload starts again from the first page.
  const extra = older && older.base === base ? older : null;
  const rows = useMemo(
    () => (base ? [...base.items, ...(extra?.items ?? [])].map(toTransactionRow) : []),
    [base, extra],
  );

  const loadMore = useCallback(async () => {
    if (!base || loadingMore) return;
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const offset = base.items.length + (extra?.items.length ?? 0);
      const page = await listAdminJournals({ type: filter, from: periodStartIso(period, new Date()), offset });
      setOlder({ base, items: [...(extra?.items ?? []), ...page.items], hasMore: page.hasMore });
    } catch (error) {
      setLoadMoreError(error);
    } finally {
      setLoadingMore(false);
    }
  }, [base, extra, filter, loadingMore, period]);

  const reloadSummary = summary.reload;
  const reloadJournals = journals.reload;
  const reloadAll = useCallback(() => {
    reloadSummary();
    reloadJournals();
  }, [reloadSummary, reloadJournals]);

  return {
    summary: summary.data,
    summaryError: sessionLost ? null : summary.error,
    reloadSummary,
    filter,
    setFilter,
    period,
    setPeriod,
    rows,
    loading: (journals.loading && !base) || sessionLost,
    refreshing: journals.loading && Boolean(base),
    error: sessionLost ? null : journals.error,
    reload: reloadAll,
    hasMore: extra ? extra.hasMore : (base?.hasMore ?? false),
    loadMore,
    loadingMore,
    loadMoreFailed: Boolean(loadMoreError) && !sessionLost,
  };
}
