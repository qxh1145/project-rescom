import {
  TOP_UP_LIST_MAX_LIMIT,
  topUpRequestListSchema,
  topUpRequestSchema,
  type TopUpRequestDto,
  type TopUpRequestListDto,
  type TopUpStatus,
} from "@rescom/schemas";
import { ApiError } from "../api/api-error.ts";
import { apiRequest } from "../api/client.ts";

/**
 * Manual point top-up (Story 6.6, Figma 14a–14c).
 *
 * VERIFIED: `POST /economy/top-ups` and `GET /economy/top-ups`
 * (`top-up.controller.ts`, `top-up.schema.ts`). The create call returns the
 * "Pending Payment" request with the platform bank account, amount, unique
 * transfer reference and VietQR payload (`paymentInstructions`), so the bank
 * details are not configured in the frontend.
 */

export interface TopUpListQuery {
  limit?: number;
  offset?: number;
  status?: TopUpStatus;
}

/** Creates the request (14a "Tiếp tục: thông tin chuyển khoản"); needs CSRF (sent by `apiRequest`). */
export function createTopUpRequest(amount: number, signal?: AbortSignal): Promise<TopUpRequestDto> {
  return apiRequest("/economy/top-ups", { method: "POST", body: { amount }, schema: topUpRequestSchema, signal });
}

/** The caller's own requests, newest first. */
export function listMyTopUpRequests(query: TopUpListQuery = {}, signal?: AbortSignal): Promise<TopUpRequestListDto> {
  const params = new URLSearchParams();
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.offset !== undefined) params.set("offset", String(query.offset));
  if (query.status) params.set("status", query.status);
  const search = params.toString();
  return apiRequest(`/economy/top-ups${search ? `?${search}` : ""}`, { schema: topUpRequestListSchema, signal });
}

/** Pages of `GET /economy/top-ups` searched for one request before giving up (50 each). */
export const TOP_UP_LOOKUP_MAX_PAGES = 10;

/**
 * One of the caller's requests (14b, 14c). ASSUMED: the backend has no
 * `GET /economy/top-ups/:id`, so the list is paged (newest first, 50 per
 * page, at most `TOP_UP_LOOKUP_MAX_PAGES`) until it is found.
 * Missing → `ApiError` 404 `TOPUP_NOT_FOUND` (the backend's code).
 */
export async function getMyTopUpRequest(id: string, signal?: AbortSignal): Promise<TopUpRequestDto> {
  let offset = 0;
  for (let page = 0; page < TOP_UP_LOOKUP_MAX_PAGES; page += 1) {
    const list = await listMyTopUpRequests(
      { limit: TOP_UP_LIST_MAX_LIMIT, ...(offset > 0 ? { offset } : {}) },
      signal,
    );
    const found = list.items.find((item) => item.id === id);
    if (found) return found;
    if (!list.hasMore || list.items.length === 0) break;
    offset += list.items.length;
  }
  throw new ApiError({ kind: "http", status: 404, code: "TOPUP_NOT_FOUND", message: "Top-up request not found" });
}

/** Newest open request, to resume after `TOPUP_PENDING_LIMIT_REACHED`. */
export async function latestPendingTopUp(signal?: AbortSignal): Promise<TopUpRequestDto | null> {
  const page = await listMyTopUpRequests({ limit: 1, status: "PENDING" }, signal);
  return page.items[0] ?? null;
}
