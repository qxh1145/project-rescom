/**
 * Story 12.4: pure view logic for Voucher của tôi, the ticket page and the
 * redemption history. No React, no route literals (hrefs live in the hidden
 * `app/(signed-in)/(app)/rewards/` dir). Server time is passed in as `nowMs`.
 */
import { encode } from "uqr";
import type {
  CodeIssueReason,
  CodeIssueStatus,
  RedemptionHistoryEntryDto,
  RedemptionHistoryListDto,
  RedemptionErrorCode,
  VoucherTicketDto,
} from "@rescom/schemas";
import { isApiError } from "../api/api-error.ts";
import { formatDayMonth, formatShortDateTime, formatTime, vietnamDateKey } from "../format/date-time.ts";
import { formatFullDate, formatPoints, formatVnd } from "./voucher-display.ts";

const DAY_MS = 86400000;

export type ViewTone = "green" | "amber" | "danger" | "blue" | "neutral";

// ---- Tabs ----

export type VoucherTab = "unused" | "used" | "expired";

export const VOUCHER_TABS: readonly VoucherTab[] = ["unused", "used", "expired"];

export function ticketTab(status: VoucherTicketDto["status"]): VoucherTab {
  if (status === "USED") return "used";
  if (status === "EXPIRED") return "expired";
  return "unused";
}

const time = (value: string | null) => (value ? Date.parse(value) : 0);

export function ticketsByTab(items: readonly VoucherTicketDto[]): Record<VoucherTab, VoucherTicketDto[]> {
  const tabs: Record<VoucherTab, VoucherTicketDto[]> = { unused: [], used: [], expired: [] };
  for (const item of items) tabs[ticketTab(item.status)].push(item);
  tabs.unused.sort((a, b) => time(a.expiresAt) - time(b.expiresAt));
  tabs.used.sort((a, b) => time(b.usedAt) - time(a.usedAt));
  tabs.expired.sort((a, b) => time(b.expiresAt) - time(a.expiresAt));
  return tabs;
}

/** The header badge (AC 6): UNUSED + EXPIRING. */
export function unusedCount(items: readonly VoucherTicketDto[]): number {
  return items.filter((item) => ticketTab(item.status) === "unused").length;
}

export function parseVoucherTab(value: string | null): VoucherTab {
  return value === "used" || value === "expired" ? value : "unused";
}

// ---- Ticket card ----

export function ticketTagView(ticket: VoucherTicketDto, nowMs: number): { tone: ViewTone; label: string } {
  switch (ticket.status) {
    case "EXPIRING": {
      const days = Math.max(1, Math.ceil((Date.parse(ticket.expiresAt) - nowMs) / DAY_MS));
      return { tone: "danger", label: `Còn ${days} ngày` };
    }
    case "USED":
      return { tone: "neutral", label: "Đã dùng" };
    case "EXPIRED":
      return { tone: "neutral", label: "Hết hạn" };
    default:
      return { tone: "green", label: "Chưa dùng" };
  }
}

export function ticketMetaLine(ticket: VoucherTicketDto, nowMs: number): string {
  if (ticket.status === "USED") return `Đã dùng ${formatShortDateTime(ticket.usedAt)}`;
  if (ticket.status === "EXPIRED") return `Hết hạn ${formatFullDate(ticket.expiresAt)}`;
  const today = vietnamDateKey(new Date(nowMs)) === vietnamDateKey(ticket.redeemedAt);
  return `HSD ${formatFullDate(ticket.expiresAt)} · ${today ? "đổi hôm nay" : `đổi ngày ${formatDayMonth(ticket.redeemedAt)}`}`;
}

export function ticketCtaLabel(status: VoucherTicketDto["status"]): string {
  if (status === "USED") return "Xem lại mã";
  if (status === "EXPIRED") return "Xem chi tiết";
  return "Xem mã & QR";
}

