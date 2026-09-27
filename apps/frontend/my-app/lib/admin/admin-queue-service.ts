import { z } from "zod";
import { apiRequest } from "../api/client.ts";

/**
 * Sidebar badges of the admin console (Figma 11 "Aside", 62:4071).
 *
 * ASSUMED API CONTRACT: `GET /admin/queue-counts` — one cheap call for the
 * four work queues instead of four list requests on every admin page.
 * - `surveys`: forms waiting in `MODERATION_QUEUE` (Duyệt khảo sát)
 * - `topUps`: `PENDING` top-up requests (Duyệt nạp điểm)
 * - `disputes`: open disputes + missing-code reports (Khiếu nại & báo lỗi)
 * - `quality`: rewards held for quality review (Xét chất lượng)
 */
export const adminQueueCountsSchema = z.object({
  surveys: z.number().int().nonnegative(),
  topUps: z.number().int().nonnegative(),
  disputes: z.number().int().nonnegative(),
  quality: z.number().int().nonnegative(),
});
export type AdminQueueCounts = z.infer<typeof adminQueueCountsSchema>;
export type AdminQueue = keyof AdminQueueCounts;

export function getAdminQueueCounts(signal?: AbortSignal): Promise<AdminQueueCounts> {
  return apiRequest("/admin/queue-counts", { schema: adminQueueCountsSchema, signal });
}
