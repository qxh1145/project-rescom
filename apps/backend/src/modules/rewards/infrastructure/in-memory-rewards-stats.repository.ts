import {
  RewardsStatsReadPort,
  RedemptionAggregates,
  VoucherKpiCounts,
  StatsVoucherRow,
  StatsFlashSaleRow,
} from '../application/ports/rewards-stats-read.port';
import { toVietnamDayKey } from '../application/rewards-admin-stats.service';
import { adminVoucherStatus } from '../domain/voucher-availability';

export interface InMemoryCountedRedemption {
  id: string;
  voucherId: string;
  pricePoints: number;
  createdAt: Date;
  hasUsage: boolean;
}

export interface InMemoryStatsVoucher extends StatsVoucherRow {
  stockRemaining: number;
  codesAvailable: number;
  state: 'ACTIVE' | 'PAUSED' | 'ARCHIVED';
  isVisible: boolean;
  redeemStartsAt: Date;
  redeemEndsAt: Date;
}

export class InMemoryRewardsStatsRepository implements RewardsStatsReadPort {
  public redemptions: InMemoryCountedRedemption[] = [];
  public vouchers: InMemoryStatsVoucher[] = [];
  public flashSales: StatsFlashSaleRow[] = [];

  async getRedemptionAggregates(
    rangeStartUtc: Date,
    rangeEndUtc: Date,
  ): Promise<RedemptionAggregates> {
    const byDay = new Map<string, number>();
    const byVoucher = new Map<
      string,
      { voucherId: string; count: number; points: number; usedCount: number }
    >();
    for (const r of this.redemptions) {
      const t = r.createdAt.getTime();
      if (t < rangeStartUtc.getTime() || t >= rangeEndUtc.getTime()) continue;
      const day = toVietnamDayKey(r.createdAt);
      byDay.set(day, (byDay.get(day) ?? 0) + 1);
      const cur = byVoucher.get(r.voucherId) ?? {
        voucherId: r.voucherId,
        count: 0,
        points: 0,
        usedCount: 0,
      };
      cur.count += 1;
      cur.points += r.pricePoints;
      cur.usedCount += r.hasUsage ? 1 : 0;
      byVoucher.set(r.voucherId, cur);
    }
    return {
      byDay: [...byDay].map(([day, count]) => ({ day, count })),
      byVoucher: [...byVoucher.values()],
    };
  }

  async getVoucherKpiCounts(
    fromDay: string,
    toDay: string,
    now: Date,
  ): Promise<VoucherKpiCounts> {
    const live = this.vouchers.filter((v) => v.state !== 'ARCHIVED');
    const statuses = live.map((v) =>
      adminVoucherStatus(
        {
          ...v,
          basePoints: 0,
          promoPoints: null,
          priceVersion: 1,
          isSharedCode: false,
        },
        now.getTime(),
      ),
    );
    return {
      total: live.length,
      active: statuses.filter((s) => s === 'ACTIVE').length,
      soldOut: statuses.filter((s) => s === 'SOLD_OUT').length,
      expired: statuses.filter((s) => s === 'EXPIRED').length,
      offeredStock: live
        .filter(
          (v) =>
            toVietnamDayKey(v.redeemStartsAt) <= toDay &&
            toVietnamDayKey(v.redeemEndsAt) >= fromDay,
        )
        .reduce((sum, v) => sum + v.stockTotal, 0),
    };
  }

  async getVouchersByIds(ids: string[]): Promise<StatsVoucherRow[]> {
    return this.vouchers
      .filter((v) => ids.includes(v.id))
      .map((v) => ({
        id: v.id,
        title: v.title,
        brand: v.brand,
        stockTotal: v.stockTotal,
      }));
  }

  async getFlashSalesForStats(
    now: Date,
    rangeStartUtc: Date,
    rangeEndUtc: Date,
  ): Promise<StatsFlashSaleRow[]> {
    return this.flashSales.filter((f) => {
      const start = f.startsAt.getTime();
      const end = Math.max(
        start,
        Math.min(f.endsAt.getTime(), f.endedEarlyAt?.getTime() ?? Infinity),
      );
      return (
        start <= now.getTime() &&
        start < rangeEndUtc.getTime() &&
        end > rangeStartUtc.getTime()
      );
    });
  }
}
