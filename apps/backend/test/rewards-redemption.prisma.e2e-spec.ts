import { randomUUID } from 'crypto';
import {
  bootHarness,
  Harness,
  probeDatabase,
  Actor,
  requireDb,
} from './fixtures/financial-pg-harness';
import {
  redemptionResultSchema,
  redemptionQuoteSchema,
  IDEMPOTENCY_KEY_HEADER,
} from '@rescom/schemas';

const pgPort = process.env.PG_PORT || '5432';
const databaseUrl =
  process.env.FINANCIAL_TEST_DATABASE_URL ??
  `postgresql://rescom_admin:rescom_password@localhost:${pgPort}/rescom_financial_test?schema=public`;

const canRun = probeDatabase(databaseUrl);
// An explicit FINANCIAL_TEST_DATABASE_URL (or CI) makes an unreachable DB a hard
// failure instead of a silent skip: this is the money-path proof.
if (!canRun && requireDb) {
  throw new Error(`PostgreSQL unreachable for ${databaseUrl}`);
}
const describeSuite = canRun ? describe : describe.skip;

describeSuite(
  'Story 12.8: Rewards redemption transactions on PostgreSQL',
  () => {
    let harness: Harness;

    beforeAll(async () => {
      harness = await bootHarness({ databaseUrl });
    }, 60_000);

    afterAll(async () => {
      await harness?.close();
    });

    async function createVoucherWithStock(opts: {
      stockRemaining: number;
      codesCount: number;
      basePoints?: number;
      isSharedCode?: boolean;
      sharedCode?: string | null;
    }) {
      const voucherId = randomUUID();
      const now = new Date();
      const brandId = 'highlands';

      const voucher = await harness.prisma.voucher.create({
        data: {
          id: voucherId,
          title: `Test Voucher ${voucherId.slice(0, 8)}`,
          brandId,
          category: 'COFFEE',
          valueVnd: 50_000,
          basePoints: opts.basePoints ?? 50,
          promoPoints: null,
          priceVersion: 1,
          stockTotal: opts.stockRemaining,
          stockRemaining: opts.stockRemaining,
          state: 'ACTIVE',
          isVisible: true,
          isSharedCode: opts.isSharedCode ?? false,
          sharedCode: opts.sharedCode ?? null,
          createdById: voucherId, // valid UUID
          redeemStartsAt: new Date(now.getTime() - 3600_000),
          redeemEndsAt: new Date(now.getTime() + 86400_000),
          codeExpiresAt: new Date(now.getTime() + 86400_000 * 10), // >= redeemEndsAt + 7 days
        },
      });

      for (let i = 0; i < opts.codesCount; i++) {
        await harness.prisma.voucherCode.create({
          data: {
            id: randomUUID(),
            voucherId: voucher.id,
            code: `CODE-${randomUUID().slice(0, 8).toUpperCase()}`,
          },
        });
      }

      return voucher;
    }

    async function setupActiveRespondent(
      initialBalance = 1000,
    ): Promise<Actor> {
      const user = await harness.user('RESPONDENT');

      // Make active and activated (has starter-unlock journal)
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
          { accountId: issuance.id, amount: -initialBalance },
          { accountId: available.id, amount: initialBalance },
        ],
      });

      // Ensure has completed survey in last 30 days
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

    it('Proof 1: Two users racing for last unit - exactly 1 success, 1 SOLD_OUT, stock=0, no overdraft', async () => {
      const userA = await setupActiveRespondent(100);
      const userB = await setupActiveRespondent(100);

      const voucher = await createVoucherWithStock({
        stockRemaining: 1,
        codesCount: 1,
        basePoints: 50,
      });

      // Both get quotes concurrently
      const [quoteResA, quoteResB] = await Promise.all([
        harness.send('post', '/rewards/quotes', userA, {
          voucherId: voucher.id,
        }),
        harness.send('post', '/rewards/quotes', userB, {
          voucherId: voucher.id,
        }),
      ]);

      expect(quoteResA.status).toBe(201);
      expect(quoteResB.status).toBe(201);
      const quoteA = redemptionQuoteSchema.parse(quoteResA.body.data);
      const quoteB = redemptionQuoteSchema.parse(quoteResB.body.data);

      // Both race to redeem simultaneously
      const [redeemResA, redeemResB] = await Promise.all([
        harness
          .send('post', '/rewards/redemptions', userA, {
            quoteId: quoteA.quoteId,
          })
          .set(IDEMPOTENCY_KEY_HEADER, `race-key-${randomUUID()}`),
        harness
          .send('post', '/rewards/redemptions', userB, {
            quoteId: quoteB.quoteId,
          })
          .set(IDEMPOTENCY_KEY_HEADER, `race-key-${randomUUID()}`),
      ]);

      const statuses = [redeemResA.status, redeemResB.status].sort();
      expect(statuses).toEqual([201, 409]);

      const winnerRes = redeemResA.status === 201 ? redeemResA : redeemResB;
      const loserRes = redeemResA.status === 409 ? redeemResA : redeemResB;

      const winnerResult = redemptionResultSchema.parse(winnerRes.body.data);
      expect(winnerResult.status).toBe('SUCCEEDED');
      expect(loserRes.body.error.code).toBe('SOLD_OUT');

      // Durable check: stockRemaining = 0
      const updatedVoucher = await harness.prisma.voucher.findUnique({
        where: { id: voucher.id },
      });
      expect(updatedVoucher?.stockRemaining).toBe(0);

      // Check codes assigned: exactly 1 code claimed
      const claimedCodes = await harness.prisma.voucherCode.count({
        where: { voucherId: voucher.id, redemptionId: { not: null } },
      });
      expect(claimedCodes).toBe(1);

      // Winner deducted 50, loser unchanged (100)
      const winnerUser = redeemResA.status === 201 ? userA : userB;
      const loserUser = redeemResA.status === 409 ? userA : userB;
      const winnerBal = (await harness.ledger.getWallet(winnerUser.id)).balance
        .available;
      const loserBal = (await harness.ledger.getWallet(loserUser.id)).balance
        .available;
      expect(winnerBal).toBe(50);
      expect(loserBal).toBe(100);
    });

    it('Proof 2: Double submit same key in parallel - exactly 1 journal, both callers get identical body', async () => {
      const user = await setupActiveRespondent(100);
      const voucher = await createVoucherWithStock({
        stockRemaining: 5,
        codesCount: 5,
        basePoints: 40,
      });

      const quoteRes = await harness.send('post', '/rewards/quotes', user, {
        voucherId: voucher.id,
      });
      expect(quoteRes.status).toBe(201);
      const quote = redemptionQuoteSchema.parse(quoteRes.body.data);

      const idempotencyKey = `double-submit-${randomUUID()}`;

      // Parallel requests with same key
      const [res1, res2] = await Promise.all([
        harness
          .send('post', '/rewards/redemptions', user, {
            quoteId: quote.quoteId,
          })
          .set(IDEMPOTENCY_KEY_HEADER, idempotencyKey),
        harness
          .send('post', '/rewards/redemptions', user, {
            quoteId: quote.quoteId,
          })
          .set(IDEMPOTENCY_KEY_HEADER, idempotencyKey),
      ]);

      expect(res1.status).toBe(201);
      expect(res2.status).toBe(201);
      expect(res1.body.data).toEqual(res2.body.data);

      // Check journals: exactly 1 journal with idempotencyKey
      const journals = await harness.prisma.ledgerJournal.findMany({
        where: { idempotencyKey: `redemption:${user.id}:${idempotencyKey}` },
      });
      expect(journals.length).toBe(1);

      // Check redemptions: exactly 1 row
      const redemptions = await harness.prisma.redemption.findMany({
        where: { userId: user.id, idempotencyKey },
      });
      expect(redemptions.length).toBe(1);
      expect(redemptions[0].status).toBe('SUCCEEDED');
    });

    it('Proof 3: Balance changed between quote and confirm - INSUFFICIENT_POINTS', async () => {
      const user = await setupActiveRespondent(60);
      const voucher = await createVoucherWithStock({
        stockRemaining: 5,
        codesCount: 5,
        basePoints: 50,
      });

      const quoteRes = await harness.send('post', '/rewards/quotes', user, {
        voucherId: voucher.id,
      });
      expect(quoteRes.status).toBe(201);
      const quote = redemptionQuoteSchema.parse(quoteRes.body.data);

      // User spends points elsewhere before confirming redemption
      const available = await harness.ledger.getOrCreateAccount(
        user.id,
        'USER_AVAILABLE',
      );
      const sink = await harness.ledger.getOrCreateAccount(null, 'SYSTEM_SINK');
      await harness.ledger.postJournal({
        idempotencyKey: `drain-${randomUUID()}`,
        entries: [
          { accountId: available.id, amount: -40 },
          { accountId: sink.id, amount: 40 },
        ],
      }); // Balance is now 20, less than 50

      const redeemRes = await harness
        .send('post', '/rewards/redemptions', user, { quoteId: quote.quoteId })
        .set(IDEMPOTENCY_KEY_HEADER, `insufficient-${randomUUID()}`);

      expect(redeemRes.status).toBe(409);
      expect(redeemRes.body.error.code).toBe('INSUFFICIENT_POINTS');
      expect(redeemRes.body.error.details.required).toBe(50);
      expect(redeemRes.body.error.details.available).toBe(20);

      // Stock remained 5
      const v = await harness.prisma.voucher.findUnique({
        where: { id: voucher.id },
      });
      expect(v?.stockRemaining).toBe(5);
    });

    it('Proof 4: Price changed between quote and confirm - PRICE_CHANGED', async () => {
      const user = await setupActiveRespondent(200);
      const voucher = await createVoucherWithStock({
        stockRemaining: 5,
        codesCount: 5,
        basePoints: 50,
      });

      const quoteRes = await harness.send('post', '/rewards/quotes', user, {
        voucherId: voucher.id,
      });
      expect(quoteRes.status).toBe(201);
      const quote = redemptionQuoteSchema.parse(quoteRes.body.data);

      // Admin updates price
      await harness.prisma.voucher.update({
        where: { id: voucher.id },
        data: {
          basePoints: 60,
          priceVersion: 2,
        },
      });

      const redeemRes = await harness
        .send('post', '/rewards/redemptions', user, { quoteId: quote.quoteId })
        .set(IDEMPOTENCY_KEY_HEADER, `price-change-${randomUUID()}`);

      expect(redeemRes.status).toBe(409);
      expect(redeemRes.body.error.code).toBe('PRICE_CHANGED');
      expect(redeemRes.body.error.details.price.points).toBe(60);
      expect(redeemRes.body.error.details.price.priceVersion).toBe(2);
    });

    it('Proof 5: Stock > 0 with no free code - rollback, drift alert Outbox event, SOLD_OUT to user', async () => {
      const user = await setupActiveRespondent(100);
      // Voucher with stock 2 and 1 voucher code in DB
      const voucher = await createVoucherWithStock({
        stockRemaining: 2,
        codesCount: 1,
        basePoints: 50,
      });

      const quoteRes = await harness.send('post', '/rewards/quotes', user, {
        voucherId: voucher.id,
      });
      expect(quoteRes.status).toBe(201);
      const quote = redemptionQuoteSchema.parse(quoteRes.body.data);

      // Simulate inventory drift: free code is deleted/lost before redeem
      await harness.prisma.voucherCode.deleteMany({
        where: { voucherId: voucher.id },
      });

      const redeemRes = await harness
        .send('post', '/rewards/redemptions', user, { quoteId: quote.quoteId })
        .set(IDEMPOTENCY_KEY_HEADER, `drift-${randomUUID()}`);

      expect(redeemRes.status).toBe(409);
      expect(redeemRes.body.error.code).toBe('SOLD_OUT');

      // Check Outbox event REWARDS_CODE_INVENTORY_DRIFT created
      const outboxEvents = await harness.prisma.outboxEvent.findMany({
        where: {
          eventType: 'REWARDS_CODE_INVENTORY_DRIFT',
          aggregateId: voucher.id,
        },
      });
      expect(outboxEvents.length).toBeGreaterThanOrEqual(1);

      // No ledger journal created
      const userBal = (await harness.ledger.getWallet(user.id)).balance
        .available;
      expect(userBal).toBe(100);
    });

    it('Proof 6: Ledger sum per journal = 0 and global sum = 0', async () => {
      const user = await setupActiveRespondent(100);
      const voucher = await createVoucherWithStock({
        stockRemaining: 5,
        codesCount: 5,
        basePoints: 30,
      });

      const quoteRes = await harness.send('post', '/rewards/quotes', user, {
        voucherId: voucher.id,
      });
      const quote = redemptionQuoteSchema.parse(quoteRes.body.data);

      const key = `sum-check-${randomUUID()}`;
      const redeemRes = await harness
        .send('post', '/rewards/redemptions', user, { quoteId: quote.quoteId })
        .set(IDEMPOTENCY_KEY_HEADER, key);
      expect(redeemRes.status).toBe(201);

      // Per journal sum = 0
      const journal = await harness.prisma.ledgerJournal.findUnique({
        where: { idempotencyKey: `redemption:${user.id}:${key}` },
        include: { entries: true },
      });
      expect(journal).not.toBeNull();
      const sum = journal!.entries.reduce((acc, e) => acc + e.amount, 0);
      expect(sum).toBe(0);

      // Global sum across all ledger entries = 0
      const globalSum = await harness.prisma.ledgerEntry.aggregate({
        _sum: { amount: true },
      });
      expect(globalSum._sum.amount).toBe(0);
    });

    it('Proof 7: Concurrency with wallet locks - same user redeeming two vouchers in parallel respects daily 500-pt limit', async () => {
      // User has 1000 points. Daily limit is 500.
      const user = await setupActiveRespondent(1000);
      const voucher1 = await createVoucherWithStock({
        stockRemaining: 5,
        codesCount: 5,
        basePoints: 300,
      });
      const voucher2 = await createVoucherWithStock({
        stockRemaining: 5,
        codesCount: 5,
        basePoints: 300,
      });

      const [quoteRes1, quoteRes2] = await Promise.all([
        harness.send('post', '/rewards/quotes', user, {
          voucherId: voucher1.id,
        }),
        harness.send('post', '/rewards/quotes', user, {
          voucherId: voucher2.id,
        }),
      ]);

      expect(quoteRes1.status).toBe(201);
      expect(quoteRes2.status).toBe(201);
      const q1 = redemptionQuoteSchema.parse(quoteRes1.body.data);
      const q2 = redemptionQuoteSchema.parse(quoteRes2.body.data);

      // User attempts to redeem both 300-pt vouchers simultaneously (total 600 > 500)
      const [r1, r2] = await Promise.all([
        harness
          .send('post', '/rewards/redemptions', user, { quoteId: q1.quoteId })
          .set(IDEMPOTENCY_KEY_HEADER, `wallet-lock-1-${randomUUID()}`),
        harness
          .send('post', '/rewards/redemptions', user, { quoteId: q2.quoteId })
          .set(IDEMPOTENCY_KEY_HEADER, `wallet-lock-2-${randomUUID()}`),
      ]);

      const statuses = [r1.status, r2.status].sort();
      expect(statuses).toEqual([201, 403]);

      const forbiddenRes = r1.status === 403 ? r1 : r2;
      expect(forbiddenRes.body.error.code).toBe('ACCOUNT_NOT_ELIGIBLE');
      expect(forbiddenRes.body.error.details.reason).toBe(
        'DAILY_LIMIT_REACHED',
      );

      // User spent exactly 300 points, 700 remaining
      const finalBal = (await harness.ledger.getWallet(user.id)).balance
        .available;
      expect(finalBal).toBe(700);
    });

    async function createFlash(
      voucherId: string,
      opts: { flashPoints: number; quota: number; perUserCap?: number },
    ) {
      const now = Date.now();
      const sale = await harness.prisma.flashSale.create({
        data: {
          code: `FS-${randomUUID().slice(0, 8)}`,
          title: 'Flash',
          startsAt: new Date(now - 3600_000),
          endsAt: new Date(now + 3600_000),
          reservedAt: new Date(now - 3600_000),
          rules: {
            requireRecentSurvey: false,
            blockFlagged: false,
            remindBefore10m: false,
          },
          createdById: randomUUID(),
          items: {
            create: {
              voucherId,
              flashPoints: opts.flashPoints,
              quota: opts.quota,
              perUserCap: opts.perUserCap ?? 1,
            },
          },
        },
        include: { items: true },
      });
      return sale.items[0];
    }

    const redeem = (user: Actor, quoteId: string, key: string) =>
      harness
        .send('post', '/rewards/redemptions', user, { quoteId })
        .set(IDEMPOTENCY_KEY_HEADER, key);

    const quoteOf = async (user: Actor, voucherId: string) => {
      const res = await harness.send('post', '/rewards/quotes', user, {
        voucherId,
      });
      expect(res.status).toBe(201);
      return redemptionQuoteSchema.parse(res.body.data);
    };

    it('FAILED attempt: row has no journal, by-key replays the stored error, stock and codes untouched', async () => {
      const user = await setupActiveRespondent(60);
      const voucher = await createVoucherWithStock({
        stockRemaining: 3,
        codesCount: 3,
        basePoints: 50,
      });
      const quote = await quoteOf(user, voucher.id);
      const available = await harness.ledger.getOrCreateAccount(
        user.id,
        'USER_AVAILABLE',
      );
      const sink = await harness.ledger.getOrCreateAccount(null, 'SYSTEM_SINK');
      await harness.ledger.postJournal({
        idempotencyKey: `drain-${randomUUID()}`,
        entries: [
          { accountId: available.id, amount: -40 },
          { accountId: sink.id, amount: 40 },
        ],
      });

      const key = `failed-${randomUUID()}`;
      const first = await redeem(user, quote.quoteId, key);
      expect(first.status).toBe(409);
      expect(first.body.error.code).toBe('INSUFFICIENT_POINTS');

      const rows = await harness.prisma.redemption.findMany({
        where: { userId: user.id, idempotencyKey: key },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        status: 'FAILED',
        journalId: null,
        failureCode: 'INSUFFICIENT_POINTS',
        voucherCodeId: null,
      });

      // Funds restored: the same key still answers the stored failure.
      await harness.fund(user.id, 100);
      const replay = await redeem(user, quote.quoteId, key);
      expect(replay.status).toBe(409);
      expect(replay.body.error.details).toEqual(first.body.error.details);
      const byKey = await harness.get(
        `/rewards/redemptions/by-key/${key}`,
        user,
      );
      expect(byKey.status).toBe(409);
      expect(byKey.body.error.code).toBe('INSUFFICIENT_POINTS');

      expect(
        (await harness.prisma.voucher.findUnique({ where: { id: voucher.id } }))
          ?.stockRemaining,
      ).toBe(3);
      expect(
        await harness.prisma.voucherCode.count({
          where: { voucherId: voucher.id, redemptionId: { not: null } },
        }),
      ).toBe(0);
    });

    it('Limit failure at confirm rolls back stock, code and journal, and records a FAILED row', async () => {
      const user = await setupActiveRespondent(1000);
      const voucher = await createVoucherWithStock({
        stockRemaining: 3,
        codesCount: 3,
        basePoints: 300,
      });
      const quote = await quoteOf(user, voucher.id);
      await harness.prisma.rewardsSettings.update({
        where: { id: 1 },
        data: { dailyPointsLimit: 200 },
      });
      try {
        const key = `limit-${randomUUID()}`;
        const res = await redeem(user, quote.quoteId, key);
        expect(res.status).toBe(403);
        expect(res.body.error.details.reason).toBe('DAILY_LIMIT_REACHED');

        expect(
          (
            await harness.prisma.voucher.findUnique({
              where: { id: voucher.id },
            })
          )?.stockRemaining,
        ).toBe(3);
        expect(
          await harness.prisma.voucherCode.count({
            where: { voucherId: voucher.id, redemptionId: { not: null } },
          }),
        ).toBe(0);
        expect(
          await harness.prisma.ledgerJournal.count({
            where: { idempotencyKey: `redemption:${user.id}:${key}` },
          }),
        ).toBe(0);
        expect(
          (await harness.ledger.getWallet(user.id)).balance.available,
        ).toBe(1000);
        const row = await harness.prisma.redemption.findFirstOrThrow({
          where: { userId: user.id, idempotencyKey: key },
        });
        expect(row).toMatchObject({ status: 'FAILED', journalId: null });
      } finally {
        await harness.prisma.rewardsSettings.update({
          where: { id: 1 },
          data: { dailyPointsLimit: 500 },
        });
      }
    });

    it('Voucher paused between quote and confirm -> VOUCHER_UNAVAILABLE, nothing charged', async () => {
      const user = await setupActiveRespondent(200);
      const voucher = await createVoucherWithStock({
        stockRemaining: 3,
        codesCount: 3,
        basePoints: 50,
      });
      const quote = await quoteOf(user, voucher.id);
      await harness.prisma.voucher.update({
        where: { id: voucher.id },
        data: { state: 'PAUSED' },
      });
      const res = await redeem(user, quote.quoteId, `paused-${randomUUID()}`);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('VOUCHER_UNAVAILABLE');
      expect(res.body.error.details.status).toBe('PAUSED');
      expect((await harness.ledger.getWallet(user.id)).balance.available).toBe(
        200,
      );
    });

    it('Flash quota 1 with two racing users: one success, loser rejected, sold=1, voucher stock -1, one journal', async () => {
      const userA = await setupActiveRespondent(200);
      const userB = await setupActiveRespondent(200);
      const voucher = await createVoucherWithStock({
        stockRemaining: 5,
        codesCount: 5,
        basePoints: 100,
      });
      const item = await createFlash(voucher.id, {
        flashPoints: 40,
        quota: 1,
      });
      const [qa, qb] = await Promise.all([
        quoteOf(userA, voucher.id),
        quoteOf(userB, voucher.id),
      ]);
      expect(qa.price).toMatchObject({ source: 'FLASH', points: 40 });

      const [ra, rb] = await Promise.all([
        redeem(userA, qa.quoteId, `flash-a-${randomUUID()}`),
        redeem(userB, qb.quoteId, `flash-b-${randomUUID()}`),
      ]);
      expect([ra.status, rb.status].sort()).toEqual([201, 409]);
      const loser = ra.status === 409 ? ra : rb;
      expect(['PRICE_CHANGED', 'SOLD_OUT']).toContain(loser.body.error.code);

      const refreshed = await harness.prisma.flashSaleItem.findUniqueOrThrow({
        where: { id: item.id },
      });
      expect(refreshed.sold).toBe(1);
      expect(refreshed.soldOutAt).not.toBeNull();
      expect(
        (await harness.prisma.voucher.findUnique({ where: { id: voucher.id } }))
          ?.stockRemaining,
      ).toBe(5);
      expect(
        await harness.prisma.flashItemClaim.count({
          where: { flashSaleItemId: item.id },
        }),
      ).toBe(1);
      expect(
        await harness.prisma.redemption.count({
          where: { voucherId: voucher.id, status: 'SUCCEEDED' },
        }),
      ).toBe(1);
      expect(
        await harness.prisma.ledgerJournal.count({
          where: { description: { contains: voucher.title } },
        }),
      ).toBe(1);
    });

    it('AC5: Flash redemption within 24h of an approved top-up writes a FLASH_AFTER_TOPUP FraudLog flag and still succeeds', async () => {
      const user = await setupActiveRespondent(200);
      const voucher = await createVoucherWithStock({
        stockRemaining: 5,
        codesCount: 5,
        basePoints: 100,
      });
      await createFlash(voucher.id, { flashPoints: 40, quota: 3 });
      await harness.prisma.topUpRequest.create({
        data: {
          userId: user.id,
          amount: 100,
          amountVnd: 20_000,
          transferReference: `RESCOM${randomUUID().slice(0, 9).toUpperCase()}`,
          status: 'APPROVED',
          reviewedAt: new Date(),
        },
      });
      const quote = await quoteOf(user, voucher.id);
      const res = await redeem(user, quote.quoteId, `flag-${randomUUID()}`);
      expect(res.status).toBe(201);
      const result = redemptionResultSchema.parse(res.body.data);

      const flags = await harness.prisma.fraudLog.findMany({
        where: { userId: user.id, type: 'FLASH_AFTER_TOPUP' },
      });
      expect(flags).toHaveLength(1);
      expect(flags[0].dedupeKey).toBe(
        `flash-after-topup:${result.redemptionId}`,
      );
    });

    it('SKIP LOCKED: five users redeeming five codes in parallel get five distinct codes', async () => {
      const voucher = await createVoucherWithStock({
        stockRemaining: 5,
        codesCount: 5,
        basePoints: 50,
      });
      const users = await Promise.all(
        [1, 2, 3, 4, 5].map(() => setupActiveRespondent(100)),
      );
      const quotes = await Promise.all(
        users.map((u) => quoteOf(u, voucher.id)),
      );
      const results = await Promise.all(
        users.map((u, i) =>
          redeem(u, quotes[i].quoteId, `skip-${i}-${randomUUID()}`),
        ),
      );
      expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
      const codes = results.map((r) => r.body.data.ticket.code);
      expect(new Set(codes).size).toBe(5);
      expect(
        await harness.prisma.voucherCode.count({
          where: { voucherId: voucher.id, redemptionId: { not: null } },
        }),
      ).toBe(5);
      expect(
        (await harness.prisma.voucher.findUnique({ where: { id: voucher.id } }))
          ?.stockRemaining,
      ).toBe(0);
    });

    it('same key with two different quotes in parallel: one success, the other IDEMPOTENCY_KEY_CONFLICT, never a 500', async () => {
      const user = await setupActiveRespondent(300);
      const v1 = await createVoucherWithStock({
        stockRemaining: 3,
        codesCount: 3,
        basePoints: 50,
      });
      const v2 = await createVoucherWithStock({
        stockRemaining: 3,
        codesCount: 3,
        basePoints: 50,
      });
      const [q1, q2] = await Promise.all([
        quoteOf(user, v1.id),
        quoteOf(user, v2.id),
      ]);
      const key = `same-key-${randomUUID()}`;
      const [r1, r2] = await Promise.all([
        redeem(user, q1.quoteId, key),
        redeem(user, q2.quoteId, key),
      ]);
      expect([r1.status, r2.status].sort()).toEqual([201, 409]);
      const loser = r1.status === 409 ? r1 : r2;
      // The ledger's in-flight guard may answer before the unique index does.
      expect([
        'IDEMPOTENCY_KEY_CONFLICT',
        'LEDGER_COMMAND_IN_PROGRESS',
      ]).toContain(loser.body.error.code);
      expect(
        await harness.prisma.ledgerJournal.count({
          where: { idempotencyKey: `redemption:${user.id}:${key}` },
        }),
      ).toBe(1);
    });

    it('stock > 0 with no free code twice in one hour: two FAILED rows, one drift event, by-key answers SOLD_OUT', async () => {
      const user = await setupActiveRespondent(300);
      const voucher = await createVoucherWithStock({
        stockRemaining: 3,
        codesCount: 0,
        basePoints: 50,
      });
      // Quote refuses a voucher with no codes, so seed one code for the quotes
      // and drop it before confirming.
      await harness.prisma.voucherCode.create({
        data: {
          voucherId: voucher.id,
          code: `TMP-${randomUUID().slice(0, 8)}`,
        },
      });
      const qa = await quoteOf(user, voucher.id);
      const qb = await quoteOf(user, voucher.id);
      await harness.prisma.voucherCode.deleteMany({
        where: { voucherId: voucher.id },
      });
      const keyA = `drift-a-${randomUUID()}`;
      const keyB = `drift-b-${randomUUID()}`;
      expect((await redeem(user, qa.quoteId, keyA)).status).toBe(409);
      expect((await redeem(user, qb.quoteId, keyB)).status).toBe(409);

      expect(
        await harness.prisma.redemption.count({
          where: { voucherId: voucher.id, status: 'FAILED' },
        }),
      ).toBe(2);
      expect(
        await harness.prisma.outboxEvent.count({
          where: {
            eventType: 'REWARDS_CODE_INVENTORY_DRIFT',
            aggregateId: voucher.id,
          },
        }),
      ).toBe(1);
      const byKey = await harness.get(
        `/rewards/redemptions/by-key/${keyB}`,
        user,
      );
      expect(byKey.status).toBe(409);
      expect(byKey.body.error.code).toBe('SOLD_OUT');
    });

    it('parallel redemptions plus parallel ledger spends by the same user: no deadlock, balance consistent', async () => {
      const user = await setupActiveRespondent(1000);
      const vouchers = await Promise.all(
        [1, 2, 3].map(() =>
          createVoucherWithStock({
            stockRemaining: 3,
            codesCount: 3,
            basePoints: 50,
          }),
        ),
      );
      const quotes = await Promise.all(
        vouchers.map((v) => quoteOf(user, v.id)),
      );
      const results = await Promise.all([
        ...quotes.map((q, i) =>
          redeem(user, q.quoteId, `lock-order-${i}-${randomUUID()}`),
        ),
        ...[1, 2, 3].map((i) =>
          harness.ledger.spendPoints({
            userId: user.id,
            amount: 10,
            idempotencyKey: `lock-order-spend:${user.id}:${i}`,
          }),
        ),
      ]);
      expect(results.slice(0, 3).map((r: any) => r.status)).toEqual([
        201, 201, 201,
      ]);
      expect((await harness.ledger.getWallet(user.id)).balance.available).toBe(
        1000 - 3 * 50 - 3 * 10,
      );
    });

    it('migration invariants: SUCCEEDED needs journal, balance and a code (or shared voucher)', async () => {
      const user = await setupActiveRespondent(100);
      const voucher = await createVoucherWithStock({
        stockRemaining: 1,
        codesCount: 1,
        basePoints: 50,
      });
      const base = {
        userId: user.id,
        voucherId: voucher.id,
        idempotencyKey: `inv-${randomUUID()}`,
        pricePoints: 50,
        priceSource: 'BASE' as const,
        priceVersion: 1,
        reference: `RDM-2026-${randomUUID().slice(0, 4).toUpperCase()}`,
      };
      await expect(
        harness.prisma.redemption.create({
          data: { ...base, status: 'SUCCEEDED', balanceAfter: 1 },
        }),
      ).rejects.toThrow();
      await expect(
        harness.prisma.redemption.create({
          data: {
            ...base,
            idempotencyKey: `inv-${randomUUID()}`,
            reference: `RDM-2026-${randomUUID().slice(0, 4).toUpperCase()}`,
            status: 'FAILED',
            journalId: randomUUID(),
            failureCode: 'SOLD_OUT',
          },
        }),
      ).rejects.toThrow();
    });
  },
);
