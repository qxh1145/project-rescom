import { VoucherInventory } from './voucher.entity';

export function voucherAvailability(voucher: VoucherInventory, now: number) {
  if (voucher.state !== 'ACTIVE' || !voucher.isVisible)
    return voucher.state === 'PAUSED' ? 'PAUSED' : 'HIDDEN';
  if (now >= +new Date(voucher.redeemEndsAt)) return 'EXPIRED';
  if (now < +new Date(voucher.redeemStartsAt)) return 'PAUSED';
  if (voucher.stockRemaining === 0 || voucher.codesAvailable === 0)
    return 'SOLD_OUT';
  return 'AVAILABLE';
}

/** Active Flash can sell while regular stock is exhausted. */
export function effectiveStatus(
  voucher: VoucherInventory,
  now: number,
  activeFlashHasQuota: boolean,
) {
  const regular = voucherAvailability(voucher, now);
  return regular === 'SOLD_OUT' &&
    activeFlashHasQuota &&
    voucher.codesAvailable > 0
    ? 'AVAILABLE'
    : regular;
}

export function adminVoucherStatus(voucher: VoucherInventory, now: number) {
  if (voucher.state === 'ARCHIVED') return 'ARCHIVED';
  const status = voucherAvailability(voucher, now);
  if (!voucher.isVisible) return 'HIDDEN';
  if (voucher.state === 'PAUSED') return 'PAUSED';
  if (status === 'EXPIRED') return 'EXPIRED';
  if (status === 'SOLD_OUT') return 'SOLD_OUT';
  return 'ACTIVE';
}
