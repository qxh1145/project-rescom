import { isApiError } from "../api/api-error.ts";

/** Vietnamese copy of the admin ledger view (Figma 11f). */

const NETWORK = "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.";

export function transactionsLoadErrorMessage(error: unknown): string {
  if (isApiError(error) && error.kind === "network") return NETWORK;
  if (isApiError(error) && error.status === 403) return "Tài khoản của bạn không có quyền xem sổ giao dịch.";
  if (isApiError(error) && (error.status === 404 || error.status === 501)) {
    return "Máy chủ chưa hỗ trợ xem sổ giao dịch.";
  }
  return "Không tải được giao dịch. Vui lòng thử lại.";
}

export function summaryLoadErrorMessage(error: unknown): string {
  if (isApiError(error) && error.kind === "network") return NETWORK;
  return "Không tải được số liệu tổng hợp. Vui lòng thử lại.";
}

export const TRANSACTIONS_LOAD_MORE_FAILED = "Không tải thêm được giao dịch. Vui lòng thử lại.";
