import { FlashSaleReadPort, FlashSaleRecord } from './flash-sale-read.port';
import { RewardsAuditEvent } from './voucher-repository.port';

export const FLASH_SALE_REPOSITORY_PORT = Symbol('FLASH_SALE_REPOSITORY_PORT');

export interface CreateFlashSaleData {
  id: string;
  code: string;
  title: string;
  createdById: string;
  startsAt: string;
  endsAt: string;
  rules: {
    requireRecentSurvey: boolean;
    blockFlagged: boolean;
    remindBefore10m?: boolean;
  };
  items: Array<{
    id: string;
    voucherId: string;
    flashPoints: number;
    quota: number;
    perUserCap: number;
  }>;
}

export interface UpdateFlashSaleData {
  title: string;
  startsAt: string;
  endsAt: string;
  rules: {
    requireRecentSurvey: boolean;
    blockFlagged: boolean;
    remindBefore10m?: boolean;
  };
  items: Array<{
    id?: string;
    voucherId: string;
    flashPoints: number;
    quota: number;
    perUserCap: number;
  }>;
}

export interface FlashSaleMonitoringStats {
  participants: number;
  failures: {
    SOLD_OUT: number;
    INSUFFICIENT_POINTS: number;
    OTHER: number;
  };
  afterTopUp: {
    count: number;
    rate: number;
    flagged: number;
  };
}

export interface FlashSaleRepositoryPort extends FlashSaleReadPort {
  insertSale(data: CreateFlashSaleData): Promise<FlashSaleRecord>;
  updateSale(id: string, data: UpdateFlashSaleData): Promise<FlashSaleRecord>;
  lockVouchers(idsAscending: string[]): Promise<void>;
  findOverlapCandidates(voucherIds: string[]): Promise<FlashSaleRecord[]>;
  findDueForReserve(now: Date, limit: number): Promise<FlashSaleRecord[]>;
  findDueForSettle(now: Date, limit: number): Promise<FlashSaleRecord[]>;
  markReserved(id: string, now: Date): Promise<boolean>;
  markSettled(
    id: string,
    now: Date,
    endReason?: string | null,
  ): Promise<boolean>;
  markEndedEarly(id: string, now: Date, reason: string): Promise<boolean>;
  /** Atomically cancels an unreserved sale (ended early + settled, RESERVATION_FAILED). */
  markReservationFailed(id: string, now: Date): Promise<boolean>;
  adjustVoucherStock(voucherId: string, delta: number): Promise<boolean>;
  appendAudit(event: RewardsAuditEvent): Promise<void>;
  getMonitoringStats(
    flashSaleId: string,
    itemIds: string[],
    succeededCount: number,
  ): Promise<FlashSaleMonitoringStats>;
}
