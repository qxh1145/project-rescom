import type { StatItem } from "@/lib/forms/results-analytics";

/** Stat chips of a scale / number question ("Trung bình 4,1 / 5", "Trung vị 4", "Tổng 321"); items come from `statItems()`. */
export function StatList({ items, className = "" }: { items: readonly StatItem[]; className?: string }) {
  if (!items.length) return null;
  return (
    <dl className={`flex flex-wrap gap-2 ${className}`}>
      {items.map((item) => (
        <div key={item.label} className="flex items-baseline gap-1.5 rounded-full bg-surface-subtle px-3 py-1.5">
          <dt className="text-[12px] font-semibold text-ink-muted">{item.label}</dt>
          <dd className="text-body-sm font-extrabold text-ink tabular-nums">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
