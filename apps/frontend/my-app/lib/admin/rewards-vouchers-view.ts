import { POINT_VND_RATE, type adminVoucherInputSchema, type adminVoucherSchema, type AdminVoucherListDto } from "@rescom/schemas";
import type { z } from "zod";
import { formatDayMonth } from "../format/date-time.ts";
import { formatPoints, formatVnd } from "../rewards/voucher-display.ts";

type Voucher = z.infer<typeof adminVoucherSchema>;
type Form = z.input<typeof adminVoucherInputSchema>;
type Summary = AdminVoucherListDto["summary"];
const CODE = /^[A-Za-z0-9-]{4,64}$/;

const STATUS_TAGS: Record<Voucher["status"], { label: string; tone: "green" | "amber" | "neutral" | "danger" }> = {
  ACTIVE: { label: "Đang phân phối", tone: "green" }, PAUSED: { label: "Tạm ngừng", tone: "amber" },
  SOLD_OUT: { label: "Hết hàng", tone: "danger" }, EXPIRED: { label: "Hết hạn", tone: "neutral" },
  HIDDEN: { label: "Đã ẩn", tone: "neutral" }, ARCHIVED: { label: "Lưu trữ", tone: "neutral" },
};

export function voucherRowView(voucher: Voucher) {
  // Status comes from the server (same source as the list filters and summary counts).
  const { label: statusLabel, tone: statusTone } = STATUS_TAGS[voucher.status];
  const priceNote = voucher.price.source === "FLASH" ? `Flash ${formatPoints(voucher.price.points)}` : voucher.promoPoints !== null ? `KM ${formatPoints(voucher.promoPoints)} · đến ${formatDayMonth(voucher.redeemEndsAt)}` : null;
  return {
    statusLabel, statusTone,
    stockLabel: `${voucher.stock.remaining}/${voucher.stock.total}`,
    reservedLabel: `giữ ${voucher.stock.flashReserved} cho Flash`,
    priceLabel: `${formatPoints(voucher.basePoints)} điểm · ${formatVnd(voucher.valueVnd)}`,
    priceNote,
    windowLabel: `${formatDayMonth(voucher.redeemStartsAt)} – ${formatDayMonth(voucher.redeemEndsAt)}`,
    canToggleVisibility: voucher.state !== "ARCHIVED",
  };
}

export function STATUS_FILTERS(summary: Summary) {
  return ([
    ["ALL", "Tất cả", summary.total], ["ACTIVE", "Đang phân phối", summary.active],
    ["PAUSED", "Tạm ngừng", summary.paused], ["SOLD_OUT", "Hết hàng", summary.soldOut],
    ["EXPIRED", "Hết hạn", summary.expired], ["HIDDEN", "Ẩn", summary.hidden],
  ] as const).map(([key, label, count]) => ({ key, label: `${label} ${count}`, count }));
}

export function voucherActionsOf(voucher: Voucher) {
  if (voucher.state === "ARCHIVED") return [{ key: "history", label: "Xem lịch sử đổi" }];
  return [
    { key: "edit", label: "Sửa thông tin" }, { key: "price", label: "Điều chỉnh giá điểm" },
    { key: "stock", label: "Điều chỉnh tồn kho" }, { key: "history", label: "Xem lịch sử đổi" },
    { key: "state", label: voucher.state === "PAUSED" ? "Tiếp tục phân phối" : "Tạm ngừng" },
    { key: "visibility", label: voucher.isVisible ? "Ẩn" : "Hiện" },
    { key: "archive", label: "Lưu trữ" },
  ];
}

