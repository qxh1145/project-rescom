"use client";
import { useApiQuery } from "@/lib/api/use-api-query";
import { listAdminFlashSales, getAdminFlashSale } from "@/lib/admin/rewards-flash-service";

export function useAdminFlashSales() {
  return useApiQuery("admin:flash-sales", (signal) => listAdminFlashSales(signal));
}
/** `id` undefined (create page) skips the request: there is no program to load. */
export function useAdminFlashSale(id?: string) {
  return useApiQuery(id ? `admin:flash-sales:${id}` : null, (signal) => getAdminFlashSale(id!, signal));
}
