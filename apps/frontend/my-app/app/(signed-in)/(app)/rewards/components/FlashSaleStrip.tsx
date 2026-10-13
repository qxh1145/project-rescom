import type { FlashSaleListDto } from "@rescom/schemas";
import { Icon } from "@/components/ui/Icon";
import { formatDayMonth, formatTime, vietnamDateKey } from "@/lib/format/date-time";
import { flashItemOrder } from "@/lib/rewards/voucher-display";
import { useServerNow } from "../hooks/use-server-now";
import { Countdown } from "./Countdown";
import { FlashSaleCard } from "./FlashSaleCard";

interface FlashSaleStripProps {
  flashSales: FlashSaleListDto;
  /** Server clock offset; the strip ticks itself so the list below does not re-render every second. */
  offsetMs: number;
  onCountdownElapsed?: () => void;
  className?: string;
}

export function FlashSaleStrip({
  flashSales,
  offsetMs,
  onCountdownElapsed,
  className = "",
}: FlashSaleStripProps) {
  const nowMs = useServerNow(offsetMs);
  // Flatten items across sales
  const allItems = flashSales.items.flatMap((fs) =>
    fs.items.map((item) => ({ ...item, saleStartsAt: fs.startsAt, saleEndsAt: fs.endsAt }))
  );

  if (allItems.length === 0) return null;

  // Find active program targeting earliest-ending ACTIVE program
  const activePrograms = flashSales.items.filter((fs) => {
    const startMs = Date.parse(fs.startsAt);
    const endMs = Date.parse(fs.endsAt);
    return nowMs >= startMs && nowMs < endMs;
  });

  activePrograms.sort((a, b) => Date.parse(a.endsAt) - Date.parse(b.endsAt));

  const upcomingPrograms = flashSales.items.filter((fs) => {
    const startMs = Date.parse(fs.startsAt);
    return nowMs < startMs;
  });
  upcomingPrograms.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));

  const currentProgram = activePrograms[0] ?? upcomingPrograms[0] ?? null;
  const isProgramActive = Boolean(activePrograms[0]);

  // Sort items: ACTIVE, UPCOMING, SOLD_OUT, ENDED
  allItems.sort((a, b) => flashItemOrder(a.state) - flashItemOrder(b.state));

  const perUserCap = currentProgram?.items[0]?.perUserCap ?? 1;
  const flashCaption = currentProgram
    ? `Kết thúc lúc ${formatTime(currentProgram.endsAt)} ${
        vietnamDateKey(currentProgram.endsAt) === vietnamDateKey(new Date(nowMs))
          ? "hôm nay"
          : `ngày ${formatDayMonth(currentProgram.endsAt)}`
      }. Mỗi người đổi ${perUserCap} suất; hết giờ hoặc hết suất thì giá về như thường.`
    : "";

  return (
    <div
      className={[
        "relative overflow-hidden rounded-[24px] bg-primary p-4.5 md:p-6 text-white shadow-xs",
        className,
      ].join(" ")}
    >
      {/* Header: mobile = one line (title + countdown right); desktop = icon + title/caption left, countdown right (Figma 122:511) */}
      <div className="flex items-center gap-2 md:items-start md:gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/20 text-tone-amber-accent md:h-10 md:w-10">
          <Icon name="zap" size={20} />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="whitespace-nowrap text-title-sm font-extrabold tracking-tight text-white md:text-title">
            Flash Sale
          </h2>
          {currentProgram && isProgramActive && (
            <p className="hidden max-w-xl text-caption text-white/80 md:block">
              {flashCaption}
            </p>
          )}
        </div>
        {currentProgram && (
          <div className="ml-auto flex shrink-0 items-center gap-2 md:self-center">
            <span className="sr-only whitespace-nowrap text-caption font-semibold text-white/90 sm:not-sr-only">
              {isProgramActive ? "Kết thúc sau" : "Bắt đầu sau"}
            </span>
            <Countdown
              endsAt={isProgramActive ? currentProgram.endsAt : currentProgram.startsAt}
              nowMs={nowMs}
              kind={isProgramActive ? "ends" : "starts"}
              tone="onBrand"
              onElapsed={onCountdownElapsed}
            />
          </div>
        )}
      </div>
      {currentProgram && isProgramActive && (
        <p className="mt-2 text-caption text-white/80 md:hidden">{flashCaption}</p>
      )}

      {/* Cards list: horizontal scroll on mobile, 4 per row (wrapping) on desktop */}
      <div className="mt-4 flex gap-3.5 overflow-x-auto pb-2 pt-1 scroll-smooth no-scrollbar lg:grid lg:grid-cols-4 lg:overflow-visible">
        {allItems.map((item) => (
          <FlashSaleCard
            key={item.id}
            item={item}
            startsAt={item.saleStartsAt}
            nowMs={nowMs}
          />
        ))}
      </div>
    </div>
  );
}
