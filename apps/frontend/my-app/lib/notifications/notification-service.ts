import {
  markAllNotificationsReadResultSchema,
  markNotificationReadResultSchema,
  notificationListSchema,
  notificationUnreadCountSchema,
  type MarkAllNotificationsReadResultDto,
  type MarkNotificationReadResultDto,
  type NotificationListDto,
} from "@rescom/schemas";
import { apiRequest } from "../api/client.ts";

/** VERIFIED against `notifications.controller.ts`. */

export async function getUnreadCount(signal?: AbortSignal): Promise<number> {
  const { unreadCount } = await apiRequest("/notifications/unread-count", {
    schema: notificationUnreadCountSchema,
    signal,
  });
  return unreadCount;
}

export function listNotifications(
  params: { limit?: number; offset?: number; unreadOnly?: boolean } = {},
  signal?: AbortSignal,
): Promise<NotificationListDto> {
  const query = new URLSearchParams();
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  if (params.offset !== undefined) query.set("offset", String(params.offset));
  if (params.unreadOnly) query.set("unreadOnly", "true");
  const suffix = query.size ? `?${query.toString()}` : "";
  return apiRequest(`/notifications${suffix}`, { schema: notificationListSchema, signal });
}

export function markNotificationRead(id: string): Promise<MarkNotificationReadResultDto> {
  return apiRequest(`/notifications/${encodeURIComponent(id)}/read`, {
    method: "PATCH",
    schema: markNotificationReadResultSchema,
  });
}

export function markAllNotificationsRead(): Promise<MarkAllNotificationsReadResultDto> {
  return apiRequest("/notifications/read-all", { method: "PATCH", schema: markAllNotificationsReadResultSchema });
}

/**
 * The DTO carries one `message`; Figma shows a bold title and a body. Mock
 * data (and, ASSUMED, the backend copy) use "Title — body".
 */
export function splitNotificationMessage(message: string): { title: string; body: string | null } {
  const [title, ...rest] = message.split(" — ");
  return { title, body: rest.length ? rest.join(" — ") : null };
}
