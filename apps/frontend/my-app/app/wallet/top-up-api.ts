import {
  adminTopUpRequestListSchema,
  topUpRequestListSchema,
  topUpRequestSchema,
  topUpReviewResultSchema,
  type AdminTopUpRequestListDto,
  type TopUpRequestDto,
  type TopUpRequestListDto,
  type TopUpReviewResultDto,
  type TopUpStatus,
} from "@rescom/schemas";
import { formMutationFetch } from "../forms/forms-api.ts";

/**
 * Typed live-API client for manual Point top-ups (Story 6.6). The demo UI
 * uses the mock repository; this client is ready for the later API swap.
 */

export type TopUpApiError = Error & { code?: string; details?: unknown };

export interface TopUpListQuery {
  limit?: number;
  offset?: number;
  status?: TopUpStatus;
}

export interface TopUpRequestOptions {
  signal?: AbortSignal;
}

function apiError(payload: unknown, fallback: string): TopUpApiError {
  const body = payload as {
    error?: { message?: string; code?: string; details?: unknown };
  } | null;
  const error = new Error(body?.error?.message || fallback) as TopUpApiError;
  error.code = body?.error?.code;
  error.details = body?.error?.details;
  return error;
}

async function readData<T>(
  res: Response,
  schema: { safeParse(value: unknown): { success: boolean; data?: T } },
  fallback: string,
): Promise<T> {
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    throw apiError(payload, fallback);
  }
  const parsed = schema.safeParse(payload?.data);
  if (!parsed.success || parsed.data === undefined) {
    throw new Error("Received a malformed top-up response from the server");
  }
  return parsed.data;
}

function toQueryString(query: TopUpListQuery = {}): string {
  const params = new URLSearchParams();
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.offset !== undefined) params.set("offset", String(query.offset));
  if (query.status) params.set("status", query.status);
  const text = params.toString();
  return text ? `?${text}` : "";
}

/** `POST /api/economy/top-ups` — creates a "Pending Payment" request. */
export async function createTopUpRequest(
  amount: number,
): Promise<TopUpRequestDto> {
  const res = await formMutationFetch("/api/economy/top-ups", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ amount }),
  });
  return readData(res, topUpRequestSchema, "Failed to create top-up request");
}

/** `GET /api/economy/top-ups` — the caller's own requests, newest first. */
export async function listMyTopUpRequests(
  query?: TopUpListQuery,
  options?: TopUpRequestOptions,
): Promise<TopUpRequestListDto> {
  const res = await fetch(`/api/economy/top-ups${toQueryString(query)}`, {
    signal: options?.signal,
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  return readData(res, topUpRequestListSchema, "Failed to load top-up requests");
}

/** `GET /api/admin/top-ups` — Admin review queue (PENDING by default). */
export async function listTopUpRequestsForReview(
  query?: TopUpListQuery,
  options?: TopUpRequestOptions,
): Promise<AdminTopUpRequestListDto> {
  const res = await fetch(`/api/admin/top-ups${toQueryString(query)}`, {
    signal: options?.signal,
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  return readData(
    res,
    adminTopUpRequestListSchema,
    "Failed to load the top-up review queue",
  );
}

/** `POST /api/admin/top-ups/:id/approve` — idempotent; retries return the original result. */
export async function approveTopUpRequest(
  topUpId: string,
  options: { correlationId?: string } = {},
): Promise<TopUpReviewResultDto> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.correlationId) {
    headers["X-Correlation-Id"] = options.correlationId;
  }
  const res = await formMutationFetch(
    `/api/admin/top-ups/${encodeURIComponent(topUpId)}/approve`,
    { method: "POST", headers },
  );
  return readData(res, topUpReviewResultSchema, "Failed to approve top-up");
}

/** `POST /api/admin/top-ups/:id/reject` — requires a reason shown to the user. */
export async function rejectTopUpRequest(
  topUpId: string,
  reason: string,
): Promise<TopUpReviewResultDto> {
  const res = await formMutationFetch(
    `/api/admin/top-ups/${encodeURIComponent(topUpId)}/reject`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ reason }),
    },
  );
  return readData(res, topUpReviewResultSchema, "Failed to reject top-up");
}
