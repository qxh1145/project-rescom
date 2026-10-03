import { z } from "zod";
import {
  TOP_UP_LIST_MAX_LIMIT,
  adminTopUpRequestSchema,
  topUpReviewResultSchema,
  type TopUpStatus,
} from "@rescom/schemas";
import { apiRequest } from "../api/client.ts";

/**
 * Admin top-up review queue (Figma 11b "Duyệt nạp điểm", Story 6.6 FR-35).
 *
 * VERIFIED (`apps/backend/src/modules/economy/presentation/admin-top-up.controller.ts`,
 * `top-up.service.ts`, `packages/schemas/src/economy/top-up.schema.ts`):
 * - `GET /admin/top-ups?status&limit&offset` → `adminTopUpRequestListSchema`;
 *   PENDING by default, oldest first; APPROVED / REJECTED newest first.
 * - `POST /admin/top-ups/:id/approve` (CSRF, no body) → `topUpReviewResultSchema`.
 *   Posts one ledger journal `topup-approval:{id}` (clearing → Khả dụng), sends
 *   the TOPUP_SUCCESS notification. A replay returns `replayed: true`.
 * - `POST /admin/top-ups/:id/reject` (CSRF, `{ reason }` 5–500 chars) → same
 *   result, no points move, WARNING notification with the reason.
 * Errors: 400 `VALIDATION_ERROR` / `TOPUP_INVALID_REQUEST`, 403
 * `TOPUP_SELF_REVIEW_FORBIDDEN` / `TOPUP_ADMIN_CAPABILITY_REQUIRED` /
 * `FORBIDDEN`, 404 `TOPUP_NOT_FOUND`, 409 `TOPUP_ALREADY_REVIEWED`
 * (`details.currentStatus`).
 *
 * ASSUMED API (display, owner item) extensions, NOT emitted by the backend (optional, so the
 * verified response parses): `userName` and `userCreatedAt` — Figma shows "Trần Minh" and "tài khoản từ
 * 12/09", the backend only joins the user's email.
 */
export const adminTopUpSchema = adminTopUpRequestSchema.extend({
  userName: z.string().min(1).nullable().optional(),
  userCreatedAt: z.string().datetime().nullable().optional(),
});
export type AdminTopUp = z.infer<typeof adminTopUpSchema>;

export const adminTopUpListSchema = z.object({
  items: z.array(adminTopUpSchema),
  total: z.number().int().min(0),
  limit: z.number().int().min(1),
  offset: z.number().int().min(0),
  hasMore: z.boolean(),
});
export type AdminTopUpList = z.infer<typeof adminTopUpListSchema>;

export const adminTopUpReviewResultSchema = topUpReviewResultSchema.extend({ topUp: adminTopUpSchema });
export type AdminTopUpReviewResult = z.infer<typeof adminTopUpReviewResultSchema>;

/** One queue page (the largest the backend allows). */
export const ADMIN_TOP_UP_PAGE_SIZE = TOP_UP_LIST_MAX_LIMIT;

export function listAdminTopUps(
  query: { status: TopUpStatus; offset?: number },
  signal?: AbortSignal,
): Promise<AdminTopUpList> {
  const params = new URLSearchParams({ status: query.status, limit: String(ADMIN_TOP_UP_PAGE_SIZE) });
  if (query.offset) params.set("offset", String(query.offset));
  return apiRequest(`/admin/top-ups?${params.toString()}`, { schema: adminTopUpListSchema, signal });
}

export function approveTopUp(id: string, signal?: AbortSignal): Promise<AdminTopUpReviewResult> {
  return apiRequest(`/admin/top-ups/${encodeURIComponent(id)}/approve`, {
    method: "POST",
    schema: adminTopUpReviewResultSchema,
    signal,
  });
}

export function rejectTopUp(id: string, reason: string, signal?: AbortSignal): Promise<AdminTopUpReviewResult> {
  return apiRequest(`/admin/top-ups/${encodeURIComponent(id)}/reject`, {
    method: "POST",
    body: { reason },
    schema: adminTopUpReviewResultSchema,
    signal,
  });
}
