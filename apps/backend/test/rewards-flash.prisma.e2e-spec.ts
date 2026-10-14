import { randomUUID } from 'crypto';
import { IDEMPOTENCY_KEY_HEADER, redemptionQuoteSchema } from '@rescom/schemas';
import {
  Actor,
  bootHarness,
  Harness,
  probeDatabase,
  requireDb,
} from './fixtures/financial-pg-harness';
import { FlashSaleLifecycleService } from '../src/modules/rewards/application/flash-sale-lifecycle.service';
import { RewardsAdminFlashService } from '../src/modules/rewards/application/rewards-admin-flash.service';
import { PrismaFlashSaleRepository } from '../src/modules/rewards/infrastructure/prisma-flash-sale.repository';
import { PrismaVoucherRepository } from '../src/modules/rewards/infrastructure/prisma-voucher.repository';

import {
  UNIT_OF_WORK_PORT,
  UnitOfWorkPort,
} from '../src/common/database/unit-of-work.port';

const pgPort = process.env.PG_PORT || '5432';
const databaseUrl =
  process.env.FINANCIAL_TEST_DATABASE_URL ??
  `postgresql://rescom_admin:rescom_password@localhost:${pgPort}/rescom_financial_test?schema=public`;

const canRun = probeDatabase(databaseUrl);
if (!canRun && requireDb) {
  throw new Error(`PostgreSQL unreachable for ${databaseUrl}`);
}
if (!canRun) {
  // eslint-disable-next-line no-console
  console.warn(
    `[rewards-flash.prisma.e2e] PostgreSQL unreachable for ${databaseUrl}: suite NOT executed`,
  );
}
const describeSuite = canRun ? describe : describe.skip;

