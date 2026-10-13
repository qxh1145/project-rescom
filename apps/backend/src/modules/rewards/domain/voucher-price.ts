import { voucherDiscountPercent } from '@rescom/schemas';
import { VoucherInventory } from './voucher.entity';

export interface ActiveFlashItem {
  flashPoints: number;
  sold: number;
  quota: number;
}

/** Caller supplies only active, non-ended Flash items; sold-out items fall back to regular price. */
export function effectivePrice(
  voucher: Pick<
    VoucherInventory,
    'basePoints' | 'promoPoints' | 'priceVersion'
  >,
  activeFlashItem?: ActiveFlashItem | null,
) {
  const flash =
    activeFlashItem && activeFlashItem.sold < activeFlashItem.quota
      ? activeFlashItem
      : null;
  const points =
    flash?.flashPoints ?? voucher.promoPoints ?? voucher.basePoints;
  const source = flash
    ? ('FLASH' as const)
    : voucher.promoPoints
      ? ('PROMO' as const)
      : ('BASE' as const);
  return {
    points,
    basePoints: voucher.basePoints,
    source,
    discountPercent: voucherDiscountPercent(points, voucher.basePoints),
    priceVersion: voucher.priceVersion,
  };
}
