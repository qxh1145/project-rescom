import { randomUUID } from 'crypto';
import { rewardsStatsSchema } from '@rescom/schemas';
import {
  bootHarness,
  databaseUrl,
  Harness,
  probeDatabase,
  requireDb,
} from './fixtures/financial-pg-harness';

const canRun = probeDatabase(databaseUrl);
if (!canRun && requireDb) {
  throw new Error(`PostgreSQL unreachable for ${databaseUrl}`);
}
if (!canRun) {
  // eslint-disable-next-line no-console
  console.warn(
    `[rewards-stats.prisma.e2e] PostgreSQL unreachable for ${databaseUrl}: suite NOT executed`,
  );
}
const describeSuite = canRun ? describe : describe.skip;

describeSuite(
  'Task 4: Rewards stats on PostgreSQL with seed and VN midnight',
  () => {
    let harness: Harness;

    beforeAll(async () => {
      harness = await bootHarness({
        databaseUrl,
        env: {
          REWARDS_ENABLED: true,
        },
      });
    }, 60_000);

    afterAll(async () => {
      await harness?.close();
    });

    it('aggregates redemptions, excludes refunds, tracks usages across VN midnight', async () => {
      const admin = await harness.user('ADMIN');

      // Create a unique brand and voucher
      const brandId = `brand-${randomUUID().slice(0, 8)}`;
      await harness.prisma.voucherBrand.create({
        data: {
          id: brandId,
          name: 'Stats Test Brand',
        },
      });

      const voucherId = randomUUID();
      const creatorId = randomUUID();
      await harness.prisma.voucher.create({
        data: {
          id: voucherId,
          title: 'Stats Test Voucher 100k',
          brandId,
          category: 'COFFEE',
          valueVnd: 100_000,
          basePoints: 200,
          promoPoints: null,
          priceVersion: 1,
          stockTotal: 50,
          stockRemaining: 47,
          state: 'ACTIVE',
          isVisible: true,
          isSharedCode: true,
          sharedCode: 'STATS-SHARED',
          createdById: creatorId,
          redeemStartsAt: new Date('2026-10-01T00:00:00.000Z'),
          redeemEndsAt: new Date('2026-10-31T00:00:00.000Z'),
          codeExpiresAt: new Date('2026-12-31T00:00:00.000Z'),
        },
      });

      const userId = randomUUID();
      await harness.prisma.user.create({
        data: {
          id: userId,
          email: `stats-user-${userId.slice(0, 8)}@fpt.edu.vn`,
          role: 'RESPONDENT',
        },
      });

      // Isolated day pair (D, D+1) in a random far-off year so the exact assertions
      // are not polluted by other suites or earlier runs on the shared test DB.
      const year = 1100 + Math.floor(Math.random() * 7900);
      const day14 = `${year}-10-14`;
      const day15 = `${year}-10-15`;

      // Seeding:
      // Vietnam day 2026-10-14:
      // 1) 23:30 VN (16:30 UTC on 2026-10-14): Succeeded redemption with usage
      const rdm1Id = randomUUID();
      await harness.prisma.redemption.create({
        data: {
          id: rdm1Id,
          userId,
          voucherId,
          idempotencyKey: `idemp-1-${rdm1Id}`,
          status: 'SUCCEEDED',
          pricePoints: 200,
          priceSource: 'BASE',
          priceVersion: 1,
          reference: `RDM-2610-${randomUUID().slice(0, 4).toUpperCase()}`,
          journalId: randomUUID(),
          balanceAfter: 800,
          createdAt: new Date(`${year}-10-14T16:30:00.000Z`),
        },
      });
      const usedAt = new Date(`${year}-10-14T16:40:00.000Z`);
      await harness.prisma.redemptionUsage.create({
        data: {
          redemptionId: rdm1Id,
          usedAt,
          undoUntil: new Date(usedAt.getTime() + 24 * 3600 * 1000),
        },
      });

      // 2) 23:45 VN (16:45 UTC on 2026-10-14): Succeeded redemption that was refunded -> MUST BE EXCLUDED!
      const rdm2Id = randomUUID();
      await harness.prisma.redemption.create({
        data: {
          id: rdm2Id,
          userId,
          voucherId,
          idempotencyKey: `idemp-2-${rdm2Id}`,
          status: 'SUCCEEDED',
          pricePoints: 200,
          priceSource: 'BASE',
          priceVersion: 1,
          reference: `RDM-2610-${randomUUID().slice(0, 4).toUpperCase()}`,
          journalId: randomUUID(),
          balanceAfter: 600,
          createdAt: new Date(`${year}-10-14T16:45:00.000Z`),
        },
      });
      const reportId = randomUUID();
      await harness.prisma.codeIssueReport.create({
        data: {
          id: reportId,
          redemptionId: rdm2Id,
          reason: 'CODE_INVALID',
          status: 'REFUNDED',
          refundJournalId: randomUUID(),
          resolvedById: admin.id,
          resolvedAt: new Date(`${year}-10-14T17:00:00.000Z`),
        },
      });
      await harness.prisma.redemptionRefund.create({
        data: {
          id: randomUUID(),
          redemptionId: rdm2Id,
          reportId,
          journalId: randomUUID(),
          reference: `RFD-2610-${randomUUID().slice(0, 4).toUpperCase()}`,
          points: 200,
        },
      });

      // Vietnam day 2026-10-15:
      // 3) 00:30 VN (17:30 UTC on 2026-10-14): Succeeded redemption without usage
      const rdm3Id = randomUUID();
      await harness.prisma.redemption.create({
        data: {
          id: rdm3Id,
          userId,
          voucherId,
          idempotencyKey: `idemp-3-${rdm3Id}`,
          status: 'SUCCEEDED',
          pricePoints: 200,
          priceSource: 'BASE',
          priceVersion: 1,
          reference: `RDM-2610-${randomUUID().slice(0, 4).toUpperCase()}`,
          journalId: randomUUID(),
          balanceAfter: 400,
          createdAt: new Date(`${year}-10-14T17:30:00.000Z`),
        },
      });

      // Call GET /admin/rewards/stats?from=${day14}&to=${day15}
      const res = await harness
        .get(`/admin/rewards/stats?from=${day14}&to=${day15}`, admin)
        .expect(200);

      expect(res.body).toHaveProperty('data');
      const stats = rewardsStatsSchema.parse(res.body.data);

      // Exact values from the seed: rdm1 on VN Oct 14, rdm3 on VN Oct 15,
      // rdm2 refunded and excluded.
      expect(stats.daily.map((d) => [d.date, d.count])).toEqual([
        [day14, 1],
        [day15, 1],
      ]);
      expect(stats.kpis.redemptions.count).toBe(2);
      expect(stats.kpis.pointsSpent.points).toBe(400);
      // rdm1 has usage, rdm3 does not
      expect(stats.kpis.selfReportedUsageRate).toBe(0.5);
      expect(stats.kpis.topVoucher).toEqual({
        voucherId,
        label: 'Stats Test Voucher 100k',
        count: 2,
        share: 1,
      });

      // Brand breakdown includes our test brand
      const brandStat = stats.byBrand.find((b) => b.brand.id === brandId);
      expect(brandStat).toBeDefined();
      expect(brandStat?.redemptions).toBe(2);
      expect(brandStat?.pointsSpent).toBe(400);
    });
  },
);
