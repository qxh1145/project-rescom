"use client";

import { useApiQuery } from "@/lib/api/use-api-query";
import { listAdminVouchers } from "@/lib/admin/rewards-vouchers-service";
import type { AdminVoucherListQueryDto } from "@rescom/schemas";

export function useAdminVouchers(filter: AdminVoucherListQueryDto["filter"], q: string) {
  return useApiQuery(`admin:vouchers:${filter}:${q}`, (signal) => listAdminVouchers({ filter, ...(q.trim() ? { q: q.trim() } : {}) }, signal));
}
