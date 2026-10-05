import { http, type RequestHandler } from "msw";
import { qualityDecisionCommandSchema } from "@/lib/admin/quality-service";
import { apiUrl, isHybridMocking } from "@/lib/api/config";
import { decideQualityReview, openQualityReviews, toQualityReviewDto } from "../data/admin-quality";
import { fail, missingCsrf, ok } from "../envelope";
import { HYBRID_ADMIN } from "../hybrid";
import { applyScenario } from "../scenarios";
import { requireMockAdmin } from "./admin";

/** Admin "Xem xét chất lượng" (Figma 17b, 63:3276). Contract: `lib/admin/quality-service.ts`. */

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export const adminQualityHandlers: RequestHandler[] = [
  // ASSUMED API CONTRACT: GET /admin/quality-reviews → { items, total } (open, newest first).
  http.get(apiUrl("/admin/quality-reviews"), async () => {
    const forced = await applyScenario("admin");
    if (forced) return forced;
    // Hybrid: the real session and `SessionGate requireAdmin` decide access (`mocks/hybrid.ts`).
    const admin = isHybridMocking ? HYBRID_ADMIN : await requireMockAdmin();
    if (admin instanceof Response) return admin;
    const items = openQualityReviews().map(toQualityReviewDto);
    return ok({ items, total: items.length });
  }),

  // ASSUMED API CONTRACT: POST /admin/quality-reviews/:responseId/decision (CSRF).
  http.post(apiUrl("/admin/quality-reviews/:responseId/decision"), async ({ params, request }) => {
    const forced = await applyScenario("admin");
    if (forced) return forced;
    // Hybrid: the real session and `SessionGate requireAdmin` decide access (`mocks/hybrid.ts`).
    const admin = isHybridMocking ? HYBRID_ADMIN : await requireMockAdmin();
    if (admin instanceof Response) return admin;
    const csrf = missingCsrf(request);
    if (csrf) return csrf;
    const parsed = qualityDecisionCommandSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return fail(400, "VALIDATION_ERROR", "Invalid quality decision.", { details: parsed.error.format() });
    }
    const outcome = decideQualityReview(String(params.responseId), parsed.data, admin);
    if (outcome.ok) return ok(outcome.result);
    switch (outcome.error) {
      case "NOT_FOUND":
        return fail(404, "QUALITY_REVIEW_NOT_FOUND", "Quality review not found.");
      case "ALREADY_DECIDED":
        return fail(409, "QUALITY_REVIEW_ALREADY_DECIDED", "This response already has a quality decision.");
      case "HOLD_NOT_FOUND":
        // Backend `releaseIntegrityHold` → InsufficientBalanceException when nothing is held any more.
        return fail(409, "QUALITY_REVIEW_ALREADY_DECIDED", "No integrity hold left for this response.");
    }
  }),
];
