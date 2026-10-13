import {
  FlashSaleReadPort,
  FlashSaleRecord,
} from '../application/ports/flash-sale-read.port';

export class InMemoryFlashSaleReadRepository implements FlashSaleReadPort {
  readonly sales: FlashSaleRecord[] = [];
  async list(): Promise<FlashSaleRecord[]> {
    return structuredClone(this.sales);
  }
}
