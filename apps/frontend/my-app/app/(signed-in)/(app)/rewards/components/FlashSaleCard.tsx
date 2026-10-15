import Link from "next/link";
import type { FlashSaleItemDto } from "@rescom/schemas";
import { ButtonLink } from "@/components/ui/Button";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Tag } from "@/components/ui/Tag";
import { formatDayMonth, formatTime, vietnamDateKey } from "@/lib/format/date-time";
import { formatPoints } from "@/lib/rewards/voucher-display";
import { VoucherThumb } from "./VoucherThumb";

interface FlashSaleCardProps {
  item: FlashSaleItemDto;
  startsAt?: string;
  /** Server-adjusted "now", to tell "hôm nay" from a later date. */
  nowMs: number;
  className?: string;
}

export function FlashSaleCard({ item, startsAt, nowMs, className = "" }: FlashSaleCardProps) {
  const isUpcoming = item.state === "UPCOMING";
  const isActive = item.state === "ACTIVE";
  const isSoldOut = item.state === "SOLD_OUT";
  const isEnded = item.state === "ENDED";

  const remainingQuota = Math.max(0, item.quota - item.sold);
  const opensToday = startsAt ? vietnamDateKey(startsAt) === vietnamDateKey(new Date(nowMs)) : false;

  return (
    <div
      className={[
        "flex w-[232px] shrink-0 flex-col overflow-hidden rounded-[20px] border border-line bg-surface shadow-xs transition-all hover:border-primary/40 lg:w-auto",
        isSoldOut || isEnded ? "bg-surface-muted/60 opacity-85" : "",
        className,
      ].join(" ")}
    >
      <div className="relative">
        <VoucherThumb
          brand={item.brand}
          category={item.category}
          size="flash"
        />
        {!isEnded && (
          <span className="absolute top-2.5 left-2.5 rounded-full bg-sale-bg px-2 py-0.5 text-xs font-bold text-sale-text shadow-xs">
            -{item.discountPercent}%
          </span>
        )}
        {isSoldOut && (
          <div className="absolute top-2.5 right-2.5">
            <Tag tone="danger" size="sm">Hết suất</Tag>
          </div>
        )}
        {isEnded && (
          <div className="absolute top-2.5 right-2.5">
            <Tag tone="neutral" size="sm">Đã kết thúc</Tag>
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2.5 p-3">
        <div className="flex flex-col">
          <span className="text-caption font-medium text-ink-muted truncate">{item.brand.name}</span>
          <Link
            href={`/rewards/${item.voucherId}`}
            className="line-clamp-1 text-body font-bold text-ink hover:text-primary transition-colors"
          >
            {item.voucherTitle}
          </Link>
          <div className="mt-1 flex items-baseline gap-1.5">
            <Tag tone="amber" size="sm">
              {formatPoints(isEnded ? item.basePoints : item.flashPoints)} điểm
            </Tag>
            {!isEnded && (
              <span className="text-caption text-ink-muted line-through">
                {formatPoints(item.basePoints)}
              </span>
            )}
          </div>
        </div>

        <div className="mt-auto flex flex-col gap-2">
          {isActive && (
            <>
              <div className="flex flex-col gap-1">
                <div className="flex justify-between text-caption text-ink-muted">
                  <span>Đã đổi {item.sold}/{item.quota}</span>
                  <span>Còn {remainingQuota}</span>
                </div>
                <ProgressBar value={item.sold} max={item.quota} height={6} tone="primary" />
              </div>
              <ButtonLink
                href={`/rewards/${item.voucherId}`}
                variant="primary"
                size="base"
                className="w-full justify-center"
              >
                Đổi ngay
              </ButtonLink>
            </>
          )}

          {isSoldOut && (
            <>
              <div className="flex flex-col gap-1">
                <div className="flex justify-between text-caption text-ink-muted">
                  <span>Đã đổi {item.quota}/{item.quota}</span>
                  <span className="text-danger font-semibold">Hết suất</span>
                </div>
                <ProgressBar value={item.quota} max={item.quota} height={6} tone="primary" />
              </div>
              <button
                type="button"
                disabled
                className="w-full rounded-control border border-dashed border-line-strong h-12 text-center text-label font-medium text-ink-muted cursor-not-allowed"
              >
                Hết suất
              </button>
            </>
          )}

          {isUpcoming && (
            <>
              <p className="text-caption text-ink-muted">
                {startsAt
                  ? `Mở lúc ${formatTime(startsAt)} ${opensToday ? "hôm nay" : `ngày ${formatDayMonth(startsAt)}`}`
                  : "Sắp mở"}{" "}
                · {item.quota} suất
              </p>
              <ButtonLink
                href={`/rewards/${item.voucherId}`}
                variant="secondary"
                size="base"
                className="w-full justify-center"
              >
                Xem voucher
              </ButtonLink>
            </>
          )}

          {isEnded && (
            <>
              <p className="text-caption text-ink-muted">
                Flash Sale đã kết thúc · về giá thường
              </p>
              <ButtonLink
                href={`/rewards/${item.voucherId}`}
                variant="secondary"
                size="base"
                className="w-full justify-center"
              >
                Xem voucher
              </ButtonLink>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
