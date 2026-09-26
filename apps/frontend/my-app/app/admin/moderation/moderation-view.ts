import type { ModerationApiError } from "./moderation-api";

/**
 * Pure, testable view helpers for the Admin Moderation Dashboard (Story 8.1,
 * Epic 8 code-review patches P8/P9). Kept separate from `page.tsx` so they
 * can be exercised with `node --test` without React.
 */

/**
 * Last valid queue page start for `total` items at `pageSize` (never
 * negative). Used to recover when deciding the last item on a later page
 * would otherwise leave the Admin looking at an "empty queue" page that is
 * simply past the end of the (now shorter) list.
 */
export function clampQueueOffset(offset: number, total: number, pageSize: number): number {
  if (total <= 0) return 0;
  const lastPageStart = Math.floor((total - 1) / pageSize) * pageSize;
  return Math.max(0, Math.min(offset, lastPageStart));
}

/**
 * Decision E8-D2 (option A): rejecting a re-submission (a new version of a
 * survey that was already live) closes the WHOLE survey for good — the
 * previously approved version leaves the Marketplace too and the survey can
 * never be reopened. The dashboard shows this warning before the Admin
 * rejects. `null` for a first submission (rejecting it only closes that
 * submission).
 */
export function describeRejectionImpact(survey: {
  isResubmission: boolean;
  versionNumber: number;
}): string | null {
  if (!survey.isResubmission) return null;
  const previous =
    survey.versionNumber > 1 ? ` (v${survey.versionNumber - 1})` : "";
  return `Đây là phiên bản chỉnh sửa v${survey.versionNumber} của một khảo sát đã từng được duyệt. Từ chối sẽ đóng vĩnh viễn toàn bộ khảo sát — kể cả phiên bản đã duyệt trước đó${previous} — và người đăng không thể mở lại. Toàn bộ điểm ký quỹ còn giữ sẽ được hoàn lại.`;
}

function extractShortfall(details: unknown): number | null {
  if (details && typeof details === "object" && "shortfall" in details) {
    const value = (details as { shortfall?: unknown }).shortfall;
    return typeof value === "number" ? value : null;
  }
  return null;
}

/**
 * Friendly Vietnamese copy for a moderation API failure. The default case
 * always returns the caller-supplied `fallback` — never the raw (English)
 * `error.message` from the backend or a network failure (Epic 8 review P9).
 */
export function describeModerationError(error: unknown, fallback: string): string {
  const apiError = error as ModerationApiError | null;

  if (apiError?.status === 401) {
    return "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập bằng tài khoản quản trị.";
  }
  if (apiError?.status === 403) {
    if (apiError.code === "MODERATION_SELF_REVIEW_FORBIDDEN") {
      return "Bạn không thể tự kiểm duyệt khảo sát do chính mình đăng.";
    }
    if (apiError.code === "MODERATION_ADMIN_CAPABILITY_REQUIRED") {
      return "Tài khoản quản trị của bạn không còn hoạt động. Vui lòng đăng nhập lại.";
    }
    return "Bạn không có quyền kiểm duyệt khảo sát.";
  }

  switch (apiError?.code) {
    case "MODERATION_VERSION_MISMATCH":
      return "Phiên bản khảo sát đã thay đổi. Hãy tải lại bản xem trước rồi quyết định lại.";
    case "MODERATION_ALREADY_DECIDED":
    case "FORM_NOT_IN_MODERATION_QUEUE":
      return "Khảo sát này đã được xử lý hoặc không còn trong hàng chờ.";
    case "INVALID_MODERATION_REQUEST":
    case "MODERATION_INVALID_REQUEST":
    case "VALIDATION_ERROR":
      return "Yêu cầu không hợp lệ. Vui lòng tải lại trang.";
    case "FORM_NOT_FOUND":
      return "Không tìm thấy khảo sát này. Có thể khảo sát đã bị xoá.";
    case "MODERATION_ESCROW_NOT_FUNDED": {
      const shortfall = extractShortfall(apiError?.details);
      return shortfall !== null
        ? `Khảo sát chưa được ký quỹ đủ: còn thiếu ${shortfall} điểm. Không thể duyệt — hãy từ chối để hoàn phần ký quỹ hiện có.`
        : "Khảo sát chưa được ký quỹ đủ. Không thể duyệt — hãy từ chối để hoàn phần ký quỹ hiện có.";
    }
    case "FORM_VALIDATION_ERROR":
    case "EXTERNAL_COMPLETION_CODE_REQUIRED":
      return "Khảo sát không đạt điều kiện xuất bản (thiếu thông tin bắt buộc hoặc đường dẫn không hợp lệ). Hãy từ chối và yêu cầu người đăng chỉnh sửa.";
    default:
      break;
  }

  if (error instanceof TypeError) {
    return "Không thể kết nối máy chủ. Vui lòng thử lại.";
  }

  return fallback;
}
