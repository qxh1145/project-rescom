import { adminQueueCountsSchema, type AdminQueueCounts } from "@rescom/schemas";
import { apiRequest } from "../api/client.ts";

/**
 * Sidebar badges of the admin console (Figma 11 "Aside", 62:4071).
 *
 * VERIFIED (`admin/presentation/admin-overview.controller.ts`, shared
 * `adminQueueCountsSchema`): `GET /admin/queue-counts`, ADMIN only — one cheap
 * call for the four work queues instead of four list requests on every admin page.
 * - `surveys`: forms waiting in `MODERATION_QUEUE` (Duyệt khảo sát)
 * - `topUps`: `PENDING` top-up requests (Duyệt nạp điểm)
 * - `disputes`: open disputes + missing-code reports (Khiếu nại & báo lỗi)
 * - `quality`: rewards held for quality review (Xét chất lượng)
 *
 * Disputes and quality reviews stay on MSW (decision Q1): the real backend
 * answers 0 for those two badges while their mock pages show sample cases.
 */
export { adminQueueCountsSchema };
export type { AdminQueue, AdminQueueCounts } from "@rescom/schemas";

export function getAdminQueueCounts(signal?: AbortSignal): Promise<AdminQueueCounts> {
  return apiRequest("/admin/queue-counts", { schema: adminQueueCountsSchema, signal });
}
