import { isApiError } from "../api/api-error.ts";

/**
 * Vietnamese error copy for PayOS top-up (Story 13.7, Task 3).
 * Error codes from backend `economy.exceptions.ts`.
 */

export const NETWORK_ERROR_MESSAGE = "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.";

export function payosCheckoutErrorMessage(error: unknown): string {
  if (!isApiError(error)) {
    return "Chưa tạo được mã thanh toán. Bạn chưa bị trừ tiền — hãy thử lại.";
  }
  if (error.kind === "network") return NETWORK_ERROR_MESSAGE;

  if (error.status === 429 || error.code === "TOPUP_CHECKOUT_RATE_LIMITED") {
    const details = error.details as { retryAfterSeconds?: number } | undefined;
    const retryAfter = details?.retryAfterSeconds;
    if (retryAfter && retryAfter > 0) {
      const minutes = Math.ceil(retryAfter / 60);
      return `Bạn thao tác quá nhanh. Vui lòng thử lại sau ${minutes} phút.`;
    }
    return "Bạn thao tác quá nhanh. Vui lòng thử lại sau ít phút.";
  }

  if (error.status === 503 || error.code === "TOPUP_PROVIDER_UNAVAILABLE") {
    return "Chưa tạo được mã thanh toán. Bạn chưa bị trừ tiền — hãy thử lại.";
  }

  if (error.code === "TOPUP_ALREADY_PROCESSING" || error.status === 409) {
    return "Bạn đang có giao dịch đang chờ thanh toán. Vui lòng hoàn tất hoặc huỷ giao dịch trước khi tạo mới.";
  }

  if (error.code === "VALIDATION_ERROR" || error.status === 400) {
    return "Số tiền nạp chưa hợp lệ. Vui lòng kiểm tra lại.";
  }

  return error.message || "Chưa tạo được mã thanh toán. Bạn chưa bị trừ tiền — hãy thử lại.";
}

export function payosCancelErrorMessage(error: unknown): string {
  if (!isApiError(error)) {
    return "Không thể huỷ giao dịch lúc này. Vui lòng thử lại.";
  }
  if (error.kind === "network") return NETWORK_ERROR_MESSAGE;

  if (error.code === "TOPUP_NOT_CANCELLABLE" || error.status === 409) {
    return "Giao dịch đã được cập nhật trạng thái mới. Đang tải lại dữ liệu...";
  }

  if (error.code === "TOPUP_NOT_FOUND" || error.status === 404) {
    return "Không tìm thấy giao dịch này.";
  }

  return error.message || "Không thể huỷ giao dịch lúc này. Vui lòng thử lại.";
}

export interface PayosRefundErrorResult {
  message: string;
  reload: boolean;
  fieldErrors?: {
    reason?: string;
    note?: string;
  };
}

function readSafeStringProperty(details: unknown, key: string): string | null {
  if (!details || typeof details !== "object") return null;
  const val = (details as Record<string, unknown>)[key];
  return typeof val === "string" ? val : null;
}

function extractRefundFieldErrors(details: unknown): { reason?: string; note?: string } | undefined {
  if (!details || typeof details !== "object") return undefined;
  let reason: string | undefined;
  let note: string | undefined;

  const issues = Array.isArray(details)
    ? details
    : Array.isArray((details as Record<string, unknown>).issues)
    ? ((details as Record<string, unknown>).issues as unknown[])
    : Array.isArray((details as Record<string, unknown>).errors)
    ? ((details as Record<string, unknown>).errors as unknown[])
    : null;

  if (issues) {
    for (const issue of issues) {
      if (issue && typeof issue === "object" && Array.isArray((issue as Record<string, unknown>).path)) {
        const path = (issue as Record<string, unknown>).path as unknown[];
        const msg = typeof (issue as Record<string, unknown>).message === "string"
          ? ((issue as Record<string, unknown>).message as string)
          : undefined;
        if (msg) {
          if (path.includes("reason") && !reason) reason = msg;
          if (path.includes("note") && !note) note = msg;
        }
      }
    }
  }

  if (!Array.isArray(details)) {
    const d = details as Record<string, unknown>;
    if (d.reason && typeof d.reason === "object" && Array.isArray((d.reason as Record<string, unknown>)._errors)) {
      const errs = (d.reason as Record<string, unknown>)._errors as unknown[];
      if (typeof errs[0] === "string") reason = errs[0];
    } else if (typeof d.reason === "string") {
      reason = d.reason;
    }

    if (d.note && typeof d.note === "object" && Array.isArray((d.note as Record<string, unknown>)._errors)) {
      const errs = (d.note as Record<string, unknown>)._errors as unknown[];
      if (typeof errs[0] === "string") note = errs[0];
    } else if (typeof d.note === "string") {
      note = d.note;
    }
  }

  if (!reason && !note) return undefined;
  return {
    ...(reason ? { reason } : {}),
    ...(note ? { note } : {}),
  };
}

