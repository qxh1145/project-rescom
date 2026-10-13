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
import { AdminCapabilityPort } from '../../economy/application/ports/admin-capability.port';
import { RewardsException } from './exceptions/rewards.exceptions';

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
  const flashSales: FlashSaleReadPort = { list: async () => [] };
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
});
