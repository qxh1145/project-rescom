import { isApiError } from "../api/api-error.ts";

/** Vietnamese copy of the admin "Tổng quan" (ASSUMED — not drawn). */

export function overviewLoadErrorMessage(error: unknown): string {
  if (isApiError(error) && error.kind === "network") {
    return "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.";
  }
  if (isApiError(error) && error.status === 403) return "Tài khoản này không có quyền quản trị.";
  return "Không tải được số liệu tổng quan. Vui lòng thử lại.";
}

export const OVERVIEW_TODO_EMPTY = "Không còn việc nào đang chờ. Các hàng chờ đều trống.";
export const OVERVIEW_FLAGGED_EMPTY = "Chưa có tài khoản nào bị gắn cờ vi phạm lặp lại.";
