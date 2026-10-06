import { isApiError } from "../api/api-error.ts";

/**
 * Vietnamese copy for "Khiếu nại & báo lỗi" failures. Codes: ASSUMED (design) case
 * codes of `disputes-service.ts`, ledger codes of `resolveDisputeHold`
 * (`economy.exceptions.ts`), `VALIDATION_ERROR` of the VERIFIED reset route.
 */

const NETWORK = "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.";

export function disputeListErrorMessage(error: unknown): string {
  if (isApiError(error) && error.kind === "network") return NETWORK;
  if (isApiError(error) && error.status === 403) return "Chỉ Admin mới xem được hàng chờ khiếu nại.";
  return "Không tải được danh sách khiếu nại. Vui lòng thử lại.";
}

const RESOLVE_MESSAGES: Record<string, string> = {
  DISPUTE_CASE_NOT_FOUND: "Không tìm thấy mục này. Có thể nó đã được xử lý.",
  DISPUTE_CASE_ALREADY_RESOLVED: "Mục này đã được một Admin khác xử lý. Danh sách vừa được tải lại.",
  DISPUTE_OUTCOME_NOT_ALLOWED: "Cách xử lý này không áp dụng cho loại mục này.",
  DISPUTE_ATTEMPT_ALREADY_REWARDED:
    "Lượt làm này đã hoàn thành hoặc đã được cộng điểm, không cộng thêm. Danh sách vừa được tải lại.",
  DISPUTE_SURVEY_CLOSED: "Khảo sát đã đóng hoặc đã đủ mẫu, không thể cộng điểm cho lượt làm này.",
  VALIDATION_ERROR: "Lý do quyết định chưa hợp lệ. Kiểm tra lại rồi thử lại.",
  // Ledger (`resolveDisputeHold`): the hold is missing, of another amount or already resolved the other way;
  // "Cộng điểm" on a missing code: the survey escrow cannot cover the reward.
  INSUFFICIENT_BALANCE: "Điểm đang giữ hoặc ký quỹ của khảo sát không đủ để xử lý. Kiểm tra lại sổ cái.",
  // Distinct from INSUFFICIENT_BALANCE: the respondent has no held points at all (not merely short).
  DISPUTE_NO_HELD_POINTS:
    "Người làm không còn điểm đang giữ cho lượt này: không thể hoàn. Hãy bác bỏ hoặc kiểm tra sổ cái.",
  IDEMPOTENCY_CONFLICT: "Khiếu nại này đã được xử lý theo hướng khác.",
  INVALID_LEDGER_OPERATION: "Không còn điểm đang giữ cho khiếu nại này.",
  LEDGER_COMMAND_IN_PROGRESS: "Sổ cái đang xử lý một thao tác khác trên lượt làm này. Thử lại sau giây lát.",
  FORBIDDEN: "Chỉ Admin mới xử lý được khiếu nại.",
  // The code `RolesGuard` actually sends for a non-admin (`auth.exceptions.ts`).
  FORBIDDEN_RESOURCE: "Chỉ Admin mới xử lý được khiếu nại.",
};

/** Resolve / reset failures. */
export function disputeResolveErrorMessage(error: unknown): string {
  const fallback = "Chưa xử lý được. Vui lòng thử lại.";
  if (!isApiError(error)) return fallback;
  if (error.kind === "network") return NETWORK;
  if (error.status === 429) return "Bạn thao tác quá nhanh. Vui lòng thử lại sau ít phút.";
  return (error.code && RESOLVE_MESSAGES[error.code]) || fallback;
}

/** The case changed elsewhere: reload the queue after showing the message. */
export function isStaleCaseError(error: unknown): boolean {
  return (
    isApiError(error) &&
    (error.code === "DISPUTE_CASE_ALREADY_RESOLVED" ||
      error.code === "DISPUTE_CASE_NOT_FOUND" ||
      // The attempt was completed since the report: reload to show its current status.
      error.code === "DISPUTE_ATTEMPT_ALREADY_REWARDED")
  );
}
