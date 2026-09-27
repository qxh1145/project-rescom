import { z } from "zod";
import {
  markAllNotificationsReadResultSchema,
  notificationListSchema,
  notificationSchema,
  notificationUnreadCountSchema,
  type MarkAllNotificationsReadResultDto,
  type NotificationListDto,
} from "@rescom/schemas";
import { apiRequest } from "../api/client.ts";

/** VERIFIED against `notifications.controller.ts`. */

/**
 * `notificationSchema` with a relaxed `type`: a type added by a newer backend
 * still reaches the list and renders with the fallback presentation
 * (`notification-presentation.ts`) instead of disappearing.
 */
export const notificationItemSchema = notificationSchema.extend({ type: z.string() });
export type NotificationItem = z.infer<typeof notificationItemSchema>;

export type NotificationPage = Omit<NotificationListDto, "items"> & { items: NotificationItem[] };

export const markNotificationReadResponseSchema = z.object({
  notification: notificationItemSchema,
  unreadCount: z.number().int().nonnegative(),
});
export type MarkNotificationReadResponse = z.infer<typeof markNotificationReadResponseSchema>;

/**
 * List parsing that tolerates single bad rows: a structurally invalid row
 * (no id, bad date…) is skipped instead of failing the whole list; unknown
 * types are kept. Only an invalid envelope is malformed; `unreadCount` stays
 * authoritative for the badge.
 */
export const tolerantNotificationListSchema = {
  safeParse(data: unknown): { success: true; data: NotificationPage } | { success: false } {
    const items: unknown = (data as { items?: unknown } | null | undefined)?.items;
    if (!Array.isArray(items)) return { success: false };
    const envelope = notificationListSchema.safeParse({ ...(data as object), items: [] });
    if (!envelope.success) return { success: false };
    return {
      success: true,
      data: {
        ...envelope.data,
        items: items.flatMap((item) => {
          const parsed = notificationItemSchema.safeParse(item);
          return parsed.success ? [parsed.data] : [];
        }),
      },
    };
  },
};

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
): Promise<NotificationPage> {
  const query = new URLSearchParams();
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  if (params.offset !== undefined) query.set("offset", String(params.offset));
  if (params.unreadOnly) query.set("unreadOnly", "true");
  const suffix = query.size ? `?${query.toString()}` : "";
  return apiRequest(`/notifications${suffix}`, { schema: tolerantNotificationListSchema, signal });
}

export function markNotificationRead(id: string): Promise<MarkNotificationReadResponse> {
  return apiRequest(`/notifications/${encodeURIComponent(id)}/read`, {
    method: "PATCH",
    schema: markNotificationReadResponseSchema,
  });
}

export function markAllNotificationsRead(): Promise<MarkAllNotificationsReadResultDto> {
  return apiRequest("/notifications/read-all", { method: "PATCH", schema: markAllNotificationsReadResultSchema });
}

/** Kept here for existing importers; the rule lives with the presentation. */
export { splitNotificationMessage } from "./notification-presentation.ts";
