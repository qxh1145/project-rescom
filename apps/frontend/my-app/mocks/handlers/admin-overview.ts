import { http, type RequestHandler } from "msw";
import { apiUrl } from "@/lib/api/config";
import { buildAdminOverview } from "../data/admin-overview";
import { ok } from "../envelope";
import { applyScenario } from "../scenarios";
import { requireMockAdmin } from "./admin";

/** Admin "Tổng quan" (Figma 11, 62:4070). */
export const adminOverviewHandlers: RequestHandler[] = [
  // ASSUMED API CONTRACT: GET /admin/overview (lib/admin/overview-service.ts).
  http.get(apiUrl("/admin/overview"), async () => {
    const forced = await applyScenario("admin");
    if (forced) return forced;
    const admin = await requireMockAdmin();
    if (admin instanceof Response) return admin;
    return ok(buildAdminOverview());
  }),
];
