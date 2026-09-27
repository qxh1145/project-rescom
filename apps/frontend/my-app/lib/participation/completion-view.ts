import type { InternalFormSubmissionResponseDto, RewardSettlementStatus } from "@rescom/schemas";

/**
 * Which completion screen to show for a finished attempt:
 * - `available` — Figma 6 "+12 điểm vào Khả dụng" (in-Rescom, SHADOW/ADVISORY);
 * - `pending`   — Google Forms: "+18 điểm vào Chờ duyệt 48 giờ" (ASSUMED copy, page 5);
 * - `held`      — Figma 17c "Điểm đang giữ để xét" (ENFORCED Integrity Hold).
 */
export type CompletionKind = "available" | "pending" | "held";

export interface CompletionView {
  kind: CompletionKind;
  amount: number;
  /** This attempt unlocked the starter points (Figma 6 "Tài khoản đã kích hoạt"). */
  activated: boolean;
  submittedAt: string | null;
}

interface AttemptLike {
  type: "INTERNAL" | "EXTERNAL";
  status: string;
  submittedAt: string | null;
  survey: { rewardPerResponse: number };
}

interface OutcomeLike {
  reward: { status: RewardSettlementStatus; amount: number } | null;
  accountActivated: boolean;
  submittedAt: string | null;
}

function kindOf(status: RewardSettlementStatus | null, attempt: AttemptLike): CompletionKind {
  if (status === "HELD_IN_INTEGRITY") return "held";
  if (status === "PENDING") return "pending";
  if (status === "SETTLED") return "available";
  return attempt.type === "EXTERNAL" || attempt.status === "PENDING_REVIEW" ? "pending" : "available";
}

/**
 * Sources, most specific first: the ASSUMED outcome route, the submit
 * response kept in sessionStorage (VERIFIED shape), then the attempt itself.
 */
export function resolveCompletionView(
  attempt: AttemptLike,
  outcome: OutcomeLike | null,
  stashed: Pick<InternalFormSubmissionResponseDto, "reward" | "submittedAt"> | null,
): CompletionView {
  const reward = outcome?.reward ?? stashed?.reward ?? null;
  return {
    kind: kindOf(reward?.status ?? null, attempt),
    amount: reward && reward.amount > 0 ? reward.amount : attempt.survey.rewardPerResponse,
    activated: outcome?.accountActivated ?? false,
    submittedAt: outcome?.submittedAt ?? stashed?.submittedAt ?? attempt.submittedAt,
  };
}

/** "26/09 14:32" in Vietnam time. */
export function formatShortDateTime(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Ho_Chi_Minh",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("day")}/${part("month")} ${part("hour")}:${part("minute")}`;
}

/** "14:31" in Vietnam time. */
export function formatClock(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Ho_Chi_Minh",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("hour")}:${part("minute")}`;
}
