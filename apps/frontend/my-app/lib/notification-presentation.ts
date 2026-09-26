import type { NotificationType } from "@rescom/schemas";

/**
 * Story 9.6: how the header bell presents each notification type. Kept pure
 * so a type the frontend does not know yet (for example one added by a newer
 * backend) falls back to a neutral entry instead of crashing the bell.
 */
export interface NotificationPresentation {
  title: string;
  icon: string;
  iconClass: string;
  href?: string;
}

export const NOTIFICATION_TYPE_PRESENTATION: Record<NotificationType, NotificationPresentation> = {
  SURVEY_APPROVED: {
    title: "Khảo sát đã được duyệt",
    icon: "✅",
    iconClass: "bg-emerald-50 dark:bg-emerald-950/50",
    href: "/forms",
  },
  SURVEY_REJECTED: {
    title: "Khảo sát bị từ chối",
    icon: "⛔",
    iconClass: "bg-rose-50 dark:bg-rose-950/50",
    href: "/forms",
  },
  ESCROW_RELEASED: {
    title: "Điểm ký quỹ đã được giải phóng",
    icon: "🔓",
    iconClass: "bg-blue-50 dark:bg-blue-950/50",
    href: "/wallet",
  },
  TOPUP_SUCCESS: {
    title: "Nạp điểm thành công",
    icon: "💳",
    iconClass: "bg-blue-50 dark:bg-blue-950/50",
    href: "/wallet",
  },
  // Decision E9-D2 (FR-57 "Points earned"): Internal reward credited instantly.
  REWARD_EARNED: {
    title: "Bạn đã nhận điểm thưởng",
    icon: "💰",
    iconClass: "bg-emerald-50 dark:bg-emerald-950/50",
    href: "/wallet",
  },
  REWARD_PENDING: {
    title: "Điểm đang chờ đối soát",
    icon: "⏳",
    iconClass: "bg-amber-50 dark:bg-amber-950/50",
    href: "/wallet",
  },
  REWARD_RELEASED: {
    title: "Điểm đã chuyển sang Khả dụng",
    icon: "🪙",
    iconClass: "bg-emerald-50 dark:bg-emerald-950/50",
    href: "/wallet",
  },
  ACCOUNT_ACTIVATED: {
    title: "Tài khoản đã được kích hoạt",
    icon: "🎉",
    iconClass: "bg-emerald-50 dark:bg-emerald-950/50",
    href: "/wallet",
  },
  WARNING: {
    title: "Cảnh báo tài khoản",
    icon: "⚠️",
    iconClass: "bg-orange-50 dark:bg-orange-950/50",
  },
};

/** Neutral entry for an unknown type; no link, so a click only marks it read. */
export const FALLBACK_PRESENTATION: NotificationPresentation = {
  title: "Thông báo",
  icon: "🔔",
  iconClass: "bg-slate-100 dark:bg-slate-800",
};

export function getNotificationPresentation(type: string): NotificationPresentation {
  return Object.prototype.hasOwnProperty.call(NOTIFICATION_TYPE_PRESENTATION, type)
    ? NOTIFICATION_TYPE_PRESENTATION[type as NotificationType]
    : FALLBACK_PRESENTATION;
}
