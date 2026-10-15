import { voucherDiscountPercent, type AdminFlashSaleDto, type AdminVoucherListDto, type FlashSaleItemDto } from "@rescom/schemas";
import { formatDayMonth, formatTime } from "../format/date-time.ts";
import { brandInitials, formatPoints, formatVnd } from "../rewards/voucher-display.ts";

type Flash = AdminFlashSaleDto;
type Item = Flash["items"][number];
type Voucher = AdminVoucherListDto["items"][number];

export function flashStatusView(status: Flash["status"]) {
  return ({ SCHEDULED: { label: "Hẹn lịch", tone: "neutral" }, UPCOMING: { label: "Sắp diễn ra", tone: "amber" }, ACTIVE: { label: "Đang diễn ra", tone: "green" }, SOLD_OUT: { label: "Hết suất", tone: "danger" }, ENDED: { label: "Đã kết thúc", tone: "neutral" } } as const)[status];
}

export const FLASH_END_REASONS = [{ value: "WRONG_PRICE", label: "Sai giá" }, { value: "STOCK_ISSUE", label: "Lỗi kho" }, { value: "PARTNER_REQUEST", label: "Đối tác yêu cầu" }, { value: "OTHER", label: "Khác" }] as const;

/** Minutes from start until the last item sold out; null while any item still has stock. Times come from the server payload. */
function soldOutAfterMinutes(flash: Flash) {
  const times = flash.items.map((item) => item.soldOutAt);
  if (!times.length || times.some((time) => !time)) return null;
  return Math.max(0, Math.round((Math.max(...times.map((time) => Date.parse(time!))) - Date.parse(flash.startsAt)) / 60000));
}

export function flashRowView(flash: Flash) {
  const sold = flash.items.reduce((sum, item) => sum + item.sold, 0);
  const quota = flash.items.reduce((sum, item) => sum + item.quota, 0);
  const minutes = soldOutAfterMinutes(flash);
  const reason = FLASH_END_REASONS.find((entry) => entry.value === flash.endReason)?.label ?? "Khác";
  const subtitle = flash.status === "SCHEDULED" ? `${flash.items.length} voucher · tạo bởi ${flash.createdBy.name}`
    : flash.status === "UPCOMING" ? `${formatPoints(flash.remindCount)} người đã bấm Nhắc tôi`
    : flash.endedEarlyAt ? `Kết thúc sớm · ${reason}`
    : flash.status === "SOLD_OUT" || (flash.status === "ENDED" && minutes !== null) ? minutes !== null ? `Hết suất sau ${formatPoints(minutes)} phút` : "Hết suất"
    : flash.status === "ENDED" ? `Kết thúc đúng giờ, dư ${formatPoints(flash.items.reduce((sum, item) => sum + item.unsold, 0))} suất`
    : `${flash.items.length} voucher · đang diễn ra`;
  return {
    title: `${flash.code} · ${flash.title}`, subtitle,
    windowLabel: `${formatDayMonth(flash.startsAt)} ${formatTime(flash.startsAt)} – ${formatTime(flash.endsAt)}`,
    soldLabel: `${formatPoints(sold)}/${formatPoints(quota)}`,
    soldRatio: quota ? sold / quota : 0,
    vouchersLabel: flash.items.map(item => `${brandInitials(item.brand)} ${formatVnd(item.valueVnd).replace(/\.000\s*đ?$/, "k")}`).join(" · "),
    actions: (flash.status === "ACTIVE" ? ["preview", "end"] : flash.status === "UPCOMING" || flash.status === "SCHEDULED" ? ["preview", "edit"] : ["preview"]) as ("preview" | "edit" | "end")[],
  };
}

export function monitorItemView(item: Item, flash: Flash) {
  const soldOut = item.sold >= item.quota;
  const speed = item.perMinute.toLocaleString("vi-VN", { maximumFractionDigits: 1 });
  const footnote = soldOut ? `${item.soldOutAt ? `Hết suất lúc ${formatTime(item.soldOutAt)}` : "Hết suất"} · đã về giá thường ${formatPoints(item.regularPoints)}`
    : item.etaAt && Date.parse(item.etaAt) < Date.parse(flash.endsAt) ? `Tốc độ ${speed} suất/phút · dự kiến hết lúc ${formatTime(item.etaAt)}`
    : `Tốc độ ${speed} suất/phút · có thể còn dư 0–${formatPoints(item.unsold)} suất`;
  return { priceLabel: `${formatPoints(item.flashPoints)} điểm`, regularLabel: formatPoints(item.regularPoints), soldLabel: `${formatPoints(item.sold)}/${formatPoints(item.quota)} suất`, soldRatio: item.quota ? item.sold / item.quota : 0, footnote, badge: soldOut ? "Hết suất" : null };
}

