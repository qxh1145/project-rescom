import { formatShortDateTime } from "@/lib/format/date-time";
import type { FormAnalytics } from "@/lib/forms/results-analytics-service";
import { formatCount, formatPercent, headerMetrics, responsesLabel } from "@/lib/forms/results-analytics";
import { formatDurationLong } from "@/lib/forms/results-view";

interface Tile {
  label: string;
  value: string;
  caption: string;
}

/**
 * Tóm tắt header: "321 câu trả lời" + stat tiles in the quality-screen style.
 * A tile is drawn only when the data backs it (`headerMetrics` → null hides it).
 */
export function AnalyticsHeader({ analytics }: { analytics: FormAnalytics }) {
  const metrics = headerMetrics(analytics);
  const tiles: Tile[] = [];
  if (metrics.completionRate !== null && analytics.startedCount !== null) {
    tiles.push({
      label: "Tỷ lệ hoàn thành",
      value: formatPercent(metrics.completionRate),
      caption: `${formatCount(metrics.totalResponses)} / ${formatCount(analytics.startedCount)} lượt bắt đầu`,
    });
  }
  if (metrics.averageDurationSeconds !== null) {
    tiles.push({
      label: "Thời gian trung bình",
      value: formatDurationLong(metrics.averageDurationSeconds),
      caption: "mỗi lượt hoàn thành",
    });
  }
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
            <li key={tile.label} className="flex flex-col gap-1.5 rounded-[18px] border border-line bg-surface p-4 lg:p-4.5">
              <span className="text-caption font-semibold text-ink-muted">{tile.label}</span>
              <span className="text-[20px] leading-[26px] font-extrabold text-ink lg:text-[24px]">{tile.value}</span>
              <span className="text-[12px] text-ink-muted">{tile.caption}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
