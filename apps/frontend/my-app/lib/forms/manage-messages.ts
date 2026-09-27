import type { SurveyFeedbackIssueTag } from "@rescom/schemas";
import { isApiError } from "../api/api-error.ts";
import type { DisputeReason } from "./manage-service.ts";

/**
 * Vietnamese copy of the page 10 screens (codes: backend
 * `form.exceptions.ts`, `economy.exceptions.ts`; dispute codes are ASSUMED).
 */

const NETWORK = "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.";

export function formsListErrorMessage(error: unknown): string {
  if (isApiError(error) && error.kind === "network") return NETWORK;
  return "Không tải được danh sách khảo sát. Vui lòng thử lại.";
}

export function formLoadErrorMessage(error: unknown): string {
  if (!isApiError(error)) return "Không tải được khảo sát. Vui lòng thử lại.";
  if (error.kind === "network") return NETWORK;
  if (error.code === "FORM_NOT_FOUND" || error.status === 404) return "Không tìm thấy khảo sát này. Có thể nó đã bị xoá.";
  if (error.code === "FORM_FORBIDDEN" || error.status === 403) return "Khảo sát này thuộc tài khoản khác.";
  return "Không tải được khảo sát. Vui lòng thử lại.";
}

export function progressErrorMessage(error: unknown): string {
  if (isApiError(error) && error.kind === "network") return NETWORK;
  return "Không tải được tiến độ khảo sát. Vui lòng thử lại.";
}

const ACTION_MESSAGES: Record<string, string> = {
  FORM_ALREADY_CLOSED: "Khảo sát đã kết thúc trước đó.",
  FORM_NOT_REOPENABLE: "Khảo sát bị Admin gỡ hoặc từ chối nên không mở lại được.",
  FORM_EDIT_CONFLICT: "Khảo sát vừa thay đổi ở nơi khác. Tải lại trang rồi thử lại.",
  FORM_FORBIDDEN: "Chỉ người tạo khảo sát mới làm được thao tác này.",
  FORM_NOT_FOUND: "Không tìm thấy khảo sát này.",
  FORM_MODERATION_REQUIRED: "Khảo sát đang chờ duyệt nên chưa đóng được.",
  INSUFFICIENT_BALANCE: "Số dư khả dụng không đủ để khoá thêm ký quỹ.",
  INSUFFICIENT_ESCROW_BALANCE: "Số dư khả dụng không đủ để khoá thêm ký quỹ.",
  FORM_VALIDATION_ERROR: "Số người trả lời thêm vượt giới hạn cho phép.",
  VALIDATION_ERROR: "Thông tin chưa hợp lệ. Kiểm tra lại rồi thử lại.",
  FORM_NOT_PUBLISHED: "Khảo sát không còn chạy.",
  // ASSUMED dispute codes (no backend route yet).
  DISPUTE_WINDOW_CLOSED: "Đã hết 48 giờ khiếu nại cho lượt làm này.",
  DISPUTE_ALREADY_OPEN: "Lượt làm này đã được khiếu nại, Admin đang xem xét.",
  ATTEMPT_NOT_DISPUTABLE: "Lượt làm này không còn khiếu nại được.",
};

/** Close / reopen / pause / dispute failures. */
export function formActionErrorMessage(error: unknown, fallback: string): string {
  if (!isApiError(error)) return fallback;
  if (error.kind === "network") return NETWORK;
  if (error.status === 429) return "Bạn thao tác quá nhanh. Vui lòng thử lại sau ít phút.";
  return (error.code && ACTION_MESSAGES[error.code]) || fallback;
}

/** Figma 10c "Vấn đề" chips. */
export const DISPUTE_REASON_LABELS: Record<DisputeReason, string> = {
  LOW_EFFORT: "Trả lời bừa",
  NO_MATCHING_RESPONSE: "Không có câu trả lời trong form",
  DUPLICATE_RESPONDENT: "Trùng người",
  OTHER: "Khác",
};

/** Figma 10a "Đánh giá từ người trả lời" rows (desktop merges the last two). */
export const FEEDBACK_ISSUE_LABELS: Record<SurveyFeedbackIssueTag, string> = {
  LONGER_THAN_ESTIMATED: "Dài hơn ước tính",
  UNCLEAR_QUESTIONS: "Câu hỏi khó hiểu",
  MISLEADING_DESCRIPTION: "Mô tả không đúng",
  TECHNICAL_ISSUE: "Lỗi kỹ thuật",
};

/** ASSUMED: at least this many characters so the Admin can judge the complaint. */
export const DISPUTE_DESCRIPTION_MIN = 10;
export const DISPUTE_DESCRIPTION_MAX = 1000;

export interface DisputeDraftErrors {
  reason?: string;
  description?: string;
}

/** Figma 10c form rules: one issue chip and a short description. */
export function validateDisputeDraft(draft: { reason: DisputeReason | null; description: string }): DisputeDraftErrors {
  const errors: DisputeDraftErrors = {};
  if (!draft.reason) errors.reason = "Chọn vấn đề của lượt làm.";
  const length = draft.description.trim().length;
  if (length < DISPUTE_DESCRIPTION_MIN) {
    errors.description = `Mô tả vấn đề ít nhất ${DISPUTE_DESCRIPTION_MIN} ký tự để Admin xem xét.`;
  } else if (length > DISPUTE_DESCRIPTION_MAX) {
    errors.description = `Mô tả tối đa ${DISPUTE_DESCRIPTION_MAX} ký tự.`;
  }
  return errors;
}
