import { payosTopUpStatusSchema, type PayosRecheckResultDto, type PayosTopUpStatus } from "@rescom/schemas";
import { vietnamDateKey } from "../format/date-time.ts";
import { topUpChip } from "../wallet/top-up-history.ts";

export const ADMIN_PAYOS_PAGE_SIZE = 10;
export type PayosFilters = { status?: PayosTopUpStatus; from: string; to: string; q: string };
export function defaultDateRange(now: Date = new Date()) {
  const to = vietnamDateKey(now);
  return { from: `${to.slice(0, 7)}-01`, to };
}
export function normalizeSearch(q: string) { return q.trim().slice(0, 100); }
export function toListQuery(filters: PayosFilters, page: number) {
  return { limit: ADMIN_PAYOS_PAGE_SIZE, offset: Math.max(0, page - 1) * ADMIN_PAYOS_PAGE_SIZE,
    ...(filters.status ? { status: filters.status } : {}), ...(filters.from ? { from: filters.from } : {}),
    ...(filters.to ? { to: filters.to } : {}), ...(normalizeSearch(filters.q) ? { q: normalizeSearch(filters.q) } : {}) };
}
export function payosStatusOptions() {
  return payosTopUpStatusSchema.options.map(status => ({ value: status, label: topUpChip(status, "PAYOS").label }));
}
export function recheckToast(result: PayosRecheckResultDto) {
  switch (result.result) {
    case "CREDITED": return { tone: "success" as const, title: "Đã cộng Điểm", body: "payOS xác nhận đã thanh toán, Điểm đã vào ví người dùng." };
    case "STILL_UNPAID": return { tone: "info" as const, title: "Chưa ghi nhận thanh toán", body: "payOS chưa nhận được tiền cho giao dịch này." };
    case "MISMATCH": return { tone: "warning" as const, title: "Sai số tiền", body: "Số tiền thực nhận khác yêu cầu — cần xử lý." };
  }
}
