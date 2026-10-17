import {
  type TopUpRefundStatus,
  type TopUpRefundEligibility,
  type TopUpRefundReason,
  type TopUpRefundIneligibleReason,
  type AdminTopUpRefundListItem,
  type AdminTopUpRefundDetail,
  businessDaysUntil,
  TOP_UP_REFUND_REJECTION_REASON_MAX,
  TOP_UP_REFUND_BANK_REFERENCE_MAX,
} from "@rescom/schemas";
import { formatDayMonth, formatShortDateTime } from "../format/date-time.ts";

export function refundStatusBadge(status: TopUpRefundStatus): {
  label: string;
  variant: "warning" | "success" | "danger" | "neutral";
} {
  switch (status) {
    case "REQUESTED":
      return { label: "Chờ xử lý", variant: "warning" };
    case "WITHDRAWN":
      return { label: "Đã rút", variant: "neutral" };
    case "REFUNDED":
      return { label: "Đã hoàn tiền", variant: "success" };
    case "REJECTED":
      return { label: "Đã từ chối", variant: "danger" };
  }
}

export function refundEligibilityBadge(eligibility: TopUpRefundEligibility): {
  label: string;
  variant: "success" | "danger";
} {
  switch (eligibility) {
    case "ELIGIBLE":
      return { label: "Hợp lệ", variant: "success" };
    case "NOT_ELIGIBLE":
      return { label: "Không đủ ĐK", variant: "danger" };
  }
}

export function verdictChip(row: Pick<AdminTopUpRefundListItem, "eligibility">): {
  label: string;
  tone: "success" | "warning";
} {
  return row.eligibility === "ELIGIBLE"
    ? { label: "Hợp lệ", tone: "success" }
    : { label: "Không hợp lệ", tone: "warning" };
}

export function verdictShortReason(
  row: Pick<AdminTopUpRefundListItem, "eligibility" | "ineligibleReason">,
): string {
  if (row.eligibility === "ELIGIBLE") {
    return "Chưa tiêu Điểm sau khi nạp";
  }
  if (row.ineligibleReason === "SPENT_SINCE_TOP_UP") {
    return "Đã dùng Điểm sau khi nạp";
  }
  if (row.ineligibleReason === "INSUFFICIENT_AVAILABLE") {
    return "Khả dụng ít hơn số Điểm nạp";
  }
  return "Không đủ điều kiện";
}

export function verdictExplanation(
  detail: Pick<AdminTopUpRefundDetail, "eligibility" | "ineligibleReason" | "paidAt" | "points">,
): string {
  if (detail.eligibility === "ELIGIBLE") {
    const formatted = detail.paidAt ? formatShortDateTime(detail.paidAt) : "";
    const paidAtStr = formatted ? ` (${formatted})` : "";
    return `User chưa tiêu Điểm nào kể từ lúc nạp${paidAtStr}. ${detail.points} Điểm đã chuyển sang Giữ chờ hoàn tiền.`;
  }
  if (detail.ineligibleReason === "SPENT_SINCE_TOP_UP") {
    return "User đã dùng Điểm (đăng/mở lại khảo sát hoặc đổi voucher) sau khi nạp, kể cả lần đổi voucher thất bại đã được hoàn Điểm. Không có Điểm nào bị giữ.";
  }
  if (detail.ineligibleReason === "INSUFFICIENT_AVAILABLE") {
    return `Lúc gửi, Điểm khả dụng ít hơn ${detail.points} Điểm của giao dịch. Không có Điểm nào bị giữ.`;
  }
  return "Yêu cầu hoàn tiền không đủ điều kiện.";
}

export function refundTransferContent(orderCode: number | string): string {
  return `RESCOM HOAN ${orderCode}`;
}

export function refundReasonLabel(reason: TopUpRefundReason): string {
  switch (reason) {
    case "WRONG_AMOUNT":
      return "Nạp nhầm số tiền";
    case "WRONG_ACCOUNT":
      return "Nạp nhầm tài khoản";
    case "NO_LONGER_NEEDED":
      return "Không còn nhu cầu";
    case "OTHER":
      return "Lý do khác";
    default:
      return "Khác";
  }
}

export function refundIneligibleReasonLabel(
  reason: TopUpRefundIneligibleReason | null,
): string | null {
  switch (reason) {
    case "SPENT_SINCE_TOP_UP":
      return "Điểm đã được sử dụng";
    case "INSUFFICIENT_AVAILABLE":
      return "Số dư khả dụng không đủ phong toả";
    default:
      return null;
  }
}


