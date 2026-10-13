// ASSUMED API CONTRACT: backend Stories 12.7–12.10 must match shared schemas.
import {
  adminFlashSaleListSchema, adminFlashSaleCreatedSchema, adminFlashSaleInputSchema,
  adminFlashEndRequestSchema, rewardsStatsSchema,
  type AdminFlashSaleInputDto, type AdminFlashEndRequestDto,
} from "@rescom/schemas";
import { apiRequest } from "../api/client.ts";
import { PILOT_BUILD } from "../pilot-scope.ts";

export function listAdminFlashSales(signal?: AbortSignal) {
  if (PILOT_BUILD) throw new Error("Rewards admin disabled in pilot");
  return apiRequest("/admin/rewards/flash-sales", { schema: adminFlashSaleListSchema, signal });
}

export function getAdminFlashSale(id: string, signal?: AbortSignal) {
  if (PILOT_BUILD) throw new Error("Rewards admin disabled in pilot");
  return apiRequest(`/admin/rewards/flash-sales/${encodeURIComponent(id)}`, { schema: adminFlashSaleCreatedSchema, signal });
}

export function createAdminFlashSale(input: AdminFlashSaleInputDto, signal?: AbortSignal) {
  if (PILOT_BUILD) throw new Error("Rewards admin disabled in pilot");
  return apiRequest("/admin/rewards/flash-sales", { method: "POST", body: adminFlashSaleInputSchema.parse(input), schema: adminFlashSaleCreatedSchema, signal });
}

export function updateAdminFlashSale(id: string, input: AdminFlashSaleInputDto, signal?: AbortSignal) {
  if (PILOT_BUILD) throw new Error("Rewards admin disabled in pilot");
  return apiRequest(`/admin/rewards/flash-sales/${encodeURIComponent(id)}`, { method: "PUT", body: adminFlashSaleInputSchema.parse(input), schema: adminFlashSaleCreatedSchema, signal });
}

export function endAdminFlashSale(id: string, input: AdminFlashEndRequestDto, signal?: AbortSignal) {
  if (PILOT_BUILD) throw new Error("Rewards admin disabled in pilot");
  return apiRequest(`/admin/rewards/flash-sales/${encodeURIComponent(id)}/end`, { method: "POST", body: adminFlashEndRequestSchema.parse(input), schema: adminFlashSaleCreatedSchema, signal });
}

export function getRewardsStats(query: { from: string; to: string }, signal?: AbortSignal) {
  if (PILOT_BUILD) throw new Error("Rewards admin disabled in pilot");
  const params = new URLSearchParams(query);
  return apiRequest(`/admin/rewards/stats?${params}`, { schema: rewardsStatsSchema, signal });
}
