"use client";

import { useCallback, useEffect, useState } from "react";
import type { WalletTopUpMode } from "@/lib/wallet/use-wallet-top-up-mode";
import { listMyTopUpRequests } from "@/lib/wallet/top-up-service";
import { listPayosTopUps } from "@/lib/wallet/payos-top-up-service";
import {
  mergeTopUps,
  type HistoryTopUp,
} from "@/lib/wallet/top-up-history";

export interface TopUpHistoryState {
  items: HistoryTopUp[];
  loading: boolean;
  error: string | null;
  partialError: string | null;
  reload: () => void;
  processingTopUp: HistoryTopUp | null;
}

export function useTopUpHistory(mode: WalletTopUpMode): TopUpHistoryState {
  const [items, setItems] = useState<HistoryTopUp[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [partialError, setPartialError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    setPartialError(null);
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    if (mode === "loading") return; // wait for the mode before choosing which lists to call
    let cancelled = false;
    const controller = new AbortController();

    Promise.allSettled([
      mode === "manual"
        ? Promise.resolve({ items: [] as Awaited<ReturnType<typeof listPayosTopUps>>["items"] })
        : listPayosTopUps({ limit: 20 }, controller.signal),
      listMyTopUpRequests({ limit: 20 }, controller.signal),
    ]).then(([payosRes, manualRes]) => {
      if (cancelled) return;

      const payosFailed = payosRes.status === "rejected";
      const manualFailed = manualRes.status === "rejected";

      if (payosFailed && manualFailed) {
        setError("Không thể tải lịch sử nạp điểm. Vui lòng thử lại.");
        setItems([]);
        setLoading(false);
        return;
      }

      const payosList = payosRes.status === "fulfilled" ? payosRes.value.items : [];
      const manualList = manualRes.status === "fulfilled" ? manualRes.value.items : [];

      if (payosFailed || manualFailed) {
        setPartialError(
          "Một số dữ liệu nạp điểm chưa thể hiển thị đầy đủ lúc này.",
        );
      }

      const merged = mergeTopUps(manualList, payosList, 20);
      setItems(merged);
      setLoading(false);
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [nonce, mode]);

  const processingTopUp =
    items.find(
      (item) => item.channel === "PAYOS" && item.status === "PROCESSING",
    ) ?? null;

  return {
    items,
    loading,
    error,
    partialError,
    reload,
    processingTopUp,
  };
}
