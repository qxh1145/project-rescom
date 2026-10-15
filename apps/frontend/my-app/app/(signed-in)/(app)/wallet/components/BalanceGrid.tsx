"use client";

import type { WalletBalanceDto } from "@rescom/schemas";
import { PENDING_DUE_LABEL } from "@/lib/wallet/wallet-history";
import { BalanceTile } from "./BalanceTile";

interface BalanceGridProps {
  balance: WalletBalanceDto;
  pendingHoursLeft: number | null;
  pendingDue: boolean;
}

function pendingNote(
  balance: WalletBalanceDto,
  hoursLeft: number | null,
  due: boolean,
): string {
  if (balance.pending === 0) return "Không có điểm chờ";
  if (due) return PENDING_DUE_LABEL;
  return hoursLeft !== null ? `Còn ${hoursLeft} giờ` : "Đang xét 48 giờ";
}

/**
 * 5 balance tiles (AC 1, FR-31, UX-DR-P2); "Khả dụng" is the BalanceCard hero above:
 * 1. Đang chờ  2. Ký quỹ  3. Đóng băng  4. Giữ để xét (integrityHold)
 * 5. Giữ chờ hoàn tiền (refundHold, shows 0 until 13.10)
 */
export function BalanceGrid({
  balance,
  pendingHoursLeft,
  pendingDue,
}: BalanceGridProps) {
  const tiles = [
    {
      label: "Đang chờ",
      value: balance.pending,
      note: pendingNote(balance, pendingHoursLeft, pendingDue),
      tooltip: "Thưởng khảo sát đang trong 48 giờ xét",
      accent: true,
    },
    {
      label: "Ký quỹ",
      value: balance.escrow,
      note: "Khảo sát bạn đăng",
      tooltip: "Điểm đang giữ cho khảo sát bạn đăng",
      accent: false,
    },
    {
      label: "Đóng băng",
      value: balance.frozen,
      note: balance.frozen > 0 ? "Mở khi xong khảo sát đầu" : "Đã mở khoá",
      tooltip: "Điểm khởi đầu mở khi xong khảo sát đầu",
      accent: false,
    },
    {
      label: "Giữ để xét",
      value: balance.integrityHold,
      note: balance.integrityHold > 0 ? "Chất lượng câu trả lời" : "Không có điểm giữ",
      tooltip: "Điểm bị giữ để xét chất lượng câu trả lời; không dùng được",
      accent: false,
    },
    {
      label: "Giữ chờ hoàn tiền",
      value: balance.refundHold ?? 0,
      note: (balance.refundHold ?? 0) > 0 ? "Đang chờ hoàn" : "Không có điểm giữ",
      tooltip: "Điểm đang giữ cho yêu cầu hoàn tiền; không dùng được",
      accent: false,
    },
  ];

  return (
    <ul
      data-tour="wallet-buckets"
      className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-3 lg:gap-3"
    >
      {tiles.map((tile) => (
        <BalanceTile
          key={tile.label}
          label={tile.label}
          value={tile.value}
          note={tile.note}
          tooltip={tile.tooltip}
          accent={tile.accent}
        />
      ))}
    </ul>
  );
}

export function BalanceGridSkeleton() {
  return (
    <div
      role="status"
      aria-label="Đang tải số dư ví..."
      className="flex flex-col gap-4 animate-pulse"
    >
      <div className="h-44 w-full rounded-[22px] bg-slate-200 lg:h-52" />
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-3 lg:gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-28 rounded-2xl bg-slate-200" />
        ))}
      </div>
    </div>
  );
}
