"use client";

import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { LabelProps } from "recharts";
import {
  CHART_AXIS_COLOR,
  CHART_GRID_COLOR,
  CHART_TRACK_COLOR,
  formatCount,
  formatPercent,
  type DistributionRow,
} from "@/lib/forms/results-analytics";
import { ChartTooltip } from "./ChartTooltip";
import { CHART_ANIMATION_MS, VERTICAL_BAR_HEIGHT } from "./chart-sizes";
import { useReducedMotion } from "./use-reduced-motion";

/** Category gap of the vertical bars — also used to tell whether a count label fits its slot. */
const CATEGORY_GAP = 0.3;
const AXIS_TICK = { fill: CHART_AXIS_COLOR, fontSize: 12 };

/** Count above a vertical bar, drawn only when it fits the bar's category slot. */
function CountLabel({ x, y, width, value }: LabelProps) {
  const slot = Number(width) / (1 - CATEGORY_GAP);
  const text = formatCount(Number(value));
  if (!Number.isFinite(slot) || text.length * 7 > slot) return null;
  return (
    <text
      x={Number(x) + Number(width) / 2}
      y={Number(y) - 6}
      textAnchor="middle"
      fontSize={11}
      fontWeight={700}
      fill={CHART_AXIS_COLOR}
    >
      {text}
    </text>
  );
}

/** Rating / linear scale / number bins: thin bars with a 4px rounded top on a recessive grid. */
function VerticalBars({ rows }: { rows: readonly DistributionRow[] }) {
  const reducedMotion = useReducedMotion();
  return (
    <div className="w-full" style={{ height: VERTICAL_BAR_HEIGHT }} aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={[...rows]}
          margin={{ top: 20, right: 4, bottom: 0, left: 0 }}
          barCategoryGap={`${CATEGORY_GAP * 100}%`}
          accessibilityLayer={false}
        >
          <CartesianGrid vertical={false} stroke={CHART_GRID_COLOR} />
          <XAxis
            dataKey="label"
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={{ stroke: CHART_GRID_COLOR }}
            interval="preserveStartEnd"
            minTickGap={4}
          />
          <YAxis allowDecimals={false} tick={AXIS_TICK} tickLine={false} axisLine={false} width={36} />
          <Tooltip content={ChartTooltip} cursor={{ fill: CHART_GRID_COLOR }} isAnimationActive={false} />
          <Bar
            dataKey="count"
            maxBarSize={32}
            radius={[4, 4, 0, 0]}
            isAnimationActive={!reducedMotion}
            animationDuration={CHART_ANIMATION_MS}
          >
            {rows.map((row) => (
              <Cell key={row.key} fill={row.color} />
            ))}
            <LabelList dataKey="count" content={CountLabel} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Checkbox / single choice with > 5 options: HTML bars so a long option label
 * wraps on its own line (never clipped, even at 360px) and "245 · 76,3%"
 * is readable without hovering. Bar length is relative to the largest count.
 */
function HorizontalBars({ rows }: { rows: readonly DistributionRow[] }) {
  const max = Math.max(1, ...rows.map((row) => row.count));
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((row) => {
        const figures = `${formatCount(row.count)} · ${formatPercent(row.percentage)}`;
        return (
          <li key={row.key} title={`${row.label}: ${formatCount(row.count)} câu trả lời · ${formatPercent(row.percentage)}`}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 text-body-sm break-words text-ink">{row.label}</span>
              <span className="shrink-0 text-caption font-bold whitespace-nowrap text-ink tabular-nums">{figures}</span>
            </div>
            <div
              aria-hidden="true"
              className="mt-1.5 h-2.5 overflow-hidden rounded-full"
              style={{ backgroundColor: CHART_TRACK_COLOR }}
            >
              <div
                className="h-full rounded-full"
                style={{ width: `${(row.count / max) * 100}%`, backgroundColor: row.color }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Distribution of one question as bars. `vertical` = Recharts (hidden from AT;
 * pair it with a `DistributionTable`), `horizontal` = an HTML list that
 * carries its own labels and figures.
 */
export function DistributionBarChart({
  rows,
  orientation,
}: {
  rows: readonly DistributionRow[];
  orientation: "horizontal" | "vertical";
}) {
  return orientation === "vertical" ? <VerticalBars rows={rows} /> : <HorizontalBars rows={rows} />;
}
