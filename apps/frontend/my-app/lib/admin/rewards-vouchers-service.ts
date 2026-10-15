// ASSUMED API CONTRACT: backend Stories 12.7–12.10 must match shared schemas.
import {
  adminVoucherListSchema, adminVoucherDetailSchema, adminVoucherCreatedSchema,
  adminVoucherBrandListSchema, adminCodeImportResultSchema,
  type AdminVoucherListQueryDto, type AdminVoucherStatePatchDto,
  type adminVoucherInputSchema, type adminVoucherPriceChangeSchema,
  type adminStockAdjustmentSchema, type adminCodeImportRequestSchema,
} from "@rescom/schemas";
import type { z } from "zod";
import { apiRequest } from "../api/client.ts";
import { REWARDS_ENABLED } from "../pilot-scope.ts";

type Input = z.input<typeof adminVoucherInputSchema>;
type PriceChange = z.input<typeof adminVoucherPriceChangeSchema>;
type StockAdjustment = z.input<typeof adminStockAdjustmentSchema>;
type CodeImport = z.input<typeof adminCodeImportRequestSchema>;

export function listAdminVouchers(query: Partial<AdminVoucherListQueryDto> = {}, signal?: AbortSignal) {
  if (!REWARDS_ENABLED) throw new Error("Rewards admin disabled");
  const params = new URLSearchParams();
  if (query.filter) params.set("filter", query.filter);
  if (query.q) params.set("q", query.q);
  return apiRequest(`/admin/rewards/vouchers${params.size ? `?${params}` : ""}`, { schema: adminVoucherListSchema, signal });
}

export function getAdminVoucher(id: string, signal?: AbortSignal) {
  if (!REWARDS_ENABLED) throw new Error("Rewards admin disabled");
  return apiRequest(`/admin/rewards/vouchers/${encodeURIComponent(id)}`, { schema: adminVoucherDetailSchema, signal });
}

export function createAdminVoucher(input: Input, signal?: AbortSignal) {
  if (!REWARDS_ENABLED) throw new Error("Rewards admin disabled");
  return apiRequest("/admin/rewards/vouchers", { method: "POST", body: input, schema: adminVoucherCreatedSchema, signal });
}

export function updateAdminVoucher(id: string, input: Input, signal?: AbortSignal) {
  if (!REWARDS_ENABLED) throw new Error("Rewards admin disabled");
  return apiRequest(`/admin/rewards/vouchers/${encodeURIComponent(id)}`, { method: "PUT", body: input, schema: adminVoucherCreatedSchema, signal });
}

export function patchAdminVoucher(id: string, patch: AdminVoucherStatePatchDto, signal?: AbortSignal) {
  if (!REWARDS_ENABLED) throw new Error("Rewards admin disabled");
  return apiRequest(`/admin/rewards/vouchers/${encodeURIComponent(id)}`, { method: "PATCH", body: patch, schema: adminVoucherCreatedSchema, signal });
}

export function changeAdminVoucherPrice(id: string, change: PriceChange, signal?: AbortSignal) {
  if (!REWARDS_ENABLED) throw new Error("Rewards admin disabled");
  return apiRequest(`/admin/rewards/vouchers/${encodeURIComponent(id)}/price`, { method: "POST", body: change, schema: adminVoucherCreatedSchema, signal });
}

export function adjustAdminVoucherStock(id: string, adjustment: StockAdjustment, signal?: AbortSignal) {
  if (!REWARDS_ENABLED) throw new Error("Rewards admin disabled");
  return apiRequest(`/admin/rewards/vouchers/${encodeURIComponent(id)}/stock`, { method: "POST", body: adjustment, schema: adminVoucherCreatedSchema, signal });
}

export function importAdminVoucherCodes(id: string, request: CodeImport, signal?: AbortSignal) {
  if (!REWARDS_ENABLED) throw new Error("Rewards admin disabled");
  return apiRequest(`/admin/rewards/vouchers/${encodeURIComponent(id)}/codes`, { method: "POST", body: request, schema: adminCodeImportResultSchema, signal });
}

export function listAdminVoucherBrands(signal?: AbortSignal) {
  if (!REWARDS_ENABLED) throw new Error("Rewards admin disabled");
  return apiRequest("/admin/rewards/brands", { schema: adminVoucherBrandListSchema, signal });
}
