import {
  CreateFlashSaleData,
  FlashSaleMonitoringStats,
  FlashSaleRepositoryPort,
  UpdateFlashSaleData,
} from '../application/ports/flash-sale-repository.port';
import { FlashSaleRecord } from '../application/ports/flash-sale-read.port';
import { RewardsAuditEvent } from '../application/ports/voucher-repository.port';
import { InMemoryFlashSaleReadRepository } from './in-memory-flash-sale-read.repository';

export class InMemoryFlashSaleRepository
  extends InMemoryFlashSaleReadRepository
  implements FlashSaleRepositoryPort
{
  readonly auditEvents: RewardsAuditEvent[] = [];
  readonly voucherStocks = new Map<string, number>();
  readonly monitoringStats = new Map<string, FlashSaleMonitoringStats>();

  async insertSale(data: CreateFlashSaleData): Promise<FlashSaleRecord> {
    const sale: FlashSaleRecord = {
      id: data.id,
      code: data.code,
      title: data.title,
      createdById: data.createdById,
      startsAt: data.startsAt,
      endsAt: data.endsAt,
      reservedAt: null,
      settledAt: null,
      endedEarlyAt: null,
      endReason: null,
      rules: {
        requireRecentSurvey: data.rules.requireRecentSurvey,
        blockFlagged: data.rules.blockFlagged,
        remindBefore10m: data.rules.remindBefore10m ?? false,
      },
      items: data.items.map((item) => ({
        id: item.id,
        flashSaleId: data.id,
        voucherId: item.voucherId,
        flashPoints: item.flashPoints,
        quota: item.quota,
        sold: 0,
        perUserCap: item.perUserCap,
        soldOutAt: null,
      })),
    };
    this.sales.push(sale);
    return structuredClone(sale);
  }

  async updateSale(
    id: string,
    data: UpdateFlashSaleData,
  ): Promise<FlashSaleRecord> {
    const existing = this.sales.find((s) => s.id === id);
    if (!existing) {
      throw new Error(`Flash sale not found: ${id}`);
    }
    existing.title = data.title;
    existing.startsAt = data.startsAt;
    existing.endsAt = data.endsAt;
    existing.rules = {
      requireRecentSurvey: data.rules.requireRecentSurvey,
      blockFlagged: data.rules.blockFlagged,
      remindBefore10m: data.rules.remindBefore10m ?? false,
    };
    existing.items = data.items.map((item, idx) => ({
      id: item.id ?? existing.items[idx]?.id ?? `item-${idx + 1}`,
      flashSaleId: id,
      voucherId: item.voucherId,
      flashPoints: item.flashPoints,
      quota: item.quota,
      sold:
        existing.items.find((i) => i.voucherId === item.voucherId)?.sold ?? 0,
      perUserCap: item.perUserCap,
      soldOutAt: null,
    }));
    return structuredClone(existing);
  }

  async lockVouchers(_idsAscending: string[]): Promise<void> {
    // In-memory no-op lock
  }

  async findOverlapCandidates(
    voucherIds: string[],
  ): Promise<FlashSaleRecord[]> {
    if (voucherIds.length === 0) return [];
    return structuredClone(
      this.sales.filter(
        (s) =>
          s.settledAt === null &&
          s.items.some((i) => voucherIds.includes(i.voucherId)),
      ),
    );
  }

  async findDueForReserve(
    now: Date,
    limit: number,
  ): Promise<FlashSaleRecord[]> {
    const nowMs = now.getTime();
    return structuredClone(
      this.sales
        .filter(
          (s) =>
            Date.parse(s.startsAt) <= nowMs &&
            Date.parse(s.endsAt) > nowMs &&
            s.reservedAt === null &&
            s.settledAt === null &&
            s.endedEarlyAt === null,
        )
        .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
        .slice(0, limit),
    );
  }

  async findDueForSettle(now: Date, limit: number): Promise<FlashSaleRecord[]> {
    const nowMs = now.getTime();
    return structuredClone(
      this.sales
        .filter(
          (s) =>
            s.settledAt === null &&
            (Date.parse(s.endsAt) <= nowMs ||
              (s.endedEarlyAt !== null &&
                Date.parse(s.endedEarlyAt) <= nowMs) ||
              (s.reservedAt !== null &&
                s.items.length > 0 &&
                s.items.every((i) => i.sold >= i.quota))),
        )
        .sort((a, b) => Date.parse(a.endsAt) - Date.parse(b.endsAt))
        .slice(0, limit),
    );
  }

  async markReserved(id: string, now: Date): Promise<boolean> {
    const sale = this.sales.find((s) => s.id === id);
    if (!sale || sale.reservedAt !== null || sale.endedEarlyAt !== null) {
      return false;
    }
    sale.reservedAt = now.toISOString();
    return true;
  }

  async markSettled(
    id: string,
    now: Date,
    endReason?: string | null,
  ): Promise<boolean> {
    const sale = this.sales.find((s) => s.id === id);
    if (!sale || sale.settledAt !== null) {
      return false;
    }
    sale.settledAt = now.toISOString();
    if (endReason && !sale.endReason) {
      sale.endReason = endReason;
    }
    return true;
  }

  async markEndedEarly(
    id: string,
    now: Date,
    reason: string,
  ): Promise<boolean> {
    const sale = this.sales.find((s) => s.id === id);
    if (
      !sale ||
      sale.reservedAt === null ||
      sale.endedEarlyAt !== null ||
      sale.settledAt !== null
    ) {
      return false;
    }
    sale.endedEarlyAt = now.toISOString();
    sale.endReason = reason;
    return true;
  }

  async markReservationFailed(id: string, now: Date): Promise<boolean> {
    const sale = this.sales.find((s) => s.id === id);
    if (
      !sale ||
      sale.reservedAt !== null ||
      sale.endedEarlyAt !== null ||
      sale.settledAt !== null
    ) {
      return false;
    }
    sale.endedEarlyAt = now.toISOString();
    sale.settledAt = now.toISOString();
    sale.endReason = 'RESERVATION_FAILED';
    return true;
  }

  async adjustVoucherStock(voucherId: string, delta: number): Promise<boolean> {
    if (delta === 0) return true;
    const current = this.voucherStocks.get(voucherId) ?? 1000;
    if (delta < 0 && current < -delta) {
      return false;
    }
    this.voucherStocks.set(voucherId, current + delta);
    return true;
  }

  async appendAudit(event: RewardsAuditEvent): Promise<void> {
    this.auditEvents.push(structuredClone(event));
  }

  async getMonitoringStats(
    flashSaleId: string,
    _itemIds: string[],
    succeededCount: number,
  ): Promise<FlashSaleMonitoringStats> {
    return (
      this.monitoringStats.get(flashSaleId) ?? {
        participants: succeededCount,
        failures: {
          SOLD_OUT: 0,
          INSUFFICIENT_POINTS: 0,
          OTHER: 0,
        },
        afterTopUp: {
          count: 0,
          rate: 0,
          flagged: 0,
        },
      }
    );
  }
}
