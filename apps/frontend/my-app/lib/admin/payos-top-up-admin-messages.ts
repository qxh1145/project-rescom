import { isApiError } from "../api/api-error.ts";

export function payosAdminErrorMessage(error: unknown): string {
  // Name check: @rescom/schemas may carry its own zod copy, so instanceof is unreliable.
  if (error instanceof Error && error.name === "ZodError") {
    const issues = (error as { issues?: Array<{ message?: string; path?: Array<string | number> }> }).issues;
    if (Array.isArray(issues) && issues.some(i => i.message?.includes("366") || i.path?.includes("from") || i.path?.includes("to"))) {
      return "Khoảng ngày không hợp lệ (tối đa 366 ngày).";
    }
    return "Dữ liệu không hợp lệ. Vui lòng kiểm tra lại.";
  }
  if (!isApiError(error)) return "Không thể xử lý yêu cầu. Thử lại sau.";
  if (error.kind === "network") return "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.";
  if (error.code === "TOPUP_ADMIN_CAPABILITY_REQUIRED") return "Bạn không có quyền xử lý giao dịch này.";
  if (error.status === 403) return "Bạn không có quyền thực hiện thao tác này.";
  switch (error.code) {
    case "TOPUP_MISMATCH_AMOUNT_CHANGED": return "Số tiền thực nhận vừa thay đổi. Đã tải lại — kiểm tra rồi xử lý lại.";
    case "TOPUP_MISMATCH_ALREADY_RESOLVED": return "Giao dịch đã được xử lý (có thể payOS vừa xác nhận đủ tiền).";
    case "TOPUP_MISMATCH_NOTHING_TO_CREDIT": return "Số tiền thực nhận chưa đủ quy đổi thành 1 Điểm.";
    case "TOPUP_PROVIDER_UNAVAILABLE": return "Không kết nối được payOS. Thử lại sau.";
    case "TOPUP_NOT_FOUND": return "Không tìm thấy giao dịch này.";
    case "TOPUP_EXPORT_TOO_LARGE": {
      const maxRows = (error.details as { maxRows?: number } | undefined)?.maxRows ?? 10000;
      return `Quá ${maxRows} giao dịch — thu hẹp khoảng ngày.`;
    }
    case "VALIDATION_ERROR": {
      const details = error.details as { issues?: Array<{ message?: string; path?: Array<string | number> }> } | undefined;
      if (details?.issues?.some(i => i.message?.includes("366") || i.path?.includes("from") || i.path?.includes("to"))) {
        return "Khoảng ngày không hợp lệ (tối đa 366 ngày).";
      }
      return "Dữ liệu không hợp lệ. Vui lòng kiểm tra lại.";
    }
    default: return "Không thể xử lý yêu cầu. Thử lại sau.";
  }
}
