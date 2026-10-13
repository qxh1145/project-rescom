"use client";
import { useApiQuery } from "@/lib/api/use-api-query";
import { getRewardsStats } from "@/lib/admin/rewards-flash-service";
import { rangeToQuery } from "@/lib/admin/rewards-stats-view";

export function useRewardsStats(range: string) {
  return useApiQuery(`admin:rewards-stats:${range}`, (signal) => getRewardsStats(rangeToQuery(range, new Date()), signal));
}
