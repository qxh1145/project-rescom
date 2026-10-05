import { isApiError } from "../api/api-error.ts";

/** Vietnamese copy for Admin · FraudLog. */

export function fraudLogLoadErrorMessage(error: unknown): string {
  if (isApiError(error) && error.kind === "network") return "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.";
  // 403 `FORBIDDEN_RESOURCE`: the backend `RolesGuard` for a non-admin.
  if (isApiError(error) && (error.status === 403 || error.code === "FORBIDDEN_RESOURCE")) {
    return "Tài khoản này không có quyền quản trị.";
  }
  if (isApiError(error) && (error.status === 404 || error.status === 501)) {
    return "FraudLog chưa có trên máy chủ này. Vui lòng thử lại sau.";
  }
  return "Không tải được FraudLog. Vui lòng thử lại.";
}

export const FRAUD_LOG_LOAD_MORE_FAILED = "Không tải thêm được FraudLog. Vui lòng thử lại.";

/** A bound cut the summary or the search (`truncated`): ask to narrow the filter. */
export const FRAUD_LOG_TRUNCATED_NOTE =
  "Kết quả quá nhiều nên phần tổng hợp chỉ tính trên các mục mới nhất — hãy thu hẹp bộ lọc (người dùng, thời gian, loại vi phạm).";

/** "12 mục", or "10 000+ mục" when the backend count hit its cap. */
export function fraudLogTotalText(page: { total: number; totalCapped: boolean }): string {
  const count = String(page.total).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${count}${page.totalCapped ? "+" : ""} mục`;
}
