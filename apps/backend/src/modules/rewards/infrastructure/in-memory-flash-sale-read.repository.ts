import {
  FlashSaleReadPort,
  FlashSaleRecord,
} from '../application/ports/flash-sale-read.port';

export class InMemoryFlashSaleReadRepository implements FlashSaleReadPort {
  readonly sales: FlashSaleRecord[] = [];
  async list(): Promise<FlashSaleRecord[]> {
    return structuredClone(this.sales);
  }

  async findById(id: string): Promise<FlashSaleRecord | null> {
    const sale = this.sales.find((s) => s.id === id);
    return sale ? structuredClone(sale) : null;
  }

  async findItemById(itemId: string) {
    for (const sale of this.sales) {
      const item = sale.items.find((it) => it.id === itemId);
      if (item) return structuredClone(item);
    }
    return null;
  }

  async findActiveItemForVoucher(voucherId: string, now: Date) {
    const nowMs = now.getTime();
    for (const sale of this.sales) {
      const startsAtMs = Date.parse(sale.startsAt);
      const endsAtMs = Date.parse(sale.endsAt);
      const endedEarlyMs = sale.endedEarlyAt
        ? Date.parse(sale.endedEarlyAt)
        : null;
      if (
        startsAtMs <= nowMs &&
        nowMs < endsAtMs &&
        (!endedEarlyMs || nowMs < endedEarlyMs)
      ) {
        const item = sale.items.find((it) => it.voucherId === voucherId);
        if (item) {
          return {
            ...structuredClone(item),
            flashSale: structuredClone(sale),
          };
        }
      }
    }
    return null;
  }

  async lockFlashItem(_id: string): Promise<void> {
    // In-memory no-op lock
  }

  async incrementFlashSold(id: string, now: Date): Promise<boolean> {
    for (const sale of this.sales) {
      const item = sale.items.find((it) => it.id === id);
      if (item) {
        if (item.sold >= item.quota) return false;
        item.sold += 1;
        if (item.sold >= item.quota) {
          item.soldOutAt = now.toISOString();
        }
        return true;
      }
    }
    return false;
  }
}
