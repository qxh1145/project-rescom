// ASSUMED API CONTRACT: Story 12.1 mock routes; backend Stories 12.7-12.10.
import {
  flashSaleListSchema,
  redemptionQuoteSchema,
  redemptionResultSchema,
  IDEMPOTENCY_KEY_HEADER,
  type RedemptionQuoteDto,
  type RedemptionResultDto,
  voucherCatalogSchema,
  voucherTicketListSchema,
  voucherTicketResponseSchema,
  codeIssueReportSchema,
  redemptionHistoryListSchema,
  type CodeIssueReportDto,
  type CreateCodeIssueReportDto,
  type RedemptionHistoryListDto,
  type VoucherTicketListDto,
  type VoucherTicketResponseDto,
  voucherDetailResponseSchema,
  type FlashSaleListDto,
  type VoucherCatalogDto,
  type VoucherDetailResponseDto,
} from "@rescom/schemas";
import { ApiError } from "../api/api-error.ts";
import { apiRequest } from "../api/client.ts";
import { REWARDS_ENABLED } from "../pilot-scope.ts";

export const REDEMPTION_HISTORY_PAGE_SIZE = 20;

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
  if (!REWARDS_ENABLED) rejectPilot();
  const search = query ? (query.startsWith("?") ? query : `?${query}`) : "";
  return apiRequest(`/rewards/vouchers${search}`, { schema: voucherCatalogSchema, signal });
}

export function getVoucher(id: string, signal?: AbortSignal): Promise<VoucherDetailResponseDto> {
  if (!REWARDS_ENABLED) rejectPilot();
  return apiRequest(`/rewards/vouchers/${encodeURIComponent(id)}`, { schema: voucherDetailResponseSchema, signal });
}

export function listFlashSales(signal?: AbortSignal): Promise<FlashSaleListDto> {
  if (!REWARDS_ENABLED) rejectPilot();
  return apiRequest("/rewards/flash-sales", { schema: flashSaleListSchema, signal });
}

export function createRedemptionQuote(voucherId: string, signal?: AbortSignal): Promise<RedemptionQuoteDto> {
  if (!REWARDS_ENABLED) rejectPilot();
  return apiRequest("/rewards/quotes", { method: "POST", body: { voucherId }, schema: redemptionQuoteSchema, signal });
}

export function redeemVoucher(quoteId: string, idempotencyKey: string, signal?: AbortSignal): Promise<RedemptionResultDto> {
  if (!REWARDS_ENABLED) rejectPilot();
  return apiRequest("/rewards/redemptions", { method: "POST", body: { quoteId }, headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey }, schema: redemptionResultSchema, signal });
}

export function getRedemptionByKey(idempotencyKey: string, signal?: AbortSignal): Promise<RedemptionResultDto> {
  if (!REWARDS_ENABLED) rejectPilot();
  return apiRequest(`/rewards/redemptions/by-key/${encodeURIComponent(idempotencyKey)}`, { schema: redemptionResultSchema, signal });
}

export function listMyVouchers(signal?: AbortSignal): Promise<VoucherTicketListDto> {
  if (!REWARDS_ENABLED) rejectPilot();
  return apiRequest("/rewards/my-vouchers", { schema: voucherTicketListSchema, signal });
}

export function getMyVoucher(ticketId: string, signal?: AbortSignal): Promise<VoucherTicketResponseDto> {
  if (!REWARDS_ENABLED) rejectPilot();
  return apiRequest(`/rewards/my-vouchers/${encodeURIComponent(ticketId)}`, { schema: voucherTicketResponseSchema, signal });
}

export function markVoucherUsed(ticketId: string, signal?: AbortSignal): Promise<VoucherTicketResponseDto> {
  if (!REWARDS_ENABLED) rejectPilot();
  return apiRequest(`/rewards/my-vouchers/${encodeURIComponent(ticketId)}/use`, { method: "POST", schema: voucherTicketResponseSchema, signal });
}

export function undoVoucherUse(ticketId: string, signal?: AbortSignal): Promise<VoucherTicketResponseDto> {
  if (!REWARDS_ENABLED) rejectPilot();
  return apiRequest(`/rewards/my-vouchers/${encodeURIComponent(ticketId)}/undo-use`, { method: "POST", schema: voucherTicketResponseSchema, signal });
}

export function reportCodeIssue(ticketId: string, input: CreateCodeIssueReportDto, signal?: AbortSignal): Promise<CodeIssueReportDto> {
  if (!REWARDS_ENABLED) rejectPilot();
  return apiRequest(`/rewards/my-vouchers/${encodeURIComponent(ticketId)}/issues`, { method: "POST", body: input, schema: codeIssueReportSchema, signal });
}

export function listRedemptionHistory(offset = 0, signal?: AbortSignal): Promise<RedemptionHistoryListDto> {
  if (!REWARDS_ENABLED) rejectPilot();
  return apiRequest(`/rewards/redemptions?limit=${REDEMPTION_HISTORY_PAGE_SIZE}&offset=${offset}`, { schema: redemptionHistoryListSchema, signal });
}
