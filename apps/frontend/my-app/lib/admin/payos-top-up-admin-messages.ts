import { isApiError } from "../api/api-error.ts";

export function payosAdminErrorMessage(error: unknown): string {
  // Name check: @rescom/schemas may carry its own zod copy, so instanceof is unreliable.
  if (error instanceof Error && error.name === "ZodError") return "Khoảng ngày không hợp lệ (tối đa 366 ngày).";
  if (!isApiError(error)) return "Không thể xử lý yêu cầu. Thử lại sau.";
  if (error.kind === "network") return "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.";
  if (error.status === 403) return "Bạn không có quyền thực hiện thao tác này.";
  switch (error.code) {
    case "TOPUP_PROVIDER_UNAVAILABLE": return "Không kết nối được payOS. Thử lại sau.";
    case "TOPUP_NOT_FOUND": return "Không tìm thấy giao dịch này.";
    case "TOPUP_EXPORT_TOO_LARGE": {
      const maxRows = (error.details as { maxRows?: number } | undefined)?.maxRows ?? 10000;
      return `Quá ${maxRows} giao dịch — thu hẹp khoảng ngày.`;
    }
    case "VALIDATION_ERROR": return "Khoảng ngày không hợp lệ (tối đa 366 ngày).";
    default: return "Không thể xử lý yêu cầu. Thử lại sau.";
  }
}
