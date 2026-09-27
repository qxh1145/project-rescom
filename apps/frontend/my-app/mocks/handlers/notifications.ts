import { http } from "msw";
import { listNotificationsQuerySchema } from "@rescom/schemas";
import { apiUrl } from "@/lib/api/config";
import { notificationsOf, updateNotifications } from "../data/notifications";
import { getMockSessionUser } from "../db/session";
import { nowIso } from "../db/store";
import { fail, ok, unauthorized } from "../envelope";
import { applyScenario } from "../scenarios";

/** Mirrors `apps/backend/src/modules/notifications/presentation/notifications.controller.ts` (VERIFIED). */
const unreadCount = (userId: string) => notificationsOf(userId).filter((item) => !item.isRead).length;

export const notificationHandlers = [
  http.get(apiUrl("/notifications/unread-count"), async () => {
    const forced = await applyScenario("notifications");
    if (forced) return forced;
    const user = await getMockSessionUser();
    if (!user) return unauthorized();
    return ok({ unreadCount: unreadCount(user.id) });
  }),

  http.get(apiUrl("/notifications"), async ({ request }) => {
    const forced = await applyScenario("notifications");
    if (forced) return forced;
    const user = await getMockSessionUser();
    if (!user) return unauthorized();
    const query = listNotificationsQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams.entries()),
    );
    if (!query.success) return fail(400, "NOTIFICATIONS_INVALID_QUERY", "Invalid query");
    const { limit, offset, unreadOnly } = query.data;
    const all = [...notificationsOf(user.id)]
      .filter((item) => !unreadOnly || !item.isRead)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const items = all.slice(offset, offset + limit);
    return ok({
      items,
      unreadCount: unreadCount(user.id),
      total: all.length,
      limit,
      offset,
      hasMore: offset + items.length < all.length,
    });
  }),

  http.patch(apiUrl("/notifications/read-all"), async () => {
    const forced = await applyScenario("notifications");
    if (forced) return forced;
    const user = await getMockSessionUser();
    if (!user) return unauthorized();
    let updatedCount = 0;
    updateNotifications(user.id, (items) => {
      for (const item of items) {
        if (!item.isRead) {
          item.isRead = true;
          item.readAt = nowIso();
          updatedCount += 1;
        }
      }
    });
    return ok({ updatedCount, unreadCount: 0 });
  }),

  http.patch(apiUrl("/notifications/:id/read"), async ({ params }) => {
    const forced = await applyScenario("notifications");
    if (forced) return forced;
    const user = await getMockSessionUser();
    if (!user) return unauthorized();
    const items = updateNotifications(user.id, (all) => {
      const target = all.find((item) => item.id === params.id);
      if (target && !target.isRead) {
        target.isRead = true;
        target.readAt = nowIso();
      }
    });
    const notification = items.find((item) => item.id === params.id);
    if (!notification) return fail(404, "NOTIFICATION_NOT_FOUND", "Notification not found");
    return ok({ notification, unreadCount: unreadCount(user.id) });
  }),
];
