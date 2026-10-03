import type {
  AttemptRewardState,
  InternalFormSubmissionResponseDto,
  RewardSettlementStatus,
} from "@rescom/schemas";

/**
 * Which completion screen to show for a finished attempt:
 * - `available` — Figma 6 "+12 điểm vào Khả dụng" (in-Rescom, SHADOW/ADVISORY);
 * - `pending`   — Google Forms: "+18 điểm vào Chờ duyệt 48 giờ" (ASSUMED (design) copy, page 5);
 * - `held`      — Figma 17c "Điểm đang giữ để xét" (ENFORCED Integrity Hold);
 * - `no-reward` — NO_REWARD: nothing was credited (ASSUMED (design) neutral copy);
 * - `reversed`  — REVERSED: the credited reward was taken back (ASSUMED (design) neutral copy).
 */
export type CompletionKind = "available" | "pending" | "held" | "no-reward" | "reversed";

export interface CompletionView {
  kind: CompletionKind;
  amount: number;
  /** This attempt unlocked the starter points (Figma 6 "Tài khoản đã kích hoạt"). */
  activated: boolean;
  submittedAt: string | null;
}

interface AttemptLike {
  type: "INTERNAL" | "EXTERNAL";
  submittedAt: string | null;
  survey: { rewardPerResponse: number };
}

interface OutcomeLike {
  reward: { state: AttemptRewardState; amount: number };
  starterUnlock: { activatedByThisAttempt: boolean };
  submittedAt: string | null;
}

/**
 * `reward.state` of `GET /attempts/:id/outcome`. NO_REWARD and REVERSED get
 * the neutral views (no "+N điểm" claim); AWAITING_SETTLEMENT and
 * NOT_COMPLETED have no screen of their own (owner decision Q2): the
 * type-based fallback shows the existing copy.
 */
function kindOfState(state: AttemptRewardState): CompletionKind | null {
  switch (state) {
    case "AVAILABLE":
      return "available";
    case "PENDING":
      return "pending";
    case "HELD_IN_INTEGRITY":
    case "HELD_IN_DISPUTE":
      return "held";
    case "NO_REWARD":
      return "no-reward";
    case "REVERSED":
      return "reversed";
    default:
      return null;
  }
}

/** `reward.status` of the stashed submit response. */
function kindOfSettlement(status: RewardSettlementStatus): CompletionKind | null {
  if (status === "HELD_IN_INTEGRITY") return "held";
  if (status === "PENDING") return "pending";
  if (status === "SETTLED") return "available";
  return null;
}

/**
 * Sources, most specific first: the outcome route, the submit response kept
 * in sessionStorage (when the outcome could not be read), then the attempt's
 * type (Google Forms rewards start in the 48h review). "Tài khoản đã kích
 * hoạt" is only claimed for a confirmed reward that the outcome attributes to
 * this attempt: a pending (48h) or held one unlocks nothing.
 */
export function resolveCompletionView(
  attempt: AttemptLike,
  outcome: OutcomeLike | null,
  stashed: Pick<InternalFormSubmissionResponseDto, "reward" | "submittedAt"> | null,
): CompletionView {
  const kind =
    (outcome ? kindOfState(outcome.reward.state) : null) ??
    (stashed?.reward ? kindOfSettlement(stashed.reward.status) : null) ??
    (attempt.type === "EXTERNAL" ? "pending" : "available");
  const credited = outcome?.reward.amount || stashed?.reward?.amount || 0;
  return {
    kind,
    amount: credited > 0 ? credited : attempt.survey.rewardPerResponse,
    activated: kind === "available" && (outcome?.starterUnlock.activatedByThisAttempt ?? false),
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
