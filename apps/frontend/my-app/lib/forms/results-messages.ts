import { isApiError } from "../api/api-error.ts";
import type { ReviewReason } from "./results-service.ts";

/** Vietnamese copy for the publisher results screens (10d, 10e, 17, 17a). */

const NETWORK = "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.";

function loadError(error: unknown, what: string): string {
  if (!isApiError(error)) return `Không tải được ${what}. Vui lòng thử lại.`;
  if (error.kind === "network") return NETWORK;
  if (error.code === "FORM_NOT_FOUND" || error.status === 404) {
    return "Không tìm thấy khảo sát này. Có thể nó đã bị xoá hoặc đường dẫn không đúng.";
  }
  if (error.code === "FORM_FORBIDDEN" || error.status === 403) {
    return "Bạn không có quyền xem kết quả của khảo sát này.";
  }
  return `Không tải được ${what}. Vui lòng thử lại.`;
}

export const responsesLoadErrorMessage = (error: unknown) => loadError(error, "câu trả lời");
export const qualityLoadErrorMessage = (error: unknown) => loadError(error, "đánh giá chất lượng");
export const versionsLoadErrorMessage = (error: unknown) => loadError(error, "lịch sử phiên bản");

export const VERSION_CHANGES_LOAD_FAILED = "Không tải được các thay đổi của bản nháp.";
export const EXPORT_FAILED = "Chưa tạo được file. Vui lòng thử lại.";

/**
 * Why a response is "Cần xem lại" (a hint to check, never a fraud verdict).
 * Codes are ASSUMED (integrity policy signals).
 */
export function reviewReasonText(reason: ReviewReason): string {
  switch (reason.code) {
    case "TOO_FAST": {
      const minutes = Number(reason.params.declaredMinutes);
      return Number.isFinite(minutes) && minutes > 0 ? `nhanh hơn nhiều so với ${minutes} phút` : "làm nhanh bất thường";
    }
    case "STRAIGHT_LINING":
      return "chọn cùng một mức cho nhiều câu liên tiếp";
    case "ATTENTION_CHECK_FAILED":
      return "trả lời sai câu kiểm tra sự chú ý";
    case "LOW_EFFORT_TEXT":
      return "câu trả lời ngắn quá sơ sài";
    case "WRONG_CODE_ATTEMPTS":
      return "nhập sai mã hoàn thành nhiều lần";
    default:
      return "có dấu hiệu cần kiểm tra";
  }
}

export const REVIEW_DISCLAIMER = '"Cần xem lại" là gợi ý để bạn kiểm tra, không phải kết luận gian lận.';
