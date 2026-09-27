import { isApiError } from "../api/api-error.ts";

/** Vietnamese copy for Form Builder errors (codes: `form.exceptions.ts`, economy, ASSUMED AI routes). */

const NETWORK = "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.";

export function loadFormErrorMessage(error: unknown): string {
  if (!isApiError(error)) return "Không tải được form. Vui lòng thử lại.";
  if (error.kind === "network") return NETWORK;
  if (error.status === 404 || error.code === "FORM_NOT_FOUND") return "Không tìm thấy khảo sát này.";
  if (error.status === 403 || error.code === "FORM_FORBIDDEN") return "Bạn không có quyền sửa khảo sát này.";
  return "Không tải được form. Vui lòng thử lại.";
}

export function createDraftErrorMessage(error: unknown): string {
  if (isApiError(error) && error.kind === "network") return NETWORK;
  return "Chưa tạo được bản nháp. Vui lòng thử lại.";
}

export function saveDraftErrorMessage(error: unknown): string {
  if (!isApiError(error)) return "Chưa lưu được bản nháp.";
  if (error.kind === "network") return "Mất kết nối. Thay đổi được giữ trên máy này và sẽ lưu khi có mạng.";
  if (error.code === "FORM_EDIT_CONFLICT") return "Form vừa được sửa ở tab hoặc thiết bị khác.";
  if (error.code === "FORM_NOT_IN_DRAFT_STATUS" || error.code === "FORM_PUBLISHED_FIELDS_IMMUTABLE") {
    return "Khảo sát đã gửi duyệt nên không sửa được nữa. Muốn sửa, hãy tạo phiên bản mới.";
  }
  if (error.status === 400) return "Một số câu hỏi chưa hợp lệ nên chưa lưu được.";
  return "Chưa lưu được bản nháp.";
}

const PUBLISH_MESSAGES: Record<string, string> = {
  PRICING_REWARD_OUT_OF_BAND: "Số điểm mỗi lượt nằm ngoài khung giá của thời lượng này.",
  INSUFFICIENT_BALANCE: "Số điểm khả dụng không đủ để ký quỹ. Hãy nạp thêm điểm hoặc giảm số mẫu.",
  INSUFFICIENT_ESCROW_BALANCE: "Số điểm khả dụng không đủ để ký quỹ. Hãy nạp thêm điểm hoặc giảm số mẫu.",
  FORM_NOT_IN_DRAFT_STATUS: "Khảo sát này đã được gửi duyệt.",
  FORM_ALREADY_PUBLISHED: "Khảo sát này đã được đăng.",
  INVALID_FORM_DRAFT: "Form chưa hợp lệ để gửi duyệt. Hãy kiểm tra lại các câu hỏi.",
  VALIDATION_ERROR: "Thông tin gửi duyệt chưa hợp lệ.",
  FORM_EDIT_CONFLICT: "Form vừa được sửa ở nơi khác. Tải lại rồi thử lần nữa.",
  TARGETING_VALIDATION_ERROR: "Thiết lập đối tượng chưa hợp lệ.",
};

export function publishErrorMessage(error: unknown): string {
  if (!isApiError(error)) return "Chưa gửi duyệt được. Vui lòng thử lại.";
  if (error.kind === "network") return NETWORK;
  return (error.code && PUBLISH_MESSAGES[error.code]) || "Chưa gửi duyệt được. Vui lòng thử lại.";
}

export function aiErrorMessage(error: unknown): string {
  if (!isApiError(error)) return "Trợ lý chưa phản hồi. Bạn vẫn có thể soạn tay bình thường.";
  if (error.kind === "network") return NETWORK;
  if (error.status === 429) return "Bạn gửi yêu cầu hơi nhanh. Thử lại sau ít phút.";
  if (error.status === 404 || error.status === 501) return "Tính năng soạn bằng AI chưa sẵn sàng. Bạn vẫn có thể soạn tay.";
  return "Trợ lý chưa phản hồi. Bạn vẫn có thể soạn tay bình thường.";
}

export const PENDING_ATTENTION_BLOCKER = "Hãy xác nhận hoặc bỏ các gợi ý kiểm tra chú ý của AI trước khi tiếp tục.";
