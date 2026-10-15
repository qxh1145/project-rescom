import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import {
  RewardsStatsReadPort,
  RedemptionAggregates,
  VoucherKpiCounts,
  StatsVoucherRow,
  StatsFlashSaleRow,
} from '../application/ports/rewards-stats-read.port';

/** Validate a DB aggregate (COUNT/SUM come back as bigint/numeric) before it reaches the DTO. */
function dbCount(value: unknown, label: string): number {
  const n = typeof value === 'bigint' ? Number(value) : Number(value ?? 0);
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new Error(`Invalid stats aggregate ${label}: ${String(value)}`);
  }
  return n;
}

@Injectable()
export class PrismaRewardsStatsRepository implements RewardsStatsReadPort {
  constructor(private readonly prisma: PrismaService) {}

  async getRedemptionAggregates(
    rangeStartUtc: Date,
    rangeEndUtc: Date,
  ): Promise<RedemptionAggregates> {
    // Columns are timestamp (UTC, no tz): tag as UTC first, then shift to VN.
    // Counted redemption = status='SUCCEEDED' with no redemption_refunds row
    const counted = this.prisma.$queryRaw<
      Array<{
        day: string;
        voucher_id: string;
        n: bigint;
        points: bigint | null;
        used: bigint;
      }>
    >`
      SELECT
        to_char(((r.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, 'YYYY-MM-DD') AS day,
        r.voucher_id::text AS voucher_id,
        COUNT(*) AS n,
        COALESCE(SUM(r.price_points), 0) AS points,
        COUNT(u.redemption_id) AS used
      FROM redemptions r
      LEFT JOIN redemption_usages u ON u.redemption_id = r.id
      WHERE r.status = 'SUCCEEDED'::"RedemptionStatus"
        AND NOT EXISTS (SELECT 1 FROM redemption_refunds rf WHERE rf.redemption_id = r.id)
        AND r.created_at >= ${rangeStartUtc}
        AND r.created_at < ${rangeEndUtc}
      GROUP BY 1, 2
    `;
    const rows = await counted;

    const byDay = new Map<string, number>();
    const byVoucher = new Map<
      string,
      { voucherId: string; count: number; points: number; usedCount: number }
    >();
    for (const row of rows) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(row.day)) {
        throw new Error(`Invalid stats day key: ${row.day}`);
      }
      const n = dbCount(row.n, 'count');
      const points = dbCount(row.points, 'points');
      const used = dbCount(row.used, 'used');
      byDay.set(row.day, (byDay.get(row.day) ?? 0) + n);
      const cur = byVoucher.get(row.voucher_id) ?? {
        voucherId: row.voucher_id,
        count: 0,
        points: 0,
        usedCount: 0,
      };
      cur.count += n;
      cur.points += points;
      cur.usedCount += used;
      byVoucher.set(row.voucher_id, cur);
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
    // Mirrors adminVoucherStatus for non-archived vouchers: hidden/paused are
    // neither active, sold out nor expired; before-start counts as active.
    const [row] = await this.prisma.$queryRaw<
      Array<{
        total: bigint;
        active: bigint;
        sold_out: bigint;
        expired: bigint;
        offered: bigint | null;
      }>
    >`
      WITH v AS (
        SELECT
          v.*,
          CASE WHEN v.is_shared_code
            THEN (CASE WHEN COALESCE(v.shared_code, '') <> '' THEN 1 ELSE 0 END)
            ELSE (SELECT COUNT(*) FROM voucher_codes c
                  WHERE c.voucher_id = v.id
                    AND c.redemption_id IS NULL AND c.issue_report_id IS NULL)
          END AS codes_available
        FROM vouchers v
        WHERE v.state <> 'ARCHIVED'::"VoucherState"
      ), s AS (
        SELECT
          v.*,
          (v.state = 'ACTIVE'::"VoucherState" AND v.is_visible) AS live,
          (${now} >= v.redeem_ends_at) AS ended,
          (${now} >= v.redeem_starts_at
            AND (v.stock_remaining = 0 OR v.codes_available = 0)) AS depleted
        FROM v
      )
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE live AND NOT ended AND NOT depleted) AS active,
        COUNT(*) FILTER (WHERE live AND NOT ended AND depleted) AS sold_out,
        COUNT(*) FILTER (WHERE live AND ended) AS expired,
        COALESCE(SUM(stock_total) FILTER (WHERE
          ((redeem_starts_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Ho_Chi_Minh')::date <= ${toDay}::date
          AND ((redeem_ends_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Ho_Chi_Minh')::date >= ${fromDay}::date
        ), 0) AS offered
      FROM s
    `;
    return {
      total: dbCount(row?.total, 'vouchers.total'),
      active: dbCount(row?.active, 'vouchers.active'),
      soldOut: dbCount(row?.sold_out, 'vouchers.soldOut'),
      expired: dbCount(row?.expired, 'vouchers.expired'),
      offeredStock: dbCount(row?.offered, 'vouchers.offered'),
    };
  }

  async getVouchersByIds(ids: string[]): Promise<StatsVoucherRow[]> {
    if (ids.length === 0) return [];
    const vouchers = await this.prisma.voucher.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        title: true,
        stockTotal: true,
        brand: { select: { id: true, name: true } },
      },
    });
    return vouchers.map((v) => ({
      id: v.id,
      title: v.title,
      brand: { id: v.brand.id, name: v.brand.name },
      stockTotal: v.stockTotal,
    }));
  }

  async getFlashSalesForStats(
    now: Date,
    rangeStartUtc: Date,
    rangeEndUtc: Date,
  ): Promise<StatsFlashSaleRow[]> {
    const flashSales = await this.prisma.flashSale.findMany({
      where: {
        // started, and [startsAt, min(endsAt, endedEarlyAt)] overlaps the range
        startsAt: { lte: now, lt: rangeEndUtc },
        endsAt: { gt: rangeStartUtc },
        OR: [{ endedEarlyAt: null }, { endedEarlyAt: { gt: rangeStartUtc } }],
      },
      select: {
        id: true,
        code: true,
        startsAt: true,
        endsAt: true,
        reservedAt: true,
        settledAt: true,
        endedEarlyAt: true,
        endReason: true,
        items: {
          select: {
            id: true,
            voucherId: true,
            flashPoints: true,
            quota: true,
            sold: true,
            perUserCap: true,
            soldOutAt: true,
            voucher: {
              select: {
                valueVnd: true,
                brand: {
                  select: {
                    name: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: {
        startsAt: 'desc',
      },
    });

    return flashSales.map((f) => ({
      id: f.id,
      code: f.code,
      startsAt: f.startsAt,
      endsAt: f.endsAt,
      reservedAt: f.reservedAt,
      settledAt: f.settledAt,
      endedEarlyAt: f.endedEarlyAt,
      endReason: f.endReason,
      items: f.items.map((i) => ({
        id: i.id,
        voucherId: i.voucherId,
        brandName: i.voucher.brand.name,
        valueVnd: i.voucher.valueVnd,
        flashPoints: i.flashPoints,
        quota: i.quota,
        sold: i.sold,
        perUserCap: i.perUserCap,
        soldOutAt: i.soldOutAt,
      })),
    }));
  }
}
