import {
  SURVEY_FEEDBACK_ALREADY_SUBMITTED_CODE,
  SURVEY_FEEDBACK_ATTEMPT_NOT_FOUND_CODE,
  SURVEY_FEEDBACK_COMMENT_MAX_LENGTH,
  SURVEY_FEEDBACK_NOT_ALLOWED_CODE,
} from "@rescom/schemas";

/**
 * Story 9.2: Vietnamese copy for feedback errors, shared by the mock
 * repository and the live API client so the later swap keeps the same
 * messages. Pure helpers; the rules live in `@rescom/schemas` and the server.
 */

export const SURVEY_FEEDBACK_ERROR_MESSAGES: Record<string, string> = {
  [SURVEY_FEEDBACK_ATTEMPT_NOT_FOUND_CODE]: "Không tìm thấy lượt khảo sát để đánh giá.",
  [SURVEY_FEEDBACK_NOT_ALLOWED_CODE]: "Bạn chỉ có thể đánh giá sau khi đã hoàn thành khảo sát.",
  [SURVEY_FEEDBACK_ALREADY_SUBMITTED_CODE]:
    "Bạn đã gửi đánh giá cho lượt khảo sát này và không thể thay đổi.",
  AUTH_REQUIRED: "Vui lòng đăng nhập để đánh giá khảo sát.",
};

/**
 * Note under the thank-you receipt. Decision E9-D4 (2026-09-26, option A):
 * it states the purpose and that rewards are unaffected, but makes no
 * promise about what the survey's Publisher can see — re-add one only once
 * Story 9.3's privacy design (minimum aggregation, pseudonymous display) is
 * approved.
 */
export const SURVEY_FEEDBACK_THANK_YOU_NOTE =
  "Đánh giá được dùng để cải thiện chất lượng khảo sát và điểm thưởng của bạn không bị ảnh hưởng.";

/** Message for the first shared-schema issue of a feedback submission (by field path). */
export function describeSurveyFeedbackValidationIssue(path: PropertyKey | undefined): string {
  if (path === "rating") return "Vui lòng chọn số sao từ 1 đến 5.";
  if (path === "comment") {
    return `Nhận xét tối đa ${SURVEY_FEEDBACK_COMMENT_MAX_LENGTH} ký tự.`;
  }
  if (path === "issueTags") return "Vấn đề gặp phải không hợp lệ.";
  return "Dữ liệu đánh giá không hợp lệ.";
}

type ErrorLike = { code?: unknown } | null | undefined;

export function getSurveyFeedbackErrorCode(error: unknown): string | null {
  const candidate = (typeof error === "object" ? error : null) as ErrorLike;
  return typeof candidate?.code === "string" ? candidate.code : null;
}

/**
 * How the receipt prompt should react to a failed call: errors that a retry
 * can never fix hide the prompt or show the stored feedback instead of a
 * useless "try again". CSRF/origin 403s stay retryable: `formMutationFetch`
 * can recover them.
 */
export function resolveSurveyFeedbackFailure(
  error: unknown,
): "HIDE" | "SHOW_SUBMITTED" | "RETRY" {
  const code = getSurveyFeedbackErrorCode(error);
  if (code === SURVEY_FEEDBACK_ALREADY_SUBMITTED_CODE) return "SHOW_SUBMITTED";
  if (
    code === SURVEY_FEEDBACK_ATTEMPT_NOT_FOUND_CODE ||
    code === SURVEY_FEEDBACK_NOT_ALLOWED_CODE ||
    code === "AUTH_REQUIRED" ||
    code === "AUTH_USER_LOCKED"
  ) {
    return "HIDE";
  }
  return "RETRY";
}
