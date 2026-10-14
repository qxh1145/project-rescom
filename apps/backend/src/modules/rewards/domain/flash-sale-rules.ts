export type AdminFlashStatus =
  'SCHEDULED' | 'UPCOMING' | 'ACTIVE' | 'SOLD_OUT' | 'ENDED';

export interface FlashDomainItem {
  id?: string;
  voucherId: string;
  flashPoints: number;
  quota: number;
  sold: number;
  perUserCap: number;
  soldOutAt?: string | null;
}

export interface FlashDomainSale {
  id?: string;
  code?: string;
  startsAt: string;
  endsAt: string;
  reservedAt?: string | null;
  settledAt?: string | null;
  endedEarlyAt?: string | null;
  endReason?: string | null;
  items: FlashDomainItem[];
}

export interface FlashSaleInputItem {
  voucherId: string;
  flashPoints: number;
  quota: number;
  perUserCap: number;
}

export interface FlashSaleInput {
  startsAt: string;
  endsAt: string;
  items: FlashSaleInputItem[];
}

export interface FlashConflict {
  path: string;
  code: string;
  details: Record<string, unknown>;
}

/**
 * Pure status of a flash sale:
 * - ENDED: settled, past endsAt, or ended early
 * - Not reserved: UPCOMING if now >= startsAt or within 24h; SCHEDULED if > 24h away
 * - Reserved: SOLD_OUT if all items sold >= quota; ACTIVE otherwise
 */
export function adminFlashStatus(
  flash: FlashDomainSale,
  now: number,
): AdminFlashStatus {
  const start = Date.parse(flash.startsAt);
  const end = Date.parse(flash.endsAt);
  const endedEarly = flash.endedEarlyAt ? Date.parse(flash.endedEarlyAt) : null;

  if (
    flash.settledAt !== null ||
    (endedEarly !== null && now >= endedEarly) ||
    now >= end
  ) {
    return 'ENDED';
  }

  if (!flash.reservedAt) {
    if (now < start) {
      return start - now <= 86400000 ? 'UPCOMING' : 'SCHEDULED';
    }
    return 'UPCOMING';
  }

  if (
    flash.items.length > 0 &&
    flash.items.every((it) => it.sold >= it.quota)
  ) {
    return 'SOLD_OUT';
  }

  return 'ACTIVE';
}

export function flashItemState(
  flash: FlashDomainSale,
  item: FlashDomainItem,
  now: number,
): 'UPCOMING' | 'ACTIVE' | 'SOLD_OUT' | 'ENDED' {
  const status = adminFlashStatus(flash, now);
  if (status === 'SCHEDULED' || status === 'UPCOMING') return 'UPCOMING';
  if (status === 'ENDED') return 'ENDED';
  return item.sold >= item.quota ? 'SOLD_OUT' : 'ACTIVE';
}

export function flashProgress(flash: FlashDomainSale, now: number) {
  const start = Date.parse(flash.startsAt);
  return flash.items.map((item) => {
    const soldOutAt = item.sold >= item.quota ? (item.soldOutAt ?? null) : null;
    const soldOutAtMs = soldOutAt ? Date.parse(soldOutAt) : Infinity;
    const endedEarlyMs = flash.endedEarlyAt
      ? Date.parse(flash.endedEarlyAt)
      : Infinity;
    const endsAtMs = Date.parse(flash.endsAt);
    const stop = Math.min(now, endsAtMs, endedEarlyMs, soldOutAtMs);
    const perMinute =
      Math.round((item.sold / Math.max(1, (stop - start) / 60000)) * 10) / 10;
    const etaAt =
      flashItemState(flash, item, now) === 'ACTIVE' && perMinute > 0
        ? new Date(
            now + ((item.quota - item.sold) / perMinute) * 60000,
          ).toISOString()
        : null;
    return { perMinute, etaAt, soldOutAt };
  });
}

export function endEarlyDecision(flash: FlashDomainSale, now: number) {
  const status = adminFlashStatus(flash, now);
  if (status !== 'ACTIVE') {
    return {
      ok: false as const,
      status: 409,
      code: status === 'ENDED' ? 'FLASH_ALREADY_ENDED' : 'FLASH_NOT_ACTIVE',
      details: {},
    };
  }
  return {
    ok: true as const,
    result: {
      returned: flash.items.reduce(
        (sum, item) => sum + item.quota - item.sold,
        0,
      ),
      items: flash.items.map((item) => ({
        voucherId: item.voucherId,
        unsold: item.quota - item.sold,
      })),
    },
  };
}

export function flashConflicts(
  input: FlashSaleInput,
  vouchers: Array<{
    id: string;
    state: string;
    isVisible: boolean;
    redeemStartsAt: string;
    redeemEndsAt: string;
    isSharedCode: boolean;
    stockRemaining: number;
    codesAvailable?: number;
    basePoints: number;
    promoPoints?: number | null;
  }>,
  flashes: Array<{
    id: string;
    code: string;
    startsAt: string;
    endsAt: string;
    endedEarlyAt?: string | null;
    settledAt?: string | null;
    items: Array<{ voucherId: string }>;
  }>,
  now: number,
  selfId?: string,
): FlashConflict[] {
  const conflicts: FlashConflict[] = [];
  const inputStart = Date.parse(input.startsAt);
  const inputEnd = Date.parse(input.endsAt);

  if (inputStart <= now) {
    conflicts.push({
      path: 'startsAt',
      code: 'FLASH_STARTS_IN_PAST',
      details: {},
    });
  }

  input.items.forEach((item, index) => {
    const v = vouchers.find((v) => v.id === item.voucherId);
    const path = (field: string) => `items.${index}.${field}`;

    if (
      !v ||
      v.state !== 'ACTIVE' ||
      !v.isVisible ||
      Date.parse(v.redeemStartsAt) > inputStart ||
      Date.parse(v.redeemEndsAt) < inputEnd ||
      (v.isSharedCode && v.stockRemaining === 0)
    ) {
      conflicts.push({
        path: path('voucherId'),
        code: 'VOUCHER_NOT_FLASHABLE',
        details: {},
      });
    }

    if (!v) return;

    const regular = v.promoPoints ?? v.basePoints;
    if (item.flashPoints >= regular) {
      conflicts.push({
        path: path('flashPoints'),
        code: 'FLASH_PRICE_NOT_BELOW_REGULAR',
        details: { regular },
      });
    }

    const available = v.isSharedCode
      ? v.stockRemaining
      : Math.min(v.stockRemaining, v.codesAvailable ?? v.stockRemaining);
    if (item.quota > available) {
      conflicts.push({
        path: path('quota'),
        code: 'FLASH_QUOTA_EXCEEDS_STOCK',
        details: { available },
      });
    }

    const other = flashes.find((f) => {
      if (f.id === selfId || f.settledAt !== null) return false;
      if (!f.items.some((i) => i.voucherId === item.voucherId)) return false;
      const fStart = Date.parse(f.startsAt);
      const fEnd = Math.min(
        Date.parse(f.endsAt),
        f.endedEarlyAt ? Date.parse(f.endedEarlyAt) : Infinity,
      );
      if (fEnd <= fStart) return false;
      return fStart < inputEnd && inputStart < fEnd;
    });

    if (other) {
      conflicts.push({
        path: path('voucherId'),
        code: 'FLASH_OVERLAP',
        details: { code: other.code },
      });
    }
  });

  return conflicts;
}
