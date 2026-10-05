import { formatShortDateTime } from "@/lib/format/date-time";
import type { AvailableFormAnalytics } from "@/lib/forms/results-analytics-service";
import { headerMetrics, responsesLabel } from "@/lib/forms/results-analytics";

interface Tile {
  label: string;
  value: string;
  caption: string;
}

/**
 * Tóm tắt header: "321 câu trả lời" + stat tiles in the quality-screen style.
 * A tile is drawn only when the data backs it (`headerMetrics` → null hides
 * it). No completion-rate or average-time tile: FR-41 funnel metrics are
 * deferred (IR.4a R4, Q6).
 */
export function AnalyticsHeader({ analytics }: { analytics: AvailableFormAnalytics }) {
  const metrics = headerMetrics(analytics);
  const tiles: Tile[] = [];
  if (metrics.lastResponseAt !== null) {
    tiles.push({
      label: "Câu trả lời gần nhất",
      value: formatShortDateTime(metrics.lastResponseAt),
      caption: "giờ Việt Nam",
    });
  }

  return (
    <div className="flex flex-col gap-3 lg:gap-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-[22px] leading-7 font-extrabold text-ink lg:text-[26px] lg:leading-8">
          {responsesLabel(metrics.totalResponses)}
        </h2>
        <span className="text-caption text-ink-muted">phiên bản v{analytics.form.versionNumber}</span>
      </div>
      {tiles.length ? (
        <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
          {tiles.map((tile) => (
            // Fixed line boxes (18 · 26 · 18 px), mirrored by `AnalyticsSkeleton`, so loading does not shift the page.
            <li key={tile.label} className="flex flex-col gap-1.5 rounded-[18px] border border-line bg-surface p-4 lg:p-4.5">
              <span className="text-caption leading-[18px] font-semibold text-ink-muted">{tile.label}</span>
              <span className="text-[20px] leading-[26px] font-extrabold text-ink lg:text-[24px]">{tile.value}</span>
              <span className="text-[12px] leading-[18px] text-ink-muted">{tile.caption}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
