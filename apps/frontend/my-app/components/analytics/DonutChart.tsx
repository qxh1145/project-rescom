"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { formatCount, type DistributionRow } from "@/lib/forms/results-analytics";
import { ChartTooltip } from "./ChartTooltip";
import { CHART_ANIMATION_MS, DONUT_HEIGHT } from "./chart-sizes";
import { useReducedMotion } from "./use-reduced-motion";

/**
 * Donut of a single-choice question (≤ 5 options): 2px white gaps between
 * slices, the answered total in the middle. The numbers live in the
 * `DistributionTable` next to it, so the drawing itself is hidden from AT.
 */
export function DonutChart({ rows, total }: { rows: readonly DistributionRow[]; total: number }) {
  const reducedMotion = useReducedMotion();
  // Zero slices would only draw a white stroke.
  const slices = rows.filter((row) => row.count > 0);

  return (
    <div className="relative w-full max-w-[240px]" style={{ height: DONUT_HEIGHT }} aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart accessibilityLayer={false}>
          <Pie
            data={slices}
            dataKey="count"
            nameKey="label"
            innerRadius="62%"
            outerRadius="96%"
            startAngle={90}
            endAngle={-270}
            stroke="#ffffff"
            strokeWidth={2}
            isAnimationActive={!reducedMotion}
            animationDuration={CHART_ANIMATION_MS}
          >
            {slices.map((row) => (
              <Cell key={row.key} fill={row.color} />
            ))}
          </Pie>
          <Tooltip content={ChartTooltip} isAnimationActive={false} />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[24px] leading-7 font-extrabold text-ink">{formatCount(total)}</span>
        <span className="text-[12px] text-ink-muted">câu trả lời</span>
      </div>
    </div>
  );
}
