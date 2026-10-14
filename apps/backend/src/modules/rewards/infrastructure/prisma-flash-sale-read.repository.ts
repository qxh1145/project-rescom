import { Injectable } from '@nestjs/common';
import { FlashSale, FlashSaleItem } from '@prisma/client';
import { PrismaService } from '../../../common/database/prisma.service';
import { currentClient } from '../../../common/database/prisma-unit-of-work';
import {
  FlashSaleReadPort,
  FlashSaleRecord,
} from '../application/ports/flash-sale-read.port';

function toSaleRecord(
  row: FlashSale & { items: FlashSaleItem[] },
): FlashSaleRecord {
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    createdById: row.createdById,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    reservedAt: row.reservedAt?.toISOString() ?? null,
    settledAt: row.settledAt?.toISOString() ?? null,
    endedEarlyAt: row.endedEarlyAt?.toISOString() ?? null,
    endReason: row.endReason,
    rules: row.rules as FlashSaleRecord['rules'],
    items: row.items.map((item) => ({
      id: item.id,
      flashSaleId: item.flashSaleId,
      voucherId: item.voucherId,
      flashPoints: item.flashPoints,
      quota: item.quota,
      sold: item.sold,
      perUserCap: item.perUserCap,
      soldOutAt: item.soldOutAt?.toISOString() ?? null,
    })),
  };
}

@Injectable()
export class PrismaFlashSaleReadRepository implements FlashSaleReadPort {
  constructor(protected readonly prisma: PrismaService) {}
  async list(): Promise<FlashSaleRecord[]> {
    const rows = await currentClient(this.prisma).flashSale.findMany({
      include: { items: true },
      orderBy: { id: 'asc' },
    });
    return rows.map(toSaleRecord);
  }

  async findById(id: string): Promise<FlashSaleRecord | null> {
    const row = await currentClient(this.prisma).flashSale.findUnique({
      where: { id },
      include: { items: true },
    });
    return row ? toSaleRecord(row) : null;
  }

  async findItemById(itemId: string) {
    const item = await currentClient(this.prisma).flashSaleItem.findUnique({
      where: { id: itemId },
    });
    if (!item) return null;
    return {
      id: item.id,
      flashSaleId: item.flashSaleId,
      voucherId: item.voucherId,
      flashPoints: item.flashPoints,
      quota: item.quota,
      sold: item.sold,
      perUserCap: item.perUserCap,
      soldOutAt: item.soldOutAt?.toISOString() ?? null,
    };
  }

  async findActiveItemForVoucher(voucherId: string, now: Date) {
    // One indexed query; with overlapping sales (12.9 forbids them) the most
    // recently started sale wins, then the lowest id, so the pick is stable.
    const item = await currentClient(this.prisma).flashSaleItem.findFirst({
      where: {
        voucherId,
        flashSale: {
          startsAt: { lte: now },
          endsAt: { gt: now },
          reservedAt: { not: null },
          settledAt: null,
          OR: [{ endedEarlyAt: null }, { endedEarlyAt: { gt: now } }],
        },
      },
      include: { flashSale: { include: { items: true } } },
      orderBy: [{ flashSale: { startsAt: 'desc' } }, { id: 'asc' }],
    });
    if (!item) return null;
    const { flashSale, ...own } = item;
    const sale = toSaleRecord(flashSale);
    return {
      id: own.id,
      flashSaleId: own.flashSaleId,
      voucherId: own.voucherId,
      flashPoints: own.flashPoints,
      quota: own.quota,
      sold: own.sold,
      perUserCap: own.perUserCap,
      soldOutAt: own.soldOutAt?.toISOString() ?? null,
      flashSale: sale,
    };
  }

  async lockFlashItem(id: string): Promise<void> {
    await currentClient(this.prisma).$queryRaw`
      SELECT id FROM "flash_sale_items"
      WHERE "id" = ${id}::uuid
      FOR UPDATE
    `;
  }

  async incrementFlashSold(id: string, now: Date): Promise<boolean> {
    const count = await currentClient(this.prisma).$executeRaw`
      UPDATE "flash_sale_items"
      SET "sold" = "sold" + 1,
          "sold_out_at" = CASE WHEN "sold" + 1 >= "quota" THEN ${now} ELSE "sold_out_at" END,
          "updated_at" = CURRENT_TIMESTAMP
      WHERE "id" = ${id}::uuid
        AND "sold" < "quota"
    `;
    return count > 0;
  }
}
