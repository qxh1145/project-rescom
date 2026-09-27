import { timeBarrierRejectionDetailsSchema } from "@rescom/schemas";
import { isApiError } from "../api/api-error.ts";
import { SURVEY_FEEDBACK_ERROR_MESSAGES } from "../survey-feedback.ts";

/** Vietnamese copy for in-Rescom participation errors (codes: `participation.exceptions.ts`). */

const NETWORK = "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.";

function rateLimited(error: unknown): string {
  const seconds = isApiError(error) ? error.retryAfterSeconds : null;
  return seconds
    ? `Bạn thao tác quá nhanh. Vui lòng thử lại sau ${seconds} giây.`
    : "Bạn thao tác quá nhanh. Vui lòng thử lại sau ít phút.";
}

/** "Đồng ý và bắt đầu" could not record the acceptance (ASSUMED consent route). */
export const CONSENT_NOT_RECORDED_MESSAGE = "Chưa ghi nhận được sự đồng ý. Kiểm tra kết nối rồi thử lại.";

export function loadAttemptErrorMessage(error: unknown): string {
  if (!isApiError(error)) return "Không tải được khảo sát. Vui lòng thử lại.";
  if (error.kind === "network") return NETWORK;
  if (error.status === 404) return "Không tìm thấy lượt làm khảo sát này.";
  if (error.code === "PUBLIC_FORM_ACCESS_DISABLED") return "Khảo sát này chưa mở cho bạn làm trong Rescom.";
  return "Không tải được khảo sát. Vui lòng thử lại.";
}

const SUBMIT_MESSAGES: Record<string, string> = {
  INVALID_FORM_SUBMISSION: "Một số câu trả lời chưa hợp lệ. Hãy kiểm tra lại các câu được đánh dấu.",
  RESPONSE_NOT_FOUND: "Không tìm thấy lượt làm này. Hãy mở lại khảo sát từ trang Khám phá.",
  SURVEY_ALREADY_COMPLETED: "Bài này đã được nộp trước đó.",
  SURVEY_NOT_AVAILABLE: "Khảo sát đã đóng, bài chưa được ghi nhận.",
};

export function submitSurveyErrorMessage(error: unknown): string {
  if (!isApiError(error)) return "Chưa gửi được bài. Vui lòng thử lại.";
  if (error.code === "PARTICIPATION_RATE_LIMITED" || error.status === 429) return rateLimited(error);
  return (error.code && SUBMIT_MESSAGES[error.code]) || "Chưa gửi được bài. Vui lòng thử lại.";
}

/** No response at all (offline, DNS…): Figma 4b "Chưa gửi được bài" with local save. */
export function isOfflineFailure(error: unknown): boolean {
  return isApiError(error) && error.kind === "network";
}

export function isAttemptExpiredError(error: unknown): boolean {
  return isApiError(error) && error.code === "ATTEMPT_EXPIRED";
}

/** Seconds left on the time barrier from a 422 `SUBMISSION_TOO_FAST`, or null for other errors. */
export function timeBarrierRemainingSeconds(error: unknown): number | null {
  if (!isApiError(error) || error.code !== "SUBMISSION_TOO_FAST") return null;
  const details = timeBarrierRejectionDetailsSchema.safeParse(error.details);
  if (details.success) return details.data.remainingSeconds;
  return error.retryAfterSeconds ?? 1;
}

/** Block errors from a 400 `INVALID_FORM_SUBMISSION` (`details` = message by block id). */
export function invalidBlockIds(error: unknown): string[] {
  if (!isApiError(error) || error.code !== "INVALID_FORM_SUBMISSION") return [];
  const details = error.details;
  if (typeof details !== "object" || details === null || Array.isArray(details)) return [];
  return Object.keys(details);
}

export function feedbackErrorMessage(error: unknown): string {
  if (error instanceof Error && (error as { code?: unknown }).code === "VALIDATION_ERROR") return error.message;
  if (isApiError(error)) {
    if (error.kind === "network") return NETWORK;
    if (error.code && SURVEY_FEEDBACK_ERROR_MESSAGES[error.code]) return SURVEY_FEEDBACK_ERROR_MESSAGES[error.code];
  }
  return "Không gửi được đánh giá. Vui lòng thử lại.";
}
