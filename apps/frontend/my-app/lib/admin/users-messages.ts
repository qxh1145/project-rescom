import { isApiError } from "../api/api-error.ts";

/** Vietnamese copy for Admin · Người dùng (codes: backend `user-admin.exceptions.ts`). */

const NETWORK = "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.";

export function usersLoadErrorMessage(error: unknown): string {
  if (isApiError(error) && error.kind === "network") return NETWORK;
  return "Không tải được danh sách người dùng. Vui lòng thử lại.";
}

export function userDetailErrorMessage(error: unknown): string {
  if (!isApiError(error)) return "Không tải được hồ sơ người dùng. Vui lòng thử lại.";
  if (error.kind === "network") return NETWORK;
  if (error.code === "USER_NOT_FOUND" || error.status === 404 || error.code === "VALIDATION_ERROR") {
    return "Không tìm thấy người dùng này. Có thể mã trong đường dẫn không đúng.";
  }
  return "Không tải được hồ sơ người dùng. Vui lòng thử lại.";
}

const ACTION_MESSAGES: Record<string, string> = {
  CANNOT_LOCK_SELF: "Admin không thể tự khoá tài khoản của mình.",
  CANNOT_LOCK_LAST_ADMIN: "Không thể khoá Admin duy nhất còn hoạt động.",
  CANNOT_DEMOTE_SELF: "Admin không thể tự đổi vai trò của mình.",
  CANNOT_DEMOTE_LAST_ADMIN: "Không thể hạ vai trò của Admin duy nhất còn hoạt động.",
  USER_ADMIN_ACTOR_NOT_ACTIVE_ADMIN: "Tài khoản của bạn không còn quyền Admin. Hãy đăng nhập lại.",
  USER_NOT_FOUND: "Không tìm thấy người dùng này. Có thể tài khoản đã bị xoá.",
  VALIDATION_ERROR: "Thông tin gửi đi chưa hợp lệ. Kiểm tra lại rồi thử lại.",
};

export function userActionErrorMessage(error: unknown, action: "lock" | "unlock" | "role"): string {
  const fallback =
    action === "lock"
      ? "Chưa khoá được tài khoản. Vui lòng thử lại."
      : action === "unlock"
        ? "Chưa mở khoá được tài khoản. Vui lòng thử lại."
        : "Chưa đổi được vai trò. Vui lòng thử lại.";
  if (!isApiError(error)) return fallback;
  if (error.kind === "network") return NETWORK;
  if (error.status === 429) return "Bạn thao tác quá nhanh. Vui lòng thử lại sau ít phút.";
  return (error.code && ACTION_MESSAGES[error.code]) || fallback;
}
