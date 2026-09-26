import {
  listNotificationsQuerySchema,
  markAllNotificationsReadResultSchema,
  markNotificationReadResultSchema,
  notificationListSchema,
  notificationSchema,
  notificationUnreadCountSchema,
  type ListNotificationsQueryInput,
  type MarkAllNotificationsReadResultDto,
  type MarkNotificationReadResultDto,
  type NotificationListDto,
} from "@rescom/schemas";
import { formMutationFetch } from "../forms/forms-api.ts";

/**
 * Typed live client for the Story 9.6 notification endpoints. The portal
 * currently renders notifications from the mock repository; this client is
 * the drop-in for the later backend swap.
 */

export type NotificationsApiError = Error & { code?: string; status?: number };

/** The slice of a shared Zod schema this client needs (avoids a direct zod dependency). */
interface ResponseSchema<T> {
  safeParse(data: unknown): { success: true; data: T } | { success: false };
}

export interface NotificationsRequestOptions {
  signal?: AbortSignal;
}

const AUTH_REQUIRED_MESSAGE = "Vui lòng đăng nhập để xem thông báo.";
const MALFORMED_MESSAGE = "Máy chủ trả về dữ liệu thông báo không hợp lệ.";

async function readEnvelope<T>(
  res: Response,
  schema: ResponseSchema<T>,
  fallbackMessage: string,
): Promise<T> {
  const payload = await res.json().catch(() => null);

  if (!res.ok) {
    const error = new Error(
      res.status === 401
        ? AUTH_REQUIRED_MESSAGE
        : payload?.error?.message || fallbackMessage,
    ) as NotificationsApiError;
    // Every backend 401 code means "signed out"; callers check one code.
    error.code = res.status === 401 ? "AUTH_REQUIRED" : payload?.error?.code;
    error.status = res.status;
    throw error;
  }

  const parsed = schema.safeParse(payload?.data);
  if (!parsed.success) {
    throw new Error(MALFORMED_MESSAGE);
  }
  return parsed.data;
}

/**
 * List parsing that tolerates single bad rows: one unknown type (a newer
 * backend) or legacy row is skipped instead of rejecting the whole list. Only
 * an invalid envelope is malformed; `unreadCount` stays authoritative.
 */
const notificationListResponseSchema: ResponseSchema<NotificationListDto> = {
  safeParse(data) {
    const items: unknown = (data as { items?: unknown } | null | undefined)?.items;
    if (!Array.isArray(items)) return { success: false };
    const envelope = notificationListSchema.safeParse({ ...(data as object), items: [] });
    if (!envelope.success) return { success: false };
    return {
      success: true,
      data: {
        ...envelope.data,
        items: items.flatMap((item) => {
          const parsed = notificationSchema.safeParse(item);
          return parsed.success ? [parsed.data] : [];
        }),
      },
    };
  },
};

export async function fetchNotifications(
  query: ListNotificationsQueryInput = {},
  options: NotificationsRequestOptions = {},
): Promise<NotificationListDto> {
  const { limit, offset, unreadOnly } = listNotificationsQuerySchema.parse(query);
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
    unreadOnly: String(unreadOnly),
  });

  const res = await fetch(`/api/notifications?${params.toString()}`, {
    signal: options.signal,
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  return readEnvelope(res, notificationListResponseSchema, "Không thể tải thông báo.");
}

export async function fetchUnreadNotificationCount(
  options: NotificationsRequestOptions = {},
): Promise<number> {
  const res = await fetch("/api/notifications/unread-count", {
    signal: options.signal,
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  const result = await readEnvelope(
    res,
    notificationUnreadCountSchema,
    "Không thể tải số thông báo chưa đọc.",
  );
  return result.unreadCount;
}

export async function markNotificationRead(
  notificationId: string,
): Promise<MarkNotificationReadResultDto> {
  const res = await formMutationFetch(
    `/api/notifications/${encodeURIComponent(notificationId)}/read`,
    { method: "PATCH", headers: { Accept: "application/json" } },
  );
  return readEnvelope(
    res,
    markNotificationReadResultSchema,
    "Không thể đánh dấu thông báo đã đọc.",
  );
}

export async function markAllNotificationsRead(): Promise<MarkAllNotificationsReadResultDto> {
  const res = await formMutationFetch("/api/notifications/read-all", {
    method: "PATCH",
    headers: { Accept: "application/json" },
  });
  return readEnvelope(
    res,
    markAllNotificationsReadResultSchema,
    "Không thể đánh dấu tất cả thông báo đã đọc.",
  );
}
