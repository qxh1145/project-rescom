"use client";

import { useCallback, useMemo } from "react";
import { useApiQuery } from "@/lib/api/use-api-query";
import { getVoucher, listFlashSales } from "@/lib/rewards/rewards-service";
import { serverOffset } from "@/lib/rewards/server-clock";

export function useVoucherDetail(voucherId: string) {
  const voucherQuery = useApiQuery(
    `rewards-voucher:${voucherId}`,
    useCallback((signal) => getVoucher(voucherId, signal), [voucherId]),
  );

  const flashSalesQuery = useApiQuery(
    "rewards-flash-sales",
    useCallback((signal) => listFlashSales(signal), []),
  );

  const reloadAll = useCallback(() => {
    voucherQuery.reload();
    flashSalesQuery.reload();
  }, [voucherQuery, flashSalesQuery]);

  const voucher = voucherQuery.data?.voucher ?? null;
  const viewer = voucherQuery.data?.viewer ?? null;

  let flashItem = null;
  if (flashSalesQuery.data) {
    for (const fs of flashSalesQuery.data.items) {
      const match = fs.items.find((item) => item.voucherId === voucherId);
      if (match) {
        flashItem = { item: match, program: fs };
        break;
      }
    }
  }

  const serverTime = voucherQuery.data?.serverTime ?? flashSalesQuery.data?.serverTime ?? null;
  // Memoized on serverTime: a fresh Date.now() per render would pin the clock to serverTime.
  const offsetMs = useMemo(() => (serverTime ? serverOffset(serverTime) : 0), [serverTime]);

  return {
    voucher,
    viewer,
    flashItem,
    loading: voucherQuery.loading,
    error: voucherQuery.error,
    offsetMs,
    reloadAll,
  };
}