const expiringCount = (items: readonly VoucherTicketDto[]) => items.filter((item) => item.status === "EXPIRING").length;

export function expiringNotice(items: readonly VoucherTicketDto[]): string | null {
  const n = expiringCount(items);
  return n > 0 ? `${n} voucher hết hạn trong 7 ngày. Rescom sẽ nhắc lại trước 1 ngày.` : null;
}

export function myVouchersSubtitle(items: readonly VoucherTicketDto[]): string {
  const n = expiringCount(items);
  return `${unusedCount(items)} voucher chưa dùng${n > 0 ? ` · ${n} voucher hết hạn trong 7 ngày` : ""}`;
}

// ---- Ticket page ----

export function canUndo(ticket: VoucherTicketDto, nowMs: number): boolean {
  return ticket.status === "USED" && ticket.undoUntil !== null && nowMs < Date.parse(ticket.undoUntil);
}

export function undoLine(ticket: VoucherTicketDto): string {
  return `Bạn có thể hoàn tác đến ${formatTime(ticket.undoUntil)} ${formatDayMonth(ticket.undoUntil)}.`;
}

export function canReportIssue(ticket: VoucherTicketDto): boolean {
  const issue = ticket.openIssue?.status;
  return ticket.status !== "EXPIRED" && issue !== "OPEN" && issue !== "REFUNDED";
}

export const CODE_ISSUE_REASON_LABELS: Record<CodeIssueReason, string> = {
  CODE_INVALID: "Thu ngân báo mã không hợp lệ",
  CODE_ALREADY_USED: "Mã báo đã được dùng",
  STORE_REFUSED: "Cửa hàng không nhận voucher",
  OTHER: "Lý do khác",
};

export const CODE_ISSUE_REASONS = Object.keys(CODE_ISSUE_REASON_LABELS) as CodeIssueReason[];

const CODE_ISSUE_VIEWS: Record<CodeIssueStatus, { tone: ViewTone; title: string; body: string }> = {
  OPEN: { tone: "amber", title: "Đang xử lý báo lỗi", body: "Admin xử lý trong 1 ngày làm việc: đổi mã mới hoặc trả lại điểm." },
  REPLACED: { tone: "green", title: "Đã đổi mã mới", body: "Mã bên trên là mã mới, dùng như bình thường." },
  REFUNDED: { tone: "blue", title: "Đã hoàn điểm", body: "Điểm đã được trả lại vào Ví điểm. Voucher này không dùng được nữa." },
  REJECTED: { tone: "neutral", title: "Mã vẫn dùng được", body: "Admin đã kiểm tra, mã vẫn hợp lệ. Nếu cửa hàng vẫn từ chối, báo lại nhé." },
};

export function codeIssueStatusView(status: CodeIssueStatus) {
  return CODE_ISSUE_VIEWS[status];
}

const ACTION_ERRORS: Record<string, string> = {
  TICKET_NOT_FOUND: "Không tìm thấy voucher này nữa. Quay lại Voucher của tôi nhé.",
  TICKET_REFUNDED: "Voucher đã được hoàn điểm nên không dùng được nữa.",
  TICKET_EXPIRED: "Voucher đã hết hạn nên không đánh dấu hay báo lỗi được nữa.",
  UNDO_WINDOW_CLOSED: "Đã quá 24 giờ nên không hoàn tác được nữa.",
  CODE_ISSUE_ALREADY_OPEN: "Mã này đang được xử lý báo lỗi. Admin sẽ phản hồi trong 1 ngày làm việc.",
};

export function ticketActionErrorMessage(error: unknown): string {
  return (isApiError(error) && error.code && ACTION_ERRORS[error.code]) || "Chưa lưu được. Thử lại nhé.";
}

// ---- Redemption history ----

const FAILURE_SHORT: Record<RedemptionErrorCode, string> = {
  SOLD_OUT: "hết hàng",
  PRICE_CHANGED: "giá đã đổi",
  INSUFFICIENT_POINTS: "không đủ điểm",
  VOUCHER_UNAVAILABLE: "voucher tạm dừng",
  ACCOUNT_NOT_ELIGIBLE: "chưa đủ điều kiện",
};

