import { isApiError } from "../api/api-error.ts";

/** Vietnamese copy for Khám phá errors (kept out of JSX). */
export const MARKETPLACE_MESSAGES = {
  feedFailed: "Không tải được danh sách khảo sát. Vui lòng thử lại.",
  feedOffline: "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.",
  retry: "Thử lại",
} as const;

export function feedErrorMessage(error: unknown): string {
  return isApiError(error) && error.kind === "network" ? MARKETPLACE_MESSAGES.feedOffline : MARKETPLACE_MESSAGES.feedFailed;
}
