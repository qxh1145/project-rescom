import { redemptionErrorSchema, type RedemptionErrorDto, type RedemptionQuoteDto, type RedemptionResultDto } from "@rescom/schemas";
import { ApiError } from "../api/api-error.ts";
import { formatTime, vietnamDateKey, formatDayMonth } from "../format/date-time.ts";
import { formatPoints } from "./voucher-display.ts";

export const REDEEM_POLL_DELAYS_MS = [2000, 4000, 8000] as const;
export type RedeemFailure = { kind: "rejected"; error: RedemptionErrorDto } | { kind: "unknown" } | { kind: "failed"; code: string | null };
export function classifyRedeemFailure(error: unknown): RedeemFailure {
  if (!(error instanceof ApiError)) return { kind: "failed", code: null };
  if (error.kind === "network" || error.kind === "malformed" || (error.status ?? 0) >= 500) return { kind: "unknown" };
  const parsed = redemptionErrorSchema.safeParse({ code: error.code, message: error.message, details: error.details });
  return error.kind === "http" && parsed.success ? { kind: "rejected", error: parsed.data } : { kind: "failed", code: error.code };
}
export async function pollRedemptionByKey({ fetchByKey, sleep, onAttempt, signal, delays = REDEEM_POLL_DELAYS_MS }: {
  fetchByKey: (signal: AbortSignal) => Promise<RedemptionResultDto>; sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  onAttempt: (attempt: number) => void; signal: AbortSignal; delays?: readonly number[];
}): Promise<{ kind: "succeeded"; result: RedemptionResultDto } | { kind: "rejected"; error: RedemptionErrorDto } | { kind: "unresolved" }> {
  for (const [index, ms] of delays.entries()) {
    signal.throwIfAborted(); await sleep(ms, signal); signal.throwIfAborted(); onAttempt(index + 1);
    try { const result = await fetchByKey(signal); signal.throwIfAborted(); return { kind: "succeeded", result }; }
    catch (error) { signal.throwIfAborted(); const failure = classifyRedeemFailure(error); if (failure.kind === "rejected") return failure; }
  }
  signal.throwIfAborted(); return { kind: "unresolved" };
}
export type RedeemTarget = "close" | "requote" | "rewards" | "rewardsCategory" | "marketplace" | "topUp" | "wallet" | "activation";
export type RedeemAction = { label: string; target: RedeemTarget };
export type RedeemRow = { label: string; value: string; oldValue?: string; danger?: boolean };
export type RedeemView = { mascot: string; title: string; body: string; rows: RedeemRow[]; primary: RedeemAction; secondary: RedeemAction };
const action = (label: string, target: RedeemTarget): RedeemAction => ({ label, target });
const unchanged = (points: number): RedeemRow[] => [{ label: "Điểm khả dụng", value: `${formatPoints(points)} điểm (không đổi)` }];
export function redeemErrorView(error: RedemptionErrorDto, ctx: { priceSource: "BASE" | "PROMO" | "FLASH" | null; availableBefore: number; quotePoints?: number }): RedeemView {
  const secondary = action("Đóng", "close");
  switch (error.code) {
    case "SOLD_OUT": {
      const flash = ctx.priceSource === "FLASH", regular = flash && error.details.regularStockRemaining > 0;
      return { mascot: "sad.svg", title: flash ? "Vừa hết suất Flash Sale" : "Voucher vừa hết hàng", body: `${flash ? "Suất cuối" : "Voucher cuối"} đã có người đổi trong lúc bạn xác nhận. Bạn chưa bị trừ điểm nào.${regular ? " Voucher vẫn còn ở giá thường." : ""}`, rows: unchanged(ctx.availableBefore), primary: regular ? action("Xem giá thường", "close") : action("Xem voucher tương tự", "rewardsCategory"), secondary };
    }
    case "PRICE_CHANGED": {
      const next = error.details.price.points, diff = ctx.availableBefore - next;
      return { mascot: "surprise.svg", title: "Giá vừa thay đổi", body: `${ctx.priceSource === "FLASH" ? "Flash Sale vừa kết thúc hoặc hết suất nên giá đã đổi." : "Giá voucher vừa được cập nhật."} Bạn chưa bị trừ điểm.`, rows: [{ label: "Giá đổi", oldValue: `${formatPoints(ctx.quotePoints ?? 0)} điểm`, value: `${formatPoints(next)} điểm` }, diff < 0 ? { label: "Còn thiếu", value: `${formatPoints(-diff)} điểm`, danger: true } : { label: "Còn lại sau khi đổi", value: `${formatPoints(diff)} điểm` }], primary: action(`Đổi với giá ${formatPoints(next)} điểm`, "requote"), secondary: action("Huỷ", "close") };
    }
    case "INSUFFICIENT_POINTS": {
      const { required, available } = error.details;
      return { mascot: "confused.png", title: "Điểm khả dụng vừa thay đổi", body: ctx.availableBefore > available ? `Một giao dịch khác vừa dùng ${formatPoints(ctx.availableBefore - available)} điểm khả dụng của bạn. Voucher này chưa được đổi và bạn chưa bị trừ điểm.` : "Điểm khả dụng của bạn không đủ để đổi voucher này. Bạn chưa bị trừ điểm.", rows: [{ label: "Voucher cần", value: `${formatPoints(required)} điểm` }, { label: "Bạn đang có", value: `${formatPoints(available)} điểm` }, { label: "Còn thiếu", value: `${formatPoints(required - available)} điểm`, danger: true }], primary: action("Làm khảo sát kiếm thêm", "marketplace"), secondary: action("Nạp điểm", "topUp") };
    }
    case "VOUCHER_UNAVAILABLE": {
      const status = error.details.status;
      return { mascot: "sad.svg", title: status === "PAUSED" ? "Voucher đang tạm dừng đổi" : status === "EXPIRED" ? "Voucher đã hết thời gian đổi" : "Voucher không còn được đổi", body: `${status === "PAUSED" ? "Voucher này vừa được tạm dừng." : status === "EXPIRED" ? "Thời gian đổi voucher này vừa kết thúc." : "Voucher này vừa được gỡ khỏi Đổi quà."} Bạn chưa bị trừ điểm.`, rows: [], primary: action("Xem voucher khác", "rewards"), secondary };
    }
    case "ACCOUNT_NOT_ELIGIBLE": {
      const reasons: Record<typeof error.details.reason, [string, RedeemAction]> = {
        ACCOUNT_NOT_ACTIVATED: ["Tài khoản cần được kích hoạt trước khi đổi voucher.", action("Kích hoạt tài khoản", "activation")],
        ACCOUNT_LOCKED: ["Tài khoản đang bị khoá nên chưa đổi được voucher.", action("Về Ví điểm", "wallet")],
        FRAUD_FLAGGED: ["Tài khoản đang được kiểm tra nên chưa đổi được voucher Flash Sale. Bạn vẫn đổi được voucher giá thường.", action("Xem voucher khác", "rewards")],
        NO_RECENT_SURVEY: ["Flash Sale dành cho người đã làm ít nhất 1 khảo sát trong 30 ngày qua.", action("Làm khảo sát", "marketplace")],
        VOUCHER_LIMIT_REACHED: ["Bạn đã đổi voucher này đủ số lần cho phép trong 30 ngày.", action("Xem voucher khác", "rewards")],
        DAILY_LIMIT_REACHED: ["Hôm nay bạn đã đổi đủ số điểm cho phép. Quay lại vào ngày mai nhé.", action("Xem voucher khác", "rewards")],
        FLASH_LIMIT_REACHED: ["Bạn đã dùng hết suất Flash Sale của mình cho voucher này.", action("Xem voucher khác", "rewards")],
      };
      const [body, primary] = reasons[error.details.reason];
      return { mascot: "shield.svg", title: "Chưa đổi được voucher này", body: `${body} Bạn chưa bị trừ điểm.`, rows: [], primary, secondary };
    }
  }
}
export function failedView(kind: "failed" | "quoteNetwork"): RedeemView {
  return { mascot: "offline.svg", title: kind === "failed" ? "Chưa đổi được voucher" : "Chưa tải được giá đổi", body: `${kind === "failed" ? "Có lỗi khi xác nhận giao dịch." : "Kết nối đang chập chờn."} Bạn chưa bị trừ điểm.`, rows: [], primary: action("Thử lại", "requote"), secondary: action("Đóng", "close") };
}
export function confirmPriceLabel(source: "BASE" | "PROMO" | "FLASH"): string { return source === "FLASH" ? "Giá Flash Sale" : source === "PROMO" ? "Giá ưu đãi" : "Giá đổi"; }
export function flashEndsLine(flashEndsAt: string, nowMs: number): string {
  return `Giá Flash áp dụng đến ${formatTime(flashEndsAt)}${vietnamDateKey(flashEndsAt) === vietnamDateKey(new Date(nowMs)) ? "" : ` ${formatDayMonth(flashEndsAt)}`}. Sau giờ đó cần xác nhận lại với giá mới.`;
}
export function tweenValue(from: number, to: number, elapsedMs: number, durationMs: number): number {
  const t = Math.max(0, Math.min(1, elapsedMs / durationMs)); return Math.round(from + (to - from) * (1 - (1 - t) ** 3));
}
export function shouldSubmitRequote(shownPoints: number, quote: RedemptionQuoteDto): boolean { return quote.price.points === shownPoints; }
