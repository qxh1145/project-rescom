import Link from "next/link";
import type { VoucherListItemDto } from "@rescom/schemas";
import { Tag } from "@/components/ui/Tag";
import {
  formatPoints,
  formatVnd,
  voucherCardState,
  voucherMetaLine,
} from "@/lib/rewards/voucher-display";
import { VoucherThumb } from "./VoucherThumb";

interface VoucherCardProps {
  item: VoucherListItemDto;
  layout?: "row" | "tile";
  className?: string;
}

export function VoucherCard({ item, layout = "row", className = "" }: VoucherCardProps) {
  const cardState = voucherCardState(item);
  const meta = voucherMetaLine(item);
  const isOnSale = cardState === "sale";
  const isSoldOut = cardState === "soldOut";
  const isExpired = cardState === "expired";
  const isPaused = cardState === "paused";
  const isMuted = isSoldOut || isExpired;

  const accessibleName = `${item.brand.name} - ${item.title} - ${formatPoints(item.price.points)} điểm - ${meta}`;

  if (layout === "tile") {
    return (
      <Link
        href={`/rewards/${item.id}`}
        aria-label={accessibleName}
        className={[
          "group flex flex-col overflow-hidden rounded-[20px] border transition-all hover:border-primary/50 hover:shadow-sm",
          isMuted ? "border-line bg-surface-muted/60 opacity-80" : "border-line bg-surface",
          className,
        ].join(" ")}
      >
        <div className="relative">
          <VoucherThumb
            brand={item.brand}
            category={item.category}
            imageUrl={item.imageUrl}
            size="tile"
          />
          {isSoldOut && (
            <div className="absolute top-2 left-2">
              <Tag tone="danger" size="sm">Hết hàng</Tag>
            </div>
          )}
          {isExpired && (
            <div className="absolute top-2 left-2">
              <Tag tone="neutral" size="sm">Hết hạn đổi</Tag>
            </div>
          )}
          {isPaused && (
            <div className="absolute top-2 left-2">
              <Tag tone="neutral" size="sm">Tạm dừng</Tag>
            </div>
          )}
        </div>

        <div className="flex flex-1 flex-col gap-1 p-4">
          <span className="text-caption font-medium text-ink-muted">{item.brand.name}</span>
          <h3 className="line-clamp-2 text-body font-bold text-ink group-hover:text-primary transition-colors">
            {item.title}
          </h3>
          <span className="text-caption text-ink-muted">Trị giá {formatVnd(item.valueVnd)}</span>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Tag tone="amber" size="md">
              {formatPoints(item.price.points)} điểm
            </Tag>
            {isOnSale && (
              <>
                <span className="text-caption text-ink-muted line-through">
                  {formatPoints(item.price.basePoints)}
                </span>
                <span className="rounded-full bg-sale-bg px-2 py-0.5 text-xs font-bold text-sale-text">
                  -{item.price.discountPercent}%
                </span>
              </>
            )}
          </div>
          <span className="text-caption text-ink-muted">{meta}</span>
        </div>
      </Link>
    );
  }

  // Row layout (mobile default, 350px wide)
  return (
    <Link
      href={`/rewards/${item.id}`}
      aria-label={accessibleName}
      className={[
        "group flex items-center gap-3.5 rounded-[20px] border p-3.5 transition-all hover:border-primary/50 hover:shadow-xs",
        isMuted ? "border-line bg-surface-muted/60 opacity-80" : "border-line bg-surface",
        className,
      ].join(" ")}
    >
      <div className="relative">
        <VoucherThumb
          brand={item.brand}
          category={item.category}
          imageUrl={item.imageUrl}
          size="md"
        />
        {isOnSale && (
          <span className="absolute -top-1.5 -left-1.5 rounded-full bg-sale-bg px-1.5 py-0.2 text-[11px] font-bold text-sale-text shadow-xs">
            -{item.price.discountPercent}%
          </span>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col justify-between">
        <div className="flex flex-col">
          <div className="flex items-center justify-between gap-1">
            <span className="text-caption font-medium text-ink-muted truncate">{item.brand.name}</span>
            {isSoldOut && <Tag tone="danger" size="sm">Hết hàng</Tag>}
            {isExpired && <Tag tone="neutral" size="sm">Hết hạn đổi</Tag>}
            {isPaused && <Tag tone="neutral" size="sm">Tạm dừng</Tag>}
          </div>
          <h3 className="line-clamp-1 text-body font-bold text-ink group-hover:text-primary transition-colors">
            {item.title}
          </h3>
        </div>

        <div className="mt-1 flex flex-wrap items-baseline gap-1.5">
          <Tag tone="amber" size="sm">
            {formatPoints(item.price.points)} điểm
          </Tag>
          {isOnSale && (
            <span className="text-caption text-ink-muted line-through">
              {formatPoints(item.price.basePoints)}
            </span>
          )}
        </div>
        <span className="mt-1 text-caption text-ink-muted">{meta}</span>
      </div>
    </Link>
  );
}
