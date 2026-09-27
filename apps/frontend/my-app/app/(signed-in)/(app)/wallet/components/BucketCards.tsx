import type { WalletBalanceDto } from "@rescom/schemas";
import { formatPoints } from "@/lib/wallet/top-up";
import { PENDING_DUE_LABEL } from "@/lib/wallet/wallet-history";

interface BucketCardsProps {
  balance: WalletBalanceDto;
  /** Soonest pending reward to mature (Figma "Còn 31 giờ"), from the history. */
  pendingHoursLeft: number | null;
  /** A pending reward is past its 48h review, its release not posted yet. */
  pendingDue: boolean;
}

function pendingNote(balance: WalletBalanceDto, hoursLeft: number | null, due: boolean): string {
  if (balance.pending === 0) return "Không có điểm chờ"; // ASSUMED: not drawn
  // The soonest reward decides: one already matured beats a countdown (ASSUMED copy).
  if (due) return PENDING_DUE_LABEL;
  return hoursLeft !== null ? `Còn ${hoursLeft} giờ` : "Đang xét 48 giờ"; // fallback ASSUMED
}

/**
 * Figma 7 balance tiles "Chờ duyệt · Đóng băng · Ký quỹ" (desktop 62:272,
 * 138.7 × 102; mobile 62:1092, 110 × 105). Integrity Hold has no tile in
 * Figma; it is shown as a note under the tiles when non-zero (ASSUMED).
 */
export function BucketCards({ balance, pendingHoursLeft, pendingDue }: BucketCardsProps) {
  const tiles = [
    { label: "Chờ duyệt", value: balance.pending, note: pendingNote(balance, pendingHoursLeft, pendingDue), accent: true },
    {
      label: "Đóng băng",
      value: balance.frozen,
      note: balance.frozen > 0 ? "Mở khi xong khảo sát đầu" : "Đã mở khoá", // "Mở khi…" ASSUMED
      accent: false,
    },
    { label: "Ký quỹ", value: balance.escrow, note: "Khảo sát của bạn", accent: false },
  ];

  return (
    <div className="flex flex-col gap-2">
      <ul className="grid grid-cols-3 gap-2.5 lg:gap-3">
        {tiles.map((tile) => (
          <li
            key={tile.label}
            className="flex min-h-[105px] flex-col gap-1 rounded-2xl border border-line bg-surface px-3 pt-[11px] pb-3 lg:min-h-[102px] lg:px-3.5 lg:pt-[13px]"
          >
            <span className="text-[12px] font-semibold text-ink-muted lg:text-caption">{tile.label}</span>
            <span
              className={`text-[22px] font-extrabold lg:text-[26px] ${tile.accent ? "text-tone-amber-fg" : "text-ink"}`}
            >
              {formatPoints(tile.value)}
            </span>
            <span className="text-[11px] text-ink-muted lg:text-[12px]">{tile.note}</span>
          </li>
        ))}
      </ul>
      {balance.integrityHold > 0 ? (
        <p className="px-1 text-[12px] text-ink-muted">
          {formatPoints(balance.integrityHold)} điểm đang giữ để xét chất lượng câu trả lời.
        </p>
      ) : null}
    </div>
  );
}
