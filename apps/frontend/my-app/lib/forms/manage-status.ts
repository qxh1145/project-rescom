import { isOwnerReopenableClose, type FormCloseKind, type FormStatusEnum, type FormTypeEnum } from "@rescom/schemas";

/**
 * "Khảo sát của tôi" status rules (Figma 10 · 63:127 / 63:1300). Pure module:
 * the backend `formStatusEnum` plus the survey's facts decide the pill, the
 * filter tab and the row actions.
 */

/** What the Publisher sees; several backend states share one pill. */
export type PublisherStatusView =
  | "REJECTED" // CLOSED by moderation (legacy: DRAFT + rejection) — "Bị từ chối"
  | "DRAFT" // never submitted — ASSUMED (design) "Bản nháp" (not drawn)
  | "PENDING_REVIEW" // MODERATION_QUEUE / legacy ESCROW_LOCKED — "Chờ duyệt"
  | "RUNNING" // PUBLISHED — "Đang chạy"
  | "FULL" // CLOSED with the quota met — "Đủ mẫu"
  | "ENDED"; // CLOSED early — ASSUMED (design) "Đã kết thúc"

export interface StatusFacts {
  status: FormStatusEnum;
  /** VERIFIED on `GET /forms/:id` and (Phase 5 M2) `GET /forms` items; absent = unknown. */
  closeKind?: FormCloseKind | null;
  /** `GET /forms/:id`: the Admin's reason and the refunded Escrow (absent on list items). */
  rejection: { reason: string; refundAmount: number } | null;
  completedCompletions: number;
  expectedCompletions: number;
}

/**
 * Backend `rejectPublication` closes the survey with `closeKind`
 * `MODERATION` (final, never reopenable), so CLOSED + MODERATION is "Bị từ
 * chối". DRAFT + `rejection` is kept for data written before that.
 */
export function statusViewOf(form: StatusFacts): PublisherStatusView {
  switch (form.status) {
    case "DRAFT":
      return form.rejection ? "REJECTED" : "DRAFT";
    case "ESCROW_LOCKED":
    case "MODERATION_QUEUE":
      return "PENDING_REVIEW";
    case "PUBLISHED":
      return "RUNNING";
    case "CLOSED":
      if (form.closeKind === "MODERATION") return "REJECTED";
      // Plan 2.3: the backend closes a survey (QUOTA) when its sample target is met.
      if (form.closeKind === "QUOTA") return "FULL";
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
      return view === "RUNNING";
    case "pending":
      return view === "PENDING_REVIEW";
    case "ended":
      return view === "FULL" || view === "ENDED";
  }
}

export interface ManageStats {
  /** "Đang chạy". */
  running: number;
  /** "Chờ Admin duyệt". */
  pendingReview: number;
  /**
   * "Đang khoá ký quỹ" — unused points still locked across every survey;
   * `null` when no survey reports it (unknown, shown as "—").
   */
  escrowLocked: number | null;
  /** "Tổng lượt hoàn thành". */
  completed: number;
}

export function aggregateStats(
  forms: readonly (StatusFacts & { escrowLocked: number | null })[],
): ManageStats {
  const stats: ManageStats = { running: 0, pendingReview: 0, escrowLocked: 0, completed: 0 };
  let escrowKnown = forms.length === 0;
  for (const form of forms) {
    const view = statusViewOf(form);
    if (view === "RUNNING") stats.running += 1;
    if (view === "PENDING_REVIEW") stats.pendingReview += 1;
    if (form.escrowLocked !== null) {
      escrowKnown = true;
      stats.escrowLocked = (stats.escrowLocked ?? 0) + form.escrowLocked;
    }
    stats.completed += form.completedCompletions;
  }
  if (!escrowKnown) stats.escrowLocked = null;
  return stats;
}

/** Why `POST /forms/:id/reopen` refuses (backend `FormNotReopenableException.reason`, + not closed). */
export type ReopenRefusal =
  | "NOT_CLOSED"
  | "CLOSED_BY_ADMIN_OR_MODERATION"
  | "VERSION_NOT_APPROVED"
  // Plan 2.3: a QUOTA close (sample target met) is not reopenable for now.
  | "SAMPLE_TARGET_REACHED";

