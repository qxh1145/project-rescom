"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { VoucherListItemDto } from "@rescom/schemas";
import { MobileBackBar } from "@/components/layout/app/MobileTopBar";
import { Alert } from "@/components/ui/Alert";
import { Button, ButtonLink, buttonClassName } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Tag } from "@/components/ui/Tag";
import {
  detailExpiryLine,
  detailStockLine,
  formatFullDate,
  formatPoints,
  formatVnd,
  howToGetCodeLine,
  shortfall,
  suggestedTopUp,
  topUpVnd,
} from "@/lib/rewards/voucher-display";
import { listVouchers } from "@/lib/rewards/rewards-service";
import { useServerNow } from "../hooks/use-server-now";
import { useVoucherDetail } from "../hooks/use-voucher-detail";
import { Countdown } from "./Countdown";
import { VoucherCard } from "./VoucherCard";
import { VoucherThumb } from "./VoucherThumb";

interface VoucherDetailScreenProps {
  voucherId: string;
  /** Story 12.3 opens the confirmation step here. Without it the CTA stays disabled. */
  onRedeem?: () => void;
}

const REDEEM_PENDING_TITLE = "Sẽ mở ở bước xác nhận (Story 12.3)";
const DISABLED_DASHED =
  "rounded-control border border-dashed border-line-strong text-center text-label font-medium text-ink-muted cursor-not-allowed";

