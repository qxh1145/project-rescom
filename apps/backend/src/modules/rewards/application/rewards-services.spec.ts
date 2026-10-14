import { FixedClock } from '../../../common/time/clock';
import { PassThroughUnitOfWork } from '../../../common/database/unit-of-work.port';
import { RewardsAdminCatalogService } from './rewards-admin-catalog.service';
import { RewardsCatalogService } from './rewards-catalog.service';
import {
  VoucherRecord,
  VoucherRepositoryPort,
} from './ports/voucher-repository.port';
import { VoucherCodeRepositoryPort } from './ports/voucher-code-repository.port';
import { FlashSaleReadPort } from './ports/flash-sale-read.port';
import { WalletBalancePort } from './ports/wallet-balance.port';
import { AccountStandingPort } from './ports/account-standing.port';
import { AdminCapabilityPort } from '../../economy/application/ports/admin-capability.port';
import { RewardsException } from './exceptions/rewards.exceptions';
import { RewardsQuoteService } from './rewards-quote.service';
import { RewardsRedemptionService } from './rewards-redemption.service';
import { InMemoryRedemptionRepository } from '../infrastructure/in-memory-redemption.repository';
import { InMemoryFlashSaleReadRepository } from '../infrastructure/in-memory-flash-sale-read.repository';

const adminId = '10000000-0000-4000-8000-000000000001';
const voucherId = '20000000-0000-4000-8000-000000000002';
const clock = new FixedClock(new Date('2026-10-13T12:00:00.000Z'));
const voucher: VoucherRecord = {
  id: voucherId,
  title: 'Coffee',
  brand: { id: 'highlands', name: 'Highlands' },
  category: 'COFFEE',
  valueVnd: 50000,
  basePoints: 50,
  promoPoints: 40,
  priceVersion: 1,
  stockTotal: 2,
  stockRemaining: 2,
  codesAvailable: 2,
  state: 'ACTIVE',
  isVisible: true,
  isSharedCode: false,
  sharedCode: null,
  redeemStartsAt: '2026-10-01T00:00:00.000Z',
  redeemEndsAt: '2026-11-01T00:00:00.000Z',
  codeExpiresAt: '2026-11-10T00:00:00.000Z',
  description: null,
  whereToUse: null,
  terms: [],
  howToUse: [],
  imageUrl: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  createdById: adminId,
};
function fixture() {
  let row = { ...voucher };
  const audits: unknown[] = [];
  const vouchers: VoucherRepositoryPort = {
    list: async () => [row],
    findById: async (id) => (id === row.id ? row : null),
    listBrands: async () => [row.brand],
    lock: async () => {},
    create: async (v) => (row = v),
    save: async (v) => (row = v),
    adjustStock: async (_id, total, expectedRemaining, updatedAt) => {
      if (row.stockRemaining !== expectedRemaining) return null;
      row = {
        ...row,
        stockTotal: total,
        stockRemaining: row.stockRemaining + total - row.stockTotal,
        updatedAt,
      };
      return row;
    },
    appendPriceVersion: async () => {},
    priceHistory: async () => [],
    redemptions: async () => [],
    decrementRegularStock: async () => true,
    appendAudit: async (event) => {
      audits.push(event);
    },
  };
  const codes: VoucherCodeRepositoryPort = {
    listCodes: async () => ['CODE-1', 'CODE-2'],
    countAvailable: async () => 2,
    importCodes: async () => {},
    removeAvailable: async (_id: string, count: number) => count,
    hasIssued: async () => false,
  };
  const flashSales: FlashSaleReadPort = {
    list: async () => [],
    findById: async () => null,
    findItemById: async () => null,
    findActiveItemForVoucher: async () => null,
    lockFlashItem: async () => {},
    incrementFlashSold: async () => true,
  };
  const wallet: WalletBalancePort = {
    getBalance: async () => ({ available: 45, pending: 3 }),
  };
  const adminCapability: AdminCapabilityPort = {
    findCurrentCapability: async (id) => ({
      userId: id,
      role: 'ADMIN',
      status: 'ACTIVE',
    }),
  };
  const unitOfWork = new PassThroughUnitOfWork();
  return {
    vouchers,
    codes,
    flashSales,
    wallet,
    adminCapability,
    unitOfWork,
    audits,
    redemptions: new InMemoryRedemptionRepository(),
  };
}

