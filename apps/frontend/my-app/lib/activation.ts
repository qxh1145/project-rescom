import type { StarterActivationState, StarterPointsStatusDto } from "@rescom/schemas";

/**
 * Presentation helpers for the Marketplace activation step (Story 7.2).
 * Pure (no React/Next imports) so pages, the card and tests share them. The
 * activation rule itself lives in `@rescom/schemas` (`evaluateStarterActivation`)
 * and is applied by the repository — nothing here decides eligibility.
 */

/** The success state is shown once, for a week after activation, until dismissed. */
export const ACTIVATION_SUCCESS_VISIBLE_DAYS = 7;

/** "Hurry" styling for the countdown to the 30-day expiry (FR-5). */
export const ACTIVATION_URGENT_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Step 1 (profile) is always done once the card shows the survey step. */
export function activationProgressPercent(state: StarterActivationState): number {
  switch (state) {
    case "ACTIVATED":
    case "READY_TO_UNLOCK":
      return 100;
    case "PENDING_CONFIRMATION":
      return 75;
    case "SURVEY_REQUIRED":
      return 50;
    default:
      return 0;
  }
}

export function isRecentActivation(
  activatedAt: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!activatedAt) return false;
  const at = new Date(activatedAt).getTime();
  if (Number.isNaN(at)) return false;
  return now.getTime() - at <= ACTIVATION_SUCCESS_VISIBLE_DAYS * DAY_MS;
}

export function isExpiryUrgent(daysRemaining: number): boolean {
  return daysRemaining <= ACTIVATION_URGENT_DAYS;
}

export function activationDismissKey(
  userId: string,
  kind: "success" | "expired",
): string {
  return `rescom:activation-${kind}-dismissed:${userId}`;
}