export function payosRefundErrorMessage(error: unknown): PayosRefundErrorResult {
  if (!isApiError(error)) {
    return {
      message: "Không thể thực hiện yêu cầu hoàn tiền. Vui lòng thử lại.",
      reload: false,
    };
  }

  if (error.kind === "network") {
    return {
      message: NETWORK_ERROR_MESSAGE,
      reload: false,
    };
  }

  if (error.code === "REFUND_ALREADY_RESOLVED") {
    return {
      message: "Yêu cầu đã được xử lý",
      reload: true,
    };
  }

  if (error.code === "TOPUP_REFUND_ALREADY_REQUESTED") {
    return {
      message: "Giao dịch này đã có yêu cầu hoàn tiền.",
      reload: true,
    };
  }

  if (error.code === "TOPUP_REFUND_NOT_ALLOWED") {
    const reason = readSafeStringProperty(error.details, "reason");
    let message = "Giao dịch này không thể yêu cầu hoàn tiền.";
    if (reason === "DEADLINE_PASSED") {
      message = "Đã quá 24 giờ kể từ lúc nạp, giao dịch này không thể hoàn tiền.";
    } else if (reason === "LEGACY_MANUAL") {
      message = "Giao dịch nạp thủ công cũ (chuyển khoản + Admin duyệt) đã ngừng và không hoàn tiền được. Giao dịch chỉ còn để tra cứu.";
    } else if (reason === "MISMATCH_CREDITED") {
      message = "Giao dịch này đã được cộng Điểm theo số tiền thực nhận nên không thể yêu cầu hoàn tiền trong ứng dụng. Phần lẻ dưới 200đ không được quy đổi.";
    } else if (reason === "WITHDRAWN") {
      message = "Bạn đã rút yêu cầu hoàn tiền. Giao dịch này không thể yêu cầu hoàn tiền nữa.";
    } else if (reason === "ALREADY_REQUESTED") {
      message = "Giao dịch này đã có yêu cầu hoàn tiền.";
    } else if (reason === "NOT_SUCCESSFUL") {
      message = "Giao dịch này không thể hoàn tiền.";
    }
    return {
      message,
      reload: true,
    };
  }

  if (error.code === "TOPUP_NOT_FOUND" || error.code === "TOPUP_REFUND_NOT_FOUND") {
    const message =
      error.code === "TOPUP_REFUND_NOT_FOUND"
        ? "Không tìm thấy yêu cầu hoàn tiền."
        : "Không tìm thấy giao dịch này.";
    return {
      message,
      reload: true,
    };
  }

  if (error.code === "VALIDATION_ERROR" || error.status === 400) {
    const fieldErrors = extractRefundFieldErrors(error.details);
    return {
      // Server validation text is English; keep the user-facing copy fixed.
      message: "Thông tin yêu cầu hoàn tiền chưa hợp lệ. Vui lòng kiểm tra lại.",
      reload: false,
      ...(fieldErrors ? { fieldErrors } : {}),
    };
  }

  return {
    message: "Không thể thực hiện yêu cầu hoàn tiền. Vui lòng thử lại.",
    reload: false,
  };
}
