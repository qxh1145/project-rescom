// ASSUMED API CONTRACT: Story 12.1 mock routes; backend Stories 12.7-12.10.
import {
  flashSaleListSchema,
  redemptionQuoteSchema,
  redemptionResultSchema,
  IDEMPOTENCY_KEY_HEADER,
  type RedemptionQuoteDto,
  type RedemptionResultDto,
  voucherCatalogSchema,
  voucherDetailResponseSchema,
  type FlashSaleListDto,
  type VoucherCatalogDto,
  type VoucherDetailResponseDto,
} from "@rescom/schemas";
import { ApiError } from "../api/api-error.ts";
import { apiRequest } from "../api/client.ts";
import { PILOT_BUILD } from "../pilot-scope.ts";

function rejectPilot(): never {
  throw new ApiError({
    kind: "http",
    status: 404,
    code: "REWARDS_DISABLED",
    message: "Rewards feature is disabled in pilot",
    details: {},
  });
}

export function listVouchers(query: string = "", signal?: AbortSignal): Promise<VoucherCatalogDto> {
  if (PILOT_BUILD) rejectPilot();
  const search = query ? (query.startsWith("?") ? query : `?${query}`) : "";
  return apiRequest(`/rewards/vouchers${search}`, { schema: voucherCatalogSchema, signal });
}

export function getVoucher(id: string, signal?: AbortSignal): Promise<VoucherDetailResponseDto> {
  if (PILOT_BUILD) rejectPilot();
  return apiRequest(`/rewards/vouchers/${encodeURIComponent(id)}`, { schema: voucherDetailResponseSchema, signal });
}

export function listFlashSales(signal?: AbortSignal): Promise<FlashSaleListDto> {
  if (PILOT_BUILD) rejectPilot();
  return apiRequest("/rewards/flash-sales", { schema: flashSaleListSchema, signal });
}

export function createRedemptionQuote(voucherId: string, signal?: AbortSignal): Promise<RedemptionQuoteDto> {
  if (PILOT_BUILD) rejectPilot();
  return apiRequest("/rewards/quotes", { method: "POST", body: { voucherId }, schema: redemptionQuoteSchema, signal });
}

export function redeemVoucher(quoteId: string, idempotencyKey: string, signal?: AbortSignal): Promise<RedemptionResultDto> {
  if (PILOT_BUILD) rejectPilot();
  return apiRequest("/rewards/redemptions", { method: "POST", body: { quoteId }, headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey }, schema: redemptionResultSchema, signal });
}

export function getRedemptionByKey(idempotencyKey: string, signal?: AbortSignal): Promise<RedemptionResultDto> {
  if (PILOT_BUILD) rejectPilot();
  return apiRequest(`/rewards/redemptions/by-key/${encodeURIComponent(idempotencyKey)}`, { schema: redemptionResultSchema, signal });
}
