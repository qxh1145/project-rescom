import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { Icon } from "@/components/ui/Icon";

/** Offline status row (63:5271): amber strip with an 18px icon. */
export function StatusRow({
  icon,
  children,
  ...props
}: { icon: string; children: ReactNode } & Omit<ComponentPropsWithoutRef<"div">, "children">) {
  return (
    <div
      className="flex min-h-10.75 items-center gap-2.5 rounded-field bg-tone-amber-bg px-3.5 py-3 text-left text-caption leading-[18.9px] text-tone-amber-ink"
      {...props}
    >
      <Icon name={icon} size={18} className="text-tone-amber-fg" />
      <span>{children}</span>
    </div>
  );
}

/** Rate-limit countdown panel (63:6111): label + 30px time, centered. */
export function CountdownPanel({ label, time }: { label: string; time: string }) {
  return (
    <div role="timer" className="flex h-21 flex-col items-center justify-center gap-0.5 rounded-2xl bg-tone-green-bg text-center">
      <span className="text-caption font-semibold text-tone-green-fg">{label}</span>
      <span className="text-[30px] font-extrabold leading-normal tabular-nums text-ink">{time}</span>
    </div>
  );
}

/** Survey summary (63:6261): bordered card with the title and response count. */
export function SurveySummaryCard({ title, meta }: { title: string; meta: string }) {
  return (
    <div className="rounded-control border border-line bg-surface px-3.5 py-3 text-left">
      <p className="text-body font-bold text-ink">{title}</p>
      <p className="mt-1 text-caption text-ink-muted">{meta}</p>
    </div>
  );
}
