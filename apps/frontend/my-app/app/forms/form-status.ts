import type { FormStatusEnum } from "@rescom/schemas";

/**
 * Publisher-facing presentation of the Form lifecycle (Story 8.1). Every
 * published survey first waits in the Admin moderation queue ("Chờ kiểm
 * duyệt") and only reaches the Marketplace after approval.
 */
export const FORM_STATUS_LABELS: Record<FormStatusEnum, string> = {
  DRAFT: "Bản nháp",
  ESCROW_LOCKED: "Đã khoá ký quỹ",
  MODERATION_QUEUE: "Chờ kiểm duyệt",
  PUBLISHED: "Đang hoạt động",
  CLOSED: "Đã đóng",
};

const FORM_STATUS_BADGE_CLASSES: Record<FormStatusEnum, string> = {
  DRAFT: "bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300",
  ESCROW_LOCKED: "bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300",
  MODERATION_QUEUE:
    "bg-violet-100 dark:bg-violet-950 text-violet-800 dark:text-violet-300",
  PUBLISHED:
    "bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300",
  CLOSED: "bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-300",
};

function isKnownStatus(status: string): status is FormStatusEnum {
  return Object.prototype.hasOwnProperty.call(FORM_STATUS_LABELS, status);
}

/** Vietnamese label for a Form status; unknown values are shown as-is. */
export function formStatusLabel(status: string): string {
  return isKnownStatus(status) ? FORM_STATUS_LABELS[status] : status;
}

/** Tailwind classes for the status badge. */
export function formStatusBadgeClass(status: string): string {
  return isKnownStatus(status)
    ? FORM_STATUS_BADGE_CLASSES[status]
    : FORM_STATUS_BADGE_CLASSES.ESCROW_LOCKED;
}

/** True while the survey waits for an Admin decision (not yet on the Marketplace). */
export function isAwaitingModeration(status: string): boolean {
  return status === "MODERATION_QUEUE";
}

/** Status a survey enters when the Publisher publishes it (FR-20). */
export const PUBLISH_TARGET_STATUS: FormStatusEnum = "MODERATION_QUEUE";
