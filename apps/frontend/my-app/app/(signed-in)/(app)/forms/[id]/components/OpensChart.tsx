import type { OpensSummary } from "@/lib/forms/manage-view";

interface OpensChartProps {
  buckets: readonly { label: string; count: number }[];
  summary: OpensSummary;
}

/**
 * Figma 10a "Lượt mở khảo sát" bars (62:2638 desktop 560×190, 62:3346 mobile
 * 318×146): three guide lines, one bar per bucket, the busiest value on top.
 */
export function OpensChart({ buckets, summary }: OpensChartProps) {
  const max = Math.max(summary.max, 1);
  const description = buckets.map((bucket) => `${bucket.label}: ${bucket.count}`).join(", ");
  return (
    <figure className="w-full lg:max-w-[560px]">
      <div
        role="img"
        aria-label={`Lượt mở theo thời gian — ${description}`}
        className="relative mt-5 h-26 border-b border-line lg:h-32.5"
      >
        <span aria-hidden="true" className="absolute inset-x-0 top-0 border-t border-line-subtle" />
        <span aria-hidden="true" className="absolute inset-x-0 top-1/2 border-t border-line-subtle" />
        <div className="absolute inset-0 flex items-end">
          {buckets.map((bucket, index) => (
            <div key={bucket.label} className="relative flex h-full flex-1 items-end justify-center">
              {index === summary.peakIndex ? (
                <span
                  className="absolute text-[12px] font-bold text-ink lg:text-caption"
                  style={{ bottom: `calc(${(bucket.count / max) * 100}% + 4px)` }}
                >
                  {bucket.count}
                </span>
              ) : null}
              <span
                aria-hidden="true"
                className="w-6 bg-primary lg:w-9"
                style={{ height: `${(bucket.count / max) * 100}%`, minHeight: bucket.count > 0 ? 2 : 0 }}
              />
            </div>
          ))}
        </div>
      </div>
      <div aria-hidden="true" className="mt-1.5 flex text-[12px] text-ink-muted lg:text-caption">
        {buckets.map((bucket) => (
          <span key={bucket.label} className="flex-1 text-center">
            {bucket.label}
          </span>
        ))}
      </div>
    </figure>
  );
}
