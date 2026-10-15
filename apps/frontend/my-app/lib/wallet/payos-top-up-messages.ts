import { isApiError } from "../api/api-error.ts";

/**
 * Vietnamese error copy for PayOS top-up (Story 13.7, Task 3).
 * Error codes from backend `economy.exceptions.ts`.
 */

export const NETWORK_ERROR_MESSAGE = "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.";

export function payosCheckoutErrorMessage(error: unknown): string {
  if (!isApiError(error)) {
    return "Chưa tạo được mã thanh toán. Bạn chưa bị trừ tiền — hãy thử lại.";
  }
  if (error.kind === "network") return NETWORK_ERROR_MESSAGE;

  if (error.status === 429 || error.code === "TOPUP_CHECKOUT_RATE_LIMITED") {
    const details = error.details as { retryAfterSeconds?: number } | undefined;
    const retryAfter = details?.retryAfterSeconds;
    if (retryAfter && retryAfter > 0) {
      const minutes = Math.ceil(retryAfter / 60);
      return `Bạn thao tác quá nhanh. Vui lòng thử lại sau ${minutes} phút.`;
    }
    return "Bạn thao tác quá nhanh. Vui lòng thử lại sau ít phút.";
  }

  if (error.status === 503 || error.code === "TOPUP_PROVIDER_UNAVAILABLE") {
    return "Chưa tạo được mã thanh toán. Bạn chưa bị trừ tiền — hãy thử lại.";
  }

  if (error.code === "TOPUP_ALREADY_PROCESSING" || error.status === 409) {
    return "Bạn đang có giao dịch đang chờ thanh toán. Vui lòng hoàn tất hoặc huỷ giao dịch trước khi tạo mới.";
  }

  if (error.code === "VALIDATION_ERROR" || error.status === 400) {
    return "Số tiền nạp chưa hợp lệ. Vui lòng kiểm tra lại.";
  }

  return error.message || "Chưa tạo được mã thanh toán. Bạn chưa bị trừ tiền — hãy thử lại.";
}

export function payosCancelErrorMessage(error: unknown): string {
  if (!isApiError(error)) {
    return "Không thể huỷ giao dịch lúc này. Vui lòng thử lại.";
  }
  if (error.kind === "network") return NETWORK_ERROR_MESSAGE;

  if (error.code === "TOPUP_NOT_CANCELLABLE" || error.status === 409) {
    return "Giao dịch đã được cập nhật trạng thái mới. Đang tải lại dữ liệu...";
  }

  if (error.code === "TOPUP_NOT_FOUND" || error.status === 404) {
    return "Không tìm thấy giao dịch này.";
  }

  return error.message || "Không thể huỷ giao dịch lúc này. Vui lòng thử lại.";
}
