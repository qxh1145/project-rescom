import { InMemoryVoucherRepository } from './in-memory-voucher.repository';
import { InMemoryVoucherCodeRepository } from './in-memory-voucher-code.repository';
import { InMemoryFlashSaleReadRepository } from './in-memory-flash-sale-read.repository';
import { InMemoryFlashSaleRepository } from './in-memory-flash-sale.repository';
import { InMemoryRedemptionRepository } from './in-memory-redemption.repository';
import { PrismaVoucherRepository } from './prisma-voucher.repository';
import { PrismaVoucherCodeRepository } from './prisma-voucher-code.repository';
import { PrismaFlashSaleReadRepository } from './prisma-flash-sale-read.repository';
import { PrismaFlashSaleRepository } from './prisma-flash-sale.repository';
import { VoucherRecord } from '../application/ports/voucher-repository.port';
import { PrismaService } from '../../../common/database/prisma.service';

const id = '00000000-0000-4000-8000-000000000001';
const voucher: VoucherRecord = {
  id,
  title: 'Voucher',
  brand: { id: 'kfc', name: 'KFC' },
  category: 'COFFEE',
  valueVnd: 10000,
  basePoints: 50,
  promoPoints: null,
  priceVersion: 1,
  stockTotal: 10,
  stockRemaining: 8,
  codesAvailable: 0,
  state: 'ACTIVE',
  isVisible: true,
  isSharedCode: false,
  sharedCode: null,
  redeemStartsAt: '2026-10-01T00:00:00.000Z',
  redeemEndsAt: '2026-11-01T00:00:00.000Z',
  codeExpiresAt: '2026-11-08T00:00:00.000Z',
  description: null,
  whereToUse: null,
  terms: [],
  howToUse: [],
  imageUrl: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  createdById: id,
};

