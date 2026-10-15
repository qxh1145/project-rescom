import { rewardsStatsSchema } from '@rescom/schemas';
import {
  RewardsAdminStatsService,
  toVietnamDayKey,
  parseVietnamDayToRangeUtc,
} from './rewards-admin-stats.service';
import { InMemoryRewardsStatsRepository } from '../infrastructure/in-memory-rewards-stats.repository';

describe('RewardsAdminStatsService Unit Tests', () => {
  let service: RewardsAdminStatsService;
  let repo: InMemoryRewardsStatsRepository;
  const now = new Date('2026-10-15T12:00:00.000Z');

  beforeEach(() => {
    repo = new InMemoryRewardsStatsRepository();
    service = new RewardsAdminStatsService({
      statsRead: repo,
      now: () => now,
    });
  });

  describe('Vietnam date & midnight handling', () => {
    it('correctly maps 23:30 UTC+7 vs 00:30 UTC+7 across midnight', () => {
      // 23:30 UTC+7 on Oct 14 is 16:30 UTC on Oct 14
      const d1 = new Date('2026-10-14T16:30:00.000Z');
      expect(toVietnamDayKey(d1)).toBe('2026-10-14');

      // 00:30 UTC+7 on Oct 15 is 17:30 UTC on Oct 14
      const d2 = new Date('2026-10-14T17:30:00.000Z');
      expect(toVietnamDayKey(d2)).toBe('2026-10-15');
    });

    it('generates exact UTC range for Vietnam calendar days', () => {
      const { startUtc, endUtc } = parseVietnamDayToRangeUtc(
        '2026-10-14',
        '2026-10-14',
      );
      // Midnight VN on Oct 14 = 2026-10-13T17:00:00.000Z
      expect(startUtc.toISOString()).toBe('2026-10-13T17:00:00.000Z');
      // End of day VN on Oct 14 = 2026-10-14T17:00:00.000Z
      expect(endUtc.toISOString()).toBe('2026-10-14T17:00:00.000Z');
    });
  });

  describe('Empty range & ratio validations', () => {
    it('returns zero counts and valid ratios with no NaN on empty range', async () => {
      const stats = await service.getStats({
        from: '2026-10-01',
        to: '2026-10-07',
      });

      expect(stats.kpis.redemptions.count).toBe(0);
      expect(stats.kpis.redemptions.avgPerRegularDay).toBe(0);
      expect(stats.kpis.pointsSpent.points).toBe(0);
      expect(stats.kpis.pointsSpent.vndEquivalent).toBe(0);
      expect(stats.kpis.redemptionRate.rate).toBe(0);
      expect(stats.kpis.topVoucher).toBeNull();
      expect(stats.kpis.selfReportedUsageRate).toBe(0);
      expect(stats.daily).toHaveLength(7);
      expect(stats.byBrand).toEqual([]);
      expect(stats.flashSales).toEqual([]);

      // Ensure DTO strictly validates schema
      expect(() => rewardsStatsSchema.parse(stats)).not.toThrow();
    });
  });

  describe('Stats calculations and business rules', () => {
    const voucher1 = {
      id: '11111111-1111-4111-8111-111111111111',
      title: 'Highlands Coffee 50k',
      brand: { id: 'highlands', name: 'Highlands Coffee' },
      stockTotal: 100,
      stockRemaining: 80,
      codesAvailable: 80,
      state: 'ACTIVE' as const,
      isVisible: true,
      redeemStartsAt: new Date('2026-10-01T00:00:00.000Z'),
      redeemEndsAt: new Date('2026-10-31T00:00:00.000Z'),
    };

    const voucher2 = {
      id: '22222222-2222-4222-8222-222222222222',
      title: 'Phuc Long 30k',
      brand: { id: 'phuc-long', name: 'Phúc Long' },
      stockTotal: 50,
      stockRemaining: 45,
      codesAvailable: 45,
      state: 'ACTIVE' as const,
      isVisible: true,
      redeemStartsAt: new Date('2026-10-01T00:00:00.000Z'),
      redeemEndsAt: new Date('2026-10-31T00:00:00.000Z'),
    };

    beforeEach(() => {
      repo.vouchers = [voucher1, voucher2];
    });

    it('calculates KPIs, regular day avg, top voucher share and brand breakdown', async () => {
      // Oct 14: 2 redemptions for v1 (one has usage), 1 redemption for v2
      // Oct 15: Flash sale day. 3 redemptions for v1.
      repo.redemptions = [
        {
          id: 'r1',
          voucherId: voucher1.id,
          pricePoints: 100,
          createdAt: new Date('2026-10-14T03:00:00.000Z'),
          hasUsage: true,
        },
        {
          id: 'r2',
          voucherId: voucher1.id,
          pricePoints: 100,
          createdAt: new Date('2026-10-14T05:00:00.000Z'),
          hasUsage: false,
        },
        {
          id: 'r3',
          voucherId: voucher2.id,
          pricePoints: 60,
          createdAt: new Date('2026-10-14T08:00:00.000Z'),
          hasUsage: false,
        },
        {
          id: 'r4',
          voucherId: voucher1.id,
          pricePoints: 80,
          createdAt: new Date('2026-10-15T02:00:00.000Z'),
          hasUsage: false,
        },
      ];

      // Flash sale on Oct 15 (started)
      repo.flashSales = [
        {
          id: '11111111-2222-4333-8444-555555555555',
          code: 'FS-261015-A',
          startsAt: new Date('2026-10-15T02:00:00.000Z'), // VN Oct 15 09:00
          endsAt: new Date('2026-10-15T14:00:00.000Z'),
          reservedAt: new Date('2026-10-15T02:00:00.000Z'),
          settledAt: null,
          endedEarlyAt: null,
          endReason: null,
          items: [
            {
              id: 'fsi1',
              voucherId: voucher1.id,
              brandName: 'Highlands Coffee',
              valueVnd: 50000,
              flashPoints: 80,
              quota: 10,
              sold: 1,
              perUserCap: 1,
              soldOutAt: null,
            },
          ],
        },
      ];

      const stats = await service.getStats({
        from: '2026-10-14',
        to: '2026-10-15',
      });

      // Total redemptions: 4
      expect(stats.kpis.redemptions.count).toBe(4);
      // Oct 14 is regular (count 3). Oct 15 has flash sale FS-261015-A.
      // Average per regular day = 3 / 1 = 3. (Flash day Oct 15 excluded from regular average)
      expect(stats.kpis.redemptions.avgPerRegularDay).toBe(3);

      // Points spent: 100 + 100 + 60 + 80 = 340
      expect(stats.kpis.pointsSpent.points).toBe(340);
      expect(stats.kpis.pointsSpent.vndEquivalent).toBe(340 * 200);

      // Top voucher: v1 with 3 redemptions out of 4 (share = 0.75)
      expect(stats.kpis.topVoucher).toEqual({
        voucherId: voucher1.id,
        label: 'Highlands Coffee 50k',
        count: 3,
        share: 0.75,
      });

      // Self reported usage rate: 1 with usage out of 4 = 0.25
      expect(stats.kpis.selfReportedUsageRate).toBe(0.25);

      // Brands: highlands and phuc-long
      expect(stats.byBrand).toHaveLength(2);
      const hlBrand = stats.byBrand.find((b) => b.brand.id === 'highlands');
      expect(hlBrand).toBeDefined();
      expect(hlBrand?.redemptions).toBe(3);
      expect(hlBrand?.pointsSpent).toBe(280);
      // offered for highlands: max(3, 100) = 100 -> soldRatio = 3 / 100 = 0.03
      expect(hlBrand?.soldRatio).toBe(0.03);

      // Flash performance
      expect(stats.flashSales).toHaveLength(1);
      expect(stats.flashSales[0].code).toBe('FS-261015-A');
      expect(stats.flashSales[0].sold).toBe(1);
      expect(stats.flashSales[0].quota).toBe(10);
      expect(stats.flashSales[0].pointsSpent).toBe(80);

      expect(() => rewardsStatsSchema.parse(stats)).not.toThrow();
    });

    it('excludes upcoming flash sales from flash days and performance', async () => {
      // Flash sale in future (startsAt > now)
      repo.flashSales = [
        {
          id: 'fs2',
          code: 'FS-261016-B',
          startsAt: new Date('2026-10-16T02:00:00.000Z'),
          endsAt: new Date('2026-10-16T14:00:00.000Z'),
          reservedAt: null,
          settledAt: null,
          endedEarlyAt: null,
          endReason: null,
          items: [],
        },
      ];

      const stats = await service.getStats({
        from: '2026-10-14',
        to: '2026-10-16',
      });

      // upcoming flash sale must not mark Oct 16 as flash day
      const day16 = stats.daily.find((d) => d.date === '2026-10-16');
      expect(day16?.flashSaleCodes).toEqual([]);
      expect(stats.flashSales).toEqual([]);
    });

    it('marks every VN day covered by a cross-midnight / multi-day sale as a flash day', async () => {
      // 2026-10-13 23:00 VN -> 2026-10-15 01:00 VN (covers VN Oct 13, 14, 15)
      repo.flashSales = [
        {
          id: '33333333-3333-4333-8333-333333333333',
          code: 'FS-MULTI',
          startsAt: new Date('2026-10-13T16:00:00.000Z'),
          endsAt: new Date('2026-10-14T18:00:00.000Z'),
          reservedAt: new Date('2026-10-13T16:00:00.000Z'),
          settledAt: null,
          endedEarlyAt: null,
          endReason: null,
          items: [],
        },
      ];
      repo.redemptions = [
        {
          id: 'r1',
          voucherId: voucher1.id,
          pricePoints: 100,
          createdAt: new Date('2026-10-15T20:00:00.000Z'), // VN Oct 16
          hasUsage: false,
        },
      ];

      const stats = await service.getStats({
        from: '2026-10-13',
        to: '2026-10-16',
      });

      expect(stats.daily.map((d) => d.flashSaleCodes)).toEqual([
        ['FS-MULTI'],
        ['FS-MULTI'],
        ['FS-MULTI'],
        [],
      ]);
      // Only Oct 16 is regular (1 redemption)
      expect(stats.kpis.redemptions.avgPerRegularDay).toBe(1);
    });

    it('stops flash days at endedEarlyAt and ignores sales outside the range', async () => {
      repo.flashSales = [
        {
          id: 'fs-early',
          code: 'FS-EARLY',
          startsAt: new Date('2026-10-13T16:00:00.000Z'), // VN Oct 13 23:00
          endsAt: new Date('2026-10-15T16:00:00.000Z'),
          reservedAt: new Date('2026-10-13T16:00:00.000Z'),
          settledAt: null,
          endedEarlyAt: new Date('2026-10-13T18:00:00.000Z'), // VN Oct 14 01:00
          endReason: 'MANUAL',
          items: [],
        },
      ];
      const stats = await service.getStats({
        from: '2026-10-14',
        to: '2026-10-16',
      });
      expect(stats.daily.map((d) => d.flashSaleCodes)).toEqual([
        ['FS-EARLY'],
        [],
        [],
      ]);
    });
  });
});
