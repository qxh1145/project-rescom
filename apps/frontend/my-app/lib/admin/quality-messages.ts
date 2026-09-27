import { isApiError } from "../api/api-error.ts";

/** Vietnamese copy of the admin "Xem xét chất lượng" (codes: ASSUMED contract in `quality-service.ts`). */

const NETWORK = "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.";

export function qualityLoadErrorMessage(error: unknown): string {
  if (isApiError(error) && error.kind === "network") return NETWORK;
  if (isApiError(error) && error.status === 403) return "Tài khoản này không có quyền quản trị.";
  return "Không tải được danh sách câu trả lời cần xem. Vui lòng thử lại.";
}

const DECISION_MESSAGES: Record<string, string> = {
  QUALITY_REVIEW_NOT_FOUND: "Câu trả lời này không còn trong hàng chờ. Danh sách đã được tải lại.",
  QUALITY_REVIEW_ALREADY_DECIDED: "Câu trả lời này đã có quyết định từ Admin khác. Danh sách đã được tải lại.",
  VALIDATION_ERROR: "Quyết định chưa hợp lệ. Từ chối cần ghi lý do (tối đa 500 ký tự).",
};

export function qualityDecisionErrorMessage(error: unknown): string {
  if (!isApiError(error)) return "Chưa lưu được quyết định. Vui lòng thử lại.";
  if (error.kind === "network") return NETWORK;
  if (error.status === 429) return "Bạn thao tác quá nhanh. Vui lòng thử lại sau ít phút.";
  return (error.code && DECISION_MESSAGES[error.code]) || "Chưa lưu được quyết định. Vui lòng thử lại.";
}

/** The item left the queue (decided elsewhere or gone): reload the list. */
export function isStaleReviewError(error: unknown): boolean {
  return (
    isApiError(error) && (error.code === "QUALITY_REVIEW_NOT_FOUND" || error.code === "QUALITY_REVIEW_ALREADY_DECIDED")
  );
}

export const QUALITY_EMPTY_TITLE = "Không còn câu trả lời cần xem";
export const QUALITY_EMPTY_BODY =
  "Điểm của mọi câu trả lời đang giữ đã được xét. Câu trả lời mới bị giữ theo chính sách ENFORCED sẽ hiện ở đây.";
