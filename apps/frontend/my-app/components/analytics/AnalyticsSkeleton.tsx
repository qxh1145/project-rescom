import { DONUT_HEIGHT, VERTICAL_BAR_HEIGHT } from "./chart-sizes";

const BLOCK = "rounded-[8px] bg-surface-subtle motion-safe:animate-pulse";
const CARD = "flex flex-col gap-4 rounded-[22px] border border-line bg-surface p-5 lg:p-6";

function CardHeader() {
  return (
    <div className="flex flex-col gap-2">
      <div className={`${BLOCK} h-3.5 w-28`} />
      <div className={`${BLOCK} h-5 w-3/4 max-w-[420px]`} />
      <div className={`${BLOCK} h-3.5 w-24`} />
    </div>
  );
}

function DonutCard() {
  return (
    <div className={CARD}>
      <CardHeader />
      <div className="grid gap-4 md:grid-cols-[240px_minmax(0,1fr)] md:items-center md:gap-8">
        <div className="flex justify-center">
          <div className="flex w-full max-w-[240px] items-center justify-center" style={{ height: DONUT_HEIGHT }}>
            <div className={`${BLOCK} aspect-square h-full rounded-full`} />
          </div>
        </div>
        <div className="flex flex-col gap-3">
          {[0, 1, 2, 3].map((row) => (
            <div key={row} className={`${BLOCK} h-4`} />
          ))}
        </div>
      </div>
    </div>
  );
}

function BarCard() {
  return (
    <div className={CARD}>
      <CardHeader />
      <div className="flex gap-2">
        {[0, 1, 2].map((chip) => (
          <div key={chip} className={`${BLOCK} h-8 w-24 rounded-full`} />
        ))}
      </div>
      <div className={BLOCK} style={{ height: VERTICAL_BAR_HEIGHT }} />
    </div>
  );
}

/**
 * Loading state of the analytics screens: header tiles (summary) or the
 * question toolbar, then cards with the same fixed chart heights as the real
 * ones, so nothing jumps when the data arrives.
 */
export function AnalyticsSkeleton({ layout = "summary", label = "Đang tải thống kê…" }: { layout?: "summary" | "question"; label?: string }) {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-4 lg:gap-5">
      <span className="sr-only">{label}</span>
      {layout === "summary" ? (
        <>
          <div className={`${BLOCK} h-7 w-48`} />
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
            {[0, 1, 2].map((tile) => (
              <div key={tile} className="flex flex-col gap-2 rounded-[18px] border border-line bg-surface p-4 lg:p-4.5">
                <div className={`${BLOCK} h-3.5 w-24`} />
                <div className={`${BLOCK} h-6.5 w-16`} />
              </div>
            ))}
          </div>
          <DonutCard />
          <BarCard />
          <DonutCard />
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <div className={`${BLOCK} size-11 rounded-full`} />
            <div className={`${BLOCK} size-11 rounded-full`} />
            <div className={`${BLOCK} h-4 w-20`} />
            <div className={`${BLOCK} h-11 w-full max-w-[420px] sm:flex-1`} />
          </div>
          <DonutCard />
        </>
      )}
    </div>
  );
}
