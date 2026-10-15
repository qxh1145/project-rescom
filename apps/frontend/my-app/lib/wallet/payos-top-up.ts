import {
  PAYOS_TOP_UP_MAX_VND,
  PAYOS_TOP_UP_MIN_VND,
  POINT_VND_RATE,
  type PayosTopUpDto,
} from "@rescom/schemas";
import { formatPoints, formatVnd, type TimelineStep } from "./top-up.ts";

/** Quick amount chips for PayOS checkout (AC 6) */
export const PAYOS_QUICK_AMOUNTS = [
  20_000,
  50_000,
  100_000,
  200_000,
  500_000,
] as const;

export { PAYOS_TOP_UP_MAX_VND, PAYOS_TOP_UP_MIN_VND, POINT_VND_RATE };

/** Terminal statuses for PayOS top-ups where polling should cease */
export const PAYOS_TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  "SUCCESSFUL",
  "CANCELLED",
  "EXPIRED",
  "AMOUNT_MISMATCH",
  "MANUAL_REFUNDED",
]);

export function isTerminal(status: string): boolean {
  return PAYOS_TERMINAL_STATUSES.has(status);
}

/** 1 point = 200 VNĐ */
export function pointsForVnd(amountVnd: number): number {
  return Math.floor(amountVnd / POINT_VND_RATE);
}

/** Deadline for polling a top-up: expiresAt + 2 minutes */
export function pollDeadline(expiresAt: string | Date): Date {
  const time = typeof expiresAt === "string" ? new Date(expiresAt).getTime() : expiresAt.getTime();
  return new Date(time + 2 * 60_000);
}

/** Checks whether a top-up should continue polling right now */
export function shouldPoll(topUp: Pick<PayosTopUpDto, "status" | "expiresAt">, now: Date = new Date()): boolean {
  if (isTerminal(topUp.status)) return false;
  return now.getTime() < pollDeadline(topUp.expiresAt).getTime();
}

/**
 * Guard for provider checkout URLs: https only; a same-origin relative path
 * ("/x", not "//x") is accepted only when `allowRelative` (MSW mocking on).
 */
export function isSafeCheckoutUrl(
  url: string | null | undefined,
  allowRelative = false,
): url is string {
  if (!url) return false;
  if (url.startsWith("https://")) return true;
  return allowRelative && url.startsWith("/") && !url.startsWith("//") && !url.startsWith("/\\");
}

export type PayosAmountCheck =
  | { ok: true; amountVnd: number }
  | { ok: false; message: string; suggestion?: number };

/**
 * Validates the VNĐ amount input.
 * Strips whitespace and accepts dots/spaces as thousands separators ("10.000", "10 000").
 * Bounds: min 10.000, max 5.000.000, must be multiple of 200.
 * If not multiple of 200, calculates nearest valid suggestion rounded to multiple of 200 and clamped.
 */
export function checkPayosAmount(input: string): PayosAmountCheck {
  const trimmed = input.trim().replace(/\s/g, "");
  if (!trimmed) {
    return { ok: false, message: "Vui lòng nhập số tiền muốn nạp." };
  }

  // Accepts dots as thousands separators: e.g. "10.000" or "5.000.000"
  const text = /^\d{1,3}(\.\d{3})+$/.test(trimmed) ? trimmed.replace(/\./g, "") : trimmed;
  if (!/^\d+$/.test(text)) {
    return { ok: false, message: "Số tiền phải là số nguyên, ví dụ 50.000." };
  }

  const amountVnd = Number(text);

  if (amountVnd < PAYOS_TOP_UP_MIN_VND) {
    return {
      ok: false,
      message: `Số tiền nạp tối thiểu là ${formatVnd(PAYOS_TOP_UP_MIN_VND)}.`,
      suggestion: PAYOS_TOP_UP_MIN_VND,
    };
  }

  if (amountVnd > PAYOS_TOP_UP_MAX_VND) {
    return {
      ok: false,
      message: `Số tiền nạp tối đa là ${formatVnd(PAYOS_TOP_UP_MAX_VND)} mỗi giao dịch.`,
      suggestion: PAYOS_TOP_UP_MAX_VND,
    };
  }

  if (amountVnd % POINT_VND_RATE !== 0) {
    // Nearest multiple of 200
    const rounded = Math.round(amountVnd / POINT_VND_RATE) * POINT_VND_RATE;
    const clamped = Math.max(PAYOS_TOP_UP_MIN_VND, Math.min(PAYOS_TOP_UP_MAX_VND, rounded));
    return {
      ok: false,
      message: `Số tiền phải là bội số của ${POINT_VND_RATE}đ. Gần nhất: ${formatVnd(clamped)}.`,
      suggestion: clamped,
    };
  }

  return { ok: true, amountVnd };
}

