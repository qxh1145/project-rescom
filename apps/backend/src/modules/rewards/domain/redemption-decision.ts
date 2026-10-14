import { VoucherInventory } from './voucher.entity';
import { effectiveStatus } from './voucher-availability';
import { ActiveFlashItem, effectivePrice } from './voucher-price';

export interface FlashInventoryItem {
  id: string;
  voucherId: string;
  flashPoints: number;
  quota: number;
  sold: number;
  perUserCap: number;
  startsAt: string | Date;
  endsAt: string | Date;
  endedEarlyAt?: string | Date | null;
}

export interface QuoteComparison {
  pricePoints: number;
  priceSource: 'BASE' | 'PROMO' | 'FLASH';
  priceVersion: number;
  flashSaleItemId?: string | null;
  expiresAt: string | Date;
}

export interface RedemptionRejection {
  code: 'VOUCHER_UNAVAILABLE' | 'SOLD_OUT' | 'PRICE_CHANGED';
  details: Record<string, unknown>;
}

/**
 * Pure redemption decision matching mock order:
 * 1. Voucher status != AVAILABLE -> VOUCHER_UNAVAILABLE or SOLD_OUT
 * 2. Quote expired or price/source/points/version/flashSaleItemId differs -> PRICE_CHANGED
 * 3. Stock/quota/codes exhausted -> SOLD_OUT
 * Returns null if allowed.
 */
export function decideRedemption(
  voucher: VoucherInventory,
  activeFlashItem: (ActiveFlashItem & { id: string }) | null,
  quote: QuoteComparison,
  now: number,
): RedemptionRejection | null {
  const hasActiveFlash =
    activeFlashItem !== null && activeFlashItem.sold < activeFlashItem.quota;
  const status = effectiveStatus(voucher, now, hasActiveFlash);

  if (status !== 'AVAILABLE') {
    if (status === 'SOLD_OUT') {
      return {
        code: 'SOLD_OUT',
        details: {
          voucherId: voucher.id,
          regularStockRemaining: voucher.stockRemaining,
        },
      };
    }
    return {
      code: 'VOUCHER_UNAVAILABLE',
      details: {
        voucherId: voucher.id,
        status: status === 'HIDDEN' ? 'HIDDEN' : status,
      },
    };
  }

  const price = effectivePrice(voucher, activeFlashItem);
  const quoteExpiresAtMs = +new Date(quote.expiresAt);
  const priceChanged =
    now >= quoteExpiresAtMs ||
    price.priceVersion !== quote.priceVersion ||
    price.source !== quote.priceSource ||
    price.points !== quote.pricePoints ||
    (price.source === 'FLASH' ? (activeFlashItem?.id ?? null) : null) !==
      (quote.flashSaleItemId ?? null);

  if (priceChanged) {
    return {
      code: 'PRICE_CHANGED',
      details: {
        voucherId: voucher.id,
        price,
      },
    };
  }

  // The stockRemaining <= 0 check applies to non-FLASH price sources only;
  // Flash is guarded by sold < quota (guaranteed by price.source === 'FLASH').
  // codesAvailable <= 0 applies to both.
  if (
    (price.source !== 'FLASH' && voucher.stockRemaining <= 0) ||
    voucher.codesAvailable <= 0
  ) {
    return {
      code: 'SOLD_OUT',
      details: {
        voucherId: voucher.id,
        regularStockRemaining: voucher.stockRemaining,
      },
    };
  }

  return null;
}
