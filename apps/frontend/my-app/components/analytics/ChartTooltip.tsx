"use client";

import type { TooltipContentProps } from "recharts";
import { formatPercent, responsesLabel, type DistributionRow } from "@/lib/forms/results-analytics";

/** Hover card of the analytics charts: label · "N câu trả lời" · "x%". Text uses ink tokens, never the series color. */
export function ChartTooltip({ active, payload }: Pick<TooltipContentProps<number, string>, "active" | "payload">) {
  const row = active ? (payload?.[0]?.payload as DistributionRow | undefined) : undefined;
  if (!row) return null;
  return (
    <div className="max-w-[240px] rounded-field border border-line bg-surface px-3 py-2 text-caption shadow-[0_4px_16px_rgba(30,36,70,0.12)]">
      <p className="font-bold break-words text-ink">{row.label}</p>
      <p className="mt-0.5 text-ink-strong">
        {responsesLabel(row.count)} · {formatPercent(row.percentage)}
      </p>
    </div>
  );
}
