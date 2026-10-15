import type {
  PayosTopUpDto,
  TopUpRequestDto,
} from "@rescom/schemas";
import type { IconName } from "../../components/ui/Icon.tsx";
import { topUpVnd } from "./top-up.ts";

export type TopUpChannel = "PAYOS" | "MANUAL";

export type TopUpTone = "amber" | "green" | "grey" | "teal" | "danger";

export interface TopUpChipInfo {
  label: string;
  icon: IconName;
  tone: TopUpTone;
}

export interface HistoryTopUp {
  id: string;
  channel: TopUpChannel;
  code: string;
  amountVnd: number;
  points: number;
  createdAt: string;
  chip: TopUpChipInfo;
  expiresAt?: string;
  status: string;
}

/**
 * Returns label + IconName + tone for chip rendering (Task 4, AC 2, 4).
 * PayOS:
 * - PROCESSING: "Đang chờ thanh toán" (amber, hourglass)
 * - SUCCESSFUL: "Thành công" (green, check)
 * - CANCELLED: "Đã huỷ" (grey, x)
 * - EXPIRED: "Hết hạn" (grey, hourglass)
 * - AMOUNT_MISMATCH: "Chờ đối chiếu" (amber, alert-triangle)
 * - MANUAL_REFUNDED: "Đã hoàn tiền" (teal, refund)
 *
 * Manual:
 * - PENDING: "Chờ duyệt" (amber, hourglass)
 * - APPROVED: "Thành công" (green, check)
 * - REJECTED: "Từ chối" (danger, x)
 */
export function topUpChip(status: string, channel: TopUpChannel): TopUpChipInfo {
  if (channel === "MANUAL") {
    switch (status) {
      case "PENDING":
        return { label: "Chờ duyệt", icon: "hourglass", tone: "amber" };
      case "APPROVED":
        return { label: "Thành công", icon: "check", tone: "green" };
      case "REJECTED":
        return { label: "Từ chối", icon: "x", tone: "danger" };
      default:
        return { label: status, icon: "info", tone: "grey" };
    }
  }

  // PayOS
  switch (status) {
    case "PROCESSING":
      return { label: "Đang chờ thanh toán", icon: "hourglass", tone: "amber" };
    case "SUCCESSFUL":
      return { label: "Thành công", icon: "check", tone: "green" };
    case "CANCELLED":
      return { label: "Đã huỷ", icon: "x", tone: "grey" };
    case "EXPIRED":
      return { label: "Hết hạn", icon: "hourglass", tone: "grey" };
    case "AMOUNT_MISMATCH":
      return { label: "Chờ đối chiếu", icon: "alert-triangle", tone: "amber" };
    case "MANUAL_REFUNDED":
      return { label: "Đã hoàn tiền", icon: "refund", tone: "teal" };
    default:
      return { label: status, icon: "info", tone: "grey" };
  }
}

/** Copy for MANUAL_REFUNDED top-up (AC 4) */
export const MANUAL_REFUNDED_COPY =
  "Đã hoàn tiền thủ công cho thanh toán sai số tiền — không có Điểm nào được cộng";

export function mapManualToHistory(item: TopUpRequestDto): HistoryTopUp {
  return {
    id: item.id,
    channel: "MANUAL",
    code: item.transferReference,
    amountVnd: topUpVnd(item.amount),
    points: item.amount,
    createdAt: item.createdAt,
    chip: topUpChip(item.status, "MANUAL"),
    status: item.status,
  };
}

export function mapPayosToHistory(item: PayosTopUpDto): HistoryTopUp {
  return {
    id: item.id,
    channel: "PAYOS",
    code: String(item.orderCode),
    amountVnd: item.amountVnd,
    points: item.points,
    createdAt: item.createdAt,
    chip: topUpChip(item.status, "PAYOS"),
    expiresAt: item.expiresAt,
    status: item.status,
  };
}

/**
 * Merges manual and payos top-ups, sorts newest first by createdAt desc,
 * and limits the result.
 */
export function mergeTopUps(
  manual: TopUpRequestDto[],
  payos: PayosTopUpDto[],
  limit = 20,
): HistoryTopUp[] {
  const all: HistoryTopUp[] = [
    ...manual.map(mapManualToHistory),
    ...payos.map(mapPayosToHistory),
  ];

  all.sort((a, b) => {
    const diff = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    if (diff !== 0) return diff;
    return b.id.localeCompare(a.id);
  });

  return all.slice(0, limit);
}