const FIELD_MESSAGES: Record<string, string> = {
  title: "Nhập tên voucher (tối đa 80 ký tự).", brandId: "Chọn thương hiệu.",
  valueVnd: "Nhập số nguyên lớn hơn 0.", basePoints: "Nhập số nguyên lớn hơn 0.",
  promoPoints: "Giá khuyến mãi phải thấp hơn giá điểm thường.",
  redeemEndsAt: "Ngày kết thúc phải sau ngày bắt đầu.",
  codeExpiresAt: "Hạn dùng mã phải sau ngày kết thúc đổi ít nhất 7 ngày.",
  terms: "Tối đa 10 dòng.", howToUse: "Tối đa 10 dòng.",
  imageUrl: "Nhập đường dẫn https hợp lệ.",
};
export function voucherFormErrors(issues: readonly { path: readonly (string | number)[]; message: string }[]): Record<string, string> {
  return Object.fromEntries(issues.map(issue => {
    const key = issue.path.join(".");
    return [key, FIELD_MESSAGES[String(issue.path[0])] ?? issue.message];
  }));
}

export function parseCodeCsv(text: string): { codes: string[]; skippedHeader: boolean; invalid: { line: number; value: string }[] } {
  const codes: string[] = [], invalid: { line: number; value: string }[] = [];
  let skippedHeader = false, seenRow = false;
  text.replace(/^\uFEFF/, "").split(/\r?\n/).forEach((row, index) => {
    const value = row.split(/[,;]/, 1)[0].trim();
    if (!value) return;
    const first = !seenRow; seenRow = true;
    if (first && /^(code|mã)$/i.test(value)) { skippedHeader = true; return; }
    if (!CODE.test(value)) invalid.push({ line: index + 1, value });
    else codes.push(value);
  });
  if (codes.length > 5000) invalid.push({ line: 0, value: "Tối đa 5000 mã." });
  return { codes, skippedHeader, invalid };
}

export function suggestedPoints(valueVnd: number): number { return Math.round(valueVnd / POINT_VND_RATE); }
export function deviationWarning(valueVnd: number, basePoints: number): string | null {
  const suggested = suggestedPoints(valueVnd);
  if (!suggested || !Number.isFinite(basePoints)) return null;
  const difference = Math.abs(basePoints - suggested) / suggested * 100;
  const percent = Math.round(difference);
  return difference <= 20 ? null : `Giá điểm lệch ${percent}% so với giá trị ÷ 200đ — cần kiểm tra trước khi lưu.`;
}

export function preCheckItems(form: Form, csvResult: (ReturnType<typeof parseCodeCsv> & { duplicatesInFile?: string[]; alreadyStored?: string[] }) | null, now: string | Date, editing = false) {
  const warning = deviationWarning(form.valueVnd, form.basePoints);
  const codeValid = form.isSharedCode || !csvResult && editing || !!csvResult && csvResult.codes.length > 0 && csvResult.invalid.length === 0 && new Set(csvResult.codes).size === csvResult.codes.length && !csvResult.duplicatesInFile?.length && !csvResult.alreadyStored?.length;
  const expiryValid = Date.parse(form.codeExpiresAt) >= Date.parse(form.redeemEndsAt) + 7 * 86400000;
  const publishValid = Date.parse(form.redeemEndsAt) > new Date(now).getTime() && Date.parse(form.redeemEndsAt) > Date.parse(form.redeemStartsAt);
  return [
    { tone: warning ? "warn" : "ok", text: warning ? `${warning} Lệch giá sẽ được ghi vào nhật ký kiểm tra.` : `Giá điểm phù hợp (${formatPoints(form.basePoints)} điểm)` },
    { tone: codeValid ? "ok" : "warn", text: form.isSharedCode ? "Mã dùng chung" : !csvResult && editing ? "Không nạp thêm mã" : codeValid ? `${csvResult?.codes.length ?? 0} mã hợp lệ, không trùng` : "Mã trùng hoặc không hợp lệ — cần kiểm tra" },
    { tone: expiryValid ? "ok" : "warn", text: expiryValid ? "Hạn dùng mã đủ 7 ngày sau khi kết thúc đổi" : "Hạn dùng mã chưa đủ 7 ngày" },
    { tone: publishValid ? "ok" : "warn", text: publishValid ? "Thời gian phân phối hợp lệ" : "Thời gian phân phối chưa hợp lệ" },
  ] as { tone: "ok" | "warn"; text: string }[];
}