describe('Rewards application services', () => {
  it('filters and prices user catalog using injected time and read-only wallet', async () => {
    const f = fixture();
    const service = new RewardsCatalogService({ ...f, now: () => clock.now() });
    const result = await service.list(adminId, {
      sort: 'BEST_DEAL',
      limit: 20,
      offset: 0,
    });
    expect(result.items[0]).toMatchObject({
      status: 'AVAILABLE',
      affordable: true,
      price: { points: 40, source: 'PROMO' },
    });
    expect(result.viewer).toEqual({ available: 45, pending: 3 });
    expect(result.serverTime).toBe('2026-10-13T12:00:00.000Z');
    expect((await service.detail(adminId, voucherId)).voucher.description).toBe(
      'Coffee',
    );
    await expect(
      service.detail(adminId, '30000000-0000-4000-8000-000000000003'),
    ).rejects.toBeInstanceOf(RewardsException);
  });
  it('emits exactly one audit for price mutation, none for rejected mutation or idempotent patch', async () => {
    const f = fixture();
    const service = new RewardsAdminCatalogService({
      ...f,
      now: () => clock.now(),
    });
    await service.changePrice(voucherId, adminId, {
      basePoints: 60,
      promoPoints: 40,
    });
    expect(f.audits).toHaveLength(1);
    expect(f.audits[0]).toMatchObject({
      eventType: 'VOUCHER_PRICE_CHANGED',
      payload: { after: { priceVersion: 2 } },
    });
    await service.patch(voucherId, adminId, { state: 'ACTIVE' });
    expect(f.audits).toHaveLength(1);
    await expect(
      service.adjustStock(voucherId, adminId, {
        total: 3,
        reason: 'No codes for increase',
      }),
    ).rejects.toMatchObject({ code: 'STOCK_INCREASE_NEEDS_CODES' });
    expect(f.audits).toHaveLength(1);
    expect(f.unitOfWork.keys).toEqual([
      `rewards-admin:${voucherId}:price`,
      `rewards-admin:${voucherId}:patch`,
      `rewards-admin:${voucherId}:stock`,
    ]);
  });

  describe('review hardening', () => {
    const update = {
      title: 'Coffee',
      brandId: 'highlands',
      category: 'COFFEE' as const,
      valueVnd: 50000,
      basePoints: 50,
      promoPoints: 40,
      isSharedCode: false,
      redeemStartsAt: voucher.redeemStartsAt,
      redeemEndsAt: voucher.redeemEndsAt,
      codeExpiresAt: voucher.codeExpiresAt,
      terms: [],
      howToUse: [],
      imageUrl: null,
    };
    const admin = (f: ReturnType<typeof fixture>) =>
      new RewardsAdminCatalogService({ ...f, now: () => clock.now() });

    it('accepts non-UUID or reused correlation ids without failing the mutation', async () => {
      const f = fixture();
      const service = admin(f);
      const reused = '40000000-0000-4000-8000-000000000004';
      await service.changePrice(
        voucherId,
        adminId,
        { basePoints: 60, promoPoints: 40 },
        'not-a-uuid',
      );
      await service.changePrice(
        voucherId,
        adminId,
        { basePoints: 70, promoPoints: 40 },
        reused,
      );
      await service.changePrice(
        voucherId,
        adminId,
        { basePoints: 80, promoPoints: 40 },
        reused,
      );
      const events = f.audits as {
        idempotencyKey: string;
        correlationId: string;
      }[];
      expect(events).toHaveLength(3);
      expect(new Set(events.map((e) => e.idempotencyKey)).size).toBe(3);
      expect(events[0].correlationId).toMatch(/^[0-9a-f-]{36}$/);
      expect(events[1].correlationId).toBe(reused);
    });

    it('does not mask a non-code P2002 during code import', async () => {
      const f = fixture();
      f.codes.listCodes = async () => [];
      f.codes.importCodes = async () => {
        throw Object.assign(new Error('unique'), { code: 'P2002' });
      };
      await expect(
        admin(f).importCodes(voucherId, adminId, {
          codes: ['NEW-CODE-1'],
          mode: 'COMMIT',
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });

    it('rejects stock decrease when fewer codes were removed than requested', async () => {
      const f = fixture();
      f.codes.removeAvailable = async () => 0;
      await expect(
        admin(f).adjustStock(voucherId, adminId, {
          total: 1,
          reason: 'Remove one code',
        }),
      ).rejects.toMatchObject({ code: 'STOCK_EXCEEDS_CODES' });
    });

    it('locks the shared flag once stock exists and requires a shared code', async () => {
      const f = fixture();
      await expect(
        admin(f).update(voucherId, adminId, {
          ...update,
          isSharedCode: true,
          sharedCode: 'SHARED-1',
        }),
      ).rejects.toMatchObject({ code: 'SHARED_FLAG_LOCKED' });
      await expect(
        admin(f).create(adminId, { ...update, isSharedCode: true }),
      ).rejects.toMatchObject({
        code: 'SHARED_CODE_REQUIRED',
        details: { path: 'sharedCode' },
      });
    });

    it('flags price deviation on create and breaks BEST_DEAL ties by newest', async () => {
      const f = fixture();
      await admin(f).create(adminId, {
        ...update,
        basePoints: 400,
        promoPoints: null,
      });
      expect(f.audits[0]).toMatchObject({
        payload: { after: { deviation: true } },
      });
      const older = { ...voucher, id: voucherId };
      const newer = {
        ...voucher,
        id: '50000000-0000-4000-8000-000000000005',
        createdAt: '2026-10-02T00:00:00.000Z',
      };
      f.vouchers.list = async () => [older, newer];
      const result = await new RewardsCatalogService({
        ...f,
        now: () => clock.now(),
      }).list(adminId, { sort: 'BEST_DEAL', limit: 20, offset: 0 });
      expect(result.items.map((i) => i.id)).toEqual([newer.id, older.id]);
    });
  });

  describe('RewardsQuoteService & RewardsRedemptionService (Story 12.8)', () => {
    const flashSale = (over: Record<string, unknown> = {}) => ({
      id: 'fs1',
      code: 'FLASH1',
      startsAt: '2026-10-10T00:00:00.000Z',
      endsAt: '2026-10-20T00:00:00.000Z',
      endedEarlyAt: null,
      rules: { requireRecentSurvey: false, blockFlagged: false },
      items: [
        {
          id: 'fsi-1',
          flashSaleId: 'fs1',
          voucherId,
          flashPoints: 30,
          quota: 5,
          sold: 0,
          perUserCap: 1,
          soldOutAt: null,
        },
      ],
      ...over,
    });
    const uniqueViolation = (target: string[]) =>
      Object.assign(new Error('Unique constraint failed'), {
        code: 'P2002',
        meta: { target },
      });

    function redemptionFixture() {
      const redemptions = new InMemoryRedemptionRepository();
      const flashSales = new InMemoryFlashSaleReadRepository();
      const vRow = { ...voucher };
      const audits: any[] = [];
      const auditKeys = new Set<string>();
      const vouchers: VoucherRepositoryPort = {
        list: async () => [vRow],
        findById: async (id) => (id === vRow.id ? vRow : null),
        listBrands: async () => [vRow.brand],
        lock: async () => {},
        create: async (v) => Object.assign(vRow, v),
        save: async (v) => Object.assign(vRow, v),
        adjustStock: async () => vRow,
        decrementRegularStock: async (_id, updatedAt) => {
          if (vRow.stockRemaining <= 0) return false;
          vRow.stockRemaining -= 1;
          vRow.updatedAt = updatedAt ?? vRow.updatedAt;
          return true;
        },
        appendPriceVersion: async () => {},
        priceHistory: async () => [],
        redemptions: async () => [],
        appendAudit: async (e) => {
          // Outbox idempotency_key is UNIQUE.
          if (auditKeys.has(e.idempotencyKey)) {
            throw uniqueViolation(['idempotency_key']);
          }
          auditKeys.add(e.idempotencyKey);
          audits.push(e);
        },
      };

      const state = { balance: 1000 };
      const wallet: WalletBalancePort = {
        getBalance: async () => ({ available: state.balance, pending: 0 }),
      };

      const accountStanding: AccountStandingPort = {
        isActive: async () => true,
        isActivated: async () => true,
        completedSurveyInLastDays: async () => true,
        hasBlockingFraudFlag: async () => false,
        hasApprovedTopUpSince: async () => false,
      };

      const ledgerKeys: string[] = [];
      const journals: { amount: number; key: string }[] = [];
      const spendPoints = {
        spendPoints: async (params: any, options?: any) => {
          ledgerKeys.push(params.idempotencyKey);
          if (options?.assertBeforeInsert) {
            await options.assertBeforeInsert();
          }
          if (state.balance < params.amount) {
            const err = new Error('Insufficient');
            err.name = 'InsufficientBalanceException';
            throw err;
          }
          state.balance -= params.amount;
          journals.push({
            amount: params.amount,
            key: params.idempotencyKey,
          });
          return {
            journalId: `30000000-0000-4000-8000-00000000000${journals.length}`,
            idempotencyKey: params.idempotencyKey,
          };
        },
      };

      const fraudFlags: any[] = [];
      const fraudFlag = {
        recordFlashAfterTopUp: async (params: any) => {
          fraudFlags.push(params);
        },
      };

      redemptions.codes.set('c1', {
        id: 'c1',
        voucherId,
        code: 'CODE-SECRET-1',
        redemptionId: null,
      });
      redemptions.codes.set('c2', {
        id: 'c2',
        voucherId,
        code: 'CODE-SECRET-2',
        redemptionId: null,
      });

      const quoteService = new RewardsQuoteService({
        vouchers,
        flashSales,
        redemptions,
        wallet,
        accountStanding,
        now: () => clock.now(),
      });

      const redemptionService = new RewardsRedemptionService({
        vouchers,
        flashSales,
        redemptions,
        wallet,
        accountStanding,
        spendPoints,
        fraudFlag,
        unitOfWork: new PassThroughUnitOfWork(),
        now: () => clock.now(),
      });

      return {
        vRow,
        vouchers,
        flashSales,
        redemptions,
        wallet,
        accountStanding,
        fraudFlags,
        audits,
        journals,
        ledgerKeys,
        quoteService,
        redemptionService,
        state,
      };
    }

    it('creates quote with advisory limits and balance calculation', async () => {
      const f = redemptionFixture();
      const quote = await f.quoteService.createQuote(adminId, { voucherId });
      expect(quote).toMatchObject({
        voucherId,
        price: { points: 40, source: 'PROMO' },
        balance: { available: 1000, after: 960 },
        flashSaleItemId: null,
        flashEndsAt: null,
      });
      expect(quote.quoteId).toBeDefined();
    });

    it('successful redemption claims code, decrements stock, spends under redemption:{userId}:{key} and emits an Outbox event', async () => {
      const f = redemptionFixture();
      const quote = await f.quoteService.createQuote(adminId, { voucherId });
      const result = await f.redemptionService.redeem(
        adminId,
        { quoteId: quote.quoteId },
        'idem-key-1',
      );

      expect(result.status).toBe('SUCCEEDED');
      expect(result.pointsSpent).toBe(40);
      expect(result.ticket.code).toBe('CODE-SECRET-1');
      expect(f.vRow.stockRemaining).toBe(1);
      expect(f.ledgerKeys).toEqual([`redemption:${adminId}:idem-key-1`]);
      expect(f.audits).toHaveLength(1);
      expect(f.audits[0].eventType).toBe('REWARDS_VOUCHER_REDEEMED');
      expect(f.audits[0].correlationId).toBe(result.redemptionId);

      // Idempotent replay returns the same body (including the original code)
      const replay = await f.redemptionService.redeem(
        adminId,
        { quoteId: quote.quoteId },
        'idem-key-1',
      );
      expect(replay).toEqual(result);
      expect(f.state.balance).toBe(960);
      expect(f.journals).toHaveLength(1);
    });

    it('rejects one key for two quotes and one quote for two keys', async () => {
      const f = redemptionFixture();
      const q1 = await f.quoteService.createQuote(adminId, { voucherId });
      const q2 = await f.quoteService.createQuote(adminId, { voucherId });
      await f.redemptionService.redeem(
        adminId,
        { quoteId: q1.quoteId },
        'idem-key-1',
      );
      await expect(
        f.redemptionService.redeem(
          adminId,
          { quoteId: q2.quoteId },
          'idem-key-1',
        ),
      ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_CONFLICT' });
      await expect(
        f.redemptionService.redeem(
          adminId,
          { quoteId: q1.quoteId },
          'idem-key-2',
        ),
      ).rejects.toMatchObject({ code: 'QUOTE_ALREADY_REDEEMED' });
      expect(f.journals).toHaveLength(1);
    });

    it('records a FAILED row with no journal on INSUFFICIENT_POINTS and replays the stored error', async () => {
      const f = redemptionFixture();
      const quote = await f.quoteService.createQuote(adminId, { voucherId });
      f.state.balance = 10; // balance dropped between quote and confirm

      await expect(
        f.redemptionService.redeem(
          adminId,
          { quoteId: quote.quoteId },
          'idem-key-1',
        ),
      ).rejects.toMatchObject({
        code: 'INSUFFICIENT_POINTS',
        details: { required: 40, available: 10 },
      });

      const rows = [...f.redemptions.redemptions.values()];
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        status: 'FAILED',
        journalId: null,
        failureCode: 'INSUFFICIENT_POINTS',
        failureDetails: { required: 40, available: 10 },
        voucherCodeId: null,
      });
      expect(f.journals).toHaveLength(0);

      // Same key replays the stored error even after the balance recovered.
      f.state.balance = 1000;
      await expect(
        f.redemptionService.redeem(
          adminId,
          { quoteId: quote.quoteId },
          'idem-key-1',
        ),
      ).rejects.toMatchObject({
        code: 'INSUFFICIENT_POINTS',
        details: { required: 40, available: 10 },
      });
      await expect(
        f.redemptionService.findByKey(adminId, 'idem-key-1'),
      ).rejects.toMatchObject({ code: 'INSUFFICIENT_POINTS' });
      expect(f.redemptions.redemptions.size).toBe(1);
    });

    it('findByKey throws REDEMPTION_NOT_FOUND for an unknown key', async () => {
      const f = redemptionFixture();
      await expect(
        f.redemptionService.findByKey(adminId, 'unknown-key-1'),
      ).rejects.toMatchObject({ code: 'REDEMPTION_NOT_FOUND' });
    });

    it('rejects VOUCHER_UNAVAILABLE when the voucher is paused between quote and confirm', async () => {
      const f = redemptionFixture();
      const quote = await f.quoteService.createQuote(adminId, { voucherId });
      f.vRow.state = 'PAUSED';
      await expect(
        f.redemptionService.redeem(
          adminId,
          { quoteId: quote.quoteId },
          'idem-key-1',
        ),
      ).rejects.toMatchObject({
        code: 'VOUCHER_UNAVAILABLE',
        details: { voucherId, status: 'PAUSED' },
      });
      f.vRow.state = 'ARCHIVED';
      await expect(
        f.redemptionService.redeem(
          adminId,
          { quoteId: quote.quoteId },
          'idem-key-2',
        ),
      ).rejects.toMatchObject({ code: 'VOUCHER_UNAVAILABLE' });
      expect(f.journals).toHaveLength(0);
      expect(f.vRow.stockRemaining).toBe(2);
    });

    it('applies the per-voucher limit at confirm and records it as ACCOUNT_NOT_ELIGIBLE', async () => {
      const f = redemptionFixture();
      const quote = await f.quoteService.createQuote(adminId, { voucherId });
      f.redemptions.setDailyPointsLimit(30); // lowered after the quote
      await expect(
        f.redemptionService.redeem(
          adminId,
          { quoteId: quote.quoteId },
          'idem-key-1',
        ),
      ).rejects.toMatchObject({
        code: 'ACCOUNT_NOT_ELIGIBLE',
        details: { reason: 'DAILY_LIMIT_REACHED' },
      });
      expect(f.journals).toHaveLength(0);
      expect([...f.redemptions.redemptions.values()][0]).toMatchObject({
        status: 'FAILED',
        failureCode: 'ACCOUNT_NOT_ELIGIBLE',
      });
    });

    describe('Flash purchases', () => {
      it('decrements both Flash sold and voucher stock, and enforces the Flash end', async () => {
        const f = redemptionFixture();
        f.flashSales.sales.push(flashSale() as any);
        const quote = await f.quoteService.createQuote(adminId, { voucherId });
        expect(quote).toMatchObject({
          price: { points: 30, source: 'FLASH' },
          flashSaleItemId: 'fsi-1',
          flashEndsAt: '2026-10-20T00:00:00.000Z',
        });

        await f.redemptionService.redeem(
          adminId,
          { quoteId: quote.quoteId },
          'idem-key-1',
        );
        expect(f.flashSales.sales[0].items[0].sold).toBe(1);
        expect(f.vRow.stockRemaining).toBe(1);
        expect([...f.redemptions.redemptions.values()][0].flashSaleItemId).toBe(
          'fsi-1',
        );
      });

      it('returns PRICE_CHANGED when the Flash ended between quote and confirm', async () => {
        const f = redemptionFixture();
        f.flashSales.sales.push(flashSale() as any);
        const quote = await f.quoteService.createQuote(adminId, { voucherId });
        f.flashSales.sales[0].endedEarlyAt = '2026-10-13T11:59:00.000Z';
        await expect(
          f.redemptionService.redeem(
            adminId,
            { quoteId: quote.quoteId },
            'idem-key-1',
          ),
        ).rejects.toMatchObject({
          code: 'PRICE_CHANGED',
          details: { price: { source: 'PROMO', points: 40 } },
        });
        expect(f.journals).toHaveLength(0);
        expect(f.flashSales.sales[0].items[0].sold).toBe(0);
      });

      it('quota 1 with two racing users: one success, the loser is told the price changed', async () => {
        const f = redemptionFixture();
        const sale = flashSale();
        sale.items[0].quota = 1;
        f.flashSales.sales.push(sale as any);
        const userB = '10000000-0000-4000-8000-0000000000bb';
        const qa = await f.quoteService.createQuote(adminId, { voucherId });
        const qb = await f.quoteService.createQuote(userB, { voucherId });

        await f.redemptionService.redeem(
          adminId,
          { quoteId: qa.quoteId },
          'idem-key-a',
        );
        await expect(
          f.redemptionService.redeem(
            userB,
            { quoteId: qb.quoteId },
            'idem-key-b',
          ),
        ).rejects.toMatchObject({ code: 'PRICE_CHANGED' });
        expect(f.journals).toHaveLength(1);
        expect(f.flashSales.sales[0].items[0].sold).toBe(1);
      });

      it('does not apply the Flash cap or Flash rules to a regular purchase once Flash is sold out', async () => {
        const f = redemptionFixture();
        const sale = flashSale({
          rules: { requireRecentSurvey: true, blockFlagged: true },
        });
        sale.items[0].sold = sale.items[0].quota; // sold out, window still open
        f.flashSales.sales.push(sale as any);
        f.accountStanding.completedSurveyInLastDays = async () => false;

        const quote = await f.quoteService.createQuote(adminId, { voucherId });
        expect(quote).toMatchObject({
          price: { source: 'PROMO' },
          flashSaleItemId: null,
          flashEndsAt: null,
        });
        const result = await f.redemptionService.redeem(
          adminId,
          { quoteId: quote.quoteId },
          'idem-key-1',
        );
        expect(result.priceSource).toBe('PROMO');
        expect(
          [...f.redemptions.redemptions.values()][0].flashSaleItemId,
        ).toBeNull();
      });

      it('requires a recent survey for a Flash quote (BR-02)', async () => {
        const f = redemptionFixture();
        f.accountStanding.completedSurveyInLastDays = async () => false;
        f.flashSales.sales.push(
          flashSale({
            rules: { requireRecentSurvey: true, blockFlagged: false },
          }) as any,
        );
        await expect(
          f.quoteService.createQuote(adminId, { voucherId }),
        ).rejects.toMatchObject({
          code: 'ACCOUNT_NOT_ELIGIBLE',
          details: { reason: 'NO_RECENT_SURVEY' },
        });
      });

      it('caps a Flash item per user (BR-19)', async () => {
        const f = redemptionFixture();
        f.flashSales.sales.push(flashSale() as any);
        const q1 = await f.quoteService.createQuote(adminId, { voucherId });
        await f.redemptionService.redeem(
          adminId,
          { quoteId: q1.quoteId },
          'idem-key-1',
        );
        await expect(
          f.quoteService.createQuote(adminId, { voucherId }),
        ).rejects.toMatchObject({
          code: 'ACCOUNT_NOT_ELIGIBLE',
          details: { reason: 'FLASH_LIMIT_REACHED' },
        });
      });

      it('AC5: flags a Flash redemption within 24h after a top-up without blocking it', async () => {
        const f = redemptionFixture();
        f.flashSales.sales.push(flashSale() as any);
        let askedSince: Date | undefined;
        f.accountStanding.hasApprovedTopUpSince = async (_u, since) => {
          askedSince = since;
          return true;
        };
        const quote = await f.quoteService.createQuote(adminId, { voucherId });
        const result = await f.redemptionService.redeem(
          adminId,
          { quoteId: quote.quoteId },
          'idem-key-1',
        );
        expect(result.status).toBe('SUCCEEDED');
        expect(askedSince?.toISOString()).toBe('2026-10-12T12:00:00.000Z');
        expect(f.fraudFlags).toEqual([
          {
            userId: adminId,
            redemptionId: result.redemptionId,
            voucherId,
            now: clock.now(),
          },
        ]);
      });

      it('AC5: no flag for a regular purchase or when there was no recent top-up', async () => {
        const f = redemptionFixture();
        f.accountStanding.hasApprovedTopUpSince = async () => true;
        const quote = await f.quoteService.createQuote(adminId, { voucherId });
        await f.redemptionService.redeem(
          adminId,
          { quoteId: quote.quoteId },
          'idem-key-1',
        );
        expect(f.fraudFlags).toHaveLength(0);

        const g = redemptionFixture();
        g.flashSales.sales.push(flashSale() as any);
        const gq = await g.quoteService.createQuote(adminId, { voucherId });
        await g.redemptionService.redeem(
          adminId,
          { quoteId: gq.quoteId },
          'idem-key-1',
        );
        expect(g.fraudFlags).toHaveLength(0);
      });
    });

    describe('inventory drift (stock > 0, no free code)', () => {
      it('answers SOLD_OUT, records the FAILED row and emits one drift event per hour', async () => {
        const f = redemptionFixture();
        f.redemptions.codes.clear();
        const q1 = await f.quoteService.createQuote(adminId, { voucherId });
        const q2 = await f.quoteService.createQuote(adminId, { voucherId });

        await expect(
          f.redemptionService.redeem(
            adminId,
            { quoteId: q1.quoteId },
            'idem-key-1',
          ),
        ).rejects.toMatchObject({ code: 'SOLD_OUT' });
        // Second drift in the same hour: still a FAILED row and a SOLD_OUT.
        await expect(
          f.redemptionService.redeem(
            adminId,
            { quoteId: q2.quoteId },
            'idem-key-2',
          ),
        ).rejects.toMatchObject({ code: 'SOLD_OUT' });

        const drift = f.audits.filter(
          (a) => a.eventType === 'REWARDS_CODE_INVENTORY_DRIFT',
        );
        expect(drift).toHaveLength(1);
        expect(drift[0].idempotencyKey).toBe(
          `rewards:inventory-drift:${voucherId}:2026-10-13T12`,
        );
        expect(JSON.stringify(drift[0].payload)).not.toContain('CODE-');
        expect(f.redemptions.redemptions.size).toBe(2);
        await expect(
          f.redemptionService.findByKey(adminId, 'idem-key-2'),
        ).rejects.toMatchObject({ code: 'SOLD_OUT' });
        expect(f.journals).toHaveLength(0);
      });
    });

    describe('concurrency and integrity paths', () => {
      it('retries the transaction when the generated reference collides', async () => {
        const f = redemptionFixture();
        const quote = await f.quoteService.createQuote(adminId, { voucherId });
        const insert = f.redemptions.insertRedemption.bind(f.redemptions);
        let calls = 0;
        f.redemptions.insertRedemption = async (r) => {
          if (++calls === 1) throw uniqueViolation(['reference']);
          return insert(r);
        };
        const result = await f.redemptionService.redeem(
          adminId,
          { quoteId: quote.quoteId },
          'idem-key-1',
        );
        expect(result.status).toBe('SUCCEEDED');
        expect(calls).toBe(2);
      });

      it('converges on the winner when two requests race on the same (user, key)', async () => {
        const f = redemptionFixture();
        const quote = await f.quoteService.createQuote(adminId, { voucherId });
        const insert = f.redemptions.insertRedemption.bind(f.redemptions);
        f.redemptions.insertRedemption = async (r) => {
          // A concurrent request with the same key committed first.
          await insert({
            ...r,
            id: '60000000-0000-4000-8000-000000000006',
            reference: 'RDM-2026-WINR',
            status: 'FAILED',
            journalId: null,
            balanceAfter: null,
            failureCode: 'SOLD_OUT',
            failureDetails: { voucherId, regularStockRemaining: 0 },
          });
          throw uniqueViolation(['user_id', 'idempotency_key']);
        };
        await expect(
          f.redemptionService.redeem(
            adminId,
            { quoteId: quote.quoteId },
            'idem-key-1',
          ),
        ).rejects.toMatchObject({ code: 'SOLD_OUT' });
      });

      it('same (user, key) raced with a different quote is an IDEMPOTENCY_KEY_CONFLICT', async () => {
        const f = redemptionFixture();
        const quote = await f.quoteService.createQuote(adminId, { voucherId });
        const insert = f.redemptions.insertRedemption.bind(f.redemptions);
        f.redemptions.insertRedemption = async (r) => {
          await insert({
            ...r,
            id: '60000000-0000-4000-8000-000000000006',
            reference: 'RDM-2026-WINR',
            quoteId: '70000000-0000-4000-8000-000000000007',
            status: 'FAILED',
            journalId: null,
            balanceAfter: null,
            failureCode: 'SOLD_OUT',
            failureDetails: {},
          });
          throw uniqueViolation(['user_id', 'idempotency_key']);
        };
        await expect(
          f.redemptionService.redeem(
            adminId,
            { quoteId: quote.quoteId },
            'idem-key-1',
          ),
        ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_CONFLICT' });
      });

      it('replay never invents a code: a missing code is an integrity error', async () => {
        const f = redemptionFixture();
        const quote = await f.quoteService.createQuote(adminId, { voucherId });
        await f.redemptionService.redeem(
          adminId,
          { quoteId: quote.quoteId },
          'idem-key-1',
        );
        f.redemptions.codes.clear();
        await expect(
          f.redemptionService.findByKey(adminId, 'idem-key-1'),
        ).rejects.toThrow(/missing its voucher code/);
      });

      it('a REFUNDED row never replays as SUCCEEDED', async () => {
        const f = redemptionFixture();
        await f.redemptions.insertRedemption({
          id: '60000000-0000-4000-8000-000000000006',
          userId: adminId,
          voucherId,
          voucherCodeId: 'c1',
          flashSaleItemId: null,
          quoteId: null,
          idempotencyKey: 'refund-key-1',
          status: 'REFUNDED',
          pricePoints: 40,
          priceSource: 'PROMO',
          priceVersion: 1,
          journalId: '30000000-0000-4000-8000-000000000009',
          balanceAfter: 1000,
          failureCode: null,
          failureDetails: null,
          reference: 'RFD-2026-0001',
          createdAt: clock.now().toISOString(),
        });
        await expect(
          f.redemptionService.findByKey(adminId, 'refund-key-1'),
        ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_CONFLICT' });
      });
    });
  });
});
