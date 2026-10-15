"use client";

import { useCallback, useMemo } from "react";
import { useApiQuery } from "@/lib/api/use-api-query";
import { ticketsByTab, unusedCount } from "@/lib/rewards/my-vouchers";
import { listMyVouchers } from "@/lib/rewards/rewards-service";
import { serverOffset } from "@/lib/rewards/server-clock";
import { useServerNow } from "./use-server-now";

export function useMyVouchers() {
  const query = useApiQuery("rewards-my-vouchers", useCallback((signal) => listMyVouchers(signal), []));
  const { data } = query;
  const byTab = useMemo(() => (data ? ticketsByTab(data.items) : null), [data]);
  const unused = data ? unusedCount(data.items) : 0;
  return { ...query, byTab, unused, serverTime: data?.serverTime };
}

/** Ticking server clock for countdown tags and "đổi hôm nay" on a list left open. */
export function useTicketsNow(serverTime: string | undefined): number {
  const offsetMs = useMemo(() => (serverTime ? serverOffset(serverTime) : 0), [serverTime]);
  return useServerNow(offsetMs);
}
