import type { DropOffBar } from "@/lib/forms/results-quality";

const PLOT_HEIGHT = 136; // px between the baseline and the tallest bar (Figma 12%–80% of 200)

/** Gridlines: every whole count below the peak for small counts, else the half-way value. */
function gridValues(max: number): number[] {
  if (max <= 1) return [];
  if (max <= 5) return Array.from({ length: max - 1 }, (_, index) => index + 1);
  return [Math.round(max / 2)];
}

/**
 * "Người dừng lại ở câu nào" (Figma 17, 63:4772): one column per question,
 * single series in the primary color, the peak labelled ("2 người"), hover /
 * focus tooltip on every column and a table for screen readers.
 */
export function DropOffChart({ bars }: { bars: DropOffBar[] }) {
  const max = Math.max(0, ...bars.map((bar) => bar.count));
  const peak = bars.find((bar) => bar.count === max && max > 0);
  const scale = (count: number) => (max ? (count / max) * PLOT_HEIGHT : 0);
  return (
    <div className="w-full max-w-[600px]">
      <div className="relative h-50">
        {/* Baseline + gridlines (hairline, recessive). */}
        <div aria-hidden="true" className="absolute inset-x-0 top-40 h-px bg-line" />
        {gridValues(max).map((value) => (
          <div key={value} aria-hidden="true" className="absolute inset-x-0 h-px bg-line" style={{ top: 160 - scale(value) }} />
        ))}
        <div className="absolute inset-x-0 top-0 flex h-40">
          {bars.map((bar) => {
            const height = scale(bar.count);
            return (
              <div
                key={bar.questionNumber}
                tabIndex={0}
                role="img"
                aria-label={`${bar.label}: ${bar.count} người dừng lại`}
                className="group relative flex flex-1 flex-col items-center justify-end rounded-t-lg outline-none focus-visible:bg-surface-muted"
              >
                {bar === peak ? (
                  <span aria-hidden="true" className="mb-1 text-caption font-bold text-ink">{bar.count} người</span>
                ) : null}
                <span
                  className={`w-[58%] max-w-11 ${bar.count ? "rounded-t-[4px] bg-primary group-hover:bg-primary-hover" : "h-0.5 bg-line"}`}
                  style={bar.count ? { height } : undefined}
                />
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute bottom-full z-10 mb-1 hidden whitespace-nowrap rounded-lg bg-ink px-2.5 py-1.5 text-caption text-primary-foreground shadow-md group-hover:block group-focus-visible:block"
                >
                  {bar.label} · {bar.count} người dừng lại
                </span>
              </div>
            );
          })}
        </div>
        <div aria-hidden="true" className="absolute inset-x-0 top-[167px] flex">
          {bars.map((bar) => (
            <span key={bar.questionNumber} className="flex-1 text-center text-caption text-ink-muted">
              {bar.label}
            </span>
          ))}
        </div>
      </div>
      <table className="sr-only">
        <caption>Số người dừng lại ở từng câu</caption>
        <thead>
          <tr>
            <th scope="col">Câu</th>
            <th scope="col">Số người dừng lại</th>
          </tr>
        </thead>
        <tbody>
          {bars.map((bar) => (
            <tr key={bar.questionNumber}>
              <th scope="row">{bar.label}</th>
              <td>{bar.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
