import {
  addBusinessDays,
  businessDaysUntil,
  TOP_UP_REFUND_NOTE_MAX,
  type PayosTopUpDto,
  type TopUpRefundIneligibleReason,
  type TopUpRefundReason,
  type TopUpRefundUnavailableReason,
  type UserTopUpRefundDestinationView,
  type UserTopUpRefundRequest,
} from "@rescom/schemas";
import type { TimelineStep } from "./top-up.ts";

/**
 * Pure refund rules and presentation helpers (Story 13.11, Task 3).
 * Node-testable with relative imports.
 */

export const REFUND_REASON_OPTIONS = [
  { value: "WRONG_AMOUNT", label: "Nạp nhầm số tiền" },
  { value: "WRONG_ACCOUNT", label: "Nạp nhầm tài khoản Rescom" },
  { value: "NO_LONGER_NEEDED", label: "Không còn nhu cầu dùng Điểm" },
  { value: "OTHER", label: "Lý do khác" },
] as const;

export function refundReasonLabel(reason: TopUpRefundReason | string): string {
  const option = REFUND_REASON_OPTIONS.find((opt) => opt.value === reason);
  return option?.label ?? reason;
}

export function refundCountdownLabel(
  deadline: Date | string,
  now: Date = new Date(),
): string | null {
  const deadlineTime = typeof deadline === "string" ? new Date(deadline).getTime() : deadline.getTime();
  const nowTime = now.getTime();
  const diffMs = deadlineTime - nowTime;

  if (diffMs <= 0) return null;

  const hours = Math.floor(diffMs / (60 * 60 * 1000));
  if (hours >= 1) {
    return `Còn ${hours} giờ`;
  }

  const minutes = Math.max(1, Math.ceil(diffMs / (60 * 1000)));
  return `Còn ${minutes} phút`;
}

export type RefundSectionView =
  | { kind: "hidden" }
  | { kind: "available"; deadline: Date; countdown: string }
  | { kind: "unavailable"; reason: TopUpRefundUnavailableReason }
  | { kind: "request"; request: UserTopUpRefundRequest };

export function refundSectionView(
  topUp: Pick<PayosTopUpDto, "status" | "refund" | "refundDeadline">,
  now: Date = new Date(),
): RefundSectionView {
  if (topUp.refund?.request) {
    return { kind: "request", request: topUp.refund.request };
  }

  if (topUp.refund?.canRequest && topUp.refundDeadline) {
    const deadline = new Date(topUp.refundDeadline);
    if (now.getTime() < deadline.getTime()) {
      const countdown = refundCountdownLabel(deadline, now);
      if (countdown) {
        return { kind: "available", deadline, countdown };
      }
    }
    return { kind: "unavailable", reason: "DEADLINE_PASSED" };
  }

  if (topUp.refund?.unavailableReason) {
    if (topUp.refund.unavailableReason === "NOT_SUCCESSFUL") {
      return { kind: "hidden" };
    }
    return { kind: "unavailable", reason: topUp.refund.unavailableReason };
  }

  if (topUp.status !== "SUCCESSFUL") {
    return { kind: "hidden" };
  }

  return { kind: "unavailable", reason: "DEADLINE_PASSED" };
}

export interface RefundFormValidationSuccess {
  ok: true;
  value: {
    reason: TopUpRefundReason;
    note: string;
  };
}

export interface RefundFormValidationFailure {
  ok: false;
  errors: {
    reason?: string;
    note?: string;
  };
}

export type RefundFormValidationResult =
  | RefundFormValidationSuccess
  | RefundFormValidationFailure;

export function validateRefundForm(input: {
  reason?: string | null;
  note?: string | null;
}): RefundFormValidationResult {
  const errors: { reason?: string; note?: string } = {};

  const validReasons: Set<string> = new Set(REFUND_REASON_OPTIONS.map((o) => o.value));
  if (!input.reason || !validReasons.has(input.reason)) {
    errors.reason = "Chọn một lý do hoàn tiền.";
  }

  const trimmedNote = (input.note ?? "").trim();
  if (trimmedNote.length === 0) {
    errors.note = "Nhập ghi chú cho Admin (tối đa 300 ký tự).";
  } else if (trimmedNote.length > TOP_UP_REFUND_NOTE_MAX) {
    const over = trimmedNote.length - TOP_UP_REFUND_NOTE_MAX;
    errors.note = `Tối đa 300 ký tự — hãy rút gọn ${over} ký tự.`;
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      reason: input.reason as TopUpRefundReason,
      note: trimmedNote,
    },
  };
}

export interface RefundDestinationLabelInfo {
  verified: boolean;
  bank: string;
  accountNumber: string | null;
  holder: string | null;
}

