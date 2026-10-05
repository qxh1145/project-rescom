import { isApiError } from "../api/api-error.ts";

/** Vietnamese copy of the admin top-up queue (codes: backend `economy.exceptions.ts`). */

const NETWORK = "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.";

export function topUpQueueLoadErrorMessage(error: unknown): string {
  if (isApiError(error) && error.kind === "network") return NETWORK;
  if (isApiError(error) && error.status === 403) return "Tài khoản của bạn không có quyền xem hàng đợi nạp điểm.";
  return "Không tải được danh sách yêu cầu nạp. Vui lòng thử lại.";
}

const REVIEW_MESSAGES: Record<string, string> = {
  TOPUP_NOT_FOUND: "Không tìm thấy yêu cầu nạp này. Danh sách đã được tải lại.",
  TOPUP_ALREADY_REVIEWED: "Yêu cầu này vừa được xử lý (có thể bởi admin khác). Danh sách đã được tải lại.",
  TOPUP_SELF_REVIEW_FORBIDDEN: "Bạn không thể tự duyệt yêu cầu nạp của chính mình.",
  TOPUP_ADMIN_CAPABILITY_REQUIRED: "Quyền admin của bạn không còn hiệu lực. Hãy đăng nhập lại.",
  FORBIDDEN: "Tài khoản của bạn không có quyền duyệt nạp điểm.",
  // The code `RolesGuard` actually sends for a non-admin (`auth.exceptions.ts`).
  FORBIDDEN_RESOURCE: "Tài khoản của bạn không có quyền duyệt nạp điểm.",
  TOPUP_INVALID_REQUEST: "Lý do từ chối chưa hợp lệ (5–500 ký tự).",
  VALIDATION_ERROR: "Lý do từ chối chưa hợp lệ (5–500 ký tự).",
};

export function topUpReviewErrorMessage(error: unknown, action: "approve" | "reject"): string {
  const fallback = action === "approve" ? "Chưa duyệt được yêu cầu. Vui lòng thử lại." : "Chưa từ chối được yêu cầu. Vui lòng thử lại.";
  if (!isApiError(error)) return fallback;
  if (error.kind === "network") return NETWORK;
  if (error.status === 429) return "Bạn thao tác quá nhanh. Vui lòng thử lại sau ít phút.";
  return (error.code && REVIEW_MESSAGES[error.code]) || fallback;
}

/** The request changed under us: reload the queue after showing the message. */
export function isStaleReviewError(error: unknown): boolean {
  return isApiError(error) && (error.code === "TOPUP_ALREADY_REVIEWED" || error.code === "TOPUP_NOT_FOUND");
}
