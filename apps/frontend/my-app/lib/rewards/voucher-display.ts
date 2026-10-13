import type {
  FlashSaleItemDto,
  VoucherCategory,
  VoucherDetailDto,
  VoucherListItemDto,
  VoucherSort,
} from "@rescom/schemas";
import { vietnamDateTimeParts } from "../format/date-time.ts";
import {
  formatPoints,
  formatVnd,
  TOP_UP_PACKAGES,
  TOP_UP_STEP_POINTS,
  topUpVnd,
} from "../wallet/top-up.ts";

export const CATEGORY_LABELS: Record<VoucherCategory, string> = {
  COFFEE: "Cà phê",
  TEA: "Trà & trà sữa",
  CHICKEN_BURGER: "Gà rán & burger",
  BAKERY_DESSERT: "Bánh & tráng miệng",
};

export const CATEGORY_GLYPH: Record<VoucherCategory, string> = {
  COFFEE: "coffee",
  TEA: "cup-soda",
  CHICKEN_BURGER: "drumstick",
  BAKERY_DESSERT: "coffee",
};

export const SORT_LABELS: Record<VoucherSort, string> = {
  BEST_DEAL: "Ưu đãi tốt nhất",
  POINTS_ASC: "Điểm thấp → cao",
  POINTS_DESC: "Điểm cao → thấp",
  NEWEST: "Mới nhất",
};

const BRAND_INITIALS_MAP: Record<string, string> = {
  highlands: "HL",
  lotteria: "LT",
  "phuc-long": "PL",
  kfc: "KFC",
  "gong-cha": "GC",
  "the-coffee-house": "TCH",
};

export function brandInitials(brand: { id: string; name: string }): string {
  const mapped = BRAND_INITIALS_MAP[brand.id];
  if (mapped) return mapped;

  const words = brand.name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "VC";
  return words.slice(0, 3).map((w) => w[0].toUpperCase()).join("");
}

/** "31/12/2026" in Vietnam time. */
export function formatFullDate(value: string | Date | null | undefined): string {
  const parts = vietnamDateTimeParts(value);
  return parts ? `${parts.day}/${parts.month}/${parts.year}` : "";
}

export const VOUCHER_LOW_STOCK = 10;

export type VoucherCardState = "default" | "sale" | "soldOut" | "expired" | "paused";

export function voucherCardState(item: VoucherListItemDto): VoucherCardState {
  if (item.status === "SOLD_OUT") return "soldOut";
  if (item.status === "EXPIRED") return "expired";
  if (item.status === "PAUSED") return "paused";
  if (item.price.source !== "BASE" || item.flash !== null) return "sale";
  return "default";
}

export function voucherMetaLine(item: VoucherListItemDto): string {
  if (item.status === "SOLD_OUT") {
    return `Đã đổi hết ${item.stockTotal}/${item.stockTotal}`;
  }
  if (item.status === "EXPIRED") {
    return `Hết thời gian đổi từ ${formatFullDate(item.redeemEndsAt)}`;
  }
  if (item.status === "PAUSED") {
    return `Tạm dừng đổi · HSD ${formatFullDate(item.codeExpiresAt)}`;
  }
  if (item.flash) {
    const remainingQuota = Math.max(0, item.flash.quota - item.flash.sold);
    return `Flash Sale · còn ${remainingQuota} suất · HSD ${formatFullDate(item.codeExpiresAt)}`;
  }
  if (item.stockRemaining <= VOUCHER_LOW_STOCK) {
    return `Sắp hết · còn ${item.stockRemaining} · HSD ${formatFullDate(item.codeExpiresAt)}`;
  }
  return `Còn ${item.stockRemaining} · HSD ${formatFullDate(item.codeExpiresAt)}`;
}

export function flashItemOrder(state: FlashSaleItemDto["state"]): number {
  switch (state) {
    case "ACTIVE":
      return 0;
    case "UPCOMING":
      return 1;
    case "SOLD_OUT":
      return 2;
    case "ENDED":
      return 3;
    default:
      return 4;
  }
}

export function detailStockLine(voucher: VoucherDetailDto): string {
  if (voucher.flash) {
    const remainingQuota = Math.max(0, voucher.flash.quota - voucher.flash.sold);
    return `${remainingQuota} suất Flash Sale · ${voucher.stockRemaining} voucher giá thường`;
  }
  return `${voucher.stockRemaining} voucher`;
}

export function detailExpiryLine(voucher: VoucherDetailDto): string {
  return `Đến hết ${formatFullDate(voucher.codeExpiresAt)}. Đổi được đến ${formatFullDate(voucher.redeemEndsAt)}.`;
}

export function howToGetCodeLine(isSharedCode: boolean): string {
  return isSharedCode
    ? "Mã dùng chung hiện trong Voucher của tôi sau khi đổi."
    : "Mã riêng và QR hiện ngay trong Voucher của tôi sau khi đổi.";
}

export function shortfall(price: number, available: number): number {
  return Math.max(0, price - available);
}

export function suggestedTopUp(shortfallPoints: number): number {
  if (shortfallPoints <= 0) return 0;
  for (const pkg of TOP_UP_PACKAGES) {
    if (pkg >= shortfallPoints) return pkg;
  }
  return Math.ceil(shortfallPoints / TOP_UP_STEP_POINTS) * TOP_UP_STEP_POINTS;
}

export function brandTintClass(brandId: string, category: VoucherCategory): string {
  if (brandId === "kfc") return "bg-danger-soft text-danger";
  if (brandId === "lotteria") return "bg-tone-blue-bg text-tone-blue-fg";
  switch (category) {
    case "COFFEE":
      return "bg-tone-amber-bg text-tone-amber-fg";
    case "TEA":
      return "bg-tone-green-bg text-tone-green-fg";
    case "CHICKEN_BURGER":
      return "bg-tone-blue-bg text-tone-blue-fg";
    case "BAKERY_DESSERT":
      return "bg-tone-teal-bg text-tone-teal-fg";
    default:
      return "bg-tone-amber-bg text-tone-amber-fg";
  }
}

export { formatPoints, formatVnd, topUpVnd };
