import { isApiError } from "../api/api-error.ts";

/** Vietnamese copy of the admin "Tổng quan" (ASSUMED (design) — not drawn). */

export function overviewLoadErrorMessage(error: unknown): string {
  if (isApiError(error) && error.kind === "network") {
    return "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.";
  }
  if (isApiError(error) && error.status === 403) return "Tài khoản này không có quyền quản trị.";
  return "Không tải được số liệu tổng quan. Vui lòng thử lại.";
}

export const OVERVIEW_TODO_EMPTY = "Không còn việc nào đang chờ. Các hàng chờ đều trống.";
/** The card lists every account with a FraudLog entry in the last 14 days ("Lặp lại" marks repeat offenders). */
export const OVERVIEW_FLAGGED_EMPTY = "Không có tài khoản nào ghi nhận vi phạm trong 14 ngày qua.";
