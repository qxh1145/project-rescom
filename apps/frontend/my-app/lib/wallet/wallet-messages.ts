import { TOP_UP_MAX_PENDING_REQUESTS } from "@rescom/schemas";
import { isApiError } from "../api/api-error.ts";

/** Vietnamese copy for the wallet and top-up screens (codes: backend `economy.exceptions.ts`). */

const NETWORK = "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.";

export function walletLoadErrorMessage(error: unknown): string {
  if (isApiError(error) && error.kind === "network") return NETWORK;
  return "Không tải được Ví điểm. Vui lòng thử lại.";
}

/** "Tải thêm" of the history failed; the rows already shown stay (ASSUMED (design) copy). */
export const WALLET_LOAD_MORE_FAILED = "Không tải thêm được giao dịch. Vui lòng thử lại.";

const CREATE_MESSAGES: Record<string, string> = {
  TOPUP_PENDING_LIMIT_REACHED: `Bạn đang có ${TOP_UP_MAX_PENDING_REQUESTS} yêu cầu nạp chờ duyệt. Hãy chuyển khoản cho yêu cầu đang chờ hoặc đợi Admin xử lý.`,
  TOPUP_INVALID_REQUEST: "Số điểm nạp chưa hợp lệ. Kiểm tra lại rồi thử lại.",
  VALIDATION_ERROR: "Số điểm nạp chưa hợp lệ. Kiểm tra lại rồi thử lại.",
  TOPUP_REFERENCE_CONFLICT: "Chưa tạo được nội dung chuyển khoản. Vui lòng thử lại.",
};

export function createTopUpErrorMessage(error: unknown): string {
  if (!isApiError(error)) return "Chưa tạo được yêu cầu nạp. Vui lòng thử lại.";
  if (error.kind === "network") return NETWORK;
  if (error.status === 429) return "Bạn thao tác quá nhanh. Vui lòng thử lại sau ít phút.";
  return (error.code && CREATE_MESSAGES[error.code]) || "Chưa tạo được yêu cầu nạp. Vui lòng thử lại.";
}

export function isPendingLimitError(error: unknown): boolean {
  return isApiError(error) && error.code === "TOPUP_PENDING_LIMIT_REACHED";
}

export function loadTopUpErrorMessage(error: unknown): string {
  if (!isApiError(error)) return "Không tải được yêu cầu nạp. Vui lòng thử lại.";
  if (error.kind === "network") return NETWORK;
  if (error.code === "TOPUP_NOT_FOUND" || error.status === 404) {
    return "Không tìm thấy yêu cầu nạp này. Có thể nó thuộc tài khoản khác hoặc đã quá cũ.";
  }
  return "Không tải được yêu cầu nạp. Vui lòng thử lại.";
}

export const COPY_FAILED_MESSAGE = "Không sao chép được tự động. Hãy chọn và chép thủ công.";
