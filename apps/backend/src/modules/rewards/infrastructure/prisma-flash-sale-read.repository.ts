import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import { currentClient } from '../../../common/database/prisma-unit-of-work';
import {
  FlashSaleReadPort,
  FlashSaleRecord,
} from '../application/ports/flash-sale-read.port';

@Injectable()
export class PrismaFlashSaleReadRepository implements FlashSaleReadPort {
  constructor(private readonly prisma: PrismaService) {}
  async list(): Promise<FlashSaleRecord[]> {
    const rows = await currentClient(this.prisma).flashSale.findMany({
      include: { items: true },
      orderBy: { id: 'asc' },
    });
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      endedEarlyAt: row.endedEarlyAt?.toISOString() ?? null,
      items: row.items.map((item) => ({
        id: item.id,
        voucherId: item.voucherId,
        flashPoints: item.flashPoints,
        quota: item.quota,
        sold: item.sold,
        perUserCap: item.perUserCap,
      })),
    }));
  }
}
