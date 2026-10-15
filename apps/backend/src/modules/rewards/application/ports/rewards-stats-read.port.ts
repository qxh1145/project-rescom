export const REWARDS_STATS_READ_PORT = Symbol('REWARDS_STATS_READ_PORT');

/** Counted redemptions (SUCCEEDED, not refunded) aggregated by VN calendar day. */
export interface RedemptionDayAggregate {
  /** YYYY-MM-DD in Asia/Ho_Chi_Minh */
  day: string;
  count: number;
}

/** Counted redemptions aggregated by voucher. */
export interface RedemptionVoucherAggregate {
  voucherId: string;
  count: number;
  points: number;
  usedCount: number;
}

export interface RedemptionAggregates {
  byDay: RedemptionDayAggregate[];
  byVoucher: RedemptionVoucherAggregate[];
}

/** Voucher counts the KPIs need, computed over all non-archived vouchers. */
export interface VoucherKpiCounts {
  total: number;
  active: number;
  soldOut: number;
  expired: number;
  /** Sum of stockTotal of non-archived vouchers whose VN redeem window overlaps the range. */
  offeredStock: number;
}

export interface StatsVoucherRow {
  id: string;
  title: string;
  brand: {
    id: string;
    name: string;
  };
  stockTotal: number;
}

export interface StatsFlashSaleRow {
  id: string;
  code: string;
  startsAt: Date;
  endsAt: Date;
  reservedAt: Date | null;
  settledAt: Date | null;
  endedEarlyAt: Date | null;
  endReason: string | null;
  items: Array<{
    id: string;
    voucherId: string;
    brandName: string;
    valueVnd: number;
    flashPoints: number;
    quota: number;
    sold: number;
    perUserCap: number;
    soldOutAt: Date | null;
  }>;
}

export interface RewardsStatsReadPort {
  getRedemptionAggregates(
    rangeStartUtc: Date,
    rangeEndUtc: Date,
  ): Promise<RedemptionAggregates>;

  getVoucherKpiCounts(
    fromDay: string,
    toDay: string,
    now: Date,
  ): Promise<VoucherKpiCounts>;

  getVouchersByIds(ids: string[]): Promise<StatsVoucherRow[]>;

  /** Started sales (startsAt <= now) whose [startsAt, effective end] overlaps the range. */
  getFlashSalesForStats(
    now: Date,
    rangeStartUtc: Date,
    rangeEndUtc: Date,
  ): Promise<StatsFlashSaleRow[]>;
}
