import { isApiError } from "../api/api-error.ts";

/** Vietnamese copy of the Admin ledger operations panel (Story 14.4). */

const NETWORK = "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.";
const FALLBACK = "Thao tác chưa thực hiện được. Vui lòng thử lại.";
const ESCROW_SHORT = "Ký quỹ của khảo sát không đủ để trả thưởng.";

/** Codes of `ledger.controller.ts` / `admin-reward-redrive.controller.ts` (`http-exception.filter.ts`). */
const MESSAGES: Record<string, string> = {
  ACCOUNT_NOT_FOUND: "Không tìm thấy tài khoản sổ cái này.",
  RESPONSE_NOT_FOUND: "Không tìm thấy bài trả lời với mã này.",
  SURVEY_NOT_AVAILABLE: "Không tìm thấy lượt làm hoặc khảo sát với mã này.",
  ATTEMPT_NOT_EXTERNAL: "Lượt làm này không thuộc khảo sát Google Forms.",
  REWARD_NOT_SETTLEABLE:
    "Mục này chưa đủ điều kiện trả thưởng (chưa nộp / chưa hoàn thành hoặc không có yêu cầu thưởng).",
  SURVEY_REWARD_UNAVAILABLE: ESCROW_SHORT,
  INSUFFICIENT_ESCROW_BALANCE: ESCROW_SHORT,
  LEDGER_COMMAND_IN_PROGRESS: "Một thao tác khác trên sổ cái đang chạy. Thử lại sau vài giây.",
  INVALID_LEDGER_OPERATION: "Không tiếp tục được lượt trước. Chạy lại từ đầu.",
  VALIDATION_ERROR: "Dữ liệu gửi lên không hợp lệ.",
};

export function ledgerOpsErrorMessage(error: unknown): string {
  if (!isApiError(error)) return FALLBACK;
  if (error.kind === "network") return NETWORK;
  if (error.status === 403) return "Tài khoản của bạn không có quyền thực hiện thao tác vận hành.";
  return (error.code && MESSAGES[error.code]) || FALLBACK;
}
