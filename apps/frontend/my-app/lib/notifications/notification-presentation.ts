import type { NotificationDto, NotificationType } from "@rescom/schemas";
import { vietnamDateTimeParts } from "../format/date-time.ts";

/**
 * Figma 14d "Thông báo" (62:1837 panel / 62:2117 page): icon tile and target
 * per notification type. Pure module (no React) shared by the header panel,
 * the page and tests.
 *
 * The DTO has no link or subject id, so the target is per type (ASSUMED):
 * owner events open "Khảo sát của tôi", point events open the wallet. Types
 * Figma does not draw (TOPUP_SUCCESS, REWARD_EARNED) reuse the nearest icon.
 */
export type NotificationTone = "green" | "teal" | "amber" | "danger" | "neutral";

export interface NotificationPresentation {
  icon: string;
  tone: NotificationTone;
  href: string | null;
}

export const NOTIFICATION_PRESENTATION: Record<NotificationType, NotificationPresentation> = {
  // Figma "Khảo sát đã đủ mẫu" (62:2168). ASSUMED: approval/fill events share it.
  SURVEY_APPROVED: { icon: "target", tone: "teal", href: "/forms" },
  SURVEY_REJECTED: { icon: "x-circle", tone: "danger", href: "/forms" },
  // Figma "Khiếu nại được chấp nhận" (62:2132): points returned to the survey's escrow.
  ESCROW_RELEASED: { icon: "flag", tone: "teal", href: "/forms" },
  TOPUP_SUCCESS: { icon: "bank", tone: "green", href: "/wallet" },
  REWARD_EARNED: { icon: "star-circle", tone: "green", href: "/wallet" },
  REWARD_PENDING: { icon: "hourglass", tone: "amber", href: "/wallet" },
  REWARD_RELEASED: { icon: "star-circle", tone: "green", href: "/wallet" },
  ACCOUNT_ACTIVATED: { icon: "unlock", tone: "green", href: "/wallet" },
  // Figma "Yêu cầu nạp điểm chưa được duyệt" (62:2185). No target: the copy asks to contact support.
  // WARNING also carries the starter-points expiry: see `notificationPresentation(type, message)`.
  WARNING: { icon: "bank", tone: "danger", href: null },
};

/**
 * What a WARNING is about. The backend uses WARNING for two events
 * (`top-up.service.ts` rejection, `starter-points.coordinator.ts` expiry) and
 * the DTO has no subtype, so the message decides (ASSUMED heuristic: English
 * backend copy and Vietnamese mock copy).
 */
export type WarningTopic = "top-up" | "starter-expiry" | "other";

export function warningTopicOf(message: string): WarningTopic {
  // Transfer references are upper case ("RESCOMK7Q2M9XA", mock "RESCOM LN5820").
  if (/top-?up|nạp điểm/i.test(message) || /RESCOM ?[A-Z0-9]{4,}/.test(message)) return "top-up";
  if (/starter|khởi đầu/i.test(message)) return "starter-expiry";
  return "other";
}

const WARNING_PRESENTATION: Record<WarningTopic, NotificationPresentation> = {
  "top-up": NOTIFICATION_PRESENTATION.WARNING,
  // ASSUMED (not drawn): the wallet shows the expired Đóng băng points.
  "starter-expiry": { icon: "lock", tone: "danger", href: "/wallet" },
  // ASSUMED: a neutral warning icon when the message says neither.
  other: { icon: "alert-circle", tone: "amber", href: null },
};

/** A type added by a newer backend: neutral bell, no link (a click only marks it read). */
export const FALLBACK_NOTIFICATION_PRESENTATION: NotificationPresentation = {
  icon: "bell",
  tone: "neutral",
  href: null,
};

function isKnownType(type: string): type is NotificationType {
  return Object.prototype.hasOwnProperty.call(NOTIFICATION_PRESENTATION, type);
}

