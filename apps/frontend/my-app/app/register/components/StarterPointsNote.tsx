import { Icon } from "@/components/ui/Icon";

/** Figma `63:3459`: amber note under the register CTA (FR-4 starter grant, unlocked later). */
export function StarterPointsNote() {
  return (
    <div className="flex items-center gap-2.5 rounded-control bg-tone-amber-bg px-3.5 py-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-tone-amber-accent text-ink">
        <Icon name="lock" size={18} />
      </span>
      <p className="text-caption leading-[18.9px] text-tone-amber-ink">
        <strong className="font-bold text-ink">Tặng 100 điểm khởi đầu.</strong> Mở khoá khi hoàn tất
        hồ sơ và làm 1 khảo sát trong 30 ngày.
      </p>
    </div>
  );
}