export function monitorTotals(flash: Flash) {
  const sold = flash.items.reduce((sum, item) => sum + item.sold, 0), quota = flash.items.reduce((sum, item) => sum + item.quota, 0);
  const { SOLD_OUT, INSUFFICIENT_POINTS, OTHER } = flash.failures;
  return [
    { label: "Đã đổi", value: `${formatPoints(sold)}/${formatPoints(quota)} suất` },
    { label: "Điểm đã tiêu", value: `${formatPoints(flash.pointsSpent)} điểm` },
    { label: "Người tham gia", value: `${formatPoints(flash.participants)} người` },
    { label: "Lượt thất bại", value: `${formatPoints(SOLD_OUT + INSUFFICIENT_POINTS + OTHER)} · hết suất ${formatPoints(SOLD_OUT)}, thiếu điểm ${formatPoints(INSUFFICIENT_POINTS)}` },
    { label: "Đổi trong 24 giờ sau khi nạp", value: `${formatPoints(flash.afterTopUp.count)} lượt · ${(flash.afterTopUp.rate * 100).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}% · đã gắn cờ ${formatPoints(flash.afterTopUp.flagged)}` },
  ];
}

const ITEM_FIELD_MESSAGES: Record<string, string> = {
  flashPoints: "Nhập giá Flash là số nguyên dương.", quota: "Nhập số suất là số nguyên dương.",
  voucherId: "Chọn voucher hợp lệ.", perUserCap: "Giới hạn mỗi người phải là số nguyên dương.",
};
type FormIssue = { path: readonly (string | number)[]; message: string; code?: string };
function issueMessage(issue: FormIssue) {
  const key = issue.path.join(".");
  if (key === "title") return "Nhập tên chương trình (tối đa 60 ký tự).";
  if (key === "startsAt") return "Chọn giờ bắt đầu hợp lệ.";
  if (key === "endsAt") return /six hours|6 hour|6 giờ/i.test(issue.message) ? "Flash Sale dài tối đa 6 giờ." : /follow start/i.test(issue.message) ? "Giờ kết thúc phải sau giờ bắt đầu." : "Chọn giờ kết thúc hợp lệ.";
  if (key === "items") return issue.code === "too_small" || /at least|too small|ít nhất/i.test(issue.message) ? "Chọn ít nhất một voucher." : "Mỗi voucher chỉ được chọn một lần.";
  const field = /^items\.\d+\.(\w+)$/.exec(key)?.[1];
  return (field && ITEM_FIELD_MESSAGES[field]) ?? issue.message;
}
export function flashFormErrors(issues: readonly FormIssue[], conflicts: readonly { path: string | readonly (string | number)[]; code: string; details?: Record<string, unknown> }[] = []) {
  const errors: Record<string, string> = {};
  const add = (key: string, message: string) => { if (!errors[key]) errors[key] = message; else if (!errors[key].includes(message)) errors[key] += ` ${message}`; };
  for (const issue of issues) add(issue.path.join("."), issueMessage(issue));
  for (const conflict of conflicts) {
    const key = Array.isArray(conflict.path) ? conflict.path.join(".") : String(conflict.path);
    const details = conflict.details ?? {};
    add(key, ({
      FLASH_STARTS_IN_PAST: "Giờ bắt đầu phải ở tương lai.",
      FLASH_PRICE_NOT_BELOW_REGULAR: `Giá Flash phải thấp hơn giá hiện tại (${formatPoints(Number(details.regularPoints ?? details.regular ?? 0))} điểm).`,
      FLASH_QUOTA_EXCEEDS_STOCK: `Tối đa ${formatPoints(Number(details.available ?? 0))} suất chưa giữ.`,
      FLASH_QUOTA_BELOW_SOLD: `Không thể thấp hơn ${formatPoints(Number(details.sold ?? 0))} suất đã đổi.`,
      FLASH_OVERLAP: `Trùng giờ với ${String(details.code ?? "Flash Sale khác")}.`,
      VOUCHER_NOT_FLASHABLE: "Voucher này không thể đưa vào Flash Sale.",
    } as Record<string, string>)[conflict.code] ?? conflict.code);
  }
  return errors;
}

export function previewFlashItem(row: { voucherId: string; flashPoints: number; quota: number; perUserCap?: number }, voucher: Voucher | undefined, state: "ACTIVE" | "UPCOMING"): FlashSaleItemDto | null {
  if (!voucher || voucher.id !== row.voucherId || !Number.isInteger(row.flashPoints) || row.flashPoints <= 0 || row.flashPoints >= (voucher.promoPoints ?? voucher.basePoints) || !Number.isInteger(row.quota) || row.quota <= 0) return null;
  return { id: row.voucherId, voucherId: voucher.id, voucherTitle: voucher.title, brand: voucher.brand, category: voucher.category, valueVnd: voucher.valueVnd, flashPoints: row.flashPoints, basePoints: voucher.basePoints, discountPercent: voucherDiscountPercent(row.flashPoints, voucher.basePoints), quota: row.quota, sold: 0, perUserCap: row.perUserCap ?? 1, state };
}

export function endEarlyCopy(flash: Flash) {
  const unsold = flash.items.filter(item => item.unsold > 0);
  return [
    `Giá ${unsold.length} voucher đang chạy về giá thường ngay (${unsold.map(item => `${item.brand.name} ${formatPoints(item.regularPoints)}`).join(", ")}).`,
    `${formatPoints(unsold.reduce((sum, item) => sum + item.unsold, 0))} suất chưa đổi (${unsold.map(item => formatPoints(item.unsold)).join(" + ")}) trả về kho giá thường.`,
    "Người đang ở bước xác nhận sẽ thấy “Giá vừa thay đổi”; không ai bị trừ sai giá.",
    `${formatPoints(flash.succeededCount)} giao dịch đã thành công giữ nguyên giá Flash.`,
  ];
}
