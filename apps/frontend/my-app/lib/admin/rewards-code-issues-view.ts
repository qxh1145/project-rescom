import type { AdminCodeIssueDto, AdminCodeIssueListDto, AdminCodeIssueStatusFilter, AdminResolveCodeIssueDto } from "@rescom/schemas";
import type { TagTone } from "../../components/ui/Tag";
import { formatShortDateTime, vietnamDateTimeParts } from "../format/date-time";
import { isApiError } from "../api/api-error";

export const PAGE_SIZE = 20;
export const CODE_ISSUE_ADMIN_REASON_LABELS = { CODE_INVALID: "Mã không hợp lệ", STORE_REFUSED: "Cửa hàng từ chối", CODE_ALREADY_USED: "Mã báo đã dùng", OTHER: "Khác" } satisfies Record<AdminCodeIssueDto["reason"], string>;
export const PRICE_SOURCE_LABELS = { FLASH: "Flash", PROMO: "Promo", BASE: "Base" } satisfies Record<AdminCodeIssueDto["priceSource"], string>;
export const TICKET_STATUS_VIEW = { UNUSED: { tone: "green", label: "Chưa dùng" }, EXPIRING: { tone: "danger", label: "Sắp hết hạn" }, USED: { tone: "neutral", label: "Đã dùng" }, EXPIRED: { tone: "neutral", label: "Hết hạn" } } satisfies Record<AdminCodeIssueDto["ticketStatus"], { tone: TagTone; label: string }>;
export const REPORT_STATUS_VIEW = { OPEN: { tone: "amber", label: "Đang mở" }, REPLACED: { tone: "green", label: "Đã thay mã" }, REFUNDED: { tone: "blue", label: "Đã hoàn điểm" }, REJECTED: { tone: "neutral", label: "Đã từ chối" } } satisfies Record<AdminCodeIssueDto["status"], { tone: TagTone; label: string }>;
export const ticketStatusView = (status: AdminCodeIssueDto["ticketStatus"]) => TICKET_STATUS_VIEW[status];
export const reportStatusView = (status: AdminCodeIssueDto["status"]) => REPORT_STATUS_VIEW[status];
export const REPLACE_BLOCKED_COPY = { SHARED_CODE: "Voucher dùng mã chung, mã mới sẽ giống mã cũ.", TICKET_EXPIRED: "Ticket đã hết hạn — mã mới cũng không dùng được.", NO_STOCK: "Hết tồn kho.", NO_CODE: "Lô mã đã hết mã chưa phát." } satisfies Record<NonNullable<AdminCodeIssueDto["replaceBlockedReason"]>, string>;

