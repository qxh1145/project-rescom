export const FLASH_SALE_READ_PORT = Symbol('FLASH_SALE_READ_PORT');
export interface FlashSaleRecord {
  id: string;
  code: string;
  startsAt: string;
  endsAt: string;
  endedEarlyAt: string | null;
  items: {
    id: string;
    voucherId: string;
    flashPoints: number;
    quota: number;
    sold: number;
    perUserCap: number;
  }[];
}
export interface FlashSaleReadPort {
  list(): Promise<FlashSaleRecord[]>;
}
