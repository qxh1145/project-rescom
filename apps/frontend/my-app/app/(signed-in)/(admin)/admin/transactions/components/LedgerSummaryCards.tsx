import type { AdminLedgerSummary } from "@/lib/admin/transactions-service";
import { formatPoints, formatVnd } from "@/lib/wallet/top-up";

type ValueTone = "ink" | "amber" | "teal";

const VALUE_TONES: Record<ValueTone, string> = {
  ink: "text-ink",
  amber: "text-tone-amber-fg",
  teal: "text-tone-teal-fg",
};

interface Card {
  label: string;
  value: string;
  caption: string;
  tone: ValueTone;
}

function cardsOf(summary: AdminLedgerSummary | undefined): Card[] {
  const value = (points: number | undefined) => (points === undefined ? "…" : formatPoints(points));
  const pending = summary?.pendingTopUps;
  return [
    {
      label: "Nạp điểm chờ duyệt",
      value: value(pending?.points),
      caption: pending ? `${pending.count} yêu cầu · ${formatVnd(pending.amountVnd)}` : "Đang tải…",
      tone: "ink",
    },
    { label: "Đang ký quỹ", value: value(summary?.escrowTotal), caption: "Trên các khảo sát đang chạy", tone: "amber" },
    {
      label: "Đang chờ 48 giờ",
      value: value(summary?.pendingTotal),
      caption: "Điểm Google Forms chưa chuyển",
      tone: "ink",
    },
    {
      label: "Đã hoàn hôm nay",
      value: value(summary?.refundedToday.points),
      // ASSUMED copy: Figma "1 khảo sát bị từ chối"; a refund also happens when a publisher closes a survey early.
      caption: summary ? `${summary.refundedToday.surveys} khảo sát được hoàn ký quỹ` : "Đang tải…",
      tone: "teal",
    },
  ];
}

/** Figma 63:1685–63:1697: four 109px cards (18px radius, 28px value). */
export function LedgerSummaryCards({ summary }: { summary: AdminLedgerSummary | undefined }) {
  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-busy={!summary || undefined}>
      {cardsOf(summary).map((card) => (
        <li
          key={card.label}
          className="flex min-h-27.25 flex-col rounded-[18px] border border-line bg-surface px-4.5 pt-4 pb-4"
        >
          <span className="text-caption font-semibold text-ink-muted">{card.label}</span>
          <span className={`mt-1.5 text-[28px] leading-7 font-extrabold ${VALUE_TONES[card.tone]}`}>{card.value}</span>
          <span className="mt-2 text-[12px] text-ink-muted">{card.caption}</span>
        </li>
      ))}
    </ul>
  );
}
