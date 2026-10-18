import { vietnamDateTimeParts } from "../format/date-time.ts";
import { formatPoints, formatVnd } from "../wallet/top-up.ts";

export type SwitchCardVariant = "hidden" | "loading" | "error" | "pending" | "ready";

/**
 * Pure state machine for the B4 PayOS switch card (Story 13.13, AC 1-3).
 *
 * Rules:
 * - When PayOS is effectively on ("payos"), card is hidden.
 * - When loading, card is loading (or hidden per AC 1).
 * - When error loading availability, card shows error state.
 * - When effectively off ("manual"):
 *   - pendingTotal == null: loading
 *   - pendingTotal > 0: pending variant (190:1898)
 *   - pendingTotal === 0: ready variant (190:2091)
 */
export function switchCardVariant({
  mode,
  pendingTotal,
}: {
  mode: "loading" | "payos" | "manual" | "error";
  pendingTotal?: number | null;
}): SwitchCardVariant {
  if (mode === "payos") return "hidden";
  if (mode === "loading") return "loading";
  if (mode === "error") return "error";
  if (pendingTotal === undefined || pendingTotal === null) return "loading";
  if (pendingTotal > 0) return "pending";
  return "ready";
}

/** Formats row amount → points label ("{amount} → {points} Điểm", e.g. "100.000đ → 500 Điểm"). */
export function pendingRowLabel(item: { amountVnd: number; amount: number }): string {
  return `${formatVnd(item.amountVnd)} → ${formatPoints(item.amount)} Điểm`;
}

/** Display code for an item: orderCode or code or first 8 chars of UUID id. */
export function itemCode(item: { id: string; orderCode?: number | string | null; code?: string | null }): string {
  if (item.orderCode != null) return String(item.orderCode);
  if (item.code != null) return String(item.code);
  return item.id.slice(0, 8);
}

/**
 * Page header meta copy (Figma 190:1898 / 190:2091 / AC 1).
 * - payos: "PayOS tự cộng Điểm · hoàn tiền thủ công, hạn 3 ngày làm việc"
 * - manual/error: "{dd/MM/yyyy hôm nay} · đang dùng nạp thủ công"
 * - loading: ""
 */
export function headerMeta(
  mode: "loading" | "payos" | "manual" | "error",
  today: Date | string = new Date(),
): string {
  if (mode === "payos") {
    return "PayOS tự cộng Điểm · hoàn tiền thủ công, hạn 3 ngày làm việc";
  }
  const parts = vietnamDateTimeParts(today);
  const dateStr = parts ? `${parts.day}/${parts.month}/${parts.year}` : "";
  if (mode === "manual" || mode === "error") {
    return dateStr ? `${dateStr} · đang dùng nạp thủ công` : "Đang dùng nạp thủ công";
  }
  return "";
}

/** Verbatim copy strings from Figma B4 & AC 1-3. */
export const PAYOS_SWITCH_COPY = {
  cardTitle: "Chuyển sang nạp điểm qua PayOS",
  cardDescription:
    "Khi PayOS bật, user chỉ nạp qua PayOS và Điểm được cộng tự động. Nạp thủ công chuyển sang tab “Lịch sử thủ công (cũ)”, chỉ đọc. PayOS bật bằng cấu hình server, không bật trên giao diện.",
  chipOff: "PayOS: Tắt",
  chipOn: "PayOS: Bật",
  chipCaption: "Bật/tắt bằng cấu hình server (PAYOS_ENABLED)",
  loadError: "Không tải được trạng thái PayOS.",
  retry: "Thử lại",
  pendingBannerTitle: (n: number) =>
    `Còn ${n} yêu cầu nạp thủ công đang chờ. Cần xử lý hết trước khi bật PayOS.`,
  pendingBannerDesc:
    "Duyệt hoặc từ chối nhanh ngay bên dưới. Khi danh sách trống, báo kỹ thuật bật PAYOS_ENABLED.",
  pendingFooter:
    "Đối chiếu sao kê trước khi duyệt; từ chối cần ghi lý do. Server sẽ không khởi động với PayOS bật khi còn yêu cầu đang chờ.",
  pendingShowingPartial: (n: number, total: number) =>
    `Đang hiển thị ${n}/${total} yêu cầu cũ nhất — xem đủ ở tab “Lịch sử thủ công (cũ)”.`,
  buttonReject: "Từ chối",
  buttonApprove: "Duyệt",
  readyTitle: "Sẵn sàng bật PayOS",
  readyHandledSubtitle: (m: number) =>
    `${m} yêu cầu đã xử lý được giữ lại ở tab “Lịch sử thủ công (cũ)”.`,
  readyChecklistPending: "0 yêu cầu thủ công đang chờ",
  readyChecklistRestart: "Báo kỹ thuật bật PAYOS_ENABLED và triển khai lại.",
  confirmApproveTitle: (code: string) => `Duyệt yêu cầu ${code}?`,
  confirmApproveCredit: (points: string | number, name: string, email: string) =>
    `Cộng ${points} Điểm cho ${name} (${email}).`,
  confirmApproveStatement: (amount: string, ref: string) =>
    `Chỉ duyệt khi sao kê có khoản ${amount} với nội dung ${ref}.`,
  buttonCancel: "Huỷ",
} as const;