/** Per-viewer UI preference only; storage may be unavailable (private mode). */
export function readActivationDismissed(key: string): boolean {
  try {
    return globalThis.localStorage?.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function writeActivationDismissed(key: string): void {
  try {
    globalThis.localStorage?.setItem(key, "1");
  } catch {
    // Non-critical: the banner simply shows again next time.
  }
}

export function formatVnDate(iso: string): string {
  return new Date(iso).toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function formatVnDateTime(iso: string): string {
  const date = new Date(iso);
  const time = date.toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${time} ${formatVnDate(iso)}`;
}

/** Where a started attempt continues (Internal renderer or External code page). */
export function attemptPath(
  survey: { id: string; type: "INTERNAL" | "EXTERNAL" },
  attempt: { attemptId: string; responseId?: string | null },
): string {
  if (survey.type === "INTERNAL") {
    const params = new URLSearchParams({
      attemptId: attempt.attemptId,
      responseId: attempt.responseId ?? "",
    });
    return `/forms/${survey.id}/respond?${params.toString()}`;
  }
  return `/attempts/${attempt.attemptId}`;
}

/**
 * Code review P7: the 30-day activation window (FR-5) is still open, so a new
 * completion can still count. A completion made exactly at the deadline
 * counts (same boundary as `evaluateStarterActivation`).
 */
export function isActivationWindowOpen(
  status: { expiresAt: string | null | undefined } | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!status?.expiresAt) return false;
  const expiresAt = new Date(status.expiresAt).getTime();
  if (Number.isNaN(expiresAt)) return false;
  return now.getTime() <= expiresAt;
}

export type SidebarActivationStepStatus = "done" | "pending" | "todo";

export interface SidebarActivationView {
  title: string;
  badge: string;
  tone: "success" | "pending" | "expired";
  description: string;
  /** The two activation steps; `null` once there is nothing left to do. */
  steps: { label: string; status: SidebarActivationStepStatus }[] | null;
}

const SIDEBAR_STEP_PROFILE = "1. Điền hồ sơ nhân khẩu học";
const SIDEBAR_STEP_SURVEY = "2. Làm 1 khảo sát do người khác đăng";

/**
 * Code review P3: the Sidebar's activation block, derived from the activation
 * state only (the repository/API decides eligibility — never the component).
 * `null` hides the block (no status yet, or no starter points to activate).
 */
export function sidebarActivationView(
  status: StarterPointsStatusDto | null | undefined,
): SidebarActivationView | null {
  if (!status) return null;
  const locked = `Bạn có ${status.frozenBalance} điểm khóa. Hoàn thành 2 điều kiện để mở khóa:`;
  switch (status.activationState) {
    case "NOT_GRANTED":
      return null;
    case "ACTIVATED":
      return {
        title: "Đã Kích Hoạt",
        badge: "Hoàn tất ✓",
        tone: "success",
        description:
          "Tài khoản đã hoàn tất hồ sơ và 1 khảo sát. Điểm tân thủ đã chuyển vào số dư Khả dụng.",
        steps: null,
      };
    case "EXPIRED":
      // Decision E7-DN3: expiry forfeits only the points; finishing both
      // steps still makes a Verified Member.
      if (status.isVerifiedMember) {
        return {
          title: "Thành viên Đã Xác Thực",
          badge: "Đã hết hạn",
          tone: "expired",
          description:
            "Bạn đã hoàn tất hồ sơ và 1 khảo sát nên là Thành viên Đã Xác Thực. Riêng điểm tân thủ đã hết hạn vì chưa kích hoạt trong 30 ngày.",
          steps: null,
        };
      }
      return {
        title: "Trạng thái Kích hoạt",
        badge: "Đã hết hạn",
        tone: "expired",
        description:
          "Điểm tân thủ đã hết hạn vì tài khoản chưa kích hoạt trong 30 ngày. Bạn vẫn có thể làm khảo sát trên Chợ khảo sát để nhận điểm thưởng và trở thành Thành viên Đã Xác Thực.",
        steps: null,
      };
    case "DEMOGRAPHICS_REQUIRED":
      return {
        title: "Trạng thái Kích hoạt",
        badge: "Chờ mở khóa",
        tone: "pending",
        description: locked,
        steps: [
          { label: SIDEBAR_STEP_PROFILE, status: "todo" },
          { label: SIDEBAR_STEP_SURVEY, status: "todo" },
        ],
      };
    case "SURVEY_REQUIRED":
      return {
        title: "Trạng thái Kích hoạt",
        badge: "Chờ mở khóa",
        tone: "pending",
        description: locked,
        steps: [
          { label: SIDEBAR_STEP_PROFILE, status: "done" },
          { label: SIDEBAR_STEP_SURVEY, status: "todo" },
        ],
      };
    case "PENDING_CONFIRMATION":
      return {
        title: "Trạng thái Kích hoạt",
        badge: "Chờ đối soát",
        tone: "pending",
        description: locked,
        steps: [
          { label: SIDEBAR_STEP_PROFILE, status: "done" },
          { label: `${SIDEBAR_STEP_SURVEY} (⏳ chờ đối soát 48 giờ)`, status: "pending" },
        ],
      };
    case "READY_TO_UNLOCK":
      return {
        title: "Trạng thái Kích hoạt",
        badge: "Đang mở khóa",
        tone: "pending",
        description: `Bạn đã hoàn tất cả 2 điều kiện. ${status.frozenBalance} điểm tân thủ đang được mở khóa.`,
        steps: [
          { label: SIDEBAR_STEP_PROFILE, status: "done" },
          { label: SIDEBAR_STEP_SURVEY, status: "done" },
        ],
      };
  }
}

export interface MemberStatusBadge {
  verified: boolean;
  label: string;
}

/**
 * Decision E7-DN3: the "Verified Member" badge follows `isVerifiedMember`
 * (both onboarding steps done), separate from the starter points — an
 * expired respondent who finished both steps is verified, and one who has
 * not yet is "not verified" rather than "awaiting activation". Before the
 * status has loaded, the user's persisted activation is the fallback.
 */
export function memberStatusBadge(
  status: Pick<StarterPointsStatusDto, "isVerifiedMember" | "activationState"> | null | undefined,
  fallbackVerified = false,
): MemberStatusBadge {
  const verified = status ? status.isVerifiedMember : fallbackVerified;
  if (verified) {
    return { verified: true, label: "Thành viên Đã Xác Thực ✓" };
  }
  return {
    verified: false,
    label:
      status?.activationState === "EXPIRED"
        ? "Thành viên Mới (Chưa Xác Thực)"
        : "Thành viên Mới (Chờ Kích Hoạt)",
  };
}

export interface ReceiptActivationNotice {
  state: StarterActivationState;
  confirmsAt: string | null;
  expiresAt: string | null;
}

/**
 * Code review P10: the "unlock after the 48-hour review" notice for a receipt
 * rebuilt from an already COMPLETED attempt — shown only while this survey is
 * the one awaiting review.
 */
export function receiptActivationNotice(
  status: StarterPointsStatusDto | null | undefined,
  surveyId: string,
): ReceiptActivationNotice | undefined {
  if (
    !status ||
    status.activationState !== "PENDING_CONFIRMATION" ||
    status.activationSurvey?.formId !== surveyId
  ) {
    return undefined;
  }
  return {
    state: status.activationState,
    confirmsAt: status.activationSurvey.confirmsAt,
    expiresAt: status.expiresAt,
  };
}
