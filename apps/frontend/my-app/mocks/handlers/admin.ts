import { http } from "msw";
import { apiUrl } from "@/lib/api/config";
import { getMockSessionUser, type MockSessionUser } from "../db/session";
import { fail, ok, unauthorized } from "../envelope";
import { applyScenario } from "../scenarios";

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
  // Seed = Figma 11 sidebar badges; the lead wires it to the section data once they exist.
  http.get(apiUrl("/admin/queue-counts"), async () => {
    const forced = await applyScenario("admin");
    if (forced) return forced;
    const admin = await requireMockAdmin();
    if (admin instanceof Response) return admin;
    return ok({ surveys: 3, topUps: 2, disputes: 2, quality: 3 });
  }),
];
