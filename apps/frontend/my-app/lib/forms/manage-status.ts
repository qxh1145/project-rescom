import { isOwnerReopenableClose, type FormCloseKind, type FormStatusEnum, type FormTypeEnum } from "@rescom/schemas";

/**
 * "Khảo sát của tôi" status rules (Figma 10 · 63:127 / 63:1300). Pure module:
 * the backend `formStatusEnum` plus the survey's facts decide the pill, the
 * filter tab and the row actions.
 */

/** What the Publisher sees; several backend states share one pill. */
export type PublisherStatusView =
  | "REJECTED" // DRAFT + Admin rejection — "Bị từ chối"
  | "DRAFT" // never submitted — ASSUMED "Bản nháp" (not drawn)
  | "PENDING_REVIEW" // MODERATION_QUEUE / legacy ESCROW_LOCKED — "Chờ duyệt"
  | "PAUSED" // PUBLISHED + pausedAt — ASSUMED "Tạm dừng"
  | "RUNNING" // PUBLISHED — "Đang chạy"
  | "FULL" // CLOSED with the quota met — "Đủ mẫu"
  | "ENDED"; // CLOSED early — ASSUMED "Đã kết thúc"

export interface StatusFacts {
  status: FormStatusEnum;
  rejection: { reason: string; refundedPoints: number } | null;
  pausedAt: string | null;
  completedCompletions: number;
  expectedCompletions: number;
}

export function statusViewOf(form: StatusFacts): PublisherStatusView {
  switch (form.status) {
    case "DRAFT":
      return form.rejection ? "REJECTED" : "DRAFT";
    case "ESCROW_LOCKED":
    case "MODERATION_QUEUE":
      return "PENDING_REVIEW";
    case "PUBLISHED":
      return form.pausedAt ? "PAUSED" : "RUNNING";
    case "CLOSED":
      return form.expectedCompletions > 0 && form.completedCompletions >= form.expectedCompletions ? "FULL" : "ENDED";
  }
}

export type StatusPillTone = "neutral" | "teal" | "green" | "danger" | "amber";

export interface StatusPill {
  label: string;
  tone: StatusPillTone;
  /** `public/icons/<icon>.svg`. */
  icon: string;
}

/** Figma pills: 26px, 14px icon, 12px bold label (13px in the survey header). */
export const STATUS_PILLS: Record<PublisherStatusView, StatusPill> = {
  REJECTED: { label: "Bị từ chối", tone: "danger", icon: "x-circle" },
  DRAFT: { label: "Bản nháp", tone: "neutral", icon: "file-text" },
  PENDING_REVIEW: { label: "Chờ duyệt", tone: "neutral", icon: "clock" },
  PAUSED: { label: "Tạm dừng", tone: "amber", icon: "pause" },
  RUNNING: { label: "Đang chạy", tone: "teal", icon: "play-circle" },
  FULL: { label: "Đủ mẫu", tone: "green", icon: "check" },
  ENDED: { label: "Đã kết thúc", tone: "neutral", icon: "check" },
};

/** Figma "Lọc theo trạng thái": Tất cả · N / Đang chạy / Chờ duyệt / Đã kết thúc. */
export type ManageFilter = "all" | "running" | "pending" | "ended";

export const MANAGE_FILTERS: readonly { value: ManageFilter; label: string }[] = [
  { value: "all", label: "Tất cả" },
  { value: "running", label: "Đang chạy" },
  { value: "pending", label: "Chờ duyệt" },
  { value: "ended", label: "Đã kết thúc" },
];

/** Rejected and never-submitted drafts only appear under "Tất cả". */
export function matchesFilter(view: PublisherStatusView, filter: ManageFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "running":
      return view === "RUNNING" || view === "PAUSED";
    case "pending":
      return view === "PENDING_REVIEW";
    case "ended":
      return view === "FULL" || view === "ENDED";
  }
}

export interface ManageStats {
  /** "Đang chạy" (paused surveys included: they still hold their quota). */
  running: number;
  /** "Chờ Admin duyệt". */
  pendingReview: number;
  /** "Đang khoá ký quỹ" — points still locked across every survey. */
  escrowLocked: number;
  /** "Tổng lượt hoàn thành". */
  completed: number;
}

export function aggregateStats(
  forms: readonly (StatusFacts & { escrowLocked: number })[],
): ManageStats {
  const stats: ManageStats = { running: 0, pendingReview: 0, escrowLocked: 0, completed: 0 };
  for (const form of forms) {
    const view = statusViewOf(form);
    if (view === "RUNNING" || view === "PAUSED") stats.running += 1;
    if (view === "PENDING_REVIEW") stats.pendingReview += 1;
    stats.escrowLocked += form.escrowLocked;
    stats.completed += form.completedCompletions;
  }
  return stats;
}

/** Decision E8-D1 (backend `isReopenableByOwner`): only a survey its owner closed reopens. */
export function canReopen(form: { status: FormStatusEnum; closeKind: FormCloseKind | null }): boolean {
  return form.status === "CLOSED" && isOwnerReopenableClose(form.closeKind);
}

/**
 * "Sửa & gửi lại" of a rejected survey: the Google Forms wizard (5A) prefilled
 * from this survey, or the Form Builder (5D) for an in-Rescom form.
 */
export function resubmitHref(form: { id: string; type: FormTypeEnum }): string {
  return form.type === "EXTERNAL"
    ? `/forms/new/google-form?from=${encodeURIComponent(form.id)}`
    : `/forms/${encodeURIComponent(form.id)}/builder`;
}

/** "Kết quả": Form Builder answers live in Rescom (5C); Google Forms ones do not. */
export function resultsHref(form: { id: string; type: FormTypeEnum }): string {
  const id = encodeURIComponent(form.id);
  return form.type === "INTERNAL" ? `/forms/${id}/responses` : `/forms/${id}`;
}

export function sourceLabel(type: FormTypeEnum): string {
  return type === "EXTERNAL" ? "Google Forms" : "Form Builder";
}
