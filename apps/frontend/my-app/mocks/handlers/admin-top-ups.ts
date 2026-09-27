import { http, type RequestHandler } from "msw";
import { listTopUpRequestsQuerySchema, rejectTopUpRequestSchema } from "@rescom/schemas";
import { apiUrl } from "@/lib/api/config";
import {
  approveStoredTopUp,
  findTopUpForReview,
  listTopUpsForReview,
  rejectStoredTopUp,
  toAdminTopUpDto,
} from "../data/admin-top-ups";
import type { StoredTopUp } from "../data/top-up";
import { fail, missingCsrf, ok } from "../envelope";
import { applyScenario } from "../scenarios";
import { requireMockAdmin } from "./admin";

/**
 * Mirrors `apps/backend/src/modules/economy/presentation/admin-top-up.controller.ts`
 * + `top-up.service.ts` (Story 6.6, FR-35). All three routes are VERIFIED.
 */

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Shared checks of approve/reject: `ParseUUIDPipe`, 404, self-review (backend `lockForReview`). */
function lockForReview(id: string, adminId: string): StoredTopUp | Response {
  if (!UUID.test(id)) return fail(400, "VALIDATION_ERROR", "Validation failed (uuid is expected)");
  const stored = findTopUpForReview(id);
  if (!stored) return fail(404, "TOPUP_NOT_FOUND", `Top-up request ${id} was not found.`);
  if (stored.userId === adminId) {
    return fail(403, "TOPUP_SELF_REVIEW_FORBIDDEN", "An Admin cannot review their own top-up request.");
  }
  return stored;
}

function alreadyReviewed(stored: StoredTopUp): Response {
  return fail(
    409,
    "TOPUP_ALREADY_REVIEWED",
    `Top-up request ${stored.request.id} was already ${stored.request.status.toLowerCase()}.`,
    { details: { currentStatus: stored.request.status } },
  );
}

function reviewResult(stored: StoredTopUp, replayed: boolean) {
  return ok({ topUp: toAdminTopUpDto(stored), journalId: stored.request.journalId ?? null, replayed });
}

export const adminTopUpHandlers: RequestHandler[] = [
  // VERIFIED: GET /admin/top-ups?status&limit&offset → adminTopUpRequestListSchema (+ ASSUMED userName/userCreatedAt)
  http.get(apiUrl("/admin/top-ups"), async ({ request }) => {
    const forced = await applyScenario("admin");
    if (forced) return forced;
    const admin = await requireMockAdmin();
    if (admin instanceof Response) return admin;
    const parsed = listTopUpRequestsQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) {
      return fail(400, "VALIDATION_ERROR", "Invalid query.", { details: parsed.error.format() });
    }
    const { limit, offset, status } = parsed.data;
    const all = listTopUpsForReview(status ?? "PENDING");
    const items = all.slice(offset, offset + limit).map(toAdminTopUpDto);
    return ok({ items, total: all.length, limit, offset, hasMore: offset + items.length < all.length });
  }),

  // VERIFIED: POST /admin/top-ups/:id/approve → topUpReviewResultSchema; 404 / 403 / 409 TOPUP_ALREADY_REVIEWED
  http.post(apiUrl("/admin/top-ups/:id/approve"), async ({ request, params }) => {
    const forced = await applyScenario("admin");
    if (forced) return forced;
    const admin = await requireMockAdmin();
    if (admin instanceof Response) return admin;
    const csrf = missingCsrf(request);
    if (csrf) return csrf;
    const stored = lockForReview(String(params.id), admin.id);
    if (stored instanceof Response) return stored;
    if (stored.request.status === "APPROVED") return reviewResult(stored, true);
    if (stored.request.status !== "PENDING") return alreadyReviewed(stored);
    return reviewResult(approveStoredTopUp(stored, admin.id), false);
  }),

  // VERIFIED: POST /admin/top-ups/:id/reject { reason } → topUpReviewResultSchema; 400 VALIDATION_ERROR, 409
  http.post(apiUrl("/admin/top-ups/:id/reject"), async ({ request, params }) => {
    const forced = await applyScenario("admin");
    if (forced) return forced;
    const admin = await requireMockAdmin();
    if (admin instanceof Response) return admin;
    const csrf = missingCsrf(request);
    if (csrf) return csrf;
    const body = rejectTopUpRequestSchema.safeParse(await readJson(request));
    if (!body.success) {
      return fail(400, "VALIDATION_ERROR", "Validation failed", { details: body.error.format() });
    }
    const stored = lockForReview(String(params.id), admin.id);
    if (stored instanceof Response) return stored;
    if (stored.request.status === "REJECTED") return reviewResult(stored, true);
    if (stored.request.status !== "PENDING") return alreadyReviewed(stored);
    return reviewResult(rejectStoredTopUp(stored, admin.id, body.data.reason), false);
  }),
];