export function refundSla(
  row: Pick<AdminTopUpRefundListItem, "dueAt" | "status">,
  now = new Date(),
): {
  overdue: boolean;
  line: string;
  dueLabel: string;
} {
  const due = new Date(row.dueAt);
  const dueLabel = `Hạn ${formatDayMonth(due)}`;
  // Only an open request can be overdue; resolved rows show their outcome.
  if (row.status !== "REQUESTED") {
    return { overdue: false, line: refundStatusBadge(row.status).label, dueLabel };
  }
  const overdue = now.getTime() >= due.getTime();
  const daysLeft = businessDaysUntil(now, due);
  return {
    overdue,
    line: overdue ? "Quá hạn" : `Còn ${daysLeft} ngày`,
    dueLabel,
  };
}

export interface AuditTrailEntry {
  at: string;
  text: string;
}

export function auditTrail(detail: AdminTopUpRefundDetail): AuditTrailEntry[] {
  const entries: AuditTrailEntry[] = [];
  const actorName = detail.userName || detail.userEmail || "User";

  // 1. Submit
  entries.push({
    at: detail.submittedAt,
    text: `${actorName} · gửi yêu cầu hoàn tiền`,
  });

  // 2. Verdict
  if (detail.eligibility === "ELIGIBLE") {
    entries.push({
      at: detail.submittedAt,
      text: `Hệ thống · kết luận Hợp lệ, giữ ${detail.points} Điểm`,
    });
  } else {
    entries.push({
      at: detail.submittedAt,
      text: `Hệ thống · kết luận Không hợp lệ: ${verdictShortReason(detail)}`,
    });
  }

  // 3. Unverified
  if (!detail.destination.verified) {
    entries.push({
      at: detail.submittedAt,
      text: "Hệ thống · PayOS không trả tài khoản người trả; cần xác minh qua email",
    });
  }

  // 4. Withdrawn
  if (detail.withdrawnAt) {
    entries.push({
      at: detail.withdrawnAt,
      text: "User · rút yêu cầu",
    });
  }

  // 5. Resolved
  if (detail.resolvedAt) {
    const adminLabel = detail.resolvedBy?.email ? `Admin ${detail.resolvedBy.email}` : "Admin";
    if (detail.status === "REFUNDED") {
      entries.push({
        at: detail.resolvedAt,
        text: `${adminLabel} · đánh dấu Đã hoàn tiền`,
      });
    } else if (detail.status === "REJECTED") {
      entries.push({
        at: detail.resolvedAt,
        text: `${adminLabel} · từ chối`,
      });
    }
  }

  // 6. Bank transfer recorded
  if (detail.bankTransferRecordedAt) {
    entries.push({
      at: detail.bankTransferRecordedAt,
      text: "Admin · thêm mã chuyển khoản",
    });
  }

  return entries.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

export function rejectReasonState(text: string): {
  valid: boolean;
  value: string;
  length: number;
  max: number;
} {
  const trimmed = text.trim();
  const len = trimmed.length;
  return {
    valid: len >= 1 && len <= TOP_UP_REFUND_REJECTION_REASON_MAX,
    value: trimmed,
    length: len,
    max: TOP_UP_REFUND_REJECTION_REASON_MAX,
  };
}

export function bankTransferState(
  input: { reference?: string; transferredAt?: string | Date },
  createdAt: Date = new Date(0),
  now: Date = new Date(),
): {
  valid: boolean;
  reference: string | null;
  transferredAt: string | null;
  error?: string;
} {
  const ref = input.reference?.trim() || null;
  if (ref && ref.length > TOP_UP_REFUND_BANK_REFERENCE_MAX) {
    return { valid: false, reference: ref, transferredAt: null, error: "Mã chuyển khoản tối đa 100 ký tự" };
  }

  let transferredAtIso: string | null = null;
  if (input.transferredAt) {
    let t: Date;
    if (typeof input.transferredAt === "string") {
      const val = input.transferredAt.trim();
      if (val.includes("T") && !val.toUpperCase().endsWith("Z") && !val.includes("+") && !val.includes("-", 10)) {
        const timePart = val.length >= 19 ? val.slice(0, 19) : `${val.slice(0, 16)}:00`;
        t = new Date(`${timePart}+07:00`);
      } else {
        t = new Date(val);
      }
    } else {
      t = new Date(input.transferredAt);
    }
    if (isNaN(t.getTime())) {
      return { valid: false, reference: ref, transferredAt: null, error: "Thời điểm chuyển khoản không hợp lệ" };
    }
    const maxFuture = new Date(now.getTime() + 5 * 60 * 1000);
    if (t > maxFuture) {
      return { valid: false, reference: ref, transferredAt: null, error: "Thời điểm chuyển khoản không thể ở tương lai" };
    }
    if (t < createdAt) {
      return { valid: false, reference: ref, transferredAt: null, error: "Thời điểm chuyển khoản không thể trước thời điểm tạo yêu cầu" };
    }
    transferredAtIso = t.toISOString();
  }

  if (!ref && !transferredAtIso) {
    return { valid: false, reference: null, transferredAt: null, error: "Cần nhập ít nhất một thông tin" };
  }

  return { valid: true, reference: ref, transferredAt: transferredAtIso };
}