const DAY = 86400000;
const VN_OFFSET = 7 * 3600000;
// ponytail: no public-holiday calendar; add one when Ops supplies the list
export function slaDueAt(createdAtIso: string): string {
  const parts = vietnamDateTimeParts(createdAtIso)!;
  let start = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute) - VN_OFFSET;
  const created = Date.parse(createdAtIso);
  const weekday = (ms: number) => new Date(ms + VN_OFFSET).getUTCDay();
  const working = (ms: number) => weekday(ms) !== 0 && weekday(ms) !== 6;
  if (!working(start) || +parts.hour < 8 || +parts.hour >= 17) {
    start = Date.UTC(+parts.year, +parts.month - 1, +parts.day, 8) - VN_OFFSET;
    if (created >= start) start += DAY;
    while (!working(start)) start += DAY;
  } else start = created;
  let due = start + DAY;
  while (!working(due)) due += DAY;
  return new Date(due).toISOString();
}
export function formatWait(ms: number): string {
  const minutes = Math.max(1, Math.floor(ms / 60000));
  const days = Math.floor(minutes / 1440), hours = Math.floor((minutes % 1440) / 60);
  return days ? `${days} ngày${hours ? ` ${hours} giờ` : ""}` : hours ? `${hours} giờ` : `${minutes} phút`;
}
export function openSlaView(issue: AdminCodeIssueDto, nowMs: number) {
  const dueAt = slaDueAt(issue.createdAt);
  const delta = nowMs - Date.parse(dueAt), overdue = delta >= 0;
  return { age: formatWait(nowMs - Date.parse(issue.createdAt)), overdue, line: `${overdue ? "Quá hạn" : "Còn"} ${formatWait(Math.abs(delta))}`, dueAt };
}
export function resolvedSlaView(issue: AdminCodeIssueDto) {
  const resolvedAt = issue.resolvedAt;
  if (!resolvedAt) return { took: "—", at: "—", late: null };
  const lateMs = Date.parse(resolvedAt) - Date.parse(slaDueAt(issue.createdAt));
  return { took: formatWait(Date.parse(resolvedAt) - Date.parse(issue.createdAt)), at: formatShortDateTime(resolvedAt), late: lateMs > 0 ? `trễ hạn ${formatWait(lateMs)}` : null };
}
export const pageCount = (total: number) => Math.ceil(total / PAGE_SIZE);
export const clampOffset = (offset: number, total: number) => Math.min(Math.max(0, offset), Math.max(0, (pageCount(total) - 1) * PAGE_SIZE));
export function tabLabel(filter: AdminCodeIssueStatusFilter, list: AdminCodeIssueListDto | null, activeFilter: AdminCodeIssueStatusFilter = filter): string {
  const label = { OPEN: "Đang mở", RESOLVED: "Đã xử lý", ALL: "Tất cả" }[filter];
  return `${label}${list && (filter === "OPEN" || filter === activeFilter) ? ` · ${filter === "OPEN" ? list.summary.open : list.total}` : ""}`;
}
export function pageRangeText(list: AdminCodeIssueListDto, status: AdminCodeIssueStatusFilter, nowMs = Date.now()): string {
  const start = list.total ? list.offset + 1 : 0;
  const end = Math.min(list.offset + list.items.length, list.total);
  return `Hiển thị ${start}–${end} trong ${list.total} báo cáo${status === "RESOLVED" ? " đã xử lý" : ""}${status === "OPEN" && list.items.some(issue => openSlaView(issue, nowMs).overdue) ? " · dòng nền đỏ đã quá 1 ngày làm việc" : ""}`;
}
export function noteState(outcome: AdminResolveCodeIssueDto["outcome"], raw: string) {
  const trimmedLength = raw.trim().length, overBy = Math.max(0, trimmedLength - 500);
  const valid = !overBy && (outcome !== "REJECT" || trimmedLength > 0);
  const helper = overBy ? `Tối đa 500 ký tự — hãy rút gọn ${overBy} ký tự.` : outcome === "REJECT" ? trimmedLength ? "User sẽ thấy nội dung này. Không ghi thông tin nội bộ." : "Nhập lý do để gửi cho user — bắt buộc." : "Chỉ Admin thấy ghi chú này.";
  return { trimmedLength, valid, counter: `${trimmedLength}/500`, overBy, helper };
}
export function resolveBody(outcome: AdminResolveCodeIssueDto["outcome"], raw: string): AdminResolveCodeIssueDto {
  const note = raw.trim();
  if (outcome === "REJECT") return { outcome, note };
  return note ? { outcome, note } : { outcome };
}
export function resolveErrorView(error: unknown, issue: AdminCodeIssueDto) {
  const code = isApiError(error) ? error.code : null;
  const entries: Record<string, { title: string; body: string; suggest?: "REFUND" | "REFUND_OR_REJECT"; showResult?: true }> = {
    NO_REPLACEMENT_AVAILABLE: { title: "Không còn mã để thay", body: "Voucher vừa hết tồn kho hoặc hết mã chưa phát. Chưa có thay đổi nào. Hãy hoàn điểm cho user hoặc nhập thêm mã.", suggest: "REFUND" },
    REPLACEMENT_NOT_SUPPORTED: { title: "Voucher này không hỗ trợ thay mã", body: `${issue.voucher.brand.name} dùng mã chung cho mọi user — mã mới sẽ giống mã cũ. Hãy hoàn điểm, hoặc từ chối kèm hướng dẫn sử dụng.`, suggest: "REFUND_OR_REJECT" },
    TICKET_EXPIRED: { title: "Ticket đã hết hạn", body: `Mã mới cũng sẽ không dùng được — hãy hoàn ${issue.pricePoints} điểm cho user.`, suggest: "REFUND" },
    CODE_ISSUE_ALREADY_RESOLVED: { title: "Báo cáo đã được xử lý", body: "Một Admin khác vừa xử lý báo cáo này. Thao tác của bạn không được áp dụng — điểm không bị hoàn thêm.", showResult: true },
    TICKET_REFUNDED: { title: "Lượt đổi đã được hoàn điểm", body: "Lượt đổi này đã được hoàn điểm trước đó. Chưa có thay đổi nào.", showResult: true },
    CODE_ISSUE_NOT_FOUND: { title: "Không tìm thấy báo cáo", body: "Báo cáo không còn tồn tại. Danh sách sẽ được tải lại." },
  };
  if (code && entries[code]) return { ...entries[code], code };
  if (isApiError(error) && (error.kind === "network" || (error.status ?? 0) >= 500)) return { title: "Chưa gửi được", body: "Mất kết nối khi gửi. Ghi chú vẫn được giữ — bấm Thử lại. Gửi lại an toàn, báo cáo không bị xử lý hai lần.", code: "NETWORK_ERROR" };
  return { title: "Chưa xử lý được báo cáo", body: "Chưa có thay đổi nào được lưu. Thử lại.", code: code ?? "UNKNOWN" };
}
export function successToast(outcome: AdminResolveCodeIssueDto["outcome"], issue: AdminCodeIssueDto) {
  switch (outcome) {
    case "REPLACE": return { title: `Đã thay mã cho ${issue.reference}`, body: `User ${issue.userLabel} đã nhận mã mới và thông báo in-app.` };
    case "REFUND": return { title: `Đã hoàn ${issue.pricePoints} điểm cho user ${issue.userLabel}`, body: `${issue.reference} đã đóng · điểm về ví Khả dụng.` };
    case "REJECT": return { title: `Đã từ chối ${issue.reference}`, body: "User nhận lý do từ chối và có thể báo lại." };
  }
}
