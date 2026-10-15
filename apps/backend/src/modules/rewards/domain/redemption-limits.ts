import { REWARDS_LIMIT_PER_VOUCHER_PER_30_DAYS } from '../application/ports/rewards.constants';

export type RedemptionLimitError =
  'VOUCHER_LIMIT_REACHED' | 'DAILY_LIMIT_REACHED' | 'FLASH_LIMIT_REACHED';

export interface RedemptionLimitCounts {
  perVoucher30dCount: number;
  todayPoints: number;
  flashUserCount?: number;
}

export interface FlashLimitItem {
  perUserCap: number;
}

/**
 * Pure limit check (Task 3.2):
 * - per voucher per 30 days: max REWARDS_LIMIT_PER_VOUCHER_PER_30_DAYS (default 2)
 * - per day points: todayPoints + pricePoints <= dailyPointsLimit
 * - Flash per user cap: flashUserCount < flashItem.perUserCap
 * Returns null if within limits, or the error code.
 */
export function checkRedemptionLimits(
  counts: RedemptionLimitCounts,
  pricePoints: number,
  dailyPointsLimit: number,
  flashItem?: FlashLimitItem | null,
): RedemptionLimitError | null {
  if (counts.perVoucher30dCount >= REWARDS_LIMIT_PER_VOUCHER_PER_30_DAYS) {
    return 'VOUCHER_LIMIT_REACHED';
  }

  if (counts.todayPoints + pricePoints > dailyPointsLimit) {
    return 'DAILY_LIMIT_REACHED';
  }

  if (flashItem && typeof counts.flashUserCount === 'number') {
    if (counts.flashUserCount >= flashItem.perUserCap) {
      return 'FLASH_LIMIT_REACHED';
    }
  }

  return null;
}

/**
 * Asia/Ho_Chi_Minh day boundary (UTC+7, no DST):
 * returns start and end of calendar day in UTC Date instants.
 */
export function getVietnamCalendarDayRange(now: Date): {
  start: Date;
  end: Date;
} {
  const VN_OFFSET_HOURS = 7;
  const vnNow = new Date(now.getTime() + VN_OFFSET_HOURS * 3600 * 1000);
  const year = vnNow.getUTCFullYear();
  const month = vnNow.getUTCMonth();
  const date = vnNow.getUTCDate();

  // Midnight VN time in UTC
  const startUtc = new Date(
    Date.UTC(year, month, date) - VN_OFFSET_HOURS * 3600 * 1000,
  );
  const endUtc = new Date(startUtc.getTime() + 24 * 3600 * 1000);

  return { start: startUtc, end: endUtc };
}
