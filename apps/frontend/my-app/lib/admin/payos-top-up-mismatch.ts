import { businessDaysUntil, TOP_UP_MISMATCH_NOTE_MAX, type AdminPayosMismatch, type AdminPayosUncredited, type ResolveTopUpMismatchResult } from "@rescom/schemas";
import { formatShortDateTime, formatTime } from "../format/date-time.ts";

export function mismatchPreview(amountPaidVnd: number) {
  const points = Math.floor(amountPaidVnd / 200);
  return { points, remainderVnd: amountPaidVnd % 200, canCredit: points >= 1 };
}
export function diffVnd(row: Pick<AdminPayosMismatch, "amountVnd" | "amountPaidVnd">) { return (row.amountPaidVnd ?? 0) - row.amountVnd; }
export function mismatchSla(row: Pick<AdminPayosMismatch, "resolveDueAt">, now = new Date()) {
  const due = new Date(row.resolveDueAt), overdue = now >= due;
  return { overdue, line: overdue ? "Quá hạn" : `Còn ${businessDaysUntil(now, due)} ngày làm việc`, dueLabel: `Hạn ${formatShortDateTime(due)}` };
}
export function uncreditedBanner(items: AdminPayosUncredited[], now = new Date()) {
  return { title: `${items.length} giao dịch đã thanh toán nhưng chưa cộng Điểm sau 30 phút`,
    lines: items.map(item => `#${item.orderCode} · PayOS báo thanh toán ${formatTime(item.paidAt)}, đã ${item.paidAt ? Math.max(0, Math.floor((now.getTime() - Date.parse(item.paidAt)) / 60000)) : "?"} phút. Kiểm tra webhook trước khi cộng thủ công.`) };
}
export function noteState(note: string) { const trimmed = note.trim(); return { valid: trimmed.length >= 1 && trimmed.length <= TOP_UP_MISMATCH_NOTE_MAX, value: trimmed }; }
export function resolveToast(result: ResolveTopUpMismatchResult) {
  return result.status === "SUCCESSFUL" ? { tone: "success" as const, title: "Đã cộng Điểm", body: result.replayed ? "Giao dịch đã được cộng Điểm trước đó." : `Đã cộng ${result.pointsCredited} Điểm theo số tiền thực nhận.` }
    : { tone: "success" as const, title: "Đã hoàn tiền", body: result.replayed ? "Giao dịch đã được đánh dấu hoàn tiền trước đó." : "Đã ghi nhận hoàn tiền thủ công. Không cộng Điểm." };
}
