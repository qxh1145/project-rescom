import { isApiError } from "../api/api-error.ts";

/** Vietnamese copy for Admin · FraudLog. */

export function fraudLogLoadErrorMessage(error: unknown): string {
  if (isApiError(error) && error.kind === "network") return "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.";
  if (isApiError(error) && (error.status === 404 || error.status === 501)) {
    return "FraudLog chưa có trên máy chủ này. Vui lòng thử lại sau.";
  }
  return "Không tải được FraudLog. Vui lòng thử lại.";
}
