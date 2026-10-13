"use client";

import { useApiQuery } from "@/lib/api/use-api-query";
import { getAdminVoucher } from "@/lib/admin/rewards-vouchers-service";

export function useAdminVoucher(id?: string) {
  return useApiQuery(id ? `admin:voucher:${id}` : null, (signal) => getAdminVoucher(id!, signal));
}
