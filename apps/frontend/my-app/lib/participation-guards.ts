import {
  PARTICIPATION_RATE_LIMITED_CODE,
  SUBMISSION_TOO_FAST_CODE,
  participationRateLimitDetailsSchema,
  timeBarrierRejectionDetailsSchema,
  type ParticipationRateLimitDetails,
  type TimeBarrierRejectionDetails,
} from "@rescom/schemas";

/**
 * Story 8.2: recognises the bot-protection rejections of the participation API
 * (and of the mock repository, which mirrors the same contract) so pages can
 * show a friendly countdown instead of a generic failure. Pure helpers: the
 * rules themselves live in `@rescom/schemas` and on the server.
 */
export type ParticipationGuard =
  | ({ kind: "TIME_BARRIER" } & TimeBarrierRejectionDetails)
  | ({ kind: "RATE_LIMIT" } & ParticipationRateLimitDetails);

type ErrorLike = { code?: unknown; details?: unknown } | null | undefined;

export function getParticipationGuard(error: unknown): ParticipationGuard | null {
  const candidate = (typeof error === "object" ? error : null) as ErrorLike;
  if (!candidate) return null;

  if (candidate.code === SUBMISSION_TOO_FAST_CODE) {
    const parsed = timeBarrierRejectionDetailsSchema.safeParse(candidate.details);
    return parsed.success ? { kind: "TIME_BARRIER", ...parsed.data } : null;
  }
  if (candidate.code === PARTICIPATION_RATE_LIMITED_CODE) {
    const parsed = participationRateLimitDetailsSchema.safeParse(candidate.details);
    return parsed.success ? { kind: "RATE_LIMIT", ...parsed.data } : null;
  }
  return null;
}

/** Whole seconds until `isoTime` (never negative). */
export function secondsUntil(isoTime: string, now: number = Date.now()): number {
  const target = new Date(isoTime).getTime();
  if (!Number.isFinite(target)) return 0;
  return Math.max(0, Math.ceil((target - now) / 1000));
}

/** "45 giây", "3 phút", "1 giờ 5 phút" (Vietnamese, rounded up). */
export function formatWaitDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.ceil(totalSeconds));
  if (seconds < 60) return `${seconds} giây`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes} phút`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours} giờ ${rest} phút` : `${hours} giờ`;
}

/** Explains how the minimum time is computed, e.g. "5 câu hỏi × 2 giây". */
export function describeTimeBarrierRule(barrier: {
  requiredSeconds: number;
  questionCount: number | null;
  secondsPerQuestion: number | null;
}): string {
  if (barrier.questionCount && barrier.secondsPerQuestion) {
    const perQuestionTotal = barrier.questionCount * barrier.secondsPerQuestion;
    return perQuestionTotal >= barrier.requiredSeconds
      ? `${barrier.questionCount} câu hỏi × ${barrier.secondsPerQuestion} giây`
      : `mức tối thiểu của khảo sát (áp dụng cho ${barrier.questionCount} câu hỏi)`;
  }
  return "mức tối thiểu của khảo sát";
}

/** Friendly Vietnamese explanation for a bot-protection rejection. */
export function describeParticipationGuard(
  guard: ParticipationGuard,
  waitSeconds: number = guard.kind === "TIME_BARRIER"
    ? guard.remainingSeconds
    : guard.retryAfterSeconds,
): string {
  if (guard.kind === "TIME_BARRIER") {
    return `Bạn đang làm hơi nhanh! Khảo sát này cần ít nhất ${guard.requiredSeconds} giây (${describeTimeBarrierRule(guard)}). Hãy dành thời gian đọc kỹ từng câu hỏi — bạn có thể nộp lại sau ${formatWaitDuration(waitSeconds)}. Câu trả lời của bạn vẫn được giữ nguyên.`;
  }
  if (guard.scope === "COMPLETIONS") {
    // Decision E8-D6: open attempts hold reserved capacity, so the limit is
    // reached before any work is invested (never after finishing a survey).
    if (guard.inProgressAttempts && guard.inProgressAttempts > 0) {
      return `Bạn đã đạt giới hạn ${guard.limit} khảo sát trong ${formatWaitDuration(guard.windowSeconds)} (gồm ${guard.completionsInWindow ?? 0} khảo sát đã hoàn thành và ${guard.inProgressAttempts} khảo sát đang làm dở — mỗi lượt đang làm được giữ chỗ để bạn luôn nộp được bài). Hãy hoàn thành khảo sát đang làm, hoặc quay lại sau ${formatWaitDuration(waitSeconds)}.`;
    }
    return `Bạn đã hoàn thành ${guard.limit} khảo sát trong ${formatWaitDuration(guard.windowSeconds)} gần đây — mức tối đa để bảo vệ chất lượng dữ liệu nghiên cứu. Vui lòng quay lại sau ${formatWaitDuration(waitSeconds)}.`;
  }
  return `Bạn đang thao tác quá nhanh. Vui lòng thử lại sau ${formatWaitDuration(waitSeconds)}.`;
}