/** Icon, tone and target of a row; `message` tells the two WARNING events apart. */
export function notificationPresentation(type: string, message = ""): NotificationPresentation {
  if (!isKnownType(type)) return FALLBACK_NOTIFICATION_PRESENTATION;
  if (type === "WARNING" && message) return WARNING_PRESENTATION[warningTopicOf(message)];
  return NOTIFICATION_PRESENTATION[type];
}

/**
 * Vietnamese title per type, for backend messages (one English sentence with
 * no " — "). ASSUMED copy except where Figma 14d draws it.
 */
export const NOTIFICATION_TITLES: Record<NotificationType, string> = {
  SURVEY_APPROVED: "Khảo sát đã được duyệt",
  SURVEY_REJECTED: "Khảo sát bị từ chối",
  ESCROW_RELEASED: "Điểm đã trả về ký quỹ",
  TOPUP_SUCCESS: "Nạp điểm thành công",
  REWARD_EARNED: "Bạn vừa nhận điểm thưởng",
  REWARD_PENDING: "Điểm thưởng đang chờ 48 giờ",
  REWARD_RELEASED: "Điểm thưởng đã vào Khả dụng",
  ACCOUNT_ACTIVATED: "Tài khoản đã kích hoạt",
  WARNING: "Cảnh báo tài khoản",
};

const WARNING_TITLES: Record<WarningTopic, string> = {
  "top-up": "Yêu cầu nạp điểm chưa được duyệt",
  "starter-expiry": "Điểm khởi đầu đã hết hạn",
  other: NOTIFICATION_TITLES.WARNING,
};

/** Title of a type added by a newer backend. */
export const FALLBACK_NOTIFICATION_TITLE = "Thông báo mới";

/** "Title — body" (Figma / mock copy) → both parts; otherwise the whole text is the title. */
export function splitNotificationMessage(message: string): { title: string; body: string | null } {
  const [title, ...rest] = message.split(" — ");
  return { title, body: rest.length ? rest.join(" — ") : null };
}

/**
 * Bold title + body of a row. Messages written as "Title — body" (the Figma
 * copy of the mock data) keep that split; backend messages have no " — ", so
 * the title comes from the type and the whole message is the body.
 */
export function notificationText(item: { type: string; message: string }): { title: string; body: string | null } {
  const split = splitNotificationMessage(item.message);
  if (split.body !== null) return split;
  if (!isKnownType(item.type)) return { title: FALLBACK_NOTIFICATION_TITLE, body: item.message };
  const title = item.type === "WARNING" ? WARNING_TITLES[warningTopicOf(item.message)] : NOTIFICATION_TITLES[item.type];
  return { title, body: item.message };
}

/** Same calendar day in Vietnam time. */
export function isSameVietnamDay(iso: string, now: Date): boolean {
  const a = vietnamDateTimeParts(iso);
  const b = vietnamDateTimeParts(now);
  return a !== null && b !== null && a.day === b.day && a.month === b.month && a.year === b.year;
}

/** Figma: "20:40" for today, "22/09" before (Vietnam time). */
export function notificationTimeLabel(iso: string, now: Date): string {
  const parts = vietnamDateTimeParts(iso);
  if (!parts) return "";
  return isSameVietnamDay(iso, now) ? `${parts.hour}:${parts.minute}` : `${parts.day}/${parts.month}`;
}

export interface NotificationGroup<T> {
  key: "today" | "earlier";
  label: string;
  items: T[];
}

/** "HÔM NAY" / "TRƯỚC ĐÓ", keeping the API order; empty groups are left out. */
export function groupNotifications<T extends Pick<NotificationDto, "createdAt">>(
  items: readonly T[],
  now: Date,
): NotificationGroup<T>[] {
  const today = items.filter((item) => isSameVietnamDay(item.createdAt, now));
  const earlier = items.filter((item) => !isSameVietnamDay(item.createdAt, now));
  const groups: NotificationGroup<T>[] = [
    { key: "today", label: "HÔM NAY", items: today },
    { key: "earlier", label: "TRƯỚC ĐÓ", items: earlier },
  ];
  return groups.filter((group) => group.items.length > 0);
}