export interface HistoryRowView {
  icon: "check" | "x" | "refund";
  iconTone: "green" | "danger" | "blue";
  title: string;
  desktopTitle: string;
  /** Mobile second line. */
  subline: string;
  /** Desktop "Thời gian" column. */
  when: string;
  points: string;
  pointsTone: "default" | "muted" | "blue";
  status: string;
  /** Desktop Tag text (carries the short reason). */
  desktopStatus: string;
  statusTone: "green" | "danger" | "blue";
}

function signedPoints(points: number): string {
  if (points < 0) return `−${formatPoints(-points)}`;
  return points > 0 ? `+${formatPoints(points)}` : "0";
}

export function historyRowView(entry: RedemptionHistoryEntryDto): HistoryRowView {
  const title = `${entry.brand.name} · ${formatVnd(entry.valueVnd)}`;
  const when = formatShortDateTime(entry.createdAt);
  const flash = entry.isFlash ? "Flash Sale · " : "";
  const base = { title, desktopTitle: entry.isFlash ? `${title} (Flash)` : title, when, points: signedPoints(entry.points) };
  if (entry.kind === "FAILED") {
    const short = entry.failureCode === "SOLD_OUT" && entry.isFlash ? "hết suất" : entry.failureCode ? FAILURE_SHORT[entry.failureCode] : "";
    // The seed note already starts with "Flash Sale · ": do not repeat it.
    const reason = entry.note?.replace(/^Flash Sale · /, "").trim() || short;
    return { ...base, icon: "x", iconTone: "danger", subline: `${flash}${when}${reason ? ` · ${reason}` : ""}`, pointsTone: "muted", status: "Thất bại · không trừ", desktopStatus: `Thất bại · ${short}`, statusTone: "danger" };
  }
  if (entry.kind === "REFUNDED") {
    return { ...base, icon: "refund", iconTone: "blue", subline: `${when} · ${entry.note ?? entry.reference}`, pointsTone: "blue", status: "Đã hoàn điểm", desktopStatus: `Đã hoàn · ${entry.note?.split(",")[0] ?? "hoàn điểm"}`, statusTone: "blue" };
  }
  return { ...base, icon: "check", iconTone: "green", subline: `${flash}${when} · ${entry.reference}`, pointsTone: "default", status: "Thành công", desktopStatus: "Thành công", statusTone: "green" };
}

export function monthSummaryLine(summary: RedemptionHistoryListDto["monthSummary"]): { month: string; line: string; short: string } {
  const [year, month] = summary.month.split("-");
  // Both may be net-negative when refunds outweigh this month's redemptions: never print a negative amount.
  const points = Math.max(0, summary.pointsSpent);
  const count = Math.max(0, summary.voucherCount);
  const empty = count === 0 && points === 0;
  return {
    month: `Tháng ${month}/${year}`,
    line: empty ? "Tháng này bạn chưa đổi voucher nào." : `Đã dùng ${formatPoints(points)} điểm cho ${count} voucher`,
    short: empty ? "" : `Tháng ${month}: ${formatPoints(points)} điểm · ${count} voucher`,
  };
}

// ---- QR ----

/** QR spec quiet zone: 4 light modules on every side, part of the matrix so it scales with the code. */
export const QR_QUIET_ZONE = 4;

/** One SVG path (a unit square per dark module): rendered as an <svg>, never as HTML. `size` includes the quiet zone. */
export function qrModules(text: string): { size: number; path: string } {
  const { data, size } = encode(text, { ecc: "M", border: QR_QUIET_ZONE });
  let path = "";
  data.forEach((row, y) => row.forEach((dark, x) => { if (dark) path += `M${x} ${y}h1v1h-1z`; }));
  return { size, path };
}
