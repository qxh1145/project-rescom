/**
 * Loading blocks for the parts of /rewards that are not already on screen
 * (balance, search and chips render straight away).
 */
export function FlashStripSkeleton() {
  return (
    <div
      className="rounded-[24px] bg-primary/10 p-4.5 md:p-6"
      aria-hidden="true"
    >
      <div className="thought-skeleton h-8 w-48 rounded-[8px]" />
      <div className="mt-4 flex gap-3.5 overflow-hidden lg:grid lg:grid-cols-4">
        <div className="thought-skeleton h-[280px] w-[232px] shrink-0 rounded-[20px] lg:w-auto" />
        <div className="thought-skeleton h-[280px] w-[232px] shrink-0 rounded-[20px] lg:w-auto" />
        <div className="thought-skeleton hidden h-[280px] rounded-[20px] lg:block" />
        <div className="thought-skeleton hidden h-[280px] rounded-[20px] lg:block" />
      </div>
    </div>
  );
}

export function ListSkeleton() {
  return (
    <div role="status" aria-label="Đang tải danh sách voucher">
      {/* Mobile: Row cards */}
      <div className="flex flex-col gap-3 lg:hidden">
        <div className="thought-skeleton h-[118px] w-full rounded-[20px]" />
        <div className="thought-skeleton h-[118px] w-full rounded-[20px]" />
        <div className="thought-skeleton h-[118px] w-full rounded-[20px]" />
      </div>

      {/* Desktop: 4-column Tile grid */}
      <div className="hidden lg:grid lg:grid-cols-4 lg:gap-4">
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className="thought-skeleton h-[300px] rounded-[20px]" />
        ))}
      </div>
    </div>
  );
}
