import { isApiError } from "../api/api-error.ts";
import type { RejectionDraftError } from "./moderation-view.ts";

/**
 * Vietnamese copy of "Duyệt khảo sát" (codes: backend
 * `moderation/application/exceptions/moderation.exceptions.ts`, forms and
 * economy exceptions reached through approve/reject). Never shows the raw
 * (English) backend message.
 */

const NETWORK = "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.";

export const MODERATION_LOAD_QUEUE_FAILED = "Không tải được hàng chờ duyệt khảo sát.";
export const MODERATION_LOAD_SURVEY_FAILED = "Không tải được chi tiết khảo sát.";
export const MODERATION_APPROVE_FAILED = "Chưa duyệt được khảo sát. Vui lòng thử lại.";
export const MODERATION_REJECT_FAILED = "Chưa từ chối được khảo sát. Vui lòng thử lại.";

const INELIGIBLE =
  "Khảo sát không đạt điều kiện xuất bản (thiếu thông tin bắt buộc hoặc đường dẫn không hợp lệ). Hãy từ chối và yêu cầu người đăng chỉnh sửa.";
const ALREADY_DECIDED = "Khảo sát này đã được xử lý hoặc không còn trong hàng chờ.";

const CODE_MESSAGES: Record<string, string> = {
  MODERATION_SELF_REVIEW_FORBIDDEN: "Bạn không thể tự duyệt khảo sát do chính mình đăng.",
  MODERATION_ADMIN_CAPABILITY_REQUIRED: "Tài khoản quản trị của bạn không còn hoạt động. Vui lòng đăng nhập lại.",
  FORBIDDEN: "Bạn không có quyền duyệt khảo sát.",
  MODERATION_VERSION_MISMATCH: "Người đăng vừa cập nhật khảo sát. Hãy tải lại chi tiết rồi quyết định lại.",
  MODERATION_ALREADY_DECIDED: ALREADY_DECIDED,
  FORM_NOT_IN_MODERATION_QUEUE: ALREADY_DECIDED,
  MODERATION_INVALID_REQUEST: "Yêu cầu không hợp lệ. Vui lòng tải lại trang.",
  VALIDATION_ERROR: "Yêu cầu không hợp lệ. Vui lòng tải lại trang.",
  FORM_NOT_FOUND: "Không tìm thấy khảo sát này. Có thể khảo sát đã bị xoá.",
  FORM_VALIDATION_ERROR: INELIGIBLE,
  EXTERNAL_COMPLETION_CODE_REQUIRED: INELIGIBLE,
};

function shortfallOf(details: unknown): number | null {
  if (details && typeof details === "object" && "shortfall" in details) {
    const value = (details as { shortfall?: unknown }).shortfall;
    return typeof value === "number" ? value : null;
  }
  return null;
}

/** Copy for a failed moderation request; `fallback` for anything unmapped. */
export function moderationErrorMessage(error: unknown, fallback: string): string {
  if (!isApiError(error)) return fallback;
  if (error.kind === "network") return NETWORK;
  if (error.code === "MODERATION_ESCROW_NOT_FUNDED") {
    const shortfall = shortfallOf(error.details);
    return shortfall !== null
      ? `Khảo sát chưa được ký quỹ đủ: còn thiếu ${shortfall} điểm. Không thể duyệt — hãy từ chối để hoàn phần ký quỹ hiện có.`
      : "Khảo sát chưa được ký quỹ đủ. Không thể duyệt — hãy từ chối để hoàn phần ký quỹ hiện có.";
  }
  if (error.code && CODE_MESSAGES[error.code]) return CODE_MESSAGES[error.code];
  if (error.status === 403) return CODE_MESSAGES.FORBIDDEN;
  if (error.status === 404) return CODE_MESSAGES.FORM_NOT_FOUND;
  return fallback;
}

/** The decided survey left the queue: reload instead of retrying. */
export function isStaleDecisionError(error: unknown): boolean {
  return (
    isApiError(error) &&
    (error.code === "MODERATION_ALREADY_DECIDED" ||
      error.code === "FORM_NOT_IN_MODERATION_QUEUE" ||
      error.code === "MODERATION_VERSION_MISMATCH")
  );
}

export const REJECTION_DRAFT_MESSAGES: Record<RejectionDraftError, string> = {
  reasonRequired: "Chọn lý do từ chối.",
  noteRequired: "Ghi rõ lý do để người đăng biết cần sửa gì.",
  noteTooShort: "Ghi chú quá ngắn — viết rõ hơn một chút.",
  tooLong: "Lý do quá dài — rút gọn ghi chú.",
};

/** Figma 11a checklist hint and the other reasons "Duyệt" is disabled. */
export const APPROVAL_BLOCKER_MESSAGES = {
  notQueued: null,
  targetingInvalid: "Tiêu chí đối tượng không hợp lệ nên không thể duyệt. Hãy từ chối để người đăng sửa.",
  notFunded: "Ký quỹ chưa đủ nên không thể duyệt. Hãy từ chối để hoàn phần ký quỹ hiện có.",
  checklist: "Đánh dấu đủ các mục kiểm tra để duyệt.",
} as const;

/**
 * Decision E8-D2 (option A): rejecting a re-submission (a new version of a
 * survey that was already live) closes the WHOLE survey for good. Shown in
 * the reject dialog; `null` for a first submission.
 */
export function rejectionImpactWarning(survey: { isResubmission: boolean; versionNumber: number }): string | null {
  if (!survey.isResubmission) return null;
  const previous = survey.versionNumber > 1 ? ` (v${survey.versionNumber - 1})` : "";
  return `Đây là phiên bản chỉnh sửa v${survey.versionNumber} của một khảo sát đã từng được duyệt. Từ chối sẽ đóng vĩnh viễn toàn bộ khảo sát — kể cả phiên bản đã duyệt trước đó${previous} — và người đăng không thể mở lại.`;
}

/** ASSUMED confirmation copy after a decision (not drawn in Figma). */
export function approvedNotice(title: string): string {
  return `Đã duyệt “${title}”. Khảo sát đã lên Khám phá và người đăng đã được báo.`;
}

export function rejectedNotice(title: string, refunded: number): string {
  const refund = refunded > 0 ? ` Đã hoàn ${refunded} điểm ký quỹ cho người đăng.` : "";
  return `Đã từ chối “${title}”.${refund} Người đăng đã nhận thông báo kèm lý do.`;
}
