import { http } from "msw";
import { adminQueueCountsSchema } from "@rescom/schemas";
import { apiUrl } from "@/lib/api/config";
import { getMockSessionUser, type MockSessionUser } from "../db/session";
import { fail, ok, unauthorized } from "../envelope";
import { applyScenario } from "../scenarios";
import { disputeQueueCount } from "../data/admin-disputes";
import { moderationQueueCount } from "../data/admin-moderation";
import { qualityQueueCount } from "../data/admin-quality";
import { topUpQueueCount } from "../data/admin-top-ups";

/** Mirrors the backend `RolesGuard`: 401 without a session, 403 for non-admins. */
export async function requireMockAdmin(): Promise<MockSessionUser | Response> {
  const user = await getMockSessionUser();
  if (!user) return unauthorized();
  if (user.role !== "ADMIN") return fail(403, "FORBIDDEN_RESOURCE", "Admin role required");
  return user;
}

/**
 * Phase 6 admin console — shared routes. Each admin section registers its
 * own handler array next to this one (see `mocks/handlers/index.ts`).
 */
export const adminHandlers = [
  // VERIFIED: GET /admin/queue-counts (lib/admin/admin-queue-service.ts, shared
  // `adminQueueCountsSchema`). Counts are composed from the same stores as their
  // corresponding queues; the real backend answers 0 for disputes and quality
  // (those queues stay on MSW, decision Q1).
  http.get(apiUrl("/admin/queue-counts"), async () => {
    const forced = await applyScenario("admin");
    if (forced) return forced;
    const admin = await requireMockAdmin();
    if (admin instanceof Response) return admin;
    return ok(
      adminQueueCountsSchema.parse({
        surveys: moderationQueueCount(),
        topUps: topUpQueueCount(),
        disputes: disputeQueueCount(),
        quality: qualityQueueCount(),
      }),
    );
  }),
];
