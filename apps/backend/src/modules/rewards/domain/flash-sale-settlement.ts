export interface ReservationItem {
  voucherId: string;
  quota: number;
}

export interface VoucherStockItem {
  id: string;
  stockRemaining: number;
  /** Unclaimed unique codes; only binding for non-shared-code vouchers. */
  codesAvailable?: number;
  isSharedCode?: boolean;
}

export type ReservationPlanResult =
  | {
      ok: true;
      perVoucher: Array<{ voucherId: string; quota: number }>;
    }
  | {
      ok: false;
      shortVoucherIds: string[];
    };

export interface SettlementItem {
  voucherId: string;
  quota: number;
  sold: number;
}

export interface SettlementVoucherResult {
  voucherId: string;
  unsold: number;
}

export interface SettleDueCheckSale {
  reservedAt: string | Date | null;
  settledAt: string | Date | null;
  endsAt: string | Date;
  endedEarlyAt?: string | Date | null;
  items: Array<{ quota: number; sold: number }>;
}

export interface ReserveDueCheckSale {
  reservedAt: string | Date | null;
  settledAt: string | Date | null;
  startsAt: string | Date;
  endsAt: string | Date;
  endedEarlyAt?: string | Date | null;
}

/**
 * Pure reservation plan: checks if every voucher in the sale has enough stock.
 */
export function reservationPlan(
  sale: { items: ReservationItem[] },
  vouchers: VoucherStockItem[],
): ReservationPlanResult {
  const shortVoucherIds: string[] = [];
  const voucherMap = new Map<string, number>(
    vouchers.map((v) => [v.id, v.stockRemaining]),
  );

  for (const item of sale.items) {
    const remaining = voucherMap.get(item.voucherId);
    const voucher = vouchers.find((v) => v.id === item.voucherId);
    const codesShort =
      voucher !== undefined &&
      voucher.isSharedCode === false &&
      voucher.codesAvailable !== undefined &&
      voucher.codesAvailable < item.quota;
    if (remaining === undefined || remaining < item.quota || codesShort) {
      shortVoucherIds.push(item.voucherId);
    }
  }

  if (shortVoucherIds.length > 0) {
    return { ok: false, shortVoucherIds };
  }

  return {
    ok: true,
    perVoucher: sale.items.map((i) => ({
      voucherId: i.voucherId,
      quota: i.quota,
    })),
  };
}

/**
 * Pure settlement plan: calculates unsold quota to return to stock.
 */
export function settlementPlan(sale: {
  items: SettlementItem[];
}): SettlementVoucherResult[] {
  return sale.items.map((item) => ({
    voucherId: item.voucherId,
    unsold: Math.max(0, item.quota - item.sold),
  }));
}

/**
 * Check if a sale is due to be settled:
 * - Must be reserved
 * - Must not already be settled
 * - And: now >= endsAt OR endedEarlyAt <= now OR all items sold >= quota
 */
export function isSettleDue(
  sale: SettleDueCheckSale,
  now: Date | number,
): boolean {
  if (!sale.reservedAt || sale.settledAt !== null) {
    return false;
  }
  const nowMs = typeof now === 'number' ? now : now.getTime();
  const endsAtMs =
    typeof sale.endsAt === 'number'
      ? sale.endsAt
      : Date.parse(String(sale.endsAt));
  const endedEarlyMs = sale.endedEarlyAt
    ? Date.parse(String(sale.endedEarlyAt))
    : null;

  if (nowMs >= endsAtMs) return true;
  if (endedEarlyMs !== null && endedEarlyMs <= nowMs) return true;
  if (sale.items.length > 0 && sale.items.every((it) => it.sold >= it.quota)) {
    return true;
  }

  return false;
}

/**
 * Check if a sale is due to be reserved:
 * - Must not be reserved
 * - Must not already be settled
 * - startsAt <= now < endsAt
 * - Not ended early
 */
export function isReserveDue(
  sale: ReserveDueCheckSale,
  now: Date | number,
): boolean {
  if (sale.reservedAt !== null || sale.settledAt !== null) {
    return false;
  }
  const nowMs = typeof now === 'number' ? now : now.getTime();
  const startsAtMs =
    typeof sale.startsAt === 'number'
      ? sale.startsAt
      : Date.parse(String(sale.startsAt));
  const endsAtMs =
    typeof sale.endsAt === 'number'
      ? sale.endsAt
      : Date.parse(String(sale.endsAt));
  const endedEarlyMs = sale.endedEarlyAt
    ? Date.parse(String(sale.endedEarlyAt))
    : null;

  if (endedEarlyMs !== null && endedEarlyMs <= nowMs) {
    return false;
  }

  return startsAtMs <= nowMs && nowMs < endsAtMs;
}