describeSuite(
  'Story 12.9: Flash Sale lifecycle & reserve-at-start stock model on PostgreSQL',
  () => {
    let harness: Harness;
    let flashRepo: PrismaFlashSaleRepository;
    let voucherRepo: PrismaVoucherRepository;
    let lifecycle: FlashSaleLifecycleService;
    let adminFlash: RewardsAdminFlashService;

    beforeAll(async () => {
      harness = await bootHarness({ databaseUrl });
      flashRepo = new PrismaFlashSaleRepository(harness.prisma);
      voucherRepo = new PrismaVoucherRepository(harness.prisma);
      const unitOfWork = harness.app.get<UnitOfWorkPort>(UNIT_OF_WORK_PORT);
      lifecycle = new FlashSaleLifecycleService({
        flashSales: flashRepo,
        vouchers: voucherRepo,
        unitOfWork,
      });
      adminFlash = harness.app.get(RewardsAdminFlashService, { strict: false });
    }, 60_000);

    afterAll(async () => {
      await harness?.close();
    });

    async function createVoucher(stock: number) {
      const voucherId = randomUUID();
      const now = new Date();
      return harness.prisma.voucher.create({
        data: {
          id: voucherId,
          title: `Flash Voucher ${voucherId.slice(0, 8)}`,
          brandId: 'highlands',
          category: 'COFFEE',
          valueVnd: 50_000,
          basePoints: 100,
          promoPoints: 90,
          priceVersion: 1,
          stockTotal: stock,
          stockRemaining: stock,
          state: 'ACTIVE',
          isVisible: true,
          isSharedCode: true,
          sharedCode: 'SHARED123',
          createdById: voucherId,
          redeemStartsAt: new Date(now.getTime() - 3600_000),
          redeemEndsAt: new Date(now.getTime() + 86400_000),
          codeExpiresAt: new Date(now.getTime() + 86400_000 * 10),
        },
      });
    }

    it('lifecycle job reserves quota at start (decrementing stock) and returns unsold quota on settle', async () => {
      const voucher = await createVoucher(20);
      const saleId = randomUUID();
      const itemId = randomUUID();
      const now = new Date();

      // Create flash sale due to start
      await flashRepo.insertSale({
        id: saleId,
        code: `FS-${randomUUID().replace(/-/g, '').slice(0, 9).toUpperCase()}`,
        title: 'PG Flash Sale Test',
        createdById: voucher.id,
        startsAt: new Date(now.getTime() - 1000).toISOString(),
        endsAt: new Date(now.getTime() + 3600_000).toISOString(),
        rules: {
          requireRecentSurvey: false,
          blockFlagged: false,
          remindBefore10m: false,
        },
        items: [
          {
            id: itemId,
            voucherId: voucher.id,
            flashPoints: 40,
            quota: 10,
            perUserCap: 1,
          },
        ],
      });

      // 1. Run lifecycle to reserve
      const reserveRun = await lifecycle.runDue(now, 10);
      expect(reserveRun.reserved).toBeGreaterThanOrEqual(1);

      // Verify voucher stock remaining carved out: 20 - 10 = 10
      const afterReserve = await harness.prisma.voucher.findUniqueOrThrow({
        where: { id: voucher.id },
      });
      expect(afterReserve.stockRemaining).toBe(10);

      const reservedSale = await harness.prisma.flashSale.findUniqueOrThrow({
        where: { id: saleId },
      });
      expect(reservedSale.reservedAt).not.toBeNull();

      // 2. Simulate 3 sold items
      await harness.prisma.flashSaleItem.update({
        where: { id: itemId },
        data: { sold: 3 },
      });

      // 3. Fast-forward past endsAt and run lifecycle to settle
      const futureNow = new Date(now.getTime() + 7200_000);
      const settleRun = await lifecycle.runDue(futureNow, 10);
      expect(settleRun.settled).toBeGreaterThanOrEqual(1);

      // Verify unsold quota (10 - 3 = 7) returned: 10 + 7 = 17
      const afterSettle = await harness.prisma.voucher.findUniqueOrThrow({
        where: { id: voucher.id },
      });
      expect(afterSettle.stockRemaining).toBe(17);

      const settledSale = await harness.prisma.flashSale.findUniqueOrThrow({
        where: { id: saleId },
      });
      expect(settledSale.settledAt).not.toBeNull();
    });

    it('enforces flash_item_claims unique backstop (BR-19) under concurrent claims for perUserCap = 1', async () => {
      const voucher = await createVoucher(20);
      const saleId = randomUUID();
      const itemId = randomUUID();
      const user = await harness.user('RESPONDENT');
      const now = new Date();

      await flashRepo.insertSale({
        id: saleId,
        code: `FS-${randomUUID().replace(/-/g, '').slice(0, 9).toUpperCase()}`,
        title: 'Concurrent Claim Test',
        createdById: voucher.id,
        startsAt: new Date(now.getTime() - 1000).toISOString(),
        endsAt: new Date(now.getTime() + 3600_000).toISOString(),
        rules: {
          requireRecentSurvey: false,
          blockFlagged: false,
          remindBefore10m: false,
        },
        items: [
          {
            id: itemId,
            voucherId: voucher.id,
            flashPoints: 40,
            quota: 10,
            perUserCap: 1,
          },
        ],
      });

      await lifecycle.runDue(now, 10);

      // First claim succeeds
      const redemption1Id = randomUUID();
      await harness.prisma.redemption.create({
        data: {
          id: redemption1Id,
          userId: user.id,
          voucherId: voucher.id,
          flashSaleItemId: itemId,
          idempotencyKey: 'claim-race-1',
          status: 'SUCCEEDED',
          pricePoints: 40,
          priceSource: 'FLASH',
          priceVersion: 1,
          journalId: randomUUID(),
          balanceAfter: 100,
          reference: `RDM-${randomUUID().slice(0, 8)}`,
        },
      });

      await harness.prisma.flashItemClaim.create({
        data: {
          flashSaleItemId: itemId,
          userId: user.id,
          redemptionId: redemption1Id,
        },
      });

      // Second concurrent claim for same (flashSaleItemId, userId) must violate unique constraint
      const redemption2Id = randomUUID();
      await harness.prisma.redemption.create({
        data: {
          id: redemption2Id,
          userId: user.id,
          voucherId: voucher.id,
          flashSaleItemId: itemId,
          idempotencyKey: 'claim-race-2',
          status: 'SUCCEEDED',
          pricePoints: 40,
          priceSource: 'FLASH',
          priceVersion: 1,
          journalId: randomUUID(),
          balanceAfter: 100,
          reference: `RDM-${randomUUID().slice(0, 8)}`,
        },
      });

      await expect(
        harness.prisma.flashItemClaim.create({
          data: {
            flashSaleItemId: itemId,
            userId: user.id,
            redemptionId: redemption2Id,
          },
        }),
      ).rejects.toThrow();
    });
    const rules = {
      requireRecentSurvey: false,
      blockFlagged: false,
      remindBefore10m: false,
    };

    async function insertSale(
      voucherId: string,
      opts: { startsAt: Date; endsAt: Date; quota?: number },
    ) {
      const saleId = randomUUID();
      const itemId = randomUUID();
      await flashRepo.insertSale({
        id: saleId,
        code: `FS-${randomUUID().replace(/-/g, '').slice(0, 9).toUpperCase()}`,
        title: 'PG flash',
        createdById: voucherId,
        startsAt: opts.startsAt.toISOString(),
        endsAt: opts.endsAt.toISOString(),
        rules,
        items: [
          {
            id: itemId,
            voucherId,
            flashPoints: 40,
            quota: opts.quota ?? 5,
            perUserCap: 1,
          },
        ],
      });
      return { saleId, itemId };
    }

    async function activeRespondent(balance = 1000): Promise<Actor> {
      const user = await harness.user('RESPONDENT');
      await harness.fund(user.id, balance);
      // Starter-unlock journal + a survey completed in the last 30 days.
      const available = await harness.ledger.getOrCreateAccount(
        user.id,
        'USER_AVAILABLE',
      );
      const issuance = await harness.ledger.getOrCreateAccount(
        null,
        'SYSTEM_ISSUANCE',
      );
      await harness.ledger.postJournal({
        idempotencyKey: `starter-unlock:${user.id}`,
        entries: [
          { accountId: issuance.id, amount: -1 },
          { accountId: available.id, amount: 1 },
        ],
      });
      const formId = randomUUID();
      const versionId = randomUUID();
      await harness.prisma.form.create({
        data: {
          id: formId,
          publisherId: user.id,
          title: 'Survey',
          type: 'INTERNAL',
          status: 'PUBLISHED',
          rewardPerResponse: 10,
          expectedCompletions: 10,
          versions: {
            create: {
              id: versionId,
              versionNumber: 1,
              schemaJson: {},
              isPublished: true,
            },
          },
        },
      });
      await harness.prisma.surveyAttempt.create({
        data: {
          id: randomUUID(),
          surveyId: formId,
          formVersionId: versionId,
          respondentId: user.id,
          status: 'COMPLETED',
          submittedAt: new Date(),
        },
      });
      return user;
    }

    async function quoteOf(user: Actor, voucherId: string) {
      const res = await harness.send('post', '/rewards/quotes', user, {
        voucherId,
      });
      expect(res.status).toBe(201);
      return redemptionQuoteSchema.parse(res.body.data);
    }

    const redeem = (user: Actor, quoteId: string) =>
      harness
        .send('post', '/rewards/redemptions', user, { quoteId })
        .set(IDEMPOTENCY_KEY_HEADER, `flash-${randomUUID()}`);

    const stockOf = async (voucherId: string) =>
      (
        await harness.prisma.voucher.findUniqueOrThrow({
          where: { id: voucherId },
        })
      ).stockRemaining;

    it('parallel runDue reserves once and settles once (stock moved exactly once)', async () => {
      const voucher = await createVoucher(20);
      const now = new Date();
      const { saleId } = await insertSale(voucher.id, {
        startsAt: new Date(now.getTime() - 1000),
        endsAt: new Date(now.getTime() + 3600_000),
        quota: 8,
      });

      await Promise.all([
        lifecycle.runDue(now, 100),
        lifecycle.runDue(now, 100),
        lifecycle.runDue(now, 100),
      ]);
      expect(await stockOf(voucher.id)).toBe(12);
      expect(
        await harness.prisma.outboxEvent.count({
          where: {
            idempotencyKey: `rewards:flash:${saleId}:started`,
          },
        }),
      ).toBe(1);

      const later = new Date(now.getTime() + 7200_000);
      await Promise.all([
        lifecycle.runDue(later, 100),
        lifecycle.runDue(later, 100),
      ]);
      expect(await stockOf(voucher.id)).toBe(20);
      expect(
        await harness.prisma.outboxEvent.count({
          where: { idempotencyKey: `rewards:flash:${saleId}:settled` },
        }),
      ).toBe(1);
    });

    it('settles a sold-out sale before endsAt and leaves RESERVATION_FAILED sales out of later scans', async () => {
      const voucher = await createVoucher(10);
      const now = new Date();
      const { saleId, itemId } = await insertSale(voucher.id, {
        startsAt: new Date(now.getTime() - 1000),
        endsAt: new Date(now.getTime() + 3600_000),
        quota: 4,
      });
      await lifecycle.runDue(now, 100);
      await harness.prisma.flashSaleItem.update({
        where: { id: itemId },
        data: { sold: 4 },
      });
      const run = await lifecycle.runDue(now, 100);
      expect(run.settled).toBeGreaterThanOrEqual(1);
      expect(
        (
          await harness.prisma.flashSale.findUniqueOrThrow({
            where: { id: saleId },
          })
        ).endReason,
      ).toBe('SOLD_OUT');
      expect(await stockOf(voucher.id)).toBe(6);

      // Not enough stock for the quota: cancelled once, ended_early_at set, never re-picked.
      const poor = await createVoucher(1);
      const failed = await insertSale(poor.id, {
        startsAt: new Date(now.getTime() - 1000),
        endsAt: new Date(now.getTime() + 3600_000),
        quota: 5,
      });
      const first = await lifecycle.runDue(now, 100);
      expect(first.reservationFailed).toBeGreaterThanOrEqual(1);
      const row = await harness.prisma.flashSale.findUniqueOrThrow({
        where: { id: failed.saleId },
      });
      expect(row.endedEarlyAt).not.toBeNull();
      expect(row.settledAt).not.toBeNull();
      expect(row.endReason).toBe('RESERVATION_FAILED');
      expect(row.reservedAt).toBeNull();
      const due = await flashRepo.findDueForReserve(now, 1000);
      expect(due.some((s) => s.id === failed.saleId)).toBe(false);
      expect(await stockOf(poor.id)).toBe(1);
    });

    it('exact boundaries: reserve at startsAt, flash price in [start, end), regular at endsAt', async () => {
      const voucher = await createVoucher(10);
      const startsAt = new Date(Date.now() + 10 * 60_000);
      const endsAt = new Date(startsAt.getTime() + 3600_000);
      const { saleId } = await insertSale(voucher.id, {
        startsAt,
        endsAt,
        quota: 3,
      });

      await lifecycle.runDue(new Date(startsAt.getTime() - 1), 100);
      expect(
        (
          await harness.prisma.flashSale.findUniqueOrThrow({
            where: { id: saleId },
          })
        ).reservedAt,
      ).toBeNull();

      await lifecycle.runDue(startsAt, 100);
      expect(
        (
          await harness.prisma.flashSale.findUniqueOrThrow({
            where: { id: saleId },
          })
        ).reservedAt,
      ).not.toBeNull();

      expect(
        await flashRepo.findActiveItemForVoucher(voucher.id, startsAt),
      ).not.toBeNull();
      expect(
        await flashRepo.findActiveItemForVoucher(
          voucher.id,
          new Date(endsAt.getTime() - 1),
        ),
      ).not.toBeNull();
      expect(
        await flashRepo.findActiveItemForVoucher(voucher.id, endsAt),
      ).toBeNull();

      // A never-reserved sale whose end has passed is stamped settled with no stock move.
      const missed = await insertSale(voucher.id, {
        startsAt: new Date(startsAt.getTime() + 86400_000),
        endsAt: new Date(startsAt.getTime() + 86400_000 + 3600_000),
      });
      const afterEnd = new Date(startsAt.getTime() + 86400_000 + 3600_000);
      await lifecycle.runDue(afterEnd, 100);
      const missedRow = await harness.prisma.flashSale.findUniqueOrThrow({
        where: { id: missed.saleId },
      });
      expect(missedRow.reservedAt).toBeNull();
      expect(missedRow.settledAt).not.toBeNull();
    });

    it('boundary prices: flash price must be strictly below the regular price', async () => {
      const voucher = await createVoucher(10); // promo 90, base 100
      const admin = await harness.user('ADMIN');
      const input = (flashPoints: number) => ({
        title: 'Boundary',
        startsAt: new Date(Date.now() + 3600_000).toISOString(),
        endsAt: new Date(Date.now() + 7200_000).toISOString(),
        rules,
        items: [
          { voucherId: voucher.id, flashPoints, quota: 2, perUserCap: 1 },
        ],
      });
      await expect(
        adminFlash.create(admin.id, input(90)),
      ).rejects.toMatchObject({ code: 'FLASH_PRICE_NOT_BELOW_REGULAR' });
      const ok = await adminFlash.create(admin.id, input(89));
      expect(ok.flashSale.items[0].flashPoints).toBe(89);
    });

    it('parallel overlapping creates: exactly one wins, the other gets FLASH_OVERLAP', async () => {
      const voucher = await createVoucher(10);
      const admin = await harness.user('ADMIN');
      const body = {
        title: 'Overlap',
        startsAt: new Date(Date.now() + 3600_000).toISOString(),
        endsAt: new Date(Date.now() + 7200_000).toISOString(),
        rules,
        items: [
          { voucherId: voucher.id, flashPoints: 50, quota: 2, perUserCap: 1 },
        ],
      };
      const results = await Promise.allSettled([
        adminFlash.create(admin.id, body),
        adminFlash.create(admin.id, body),
        adminFlash.create(admin.id, body),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      for (const r of results) {
        if (r.status === 'rejected') {
          expect(r.reason).toMatchObject({ code: 'FLASH_OVERLAP' });
        }
      }
      expect(
        await harness.prisma.flashSaleItem.count({
          where: { voucherId: voucher.id },
        }),
      ).toBe(1);
    });

    it('update twice keeps sold and uses a fresh audit key each time', async () => {
      const voucher = await createVoucher(10);
      const admin = await harness.user('ADMIN');
      const body = {
        title: 'Update',
        startsAt: new Date(Date.now() + 3600_000).toISOString(),
        endsAt: new Date(Date.now() + 7200_000).toISOString(),
        rules,
        items: [
          { voucherId: voucher.id, flashPoints: 50, quota: 2, perUserCap: 1 },
        ],
      };
      const { flashSale } = await adminFlash.create(admin.id, body);
      await harness.prisma.flashSaleItem.updateMany({
        where: { flashSaleId: flashSale.id },
        data: { sold: 1 },
      });
      await adminFlash.update(flashSale.id, admin.id, body);
      await adminFlash.update(flashSale.id, admin.id, { ...body, title: 'U2' });
      const item = await harness.prisma.flashSaleItem.findFirstOrThrow({
        where: { flashSaleId: flashSale.id },
      });
      expect(item.sold).toBe(1);
      expect(
        await harness.prisma.outboxEvent.count({
          where: {
            idempotencyKey: {
              startsWith: `rewards:flash:${flashSale.id}:updated:`,
            },
          },
        }),
      ).toBe(2);
    });

    it('runDue vs early end: stock is returned exactly once', async () => {
      const voucher = await createVoucher(10);
      const admin = await harness.user('ADMIN');
      const now = new Date();
      const { saleId } = await insertSale(voucher.id, {
        startsAt: new Date(now.getTime() - 1000),
        endsAt: new Date(now.getTime() + 3600_000),
        quota: 6,
      });
      await lifecycle.runDue(now, 100);
      expect(await stockOf(voucher.id)).toBe(4);

      // The job clock is past endsAt while the admin still sees the sale ACTIVE.
      await Promise.allSettled([
        lifecycle.runDue(new Date(now.getTime() + 7200_000), 100),
        adminFlash.endEarly(saleId, admin.id, { reason: 'WRONG_PRICE' }),
      ]);
      expect(await stockOf(voucher.id)).toBe(10);
      const row = await harness.prisma.flashSale.findUniqueOrThrow({
        where: { id: saleId },
      });
      expect(row.settledAt).not.toBeNull();
    });

    it('early end vs redeem: every success consumes exactly one unit and stock is returned once', async () => {
      const voucher = await createVoucher(10);
      const admin = await harness.user('ADMIN');
      const user = await activeRespondent(1000);
      const now = new Date();
      const { saleId } = await insertSale(voucher.id, {
        startsAt: new Date(now.getTime() - 1000),
        endsAt: new Date(now.getTime() + 3600_000),
        quota: 5,
      });
      await lifecycle.runDue(now, 100);
      const quote = await quoteOf(user, voucher.id);
      expect(quote.price.source).toBe('FLASH');

      const [redeemRes] = await Promise.all([
        redeem(user, quote.quoteId),
        adminFlash.endEarly(saleId, admin.id, { reason: 'WRONG_PRICE' }),
      ]);
      const succeeded = await harness.prisma.redemption.count({
        where: { userId: user.id, status: 'SUCCEEDED' },
      });
      expect([201, 409]).toContain(redeemRes.status);
      expect(succeeded).toBe(redeemRes.status === 201 ? 1 : 0);
      expect(10 - (await stockOf(voucher.id))).toBe(succeeded);
      expect(
        (
          await harness.prisma.flashSale.findUniqueOrThrow({
            where: { id: saleId },
          })
        ).settledAt,
      ).not.toBeNull();
    });

    it('getMonitoringStats counts distinct participants, after-top-up logs/users and SOLD_OUT failures only', async () => {
      const voucher = await createVoucher(20);
      const now = new Date();
      const { itemId } = await insertSale(voucher.id, {
        startsAt: new Date(now.getTime() - 1000),
        endsAt: new Date(now.getTime() + 3600_000),
      });
      const [u1, u2, u3] = await Promise.all([
        harness.user('RESPONDENT'),
        harness.user('RESPONDENT'),
        harness.user('RESPONDENT'),
      ]);
      const seed = async (
        userId: string,
        status: 'SUCCEEDED' | 'FAILED',
        failureCode?: string,
      ) => {
        const id = randomUUID();
        await harness.prisma.redemption.create({
          data: {
            id,
            userId,
            voucherId: voucher.id,
            flashSaleItemId: itemId,
            idempotencyKey: `mon-${id}`,
            status,
            pricePoints: 40,
            priceSource: 'FLASH',
            priceVersion: 1,
            ...(status === 'SUCCEEDED'
              ? { journalId: randomUUID(), balanceAfter: 100 }
              : { failureCode }),
            reference: `RDM-${id.slice(0, 8)}`,
          },
        });
        return id;
      };
      const s1 = await seed(u1.id, 'SUCCEEDED');
      const s2 = await seed(u1.id, 'SUCCEEDED'); // same user twice
      const s3 = await seed(u2.id, 'SUCCEEDED');
      await seed(u3.id, 'FAILED', 'SOLD_OUT');
      await seed(u3.id, 'FAILED', 'INSUFFICIENT_POINTS');
      for (const [rid, userId] of [
        [s1, u1.id],
        [s2, u1.id], // two logs, one user
        [s3, u2.id],
      ]) {
        await harness.prisma.fraudLog.create({
          data: {
            userId,
            type: 'FLASH_AFTER_TOPUP',
            dedupeKey: `flash-after-topup:${rid}`,
          },
        });
      }

      const stats = await flashRepo.getMonitoringStats('unused', [itemId], 3);
      expect(stats.participants).toBe(3);
      expect(stats.failures).toEqual({
        SOLD_OUT: 1,
        INSUFFICIENT_POINTS: 1,
        OTHER: 0,
      });
      expect(stats.afterTopUp).toEqual({ count: 3, rate: 1, flagged: 2 });
    });

    it('BR-19: parallel redemptions by one user with perUserCap = 1 produce exactly one Flash success', async () => {
      const voucher = await createVoucher(20);
      const user = await activeRespondent(1000);
      const now = new Date();
      const { itemId } = await insertSale(voucher.id, {
        startsAt: new Date(now.getTime() - 1000),
        endsAt: new Date(now.getTime() + 3600_000),
        quota: 10,
      });
      await lifecycle.runDue(now, 100);

      const quotes = await Promise.all([
        quoteOf(user, voucher.id),
        quoteOf(user, voucher.id),
        quoteOf(user, voucher.id),
      ]);
      const responses = await Promise.all(
        quotes.map((q) => redeem(user, q.quoteId)),
      );
      expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
      expect(
        await harness.prisma.flashItemClaim.count({
          where: { flashSaleItemId: itemId, userId: user.id },
        }),
      ).toBe(1);
      expect(
        (
          await harness.prisma.flashSaleItem.findUniqueOrThrow({
            where: { id: itemId },
          })
        ).sold,
      ).toBe(1);
    });
  },
);
