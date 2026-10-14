import { InMemoryVoucherRepository } from './in-memory-voucher.repository';
import { InMemoryVoucherCodeRepository } from './in-memory-voucher-code.repository';
import { InMemoryFlashSaleReadRepository } from './in-memory-flash-sale-read.repository';
import { InMemoryRedemptionRepository } from './in-memory-redemption.repository';
import { PrismaVoucherRepository } from './prisma-voucher.repository';
import { PrismaVoucherCodeRepository } from './prisma-voucher-code.repository';
import { PrismaFlashSaleReadRepository } from './prisma-flash-sale-read.repository';
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
      startsAt: voucher.createdAt,
      endsAt: voucher.redeemEndsAt,
      endedEarlyAt: null,
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
});
