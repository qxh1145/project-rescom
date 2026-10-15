import {
  RewardsStatsDto,
  RewardsStatsQueryDto,
  rewardsStatsSchema,
  POINT_VND_RATE,
} from '@rescom/schemas';
import { RewardsStatsReadPort } from './ports/rewards-stats-read.port';
import { adminFlashStatus } from '../domain/flash-sale-rules';

const VN_OFFSET_HOURS = 7;
const VN_OFFSET_MS = VN_OFFSET_HOURS * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;

export interface RewardsAdminStatsServiceDependencies {
  statsRead: RewardsStatsReadPort;
  now: () => Date;
}

export function toVietnamDayKey(date: Date | string | number): string {
  const d = new Date(date);
  const vnTime = new Date(d.getTime() + VN_OFFSET_MS);
  const y = vnTime.getUTCFullYear();
  const m = String(vnTime.getUTCMonth() + 1).padStart(2, '0');
  const day = String(vnTime.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseVietnamDayToRangeUtc(
  fromDay: string,
  toDay: string,
): { startUtc: Date; endUtc: Date } {
  const [fromY, fromM, fromD] = fromDay.split('-').map(Number);
  const [toY, toM, toD] = toDay.split('-').map(Number);

  // Midnight of fromDay in VN (UTC+7) -> UTC = midnight - 7h
  const startUtc = new Date(Date.UTC(fromY, fromM - 1, fromD) - VN_OFFSET_MS);
  // End of toDay in VN (next midnight) -> UTC = next midnight - 7h
  const endUtc = new Date(Date.UTC(toY, toM - 1, toD + 1) - VN_OFFSET_MS);

  return { startUtc, endUtc };
}

export function generateDailyCalendarDays(from: string, to: string): string[] {
  const days: string[] = [];
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  for (let t = start; t <= end; t += DAY_MS) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  return days;
}

export class RewardsAdminStatsService {
  private readonly now: () => Date;

  constructor(private readonly deps: RewardsAdminStatsDependencies) {
    this.now = deps.now;
  }

  async getStats(query: RewardsStatsQueryDto): Promise<RewardsStatsDto> {
    const nowDate = this.now();
    const nowMs = nowDate.getTime();

    const { startUtc, endUtc } = parseVietnamDayToRangeUtc(
      query.from,
      query.to,
    );

    const [agg, voucherKpis, flashSales] = await Promise.all([
      this.deps.statsRead.getRedemptionAggregates(startUtc, endUtc),
      this.deps.statsRead.getVoucherKpiCounts(query.from, query.to, nowDate),
      this.deps.statsRead.getFlashSalesForStats(nowDate, startUtc, endUtc),
    ]);
    const vouchers = await this.deps.statsRead.getVouchersByIds(
      agg.byVoucher.map((v) => v.voucherId),
    );

    const days = generateDailyCalendarDays(query.from, query.to);

    // Every VN day covered by a started sale's window [startsAt, effective end)
    // inside the requested range is a Flash day.
    const codesByDay = new Map<string, string[]>();
    for (const flash of flashSales) {
      const startMs = flash.startsAt.getTime();
      const endMs = Math.max(
        startMs,
        Math.min(
          flash.endsAt.getTime(),
          flash.endedEarlyAt?.getTime() ?? Infinity,
        ),
      );
      const firstDay = toVietnamDayKey(flash.startsAt);
      const lastDay = toVietnamDayKey(new Date(Math.max(startMs, endMs - 1)));
      for (const day of days) {
        if (day >= firstDay && day <= lastDay) {
          codesByDay.set(day, [...(codesByDay.get(day) ?? []), flash.code]);
        }
      }
    }

    const countsByDay = new Map<string, number>(days.map((d) => [d, 0]));
    for (const r of agg.byDay) {
      if (countsByDay.has(r.day)) countsByDay.set(r.day, r.count);
    }

    const daily = days.map((date) => ({
      date,
      count: countsByDay.get(date) ?? 0,
      flashSaleCodes: codesByDay.get(date) ?? [],
    }));

    const regularDays = daily.filter((d) => d.flashSaleCodes.length === 0);
    const avgPerRegularDay =
      regularDays.length > 0
        ? regularDays.reduce((sum, d) => sum + d.count, 0) / regularDays.length
        : 0;

    const redemptionsByVoucher = new Map(
      agg.byVoucher.map((v) => [v.voucherId, v]),
    );
    const totalRedemptionsCount = agg.byVoucher.reduce(
      (sum, v) => sum + v.count,
      0,
    );
    const totalPointsSpent = agg.byVoucher.reduce(
      (sum, v) => sum + v.points,
      0,
    );
    const vndEquivalent = totalPointsSpent * POINT_VND_RATE;

    const activeVouchersKpi = {
      active: voucherKpis.active,
      total: voucherKpis.total,
      soldOut: voucherKpis.soldOut,
      expired: voucherKpis.expired,
    };

    // Redemption rate KPI
    const offered = Math.max(totalRedemptionsCount, voucherKpis.offeredStock);
    const redemptionRate = {
      redeemed: totalRedemptionsCount,
      offered,
      rate: offered > 0 ? totalRedemptionsCount / offered : 0,
    };

    // Top voucher KPI
    const voucherMap = new Map(vouchers.map((v) => [v.id, v]));
    let topVoucher: RewardsStatsDto['kpis']['topVoucher'] = null;
    if (totalRedemptionsCount > 0) {
      const sorted = [...redemptionsByVoucher.values()].sort(
        (a, b) => b.count - a.count || a.voucherId.localeCompare(b.voucherId),
      );
      if (sorted.length > 0) {
        const top = sorted[0];
        topVoucher = {
          voucherId: top.voucherId,
          label: voucherMap.get(top.voucherId)?.title ?? 'Voucher',
          count: top.count,
          share: top.count / totalRedemptionsCount,
        };
      }
    }

    // Self-reported usage rate KPI
    const usedCount = agg.byVoucher.reduce((sum, v) => sum + v.usedCount, 0);
    const selfReportedUsageRate =
      totalRedemptionsCount > 0
        ? Math.min(1, usedCount / totalRedemptionsCount)
        : 0;

    // By Brand
    const brandMap = new Map<
      string,
      {
        brand: { id: string; name: string };
        redemptions: number;
        pointsSpent: number;
        offered: number;
      }
    >();

    for (const [voucherId, tally] of redemptionsByVoucher.entries()) {
      const v = voucherMap.get(voucherId);
      if (!v) continue;
      const brandId = v.brand.id;
      const cur = brandMap.get(brandId) ?? {
        brand: v.brand,
        redemptions: 0,
        pointsSpent: 0,
        offered: 0,
      };
      cur.redemptions += tally.count;
      cur.pointsSpent += tally.points;
      cur.offered += Math.max(tally.count, v.stockTotal);
      brandMap.set(brandId, cur);
    }

    const byBrand = [...brandMap.values()].map((b) => ({
      brand: b.brand,
      redemptions: b.redemptions,
      pointsSpent: b.pointsSpent,
      soldRatio: b.offered > 0 ? b.redemptions / b.offered : 0,
    }));

    // Flash sales performance
    // Performance table lists sales that started inside the range.
    const flashSalesInRange = flashSales.filter((f) => {
      const startDay = toVietnamDayKey(f.startsAt);
      return startDay >= query.from && startDay <= query.to;
    });

    const flashSalesResult = flashSalesInRange.map((f) => {
      const sold = f.items.reduce((sum, item) => sum + item.sold, 0);
      const quota = f.items.reduce((sum, item) => sum + item.quota, 0);
      const pointsSpent = f.items.reduce(
        (sum, item) => sum + item.sold * item.flashPoints,
        0,
      );

      const domainSale = {
        startsAt: f.startsAt.toISOString(),
        endsAt: f.endsAt.toISOString(),
        reservedAt: f.reservedAt ? f.reservedAt.toISOString() : null,
        settledAt: f.settledAt ? f.settledAt.toISOString() : null,
        endedEarlyAt: f.endedEarlyAt ? f.endedEarlyAt.toISOString() : null,
        endReason: f.endReason,
        items: f.items.map((it) => ({
          voucherId: it.voucherId,
          flashPoints: it.flashPoints,
          quota: it.quota,
          sold: it.sold,
          perUserCap: it.perUserCap,
        })),
      };
      const status = adminFlashStatus(domainSale, nowMs);

      const itemsLabel = f.items
        .map((i) => `${i.brandName} ${Math.round(i.valueVnd / 1000)}k`)
        .join(' · ');

      const allSoldOut =
        f.items.length > 0 && f.items.every((it) => it.soldOutAt !== null);
      let soldOutAfterMinutes: number | null = null;
      if (allSoldOut) {
        const latestSoldOutMs = Math.max(
          ...f.items.map((it) => it.soldOutAt!.getTime()),
        );
        soldOutAfterMinutes = Math.max(
          0,
          Math.round((latestSoldOutMs - f.startsAt.getTime()) / 60000),
        );
      }

      return {
        flashSaleId: f.id,
        code: f.code,
        startsAt: f.startsAt.toISOString(),
        itemsLabel,
        sold,
        quota,
        status,
        pointsSpent,
        soldOutAfterMinutes,
      };
    });

    const result: RewardsStatsDto = {
      range: {
        from: query.from,
        to: query.to,
      },
      updatedAt: nowDate.toISOString(),
      kpis: {
        activeVouchers: activeVouchersKpi,
        redemptions: {
          count: totalRedemptionsCount,
          avgPerRegularDay,
        },
        pointsSpent: {
          points: totalPointsSpent,
          vndEquivalent,
        },
        redemptionRate,
        topVoucher,
        selfReportedUsageRate,
      },
      daily,
      byBrand,
      flashSales: flashSalesResult,
    };

    return rewardsStatsSchema.parse(result);
  }
}

export type RewardsAdminStatsDependencies =
  RewardsAdminStatsServiceDependencies;
