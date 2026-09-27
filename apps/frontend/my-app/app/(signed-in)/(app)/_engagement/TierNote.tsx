import { Icon } from "@/components/ui/Icon";

/** Figma 16 / 16b info note (63:5028, 63:3270): tiers never measure answer reliability. */
export function TierNote({ className = "" }: { className?: string }) {
  return (
    <p className={`flex gap-2.5 rounded-field bg-surface-subtle py-[11px] pl-3.5 pr-3.5 text-caption-relaxed text-ink-strong ${className}`}>
      <Icon name="info" size={18} className="mt-px text-ink-muted" />
      <span>
        Hạng chỉ dựa trên số khảo sát bạn đã làm. Hạng không đo độ tin cậy câu trả lời và không ảnh hưởng đến đánh giá
        chất lượng.
      </span>
    </p>
  );
}