export function refundDestinationLabel(
  destination: UserTopUpRefundDestinationView | null | undefined,
): RefundDestinationLabelInfo {
  const bank =
    destination?.bankName ??
    (destination?.bankId ? `Mã ngân hàng ${destination.bankId}` : "Ngân hàng");

  const accountNumber = destination?.accountNumber ?? null;
  const verified = Boolean(destination?.verified && accountNumber);
  const holder = destination?.holderName ?? null;

  return {
    verified,
    bank,
    accountNumber,
    holder,
  };
}

export function refundDueDate(submittedAt: Date | string): Date {
  const subDate = typeof submittedAt === "string" ? new Date(submittedAt) : submittedAt;
  return addBusinessDays(subDate, 3);
}

export function refundDueLabel(
  submittedAt: Date | string,
  now: Date = new Date(),
): string {
  const due = refundDueDate(submittedAt);
  const days = businessDaysUntil(now, due);
  if (days <= 0 || now.getTime() >= due.getTime()) {
    return "Quá hạn";
  }
  return `còn ${days} ngày làm việc`;
}

export function formatVietnamDateTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const formatter = new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return formatter.format(d).replace(",", "");
}

export function formatVietnamDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const formatter = new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  return formatter.format(d);
}

export function refundUnavailableCopy(
  reason: TopUpRefundUnavailableReason | string,
  ctx?: { paidAt?: Date | string | null },
): string {
  switch (reason) {
    case "DEADLINE_PASSED":
      if (ctx?.paidAt) {
        return `Đã quá 24 giờ kể từ lúc nạp (${formatVietnamDateTime(ctx.paidAt)}), giao dịch này không thể hoàn tiền.`;
      }
      return "Đã quá 24 giờ kể từ lúc nạp, giao dịch này không thể hoàn tiền.";
    case "LEGACY_MANUAL":
      return "Giao dịch nạp thủ công cũ (chuyển khoản + Admin duyệt) đã ngừng và không hoàn tiền được. Giao dịch chỉ còn để tra cứu.";
    case "MISMATCH_CREDITED":
      return "Giao dịch này đã được cộng Điểm theo số tiền thực nhận nên không thể yêu cầu hoàn tiền trong ứng dụng. Phần lẻ dưới 200đ không được quy đổi.";
    case "WITHDRAWN":
      return "Bạn đã rút yêu cầu hoàn tiền. Giao dịch này không thể yêu cầu hoàn tiền nữa.";
    case "ALREADY_REQUESTED":
      return "Giao dịch này đã có yêu cầu hoàn tiền.";
    case "NOT_SUCCESSFUL":
      return "";
    default:
      return "Giao dịch này không thể yêu cầu hoàn tiền.";
  }
}

export function ineligibleCopy(reason: TopUpRefundIneligibleReason | string): string {
  switch (reason) {
    case "SPENT_SINCE_TOP_UP":
      return "Đã ghi nhận yêu cầu nhưng không đủ điều kiện hoàn tiền vì bạn đã sử dụng Điểm (đăng/mở lại khảo sát hoặc đổi voucher) sau khi nạp. Một lần đổi voucher thất bại đã được hoàn Điểm vẫn được tính là đã sử dụng. Admin sẽ phản hồi.";
    case "INSUFFICIENT_AVAILABLE":
      return "Đã ghi nhận yêu cầu nhưng không đủ điều kiện hoàn tiền vì Điểm khả dụng hiện ít hơn số Điểm của giao dịch. Admin sẽ phản hồi.";
    default:
      return "Đã ghi nhận yêu cầu nhưng không đủ điều kiện hoàn tiền. Admin sẽ phản hồi.";
  }
}

export function refundTimelineSteps(request: UserTopUpRefundRequest): TimelineStep[] {
  const steps: TimelineStep[] = [];

  const isEligible = request.eligibility === "ELIGIBLE";
  steps.push({
    title: "Gửi yêu cầu hoàn tiền",
    detail: isEligible ? "Đủ điều kiện hoàn tiền" : "Không đủ điều kiện hoàn tiền",
    state: "done",
  });

  switch (request.status) {
    case "REQUESTED":
      steps.push({
        title: isEligible ? "Chờ Admin chuyển khoản" : "Chờ Admin phản hồi",
        detail: "Tối đa 3 ngày làm việc",
        state: "current",
      });
      break;
    case "REFUNDED":
      steps.push({
        title: "Admin đã chuyển khoản hoàn tiền",
        detail: request.bankTransferReference
          ? `Mã GD: ${request.bankTransferReference}`
          : "Đã hoàn tiền về tài khoản",
        state: "done",
      });
      break;
    case "REJECTED":
      steps.push({
        title: "Admin từ chối hoàn tiền",
        detail: request.rejectionReason ?? "Yêu cầu không được duyệt",
        state: "failed",
      });
      break;
    case "WITHDRAWN":
      steps.push({
        title: "Đã rút yêu cầu",
        detail: "Người dùng đã rút yêu cầu hoàn tiền",
        state: "failed",
      });
      break;
  }

  return steps;
}
