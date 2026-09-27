import {
  POINT_VND_RATE,
  TOP_UP_MAX_POINTS,
  TOP_UP_MIN_POINTS,
  type TopUpRequestDto,
} from "@rescom/schemas";

/**
 * Pure rules of the top-up flow (Figma 14a–14c, backend `top-up.schema.ts`).
 *
 * Packages: Figma draws 100 / 200 / 500 points. The shared schema's
 * `TOP_UP_PRESET_AMOUNTS` (100, 250, 500, 1000) is not used by any backend
 * rule, and 250 would break Figma's "bội số của 100", so the UI follows
 * Figma (ASSUMED).
 */
export const TOP_UP_PACKAGES = [100, 200, 500] as const;

/**
 * ASSUMED: Figma 14a "Hoặc nhập số điểm (bội số của 100)". The backend only
 * enforces an integer between `TOP_UP_MIN_POINTS` and `TOP_UP_MAX_POINTS`.
 */
export const TOP_UP_STEP_POINTS = 100;

export { POINT_VND_RATE, TOP_UP_MAX_POINTS, TOP_UP_MIN_POINTS };

const VND = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 });

/** "20.000đ" (Figma money format). */
export function formatVnd(amount: number): string {
  return `${VND.format(amount)}đ`;
}

/** "1.000" — thousands separator for large point amounts. */
export function formatPoints(points: number): string {
  return VND.format(points);
}

/** 1 point = `POINT_VND_RATE` đ (200). */
export function topUpVnd(points: number): number {
  return points * POINT_VND_RATE;
}

export type TopUpAmountCheck = { ok: true; points: number } | { ok: false; message: string };

/**
 * Validates the custom amount field (14a). Empty input is handled by the caller.
 * Dots are accepted only as vi-VN thousands separators ("1.000", "12.500"):
 * "3.00" is rejected instead of becoming 300.
 */
export function checkTopUpPoints(input: string): TopUpAmountCheck {
  const trimmed = input.trim().replace(/\s/g, "");
  const text = /^\d{1,3}(\.\d{3})+$/.test(trimmed) ? trimmed.replace(/\./g, "") : trimmed;
  if (!/^\d+$/.test(text)) return { ok: false, message: "Nhập số điểm là số nguyên, ví dụ 300." };
  const points = Number(text);
  if (points < TOP_UP_MIN_POINTS) {
    return { ok: false, message: `Tối thiểu ${TOP_UP_MIN_POINTS} điểm (${formatVnd(topUpVnd(TOP_UP_MIN_POINTS))}).` };
  }
  if (points > TOP_UP_MAX_POINTS) {
    return { ok: false, message: `Tối đa ${formatPoints(TOP_UP_MAX_POINTS)} điểm mỗi lần nạp.` };
  }
  if (points % TOP_UP_STEP_POINTS !== 0) {
    return { ok: false, message: `Số điểm phải là bội số của ${TOP_UP_STEP_POINTS}.` };
  }
  return { ok: true, points };
}

/**
 * Amount to copy for the bank app: digits only ("20000"), which every
 * banking app accepts (ASSUMED; Figma shows "20.000đ").
 */
export function copyableVnd(amount: number): string {
  return String(amount);
}

export type TimelineStepState = "done" | "current" | "todo" | "failed";

export interface TimelineStep {
  title: string;
  detail: string;
  state: TimelineStepState;
}

/**
 * Figma 14c timeline "Đã gửi yêu cầu → Admin đang đối chiếu → Cộng N điểm".
 * APPROVED / REJECTED are not drawn (ASSUMED copy): approved completes every
 * step; rejected fails the review step with the admin's reason.
 */
export function topUpTimeline(request: Pick<TopUpRequestDto, "amount" | "status" | "rejectionReason">, sentDetail: string): TimelineStep[] {
  const credit = `Cộng ${formatPoints(request.amount)} điểm vào Ví`;
  if (request.status === "APPROVED") {
    return [
      { title: "Đã gửi yêu cầu", detail: sentDetail, state: "done" },
      { title: "Admin đã xác nhận chuyển khoản", detail: "Đã đối chiếu xong", state: "done" },
      { title: credit, detail: "Điểm đã vào Khả dụng", state: "done" },
    ];
  }
  if (request.status === "REJECTED") {
    return [
      { title: "Đã gửi yêu cầu", detail: sentDetail, state: "done" },
      {
        title: "Admin không tìm thấy giao dịch khớp",
        detail: request.rejectionReason ? `Lý do: ${request.rejectionReason}` : "Yêu cầu đã bị từ chối",
        state: "failed",
      },
      { title: credit, detail: "Không cộng điểm", state: "todo" },
    ];
  }
  return [
    { title: "Đã gửi yêu cầu", detail: sentDetail, state: "done" },
    { title: "Admin đang đối chiếu chuyển khoản", detail: "Bạn có thể rời trang này", state: "current" },
    { title: credit, detail: "Bạn sẽ nhận thông báo", state: "todo" },
  ];
}

/** Routes of the flow (`app/(signed-in)/(focus)/wallet/top-up/…`). */
export function topUpTransferPath(id: string): string {
  return `/wallet/top-up/${encodeURIComponent(id)}`;
}

export function topUpStatusPath(id: string): string {
  return `/wallet/top-up/${encodeURIComponent(id)}/pending`;
}
