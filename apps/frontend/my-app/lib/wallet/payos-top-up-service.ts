import {
  payosAvailabilitySchema,
  payosCheckoutResultSchema,
  payosTopUpListSchema,
  payosTopUpSchema,
  submitTopUpRefundSchema,
  topUpRefundResultSchema,
  type ListPayosTopUpsQuery,
  type PayosAvailability,
  type PayosCheckoutResultDto,
  type PayosTopUpDto,
  type PayosTopUpListDto,
  type SubmitTopUpRefundInput,
  type TopUpRefundResult,
} from "@rescom/schemas";
import { apiRequest } from "../api/client.ts";

/**
 * PayOS point top-up service (Story 13.7, AC 2, 6, 7, 8, 9; Story 13.11, AC 3, 4, 6).
 * All endpoints under `/economy/top-ups/payos`.
 */

export function getPayosAvailability(signal?: AbortSignal): Promise<PayosAvailability> {
  return apiRequest("/economy/top-ups/payos/availability", {
    schema: payosAvailabilitySchema,
    signal,
  });
}

export function createPayosCheckout(
  amountVnd: number,
  signal?: AbortSignal,
): Promise<PayosCheckoutResultDto> {
  return apiRequest("/economy/top-ups/payos", {
    method: "POST",
    body: { amountVnd },
    schema: payosCheckoutResultSchema,
    signal,
  });
}

export function getPayosTopUp(id: string, signal?: AbortSignal): Promise<PayosTopUpDto> {
  return apiRequest(`/economy/top-ups/payos/${encodeURIComponent(id)}`, {
    schema: payosTopUpSchema,
    signal,
  });
}

export function cancelPayosTopUp(id: string, signal?: AbortSignal): Promise<PayosTopUpDto> {
  return apiRequest(`/economy/top-ups/payos/${encodeURIComponent(id)}/cancel`, {
    method: "POST",
    body: {},
    schema: payosTopUpSchema,
    signal,
  });
}

export function listPayosTopUps(
  query: Partial<ListPayosTopUpsQuery> = {},
  signal?: AbortSignal,
): Promise<PayosTopUpListDto> {
  const params = new URLSearchParams();
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.offset !== undefined) params.set("offset", String(query.offset));
  const search = params.toString();
  return apiRequest(`/economy/top-ups/payos${search ? `?${search}` : ""}`, {
    schema: payosTopUpListSchema,
    signal,
  });
}

export function requestPayosRefund(
  id: string,
  body: SubmitTopUpRefundInput,
  signal?: AbortSignal,
): Promise<TopUpRefundResult> {
  const validatedBody = submitTopUpRefundSchema.parse(body);
  return apiRequest(`/economy/top-ups/payos/${encodeURIComponent(id)}/refund-request`, {
    method: "POST",
    body: validatedBody,
    schema: topUpRefundResultSchema,
    signal,
  });
}

export function withdrawPayosRefund(
  id: string,
  signal?: AbortSignal,
): Promise<TopUpRefundResult> {
  return apiRequest(`/economy/top-ups/payos/${encodeURIComponent(id)}/refund-request/withdraw`, {
    method: "POST",
    body: {},
    schema: topUpRefundResultSchema,
    signal,
  });
}
