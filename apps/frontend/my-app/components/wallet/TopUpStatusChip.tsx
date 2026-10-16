import { Icon } from "@/components/ui/Icon";
import type { TopUpChipInfo } from "@/lib/wallet/top-up-history";

const TONE_CLASSES: Record<TopUpChipInfo["tone"], string> = {
  amber: "bg-tone-amber-bg text-tone-amber-fg border-tone-amber-accent/30",
  green: "bg-tone-green-bg text-tone-green-fg border-tone-green-accent/30",
  grey: "bg-slate-100 text-ink-muted border-slate-200",
  teal: "bg-teal-50 text-teal-800 border-teal-200",
  danger: "bg-tone-danger-bg text-tone-danger-fg border-tone-danger-accent/30",
};

export function TopUpStatusChip({ chip }: { chip: TopUpChipInfo }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
        TONE_CLASSES[chip.tone] ?? TONE_CLASSES.grey
      }`}
    >
      <Icon name={chip.icon} size={12} />
      <span>{chip.label}</span>
    </span>
  );
}
