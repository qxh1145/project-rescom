import { isApiError } from "../api/api-error.ts";

/** Vietnamese copy for the publisher results screens (10d, 10e, 17, 17a). */

const NETWORK = "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.";

/**
 * A 404 says WHAT is missing: `FORM_NOT_FOUND` (the survey, or not the
 * caller's — no existence leak), `FORM_VERSION_NOT_FOUND`, or a bare
 * `NOT_FOUND` (the route itself is missing, e.g. a backend without it), which
 * must never read as "the survey was deleted".
 */
function loadError(error: unknown, what: string): string {
  if (!isApiError(error)) return `Không tải được ${what}. Vui lòng thử lại.`;
  if (error.kind === "network") return NETWORK;
  switch (error.code) {
    case "FORM_NOT_FOUND":
      return "Không tìm thấy khảo sát này. Có thể nó đã bị xoá hoặc đường dẫn không đúng.";
    case "FORM_VERSION_NOT_FOUND":
      return "Không có phiên bản này của khảo sát.";
    case "FORM_FORBIDDEN":
      return "Bạn không có quyền xem kết quả của khảo sát này.";
    case "INVALID_CURSOR":
      return "Danh sách câu trả lời vừa thay đổi. Tải lại trang để xem bản mới nhất.";
    case "PUBLISHER_ANALYTICS_LIMIT_EXCEEDED":
      return "Phiên bản này có hơn 5.000 câu trả lời nên chưa tổng hợp được. Bạn vẫn xem từng câu trả lời hoặc xuất dữ liệu, nhưng chỉ 2.000 câu trả lời mới nhất.";
  }
  if (error.status === 403) return "Bạn không có quyền xem kết quả của khảo sát này.";
  if (error.status === 404) return `Máy chủ chưa hỗ trợ xem ${what}. Vui lòng thử lại sau.`;
  return `Không tải được ${what}. Vui lòng thử lại.`;
}

export const responsesLoadErrorMessage = (error: unknown) => loadError(error, "câu trả lời");
export const qualityLoadErrorMessage = (error: unknown) => loadError(error, "đánh giá chất lượng");
export const versionsLoadErrorMessage = (error: unknown) => loadError(error, "lịch sử phiên bản");
export const analyticsLoadErrorMessage = (error: unknown) => loadError(error, "thống kê câu trả lời");

/** Empty Tóm tắt: "Sao chép liên kết khảo sát". */
export const SURVEY_LINK_COPIED = "Đã sao chép liên kết khảo sát.";
export const SURVEY_LINK_COPY_FAILED = "Không sao chép tự động được. Hãy chọn và sao chép liên kết bên dưới.";

/** Google Forms surveys (`NOT_APPLICABLE`): the answers stay in Google. */
export const GOOGLE_FORMS_ANSWERS_NOTE =
  "Câu trả lời Google Forms nằm trong Google Forms của bạn; Rescom chỉ lưu mã hoàn thành đã xác minh.";

/** `collectFormResponses` stopped at `RESPONSES_MAX_PAGES` (Story IR.4a AC8.1). */
export const RESPONSES_TRUNCATED_NOTE = "Chỉ hiển thị 2.000 câu trả lời mới nhất.";

/** Neutral integrity tag of a response (`integrity.applicability` NOT_ASSESSED, IR.4a R8). */
export const NOT_ASSESSED_LABEL = "Chưa đánh giá chất lượng";

export const VERSION_CHANGES_LOAD_FAILED = "Không tải được các thay đổi của bản nháp.";
export const EXPORT_FAILED = "Chưa tạo được file. Vui lòng thử lại.";
