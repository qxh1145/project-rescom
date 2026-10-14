export const FLASH_SALE_READ_PORT = Symbol('FLASH_SALE_READ_PORT');
export interface FlashSaleItemRecord {
  id: string;
  flashSaleId: string;
  voucherId: string;
  flashPoints: number;
  quota: number;
  sold: number;
  perUserCap: number;
  soldOutAt: string | null;
}

export interface FlashSaleRecord {
  id: string;
  code: string;
  startsAt: string;
  endsAt: string;
  endedEarlyAt: string | null;
  rules?: {
    requireRecentSurvey: boolean;
    blockFlagged: boolean;
    remindBefore10m?: boolean;
  };
  items: FlashSaleItemRecord[];
}

export interface FlashSaleReadPort {
  list(): Promise<FlashSaleRecord[]>;
  findById(id: string): Promise<FlashSaleRecord | null>;
  findItemById(itemId: string): Promise<FlashSaleItemRecord | null>;
  findActiveItemForVoucher(
    voucherId: string,
    now: Date,
  ): Promise<(FlashSaleItemRecord & { flashSale: FlashSaleRecord }) | null>;
  lockFlashItem(id: string): Promise<void>;
  /** Conditional increment: increments sold iff sold < quota; sets soldOutAt if sold + 1 >= quota. Returns true if updated. */
  incrementFlashSold(id: string, now: Date): Promise<boolean>;
}