/**
 * Backend `reopenForm` order: only CLOSED; decision E8-D1 — only a survey its
 * owner closed (`isReopenableByOwner`); Story 8.1 — the current version must
 * have been approved (a withdrawn or re-versioned submission never went
 * live). `currentVersion` is only known on `GET /forms/:id`; without it the
 * version check is left to the server.
 */
export function reopenRefusalOf(form: {
  status: FormStatusEnum;
  closeKind?: FormCloseKind | null;
  currentVersion?: Readonly<Record<string, unknown>> | null;
}): ReopenRefusal | null {
  if (form.status !== "CLOSED") return "NOT_CLOSED";
  if (form.closeKind === "QUOTA") return "SAMPLE_TARGET_REACHED";
  // Story IR.2b: OWNER and DEADLINE closes are reopenable.
  if (!isOwnerReopenableClose(form.closeKind ?? null)) return "CLOSED_BY_ADMIN_OR_MODERATION";
  if (form.currentVersion?.isPublished === false) return "VERSION_NOT_APPROVED";
  return null;
}

/** Decision E8-D1 (backend `isReopenableByOwner`) + an approved current version when known. */
export function canReopen(form: Parameters<typeof reopenRefusalOf>[0]): boolean {
  return reopenRefusalOf(form) === null;
}

/**
 * "Mở lại" on a list row (Phase 5 M2). Stopgap: a CLOSED survey whose close
 * kind is not known (`null`/absent — an older backend, or a close recorded
 * before the column existed) still offers the link, and `/forms/:id/reopen`
 * decides from `GET /forms/:id` (it explains a refusal). A known ADMIN or
 * MODERATION close never offers it.
 */
export function listOffersReopen(form: { status: FormStatusEnum; closeKind?: FormCloseKind | null }): boolean {
  if (form.status !== "CLOSED") return false;
  return form.closeKind == null || canReopen(form);
}

/**
 * "Rút lại & hoàn điểm" (Phase 5 M7, decision Q4 option a): backend
 * `closeForm` lets the owner withdraw a survey waiting for review and close a
 * re-versioned draft (one with a published version, whose Escrow is still
 * held). A draft past v1 is taken as re-versioned; a never-published one is
 * refused by the server (400 `INVALID_STATUS_TRANSITION`).
 */
export function canWithdraw(form: StatusFacts, versionNumber: number): boolean {
  const view = statusViewOf(form);
  return view === "PENDING_REVIEW" || (view === "DRAFT" && versionNumber > 1);
}

/**
 * "Xoá" of a list row: backend `deleteDraft` only removes a DRAFT with no
 * published version. As in `canWithdraw`, a draft past v1 is taken as
 * re-versioned (it withdraws instead); a legacy rejected draft is not offered.
 */
export function canDelete(form: StatusFacts, versionNumber: number): boolean {
  return statusViewOf(form) === "DRAFT" && versionNumber === 1;
}

/**
 * "Chỉnh sửa" of a running Form Builder survey (`POST /forms/:id/versions`
 * needs PUBLISHED). Google Forms surveys
 * are edited on Google itself, so they never offer it.
 */
export function canEditLive(form: StatusFacts & { type: FormTypeEnum }): boolean {
  const view = statusViewOf(form);
  return form.type === "INTERNAL" && view === "RUNNING";
}

/**
 * "Sửa & gửi lại" of a rejected survey. The backend never edits a CLOSED
 * survey, so both paths create a new one: the Google Forms wizard (5A)
 * prefilled from this survey, or `/forms/:id/resubmit` — a confirmation over
 * the Tiến độ tab that copies an in-Rescom form into a new Form Builder draft.
 */
export function resubmitHref(form: { id: string; type: FormTypeEnum }): string {
  return form.type === "EXTERNAL"
    ? `/forms/new/google-form?from=${encodeURIComponent(form.id)}`
    : `/forms/${encodeURIComponent(form.id)}/resubmit`;
}

/** "Tiếp tục soạn" of a never-submitted draft (ASSUMED (design), not drawn): its own editor. */
export function continueDraftHref(form: { id: string; type: FormTypeEnum }): string {
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
