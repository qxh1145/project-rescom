export type VoucherState = 'ACTIVE' | 'PAUSED' | 'ARCHIVED';

export interface VoucherInventory {
  id: string;
  basePoints: number;
  promoPoints: number | null;
  priceVersion: number;
  stockTotal: number;
  stockRemaining: number;
  codesAvailable: number;
  redeemStartsAt: string | Date;
  redeemEndsAt: string | Date;
  state: VoucherState;
  isVisible: boolean;
  isSharedCode: boolean;
}

/** Archived vouchers remain readable, but cannot be changed. */
export function voucherStateDecision(
  current: VoucherState,
  next: VoucherState,
) {
  if (current === 'ARCHIVED' && next !== current)
    return { ok: false as const, status: 409, code: 'VOUCHER_ARCHIVED' };
  return { ok: true as const, changed: current !== next };
}

export function voucherVisibilityDecision(
  voucher: Pick<VoucherInventory, 'state' | 'isVisible'>,
  visible: boolean,
) {
  if (voucher.state === 'ARCHIVED')
    return { ok: false as const, status: 409, code: 'VOUCHER_ARCHIVED' };
  return { ok: true as const, changed: voucher.isVisible !== visible };
}

export interface VoucherStock {
  total: number;
  issued: number;
  flashReserved: number;
  remaining: number;
  codesAvailable: number;
}

export function adminStockOf(
  voucher: VoucherInventory,
  flashReserved: number,
): VoucherStock {
  return {
    total: voucher.stockTotal,
    issued: voucher.stockTotal - voucher.stockRemaining - flashReserved,
    flashReserved,
    remaining: voucher.stockRemaining,
    codesAvailable: voucher.codesAvailable,
  };
}