describe('Rewards repository contracts', () => {
  it('memory stock uses expected remaining and rejects negative updates', async () => {
    const repo = new InMemoryVoucherRepository();
    await repo.create(voucher);
    expect(await repo.adjustStock(id, 0, 8, voucher.updatedAt)).toBeNull();
    expect(await repo.adjustStock(id, 12, 7, voucher.updatedAt)).toBeNull();
    expect(
      (await repo.adjustStock(id, 12, 8, voucher.updatedAt))?.stockRemaining,
    ).toBe(10);
    expect((await repo.findById(id))?.stockTotal).toBe(12);
  });

  it('memory imports reject duplicate codes before inserting any', async () => {
    const repo = new InMemoryVoucherCodeRepository();
    await expect(repo.importCodes(id, ['ONE', 'ONE'])).rejects.toThrow();
    expect(await repo.listCodes(id)).toEqual([]);
    await repo.importCodes(id, ['ONE', 'TWO']);
    expect(await repo.countAvailable(id)).toBe(2);
    await repo.removeAvailable(id, 1);
    expect(await repo.countAvailable(id)).toBe(1);
  });

  it('Prisma operations use conditional stock SQL, no duplicate-skipping, and ambient read client', async () => {
    const queryRaw = jest.fn().mockResolvedValue([]);
    const createMany = jest.fn().mockResolvedValue({ count: 1 });
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      $queryRaw: queryRaw,
      voucherCode: { createMany },
      flashSale: { findMany },
    } as unknown as PrismaService;
    expect(
      await new PrismaVoucherRepository(prisma).adjustStock(
        id,
        0,
        8,
        voucher.updatedAt,
      ),
    ).toBeNull();
    await new PrismaVoucherRepository(prisma).lock(id);
    expect(queryRaw).toHaveBeenCalledTimes(2);
    expect(String(queryRaw.mock.calls[1][0])).toContain('FOR UPDATE');
    expect(String(queryRaw.mock.calls[0][0])).toContain('stock_remaining = ');
    await new PrismaVoucherCodeRepository(prisma).importCodes(id, ['ONE']);
    expect(createMany).toHaveBeenCalledWith({
      data: [{ voucherId: id, code: 'ONE' }],
      skipDuplicates: false,
    });
    expect(await new PrismaFlashSaleReadRepository(prisma).list()).toEqual([]);
  });

  it('memory Flash reads cannot mutate source', async () => {
    const reader = new InMemoryFlashSaleReadRepository();
    reader.sales.push({
      id,
      code: 'FS',
      title: 'Flash Sale',
      createdById: id,
      startsAt: voucher.createdAt,
      endsAt: voucher.redeemEndsAt,
      reservedAt: voucher.createdAt,
      settledAt: null,
      endedEarlyAt: null,
      endReason: null,
      items: [],
    });
    (await reader.list())[0].items.push({
      id,
      flashSaleId: id,
      voucherId: id,
      flashPoints: 5,
      quota: 2,
      sold: 0,
      perUserCap: 1,
      soldOutAt: null,
    });
    expect((await reader.list())[0].items).toEqual([]);
  });

  it('RedemptionRepository claimCode, quotes and redemptions operations', async () => {
    const repo = new InMemoryRedemptionRepository();

    repo.codes.set('c1', {
      id: 'c1',
      voucherId: id,
      code: 'CODE-SECRET-1',
      redemptionId: null,
    });

    const claimed = await repo.claimCode(id);
    expect(claimed).toEqual({ id: 'c1', code: 'CODE-SECRET-1' });
    await repo.linkCodeToRedemption(claimed!.id, 'redemption-1');

    // Second claim finds none
    const claimedAgain = await repo.claimCode(id);
    expect(claimedAgain).toBeNull();

    // Quotes and redemptions
    await repo.insertQuote({
      id: 'q1',
      userId: id,
      voucherId: id,
      flashSaleItemId: null,
      priceVersion: 1,
      pricePoints: 50,
      priceSource: 'BASE',
      expiresAt: '2026-10-15T00:00:00.000Z',
      createdAt: '2026-10-14T00:00:00.000Z',
    });
    expect((await repo.findQuoteById('q1'))?.pricePoints).toBe(50);

    await repo.insertRedemption({
      id: 'r1',
      userId: id,
      voucherId: id,
      voucherCodeId: 'c1',
      flashSaleItemId: null,
      quoteId: 'q1',
      idempotencyKey: 'k1',
      status: 'SUCCEEDED',
      pricePoints: 50,
      priceSource: 'BASE',
      priceVersion: 1,
      journalId: 'j1',
      balanceAfter: 100,
      failureCode: null,
      failureDetails: null,
      reference: 'RDM-2026-ABCD',
      createdAt: '2026-10-14T01:00:00.000Z',
    });
    expect((await repo.findRedemptionByUserAndKey(id, 'k1'))?.status).toBe(
      'SUCCEEDED',
    );
    expect(
      await repo.countVoucherRedemptionsInWindow(
        id,
        id,
        new Date('2026-10-01'),
      ),
    ).toBe(1);
    expect(
      await repo.countTodayRedeemedPoints(
        id,
        new Date('2026-10-14T00:00:00.000Z'),
        new Date('2026-10-15T00:00:00.000Z'),
      ),
    ).toBe(50);
  });

  it('InMemoryFlashSaleRepository lifecycle and stock operations work as expected', async () => {
    const repo = new InMemoryFlashSaleRepository();
    const sale = await repo.insertSale({
      id,
      code: 'FS-261014-A',
      title: 'Flash Sale Test',
      createdById: id,
      startsAt: '2026-10-14T10:00:00.000Z',
      endsAt: '2026-10-14T14:00:00.000Z',
      rules: {
        requireRecentSurvey: true,
        blockFlagged: true,
        remindBefore10m: true,
      },
      items: [
        {
          id: 'item-1',
          voucherId: id,
          flashPoints: 30,
          quota: 5,
          perUserCap: 1,
        },
      ],
    });
    expect(sale.id).toBe(id);
    expect(sale.items[0].quota).toBe(5);

    const candidates = await repo.findOverlapCandidates([id]);
    expect(candidates).toHaveLength(1);

    const dueReserve = await repo.findDueForReserve(
      new Date('2026-10-14T11:00:00.000Z'),
      10,
    );
    expect(dueReserve).toHaveLength(1);

    expect(
      await repo.markReserved(id, new Date('2026-10-14T10:00:00.000Z')),
    ).toBe(true);
    expect(
      await repo.markReserved(id, new Date('2026-10-14T10:00:00.000Z')),
    ).toBe(false);

    expect(await repo.adjustVoucherStock(id, -5)).toBe(true);
    expect(await repo.adjustVoucherStock(id, 2)).toBe(true);

    const dueSettle = await repo.findDueForSettle(
      new Date('2026-10-14T15:00:00.000Z'),
      10,
    );
    expect(dueSettle).toHaveLength(1);

    expect(
      await repo.markSettled(
        id,
        new Date('2026-10-14T15:00:00.000Z'),
        'EXPIRED',
      ),
    ).toBe(true);
    expect(
      await repo.markSettled(id, new Date('2026-10-14T15:00:00.000Z')),
    ).toBe(false);

    const stats = await repo.getMonitoringStats(id, ['item-1'], 3);
    expect(stats.participants).toBe(3);
  });

  it('InMemoryFlashSaleRepository: updateSale keeps sold, markReservationFailed is atomic, sold-out sales are due', async () => {
    const repo = new InMemoryFlashSaleRepository();
    const base = {
      id,
      code: 'FS-261014-A',
      title: 'T',
      createdById: id,
      startsAt: '2026-10-14T10:00:00.000Z',
      endsAt: '2026-10-14T14:00:00.000Z',
      rules: { requireRecentSurvey: false, blockFlagged: false },
      items: [
        {
          id: 'item-1',
          voucherId: id,
          flashPoints: 30,
          quota: 5,
          perUserCap: 1,
        },
      ],
    };
    await repo.insertSale(base);
    repo.sales[0].items[0].sold = 3;
    const updated = await repo.updateSale(id, {
      title: 'T2',
      startsAt: base.startsAt,
      endsAt: base.endsAt,
      rules: base.rules,
      items: [
        {
          id: 'item-1',
          voucherId: id,
          flashPoints: 25,
          quota: 5,
          perUserCap: 1,
        },
      ],
    });
    expect(updated.items[0].sold).toBe(3);

    const now = new Date('2026-10-14T11:00:00.000Z');
    expect(await repo.markReservationFailed(id, now)).toBe(true);
    expect(repo.sales[0]).toMatchObject({
      endReason: 'RESERVATION_FAILED',
      endedEarlyAt: now.toISOString(),
      settledAt: now.toISOString(),
    });
    expect(await repo.markReservationFailed(id, now)).toBe(false);
    expect(await repo.findDueForReserve(now, 10)).toHaveLength(0);

    const other = await repo.insertSale({
      ...base,
      id: 'sale-2',
      code: 'FS-261014-B',
      items: [{ ...base.items[0], id: 'item-2' }],
    });
    repo.sales[1].reservedAt = base.startsAt;
    repo.sales[1].items[0].sold = other.items[0].quota;
    expect(await repo.findDueForSettle(now, 10)).toHaveLength(1);
  });

  it('PrismaFlashSaleRepository methods call prisma correctly', async () => {
    const executeRaw = jest.fn().mockResolvedValue(1);
    const queryRaw = jest.fn().mockResolvedValue([]);
    const flashSale = {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({
        id,
        code: 'FS-261014-A',
        title: 'Title',
        createdById: id,
        startsAt: new Date(),
        endsAt: new Date(),
        reservedAt: null,
        settledAt: null,
        endedEarlyAt: null,
        endReason: null,
        rules: {},
        items: [],
      }),
      update: jest.fn().mockResolvedValue({
        id,
        code: 'FS-261014-A',
        title: 'Title Updated',
        createdById: id,
        startsAt: new Date(),
        endsAt: new Date(),
        reservedAt: null,
        settledAt: null,
        endedEarlyAt: null,
        endReason: null,
        rules: {},
        items: [],
      }),
    };
    const flashSaleItem = {
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    };
    const prisma = {
      $executeRaw: executeRaw,
      $queryRaw: queryRaw,
      flashSale,
      flashSaleItem,
    } as unknown as PrismaService;

    const repo = new PrismaFlashSaleRepository(prisma);
    await repo.lockVouchers([id]);
    expect(queryRaw).toHaveBeenCalled();
    expect(String(queryRaw.mock.calls[0][0])).toContain('FOR UPDATE');

    expect(await repo.markReserved(id, new Date())).toBe(true);
    expect(executeRaw).toHaveBeenCalled();

    expect(await repo.adjustVoucherStock(id, -5)).toBe(true);
    expect(await repo.adjustVoucherStock(id, 5)).toBe(true);
    expect(await repo.adjustVoucherStock(id, 0)).toBe(true);
  });
});