export function VoucherDetailScreen({ voucherId, onRedeem }: VoucherDetailScreenProps) {
  const { voucher, viewer, flashItem, loading, error, offsetMs, reloadAll } = useVoucherDetail(voucherId);
  const nowMs = useServerNow(offsetMs);

  // Similar vouchers are only shown for SOLD_OUT; results are tagged with the
  // voucher they were fetched for, so a previous voucher's list never shows.
  const [similar, setSimilar] = useState<{ forId: string; items: VoucherListItemDto[] }>({ forId: "", items: [] });
  const similarVouchers = similar.forId === voucherId ? similar.items : [];
  const soldOutCategory = voucher?.status === "SOLD_OUT" ? voucher.category : null;

  useEffect(() => {
    if (!soldOutCategory) return;
    const controller = new AbortController();
    const pick = (items: VoucherListItemDto[]) =>
      items.filter((item) => item.id !== voucherId && item.status === "AVAILABLE").slice(0, 2);
    void (async () => {
      try {
        let items = pick((await listVouchers(`category=${soldOutCategory}&limit=4`, controller.signal)).items);
        if (items.length === 0) items = pick((await listVouchers("limit=4", controller.signal)).items);
        if (!controller.signal.aborted) setSimilar({ forId: voucherId, items });
      } catch {
        // Decorative section: a failed lookup just leaves it out.
      }
    })();
    return () => controller.abort();
  }, [voucherId, soldOutCategory]);

  if (loading && !voucher) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <div className="thought-skeleton h-[300px] w-full rounded-[24px]" />
      </div>
    );
  }

  if (error && !voucher) {
    if (error.code === "VOUCHER_NOT_FOUND" || error.status === 404) {
      return (
        <div className="mx-auto max-w-md px-4 py-16 text-center">
          <h2 className="text-title-sm font-bold text-ink">Voucher này không còn hiển thị.</h2>
          <p className="mt-2 text-body text-ink-muted">Có thể voucher đã hết hạn hoặc được gỡ xuống.</p>
          <div className="mt-6">
            <ButtonLink href="/rewards" variant="primary" size="md">
              Về Đổi quà
            </ButtonLink>
          </div>
        </div>
      );
    }

    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <h2 className="text-title-sm font-bold text-ink">Không thể tải thông tin voucher</h2>
        <p className="mt-2 text-body text-ink-muted">Vui lòng kiểm tra lại kết nối mạng.</p>
        <div className="mt-6 flex justify-center gap-3">
          <Button variant="primary" size="md" onClick={reloadAll}>
            Thử lại
          </Button>
          <ButtonLink href="/rewards" variant="secondary" size="md">
            Về Đổi quà
          </ButtonLink>
        </div>
      </div>
    );
  }

  if (!voucher || !viewer) return null;

  const isAvailable = voucher.status === "AVAILABLE";
  const isSoldOut = voucher.status === "SOLD_OUT";
  const isExpired = voucher.status === "EXPIRED";
  const isPaused = voucher.status === "PAUSED";

  const isAffordable = voucher.affordable;
  const pricePoints = voucher.price.points;
  const availablePoints = viewer.available;
  const pendingPoints = viewer.pending;
  const balanceAfter = Math.max(0, availablePoints - pricePoints);
  const neededShortfall = shortfall(pricePoints, availablePoints);
  const suggestedTopUpPoints = suggestedTopUp(neededShortfall);

  const hasFlash = Boolean(voucher.flash);
  const isFlashSoldOutOrEnded =
    !hasFlash &&
    flashItem !== null &&
    (flashItem.item.state === "SOLD_OUT" || flashItem.item.state === "ENDED");

  const isOnSale = voucher.price.source !== "BASE";

  // Rendered twice (mobile banner, desktop panel; one is hidden by CSS). Only one
  // gets `onElapsed`, so the reload runs once.
  const renderFlashStrip = (className: string, onElapsed?: () => void) =>
    isAvailable && voucher.flash ? (
      <div className={`flex flex-col gap-2 rounded-[20px] bg-primary p-4 text-white ${className}`}>
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-label font-bold">
            <Icon name="zap" size={18} className="text-tone-amber-accent" />
            Flash Sale · kết thúc sau
          </span>
          <Countdown endsAt={voucher.flash.endsAt} nowMs={nowMs} tone="onBrand" onElapsed={onElapsed} />
        </div>
        <ProgressBar value={voucher.flash.sold} max={voucher.flash.quota} height={6} tone="primary" />
        <span className="text-caption text-white/80">
          Đã đổi {voucher.flash.sold}/{voucher.flash.quota} · còn {voucher.flash.quota - voucher.flash.sold} suất · mỗi người {flashItem?.item.perUserCap ?? 1} suất
        </span>
      </div>
    ) : null;

  const renderRedeemButton = (size: "md" | "lg", className?: string) => (
    <Button
      variant="primary"
      size={size}
      disabled={!onRedeem}
      title={onRedeem ? undefined : REDEEM_PENDING_TITLE}
      onClick={onRedeem}
      className={className}
    >
      Đổi ngay
    </Button>
  );

  // Price card body, shared by the mobile card and the desktop panel.
  const priceSummary = (
    <>
      <div className="flex flex-col gap-1">
        <span className="text-caption text-ink-muted">Giá đổi</span>
        {isOnSale && (
          <div className="flex items-center gap-2">
            <span className="text-body text-ink-muted line-through">{formatPoints(voucher.price.basePoints)}</span>
            <span className="rounded-full bg-sale-bg px-2 py-0.5 text-xs font-bold text-sale-text">
              -{voucher.price.discountPercent}%
            </span>
          </div>
        )}
        <div className="flex items-baseline gap-2">
          <span className={`text-3xl font-extrabold ${isAvailable ? "text-primary" : "text-ink-muted"}`}>
            {formatPoints(pricePoints)}
          </span>
          <span className="text-body font-semibold text-ink-muted">điểm</span>
        </div>
      </div>

      <div className="flex flex-col gap-1.5 border-t border-line-subtle pt-3 text-body-sm">
        <div className="flex justify-between">
          <span className="text-ink-muted">Điểm khả dụng của bạn</span>
          <span className="font-semibold text-ink">{formatPoints(availablePoints)} điểm</span>
        </div>
        {isAvailable && isAffordable && (
          <div className="flex justify-between">
            <span className="text-ink-muted">Còn lại sau khi đổi</span>
            <span className="font-semibold text-primary">{formatPoints(balanceAfter)} điểm</span>
          </div>
        )}
        {isAvailable && !isAffordable && (
          <div className="flex justify-between text-danger font-semibold">
            <span>Còn thiếu</span>
            <span>{formatPoints(neededShortfall)} điểm</span>
          </div>
        )}
      </div>
    </>
  );

  return (
    <div className="min-h-full pb-[calc(100px+env(safe-area-inset-bottom))] lg:pb-16">
      {/* Mobile Back Bar (< lg) */}
      <MobileBackBar title="Chi tiết voucher" backHref="/rewards" />

      <main className="mx-auto max-w-[1248px] px-4 py-4 md:px-6 md:py-6">
        {/* Desktop Breadcrumb (≥ lg) */}
        <nav aria-label="Breadcrumb" className="mb-4 hidden items-center gap-1.5 text-caption text-ink-muted lg:flex">
          <Link href="/rewards" className="hover:text-ink hover:underline">
            Đổi quà
          </Link>
          <span>›</span>
          <span className="font-semibold text-ink">
            {voucher.brand.name} · {voucher.title}
          </span>
        </nav>

        <div className="flex flex-col lg:flex-row lg:items-start lg:gap-8">
          {/* Left Column (768px on desktop) */}
          <div className="flex min-w-0 flex-1 flex-col gap-5 lg:max-w-[768px]">
            {/* Image / Thumbnail */}
            <div className="h-44 w-full overflow-hidden rounded-[20px] lg:h-[300px]">
              <VoucherThumb
                brand={voucher.brand}
                category={voucher.category}
                imageUrl={voucher.imageUrl}
                size="lg"
                className="h-full w-full"
              />
            </div>

            {/* Title Block */}
            <div className="flex flex-col gap-1 border-b border-line-subtle pb-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-caption font-semibold text-ink-muted">
                  {voucher.brand.name}
                </span>
                {isSoldOut && <Tag tone="danger" size="sm">Hết hàng</Tag>}
                {isExpired && <Tag tone="neutral" size="sm">Hết hạn đổi</Tag>}
                {isPaused && <Tag tone="neutral" size="sm">Tạm dừng</Tag>}
              </div>

              <h1 className="text-title-sm font-extrabold text-ink lg:text-title">
                {voucher.title}
              </h1>
              <p className="text-body-sm font-medium text-ink-muted">
                Trị giá {formatVnd(voucher.valueVnd)}
              </p>
            </div>

            {/* Status alerts */}
            {isSoldOut && (
              <Alert tone="danger">
                Đã đổi hết {voucher.stockTotal}/{voucher.stockTotal} voucher.
              </Alert>
            )}

            {isExpired && (
              <Alert tone="info">
                Hết thời gian đổi từ {formatFullDate(voucher.redeemEndsAt)}.
              </Alert>
            )}

            {isPaused && (
              <Alert tone="info">
                Voucher đang tạm dừng đổi. Bạn quay lại sau nhé.
              </Alert>
            )}

            {isFlashSoldOutOrEnded && (
              <Alert tone="info">
                {flashItem.item.state === "SOLD_OUT"
                  ? "Suất Flash Sale đã hết. Giá dưới đây là giá thường."
                  : "Flash Sale đã kết thúc. Giá dưới đây là giá thường."}
              </Alert>
            )}

            {/* Not enough points notice (Mobile & Desktop left) */}
            {isAvailable && !isAffordable && (
              <div className="rounded-[20px] border border-tone-amber-line bg-tone-amber-tint p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-label font-bold text-tone-amber-ink">
                    Bạn còn thiếu {formatPoints(neededShortfall)} điểm
                  </span>
                  <span className="text-caption font-semibold text-tone-amber-ink">
                    {formatPoints(availablePoints)} / {formatPoints(pricePoints)}
                  </span>
                </div>
                <div className="mt-2">
                  <ProgressBar
                    value={availablePoints}
                    max={pricePoints}
                    height={8}
                    tone="amber"
                    label={`Đã có ${formatPoints(availablePoints)} trên ${formatPoints(pricePoints)} điểm`}
                  />
                </div>
                <p className="mt-2 text-caption text-ink-muted">
                  {pendingPoints > 0
                    ? `${formatPoints(pendingPoints)} điểm chờ duyệt chưa được tính. `
                    : ""}
                  Muốn đổi ngay thì nạp từ {formatPoints(suggestedTopUpPoints)} điểm ({formatVnd(topUpVnd(suggestedTopUpPoints))}).
                </p>
              </div>
            )}

            {/* Flash banner and price card on mobile (the desktop panel has its own) */}
            {renderFlashStrip("lg:hidden", reloadAll)}

            <div className="flex flex-col gap-4 rounded-[24px] border border-line bg-surface p-5 shadow-xs lg:hidden">
              {priceSummary}
            </div>

            {/* Info card (HSD, Số lượng, Nơi áp dụng, Cách nhận) */}
            <div className="rounded-[20px] border border-line bg-surface p-4 flex flex-col gap-3">
              <h3 className="text-label font-bold text-ink">Thông tin voucher</h3>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 text-body-sm">
                <div>
                  <span className="text-ink-muted block text-caption">Hạn sử dụng mã</span>
                  <span className="font-semibold text-ink">{detailExpiryLine(voucher)}</span>
                </div>
                <div>
                  <span className="text-ink-muted block text-caption">Số lượng còn</span>
                  <span className="font-semibold text-ink">{detailStockLine(voucher)}</span>
                </div>
                <div>
                  <span className="text-ink-muted block text-caption">Nơi áp dụng</span>
                  <span className="font-semibold text-ink">{voucher.whereToUse}</span>
                </div>
                <div>
                  <span className="text-ink-muted block text-caption">Cách nhận mã</span>
                  <span className="font-semibold text-ink">{howToGetCodeLine(voucher.isSharedCode)}</span>
                </div>
              </div>
            </div>

            {/* Description card */}
            <div className="rounded-[20px] border border-line bg-surface p-4 flex flex-col gap-2">
              <h3 className="text-label font-bold text-ink">Mô tả</h3>
              <p className="text-body-sm text-ink-muted leading-relaxed whitespace-pre-line">
                {voucher.description}
              </p>
            </div>

            {/* Terms card */}
            <div className="rounded-[20px] border border-line bg-surface p-4 flex flex-col gap-2">
              <h3 className="text-label font-bold text-ink">Điều kiện sử dụng</h3>
              <ul className="list-disc pl-5 text-body-sm text-ink-muted space-y-1">
                {voucher.terms.map((term, i) => (
                  <li key={i}>{term}</li>
                ))}
              </ul>
            </div>

            <p className="text-caption text-ink-muted italic">
              Chỉ trừ điểm khi đổi thành công. Voucher đã đổi không trả lại điểm, trừ khi mã bị lỗi và được Admin xác nhận.
            </p>

            {/* Similar vouchers when sold out */}
            {isSoldOut && similarVouchers.length > 0 && (
              <div className="mt-2 flex flex-col gap-3">
                <h3 className="text-label font-bold text-ink">Voucher tương tự còn hàng</h3>
                {similarVouchers.map((item) => (
                  <VoucherCard key={item.id} item={item} layout="row" />
                ))}
              </div>
            )}
          </div>

          {/* Right Column / Sticky panel on desktop (400px) */}
          <div className="sticky top-6 hidden lg:flex lg:w-[400px] lg:shrink-0 lg:flex-col lg:gap-4">
            {renderFlashStrip("")}

            {/* Price & Balance Card */}
            <div className="rounded-[24px] border border-line bg-surface p-5 shadow-xs flex flex-col gap-4">
              {priceSummary}

              {/* Desktop CTA */}
              <div className="mt-2 flex flex-col gap-2">
                {isAvailable && isAffordable && renderRedeemButton("lg", "w-full justify-center")}

                {isAvailable && !isAffordable && (
                  <>
                    <button
                      type="button"
                      disabled
                      className={`w-full py-2.5 ${DISABLED_DASHED}`}
                    >
                      Đổi ngay
                    </button>
                    <ButtonLink
                      href="/marketplace"
                      variant="primary"
                      size="lg"
                      className="w-full justify-center"
                    >
                      Kiếm thêm điểm
                    </ButtonLink>
                    <p className="text-caption text-ink-muted text-center">
                      Nút Đổi ngay mở lại khi đủ {formatPoints(pricePoints)} điểm. Có thể{" "}
                      <Link href="/wallet/top-up" className="text-primary underline">
                        nạp điểm ở Ví điểm
                      </Link>.
                    </p>
                  </>
                )}

                {isSoldOut && (
                  <button
                    type="button"
                    disabled
                    className={`w-full py-2.5 ${DISABLED_DASHED}`}
                  >
                    Hết hàng
                  </button>
                )}

                {isExpired && (
                  <button
                    type="button"
                    disabled
                    className={`w-full py-2.5 ${DISABLED_DASHED}`}
                  >
                    Hết hạn đổi
                  </button>
                )}

                {isPaused && (
                  <button
                    type="button"
                    disabled
                    className={`w-full py-2.5 ${DISABLED_DASHED}`}
                  >
                    Tạm dừng
                  </button>
                )}

                <p className="text-[12px] text-ink-muted text-center mt-1">
                  Bạn sẽ xem lại và xác nhận trước khi điểm bị trừ.
                </p>
              </div>
            </div>

            <p className="text-caption text-ink-muted text-center px-2">
              Dùng điểm khả dụng, gồm cả điểm nạp. Voucher đã đổi không trả lại điểm, trừ khi mã bị lỗi và được Admin xác nhận.
            </p>
          </div>
        </div>
      </main>

      {/* Fixed bottom action bar on mobile (< lg) */}
      <div className="fixed bottom-[calc(62px+env(safe-area-inset-bottom))] left-0 right-0 z-20 border-t border-line-subtle bg-surface/95 backdrop-blur-md px-4 py-3 lg:hidden shadow-md">
        <div className="mx-auto flex max-w-md flex-col gap-2">
          {isAvailable && !isAffordable ? (
            <>
              <p className="text-caption text-ink-muted">
                Nút Đổi ngay mở lại khi đủ {formatPoints(pricePoints)} điểm. Có thể{" "}
                <Link href="/wallet/top-up" className="text-primary underline">
                  nạp điểm ở Ví điểm
                </Link>.
              </p>
              <div className="flex items-center gap-2">
                <button type="button" disabled className={`h-11 flex-1 px-4 ${DISABLED_DASHED}`}>
                  Đổi ngay
                </button>
                <Link href="/marketplace" className={buttonClassName({ variant: "primary", size: "md", className: "flex-1" })}>
                  Kiếm thêm điểm
                </Link>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-col">
                <div className="flex items-baseline gap-1">
                  <span className={`text-title-sm font-extrabold ${isAvailable ? "text-primary" : "text-ink-muted"}`}>
                    {formatPoints(pricePoints)}
                  </span>
                  <span className="text-caption font-semibold text-ink-muted">điểm</span>
                </div>
                {isAvailable && (
                  <span className="text-caption text-ink-muted">
                    Còn {formatPoints(balanceAfter)} điểm sau khi đổi
                  </span>
                )}
              </div>

              {isAvailable && renderRedeemButton("md")}
              {isSoldOut && (
                <button type="button" disabled className={`px-4 py-2 ${DISABLED_DASHED}`}>
                  Hết hàng
                </button>
              )}
              {isExpired && (
                <button type="button" disabled className={`px-4 py-2 ${DISABLED_DASHED}`}>
                  Hết hạn đổi
                </button>
              )}
              {isPaused && (
                <button type="button" disabled className={`px-4 py-2 ${DISABLED_DASHED}`}>
                  Tạm dừng
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
