import { formatCount, formatPercent, type DistributionRow } from "@/lib/forms/results-analytics";

/**
 * Legend + data table of one distribution (color dot · label · count · %), a
 * real `<table>` so it doubles as the accessible view of the chart.
 * `summary` = compact legend (headers for screen readers only); `detail` =
 * table with "Lựa chọn · Số câu trả lời · Tỷ lệ". Labels wrap, never truncate.
 */
export function DistributionTable({
  rows,
  caption,
  variant = "summary",
  showColor = false,
  note,
  className = "",
}: {
  rows: readonly DistributionRow[];
  /** Accessible name of the table (usually the question title). */
  caption: string;
  variant?: "summary" | "detail";
  /** Color dots — only when the chart next to it is multi-colored (donut). */
  showColor?: boolean;
  /** Line under the table, e.g. "tổng tỷ lệ có thể vượt 100%". */
  note?: string | null;
  className?: string;
}) {
  const detail = variant === "detail";
  const cell = detail ? "py-2.5" : "py-1.5";
  return (
    <div className={`min-w-0 ${className}`}>
      <table className="w-full border-collapse text-left">
        <caption className="sr-only">{caption}</caption>
        <thead className={detail ? "" : "sr-only"}>
          <tr className="text-[12px] font-semibold text-ink-muted">
            <th scope="col" className="pb-2 font-semibold">
              Lựa chọn
            </th>
            <th scope="col" className="pb-2 pl-3 text-right font-semibold whitespace-nowrap">
              Số câu trả lời
            </th>
            <th scope="col" className="pb-2 pl-3 text-right font-semibold">
              Tỷ lệ
            </th>
          </tr>
        </thead>
        <tbody className={detail ? "text-body-sm" : "text-caption"}>
          {rows.map((row) => (
            <tr key={row.key} className={detail ? "border-t border-line-subtle" : ""}>
              <th scope="row" className={`${cell} align-top font-normal text-ink`}>
                <span className="flex items-start gap-2">
                  {showColor ? (
                    <span
                      aria-hidden="true"
                      className="mt-[5px] size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: row.color }}
                    />
                  ) : null}
                  <span className="min-w-0 break-words">{row.label}</span>
                </span>
              </th>
              <td className={`${cell} pl-3 text-right align-top font-bold whitespace-nowrap text-ink tabular-nums`}>
                {formatCount(row.count)}
              </td>
              <td className={`${cell} pl-3 text-right align-top whitespace-nowrap text-ink-muted tabular-nums`}>
                {formatPercent(row.percentage)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {note ? <p className="mt-2 text-[12px] leading-[18px] text-ink-muted">{note}</p> : null}
    </div>
  );
}
