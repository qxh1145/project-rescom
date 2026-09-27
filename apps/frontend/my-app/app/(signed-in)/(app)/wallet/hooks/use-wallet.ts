"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useApiQuery } from "@/lib/api/use-api-query";
import { useSession } from "@/lib/session/SessionProvider";
import { useSessionLossRedirect } from "@/lib/session/use-session-loss";
import {
  appendTransactions,
  dropTrailingJournal,
  hasDuePendingRelease,
  nextPendingReleaseHours,
  toHistoryRows,
  type HistoryFilter,
} from "@/lib/wallet/wallet-history";
import { getWalletDetails, WALLET_HISTORY_LIMIT, type WalletTransaction, type WalletView } from "@/lib/wallet/wallet-service";

/** Older pages loaded with "Tải thêm", tied to the first page they continue. */
interface OlderPages {
  base: WalletView;
  transactions: WalletTransaction[];
  pageIsFull: boolean;
}

/** `/wallet` data: balances + history (first page, then "Tải thêm") and the client-side filter. */
export function useWallet() {
  const query = useApiQuery("wallet-details", (signal) => getWalletDetails(signal));
  const { balance: chipBalance, refresh } = useSession();
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const [older, setOlder] = useState<OlderPages | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<unknown>(null);
  // 401 / locked account: SessionGate redirects instead of an error with a useless retry.
  const sessionLost = useSessionLossRedirect(query.error, loadMoreError);

  const base = query.data;
  // A reload starts again from the first page.
  const extra = older && older.base === base ? older : null;
  const transactions = useMemo(
    () => (base ? appendTransactions(base.transactions, extra?.transactions ?? []) : []),
    [base, extra],
  );
  const pageIsFull = extra ? extra.pageIsFull : (base?.transactions.length ?? 0) >= WALLET_HISTORY_LIMIT;
  const rows = useMemo(() => toHistoryRows(dropTrailingJournal(transactions, pageIsFull)), [transactions, pageIsFull]);

  const loadMore = useCallback(async () => {
    if (!base || loadingMore) return;
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      // Offset = entries received so far (the trailing, maybe split, journal included).
      const offset = base.transactions.length + (extra?.transactions.length ?? 0);
      const page = await getWalletDetails(undefined, offset);
      setOlder({
        base,
        transactions: [...(extra?.transactions ?? []), ...page.transactions],
        pageIsFull: page.transactions.length >= WALLET_HISTORY_LIMIT,
      });
    } catch (error) {
      setLoadMoreError(error);
    } finally {
      setLoadingMore(false);
    }
  }, [base, extra, loadingMore]);

  // The header chip was read when the session loaded; refresh it only if the points moved since.
  const balance = base?.balance;
  const stale =
    balance !== undefined &&
    chipBalance !== null &&
    (balance.available !== chipBalance.available || balance.frozen !== chipBalance.frozen);
  useEffect(() => {
    if (stale) refresh();
  }, [stale, refresh]);

  return {
    wallet: base ?? null,
    error: sessionLost ? null : query.error,
    loading: query.loading || sessionLost,
    reload: query.reload,
    filter,
    setFilter,
    /** Every row; each layout filters them (the mobile control has no "Nạp"). */
    rows,
    hasMore: pageIsFull,
    loadMore,
    loadingMore,
    loadMoreFailed: Boolean(loadMoreError) && !sessionLost,
    pendingHoursLeft: nextPendingReleaseHours(rows),
    pendingDue: hasDuePendingRelease(rows),
  };
}