/**
 * Vertical status timeline for PayOS top-up (Task 3, AC 10).
 * Stages: Tạo giao dịch -> Thanh toán -> Cộng Điểm
 */
export function payosTimeline(
  topUp: Pick<PayosTopUpDto, "status" | "points" | "createdAt" | "paidAt" | "cancelledAt">,
): TimelineStep[] {
  const pointsText = `Cộng ${formatPoints(topUp.points)} điểm vào Ví`;

  if (topUp.status === "SUCCESSFUL") {
    return [
      { title: "Đã tạo yêu cầu thanh toán", detail: "Mã giao dịch hợp lệ", state: "done" },
      { title: "Thanh toán thành công qua PayOS", detail: "Đã nhận tiền chuyển khoản", state: "done" },
      { title: pointsText, detail: "Điểm đã vào Ví khả dụng", state: "done" },
    ];
  }

  if (topUp.status === "CANCELLED") {
    return [
      { title: "Đã tạo yêu cầu thanh toán", detail: "Đã khởi tạo", state: "done" },
      { title: "Giao dịch đã huỷ", detail: "Người dùng đã huỷ hoặc chưa thanh toán", state: "failed" },
      { title: pointsText, detail: "Không cộng điểm", state: "todo" },
    ];
  }

  if (topUp.status === "EXPIRED") {
    return [
      { title: "Đã tạo yêu cầu thanh toán", detail: "Đã khởi tạo", state: "done" },
      { title: "Mã thanh toán hết hạn", detail: "Quá thời hạn thanh toán 5 phút", state: "failed" },
      { title: pointsText, detail: "Không cộng điểm", state: "todo" },
    ];
  }

  if (topUp.status === "AMOUNT_MISMATCH") {
    return [
      { title: "Đã tạo yêu cầu thanh toán", detail: "Đã khởi tạo", state: "done" },
      { title: "Sai lệch số tiền thanh toán", detail: "Số tiền nhận không khớp với yêu cầu", state: "failed" },
      { title: "Admin đối chiếu xử lý", detail: "Admin sẽ xử lý trong 3 ngày làm việc", state: "current" },
    ];
  }

  if (topUp.status === "MANUAL_REFUNDED") {
    return [
      { title: "Đã tạo yêu cầu thanh toán", detail: "Đã khởi tạo", state: "done" },
      { title: "Đã hoàn tiền thủ công", detail: "Hoàn tiền cho thanh toán sai lệch", state: "done" },
      { title: pointsText, detail: "Không cộng điểm", state: "todo" },
    ];
  }

  // PROCESSING
  return [
    { title: "Đã tạo yêu cầu thanh toán", detail: "Mã thanh toán sẵn sàng", state: "done" },
    { title: "Chờ thanh toán qua PayOS", detail: "Vui lòng quét mã QR hoặc mở cổng thanh toán", state: "current" },
    { title: pointsText, detail: "Điểm sẽ được cộng ngay khi thanh toán", state: "todo" },
  ];
}
