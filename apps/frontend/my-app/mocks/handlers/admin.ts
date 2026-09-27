import { http } from "msw";
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
  if (user.role !== "ADMIN") return fail(403, "FORBIDDEN", "Admin role required");
  return user;
}

/**
 * Phase 6 admin console — shared routes. Each admin section registers its
 * own handler array next to this one (see `mocks/handlers/index.ts`).
 */
export const adminHandlers = [
  // ASSUMED API CONTRACT: GET /admin/queue-counts (lib/admin/admin-queue-service.ts).
  // Counts are composed from the same stores as their corresponding queues.
  http.get(apiUrl("/admin/queue-counts"), async () => {
    const forced = await applyScenario("admin");
    if (forced) return forced;
    const admin = await requireMockAdmin();
    if (admin instanceof Response) return admin;
    return ok({
      surveys: moderationQueueCount(),
      topUps: topUpQueueCount(),
      disputes: disputeQueueCount(),
      quality: qualityQueueCount(),
    });
  }),
];
