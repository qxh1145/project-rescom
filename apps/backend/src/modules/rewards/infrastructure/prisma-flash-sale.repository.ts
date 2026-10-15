import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/database/prisma.service';
import { currentClient } from '../../../common/database/prisma-unit-of-work';
import {
  CreateFlashSaleData,
  FlashSaleMonitoringStats,
  FlashSaleRepositoryPort,
  UpdateFlashSaleData,
} from '../application/ports/flash-sale-repository.port';
import { FlashSaleRecord } from '../application/ports/flash-sale-read.port';
import { RewardsAuditEvent } from '../application/ports/voucher-repository.port';
import { PrismaFlashSaleReadRepository } from './prisma-flash-sale-read.repository';

function toSaleRecord(row: any): FlashSaleRecord {
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
    rules: row.rules,
    items: (row.items ?? []).map((item: any) => ({
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
export class PrismaFlashSaleRepository
  extends PrismaFlashSaleReadRepository
  implements FlashSaleRepositoryPort
{
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async insertSale(data: CreateFlashSaleData): Promise<FlashSaleRecord> {
    const row = await currentClient(this.prisma).flashSale.create({
      data: {
        id: data.id,
        code: data.code,
        title: data.title,
        createdById: data.createdById,
        startsAt: new Date(data.startsAt),
        endsAt: new Date(data.endsAt),
        rules: data.rules,
        items: {
          create: data.items.map((item) => ({
            id: item.id,
            voucherId: item.voucherId,
            flashPoints: item.flashPoints,
            quota: item.quota,
            sold: 0,
            perUserCap: item.perUserCap,
          })),
        },
      },
      include: { items: true },
    });
    return toSaleRecord(row);
  }

  async updateSale(
    id: string,
    data: UpdateFlashSaleData,
  ): Promise<FlashSaleRecord> {
    const previous = await currentClient(this.prisma).flashSaleItem.findMany({
      where: { flashSaleId: id },
      select: { voucherId: true, sold: true },
    });
    const soldByVoucher = new Map(previous.map((i) => [i.voucherId, i.sold]));
    await currentClient(this.prisma).flashSaleItem.deleteMany({
      where: { flashSaleId: id },
    });
    const row = await currentClient(this.prisma).flashSale.update({
      where: { id },
      data: {
        title: data.title,
        startsAt: new Date(data.startsAt),
        endsAt: new Date(data.endsAt),
        rules: data.rules,
        items: {
          create: data.items.map((item) => ({
            ...(item.id ? { id: item.id } : {}),
            voucherId: item.voucherId,
            flashPoints: item.flashPoints,
            quota: item.quota,
            sold: soldByVoucher.get(item.voucherId) ?? 0,
            perUserCap: item.perUserCap,
          })),
        },
      },
      include: { items: true },
    });
    return toSaleRecord(row);
  }

  async lockVouchers(idsAscending: string[]): Promise<void> {
    for (const id of idsAscending) {
      await currentClient(this.prisma).$queryRaw`
        SELECT id FROM "vouchers"
        WHERE "id" = ${id}::uuid
        FOR UPDATE
      `;
    }
  }

  async findOverlapCandidates(
    voucherIds: string[],
  ): Promise<FlashSaleRecord[]> {
    if (voucherIds.length === 0) return [];
    const rows = await currentClient(this.prisma).flashSale.findMany({
      where: {
        settledAt: null,
        items: {
          some: {
            voucherId: { in: voucherIds },
          },
        },
      },
      include: { items: true },
    });
    return rows.map(toSaleRecord);
  }

  async findDueForReserve(
    now: Date,
    limit: number,
  ): Promise<FlashSaleRecord[]> {
    const rows = await currentClient(this.prisma).flashSale.findMany({
      where: {
        startsAt: { lte: now },
        endsAt: { gt: now },
        reservedAt: null,
        settledAt: null,
        endedEarlyAt: null,
      },
      include: { items: true },
      orderBy: { startsAt: 'asc' },
      take: limit,
    });
    return rows.map(toSaleRecord);
  }

  async findDueForSettle(now: Date, limit: number): Promise<FlashSaleRecord[]> {
    // Fully sold-out reserved sales settle before `endsAt` (column-to-column
    // comparison is not expressible in a Prisma `where`).
    const soldOut = await currentClient(this.prisma).$queryRaw<
      Array<{ id: string }>
    >`
      SELECT fs."id" FROM "flash_sales" fs
      WHERE fs."settled_at" IS NULL
        AND fs."reserved_at" IS NOT NULL
        AND EXISTS (SELECT 1 FROM "flash_sale_items" i WHERE i."flash_sale_id" = fs."id")
        AND NOT EXISTS (
          SELECT 1 FROM "flash_sale_items" i
          WHERE i."flash_sale_id" = fs."id" AND i."sold" < i."quota"
        )
      LIMIT ${limit}
    `;
    const rows = await currentClient(this.prisma).flashSale.findMany({
      where: {
        settledAt: null,
        OR: [
          { endsAt: { lte: now } },
          { endedEarlyAt: { lte: now } },
          { id: { in: soldOut.map((r) => r.id) } },
        ],
      },
      include: { items: true },
      orderBy: { endsAt: 'asc' },
      take: limit,
    });
    return rows.map(toSaleRecord);
  }

  async markReserved(id: string, now: Date): Promise<boolean> {
    const count = await currentClient(this.prisma).$executeRaw`
      UPDATE "flash_sales"
      SET "reserved_at" = ${now},
          "updated_at" = CURRENT_TIMESTAMP
      WHERE "id" = ${id}::uuid
        AND "reserved_at" IS NULL
        AND "ended_early_at" IS NULL
    `;
    return count > 0;
  }

  async markSettled(
    id: string,
    now: Date,
    endReason?: string | null,
  ): Promise<boolean> {
    const count = await currentClient(this.prisma).$executeRaw`
      UPDATE "flash_sales"
      SET "settled_at" = ${now},
          "end_reason" = COALESCE("end_reason", ${endReason ?? null}),
          "updated_at" = CURRENT_TIMESTAMP
      WHERE "id" = ${id}::uuid
        AND "settled_at" IS NULL
    `;
    return count > 0;
  }

  async markEndedEarly(
    id: string,
    now: Date,
    reason: string,
  ): Promise<boolean> {
    const count = await currentClient(this.prisma).$executeRaw`
      UPDATE "flash_sales"
      SET "ended_early_at" = ${now},
          "end_reason" = ${reason},
          "updated_at" = CURRENT_TIMESTAMP
      WHERE "id" = ${id}::uuid
        AND "reserved_at" IS NOT NULL
        AND "ended_early_at" IS NULL
        AND "settled_at" IS NULL
    `;
    return count > 0;
  }

  async markReservationFailed(id: string, now: Date): Promise<boolean> {
    const count = await currentClient(this.prisma).$executeRaw`
      UPDATE "flash_sales"
      SET "ended_early_at" = ${now},
          "settled_at" = ${now},
          "end_reason" = 'RESERVATION_FAILED',
          "updated_at" = CURRENT_TIMESTAMP
      WHERE "id" = ${id}::uuid
        AND "reserved_at" IS NULL
        AND "ended_early_at" IS NULL
        AND "settled_at" IS NULL
    `;
    return count > 0;
  }

  async adjustVoucherStock(voucherId: string, delta: number): Promise<boolean> {
    if (delta === 0) return true;
    if (delta < 0) {
      const count = await currentClient(this.prisma).$executeRaw`
        UPDATE "vouchers"
        SET "stock_remaining" = "stock_remaining" + ${delta},
            "updated_at" = CURRENT_TIMESTAMP
        WHERE "id" = ${voucherId}::uuid
          AND "stock_remaining" >= ${-delta}
      `;
      return count > 0;
    } else {
      const count = await currentClient(this.prisma).$executeRaw`
        UPDATE "vouchers"
        SET "stock_remaining" = "stock_remaining" + ${delta},
            "updated_at" = CURRENT_TIMESTAMP
        WHERE "id" = ${voucherId}::uuid
      `;
      return count > 0;
    }
  }

  async appendAudit(event: RewardsAuditEvent): Promise<void> {
    const isUuid =
      event.correlationId &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        event.correlationId,
      );
    await currentClient(this.prisma).outboxEvent.create({
      data: {
        id: event.id,
        idempotencyKey: event.idempotencyKey,
        eventType: event.eventType,
        schemaVersion: 1,
        producer: event.producer,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        aggregateVersion: event.aggregateVersion,
        correlationId: isUuid ? event.correlationId : null,
        status: 'PENDING',
        payload: event.payload as Prisma.InputJsonValue,
      },
    });
  }

  async getMonitoringStats(
    flashSaleId: string,
    itemIds: string[],
    succeededCount: number,
  ): Promise<FlashSaleMonitoringStats> {
    if (itemIds.length === 0) {
      return {
        participants: 0,
        failures: { SOLD_OUT: 0, INSUFFICIENT_POINTS: 0, OTHER: 0 },
        afterTopUp: { count: 0, rate: 0, flagged: 0 },
      };
    }

    const participantsRows = await currentClient(
      this.prisma,
    ).redemption.findMany({
      where: {
        flashSaleItemId: { in: itemIds },
      },
      select: { userId: true },
      distinct: ['userId'],
    });
    const participants = participantsRows.length;

    const failedRows = await currentClient(this.prisma).redemption.findMany({
      where: {
        flashSaleItemId: { in: itemIds },
        status: 'FAILED',
      },
      select: { failureCode: true },
    });
    let soldOut = 0;
    let insufficient = 0;
    let other = 0;
    for (const row of failedRows) {
      if (row.failureCode === 'SOLD_OUT') {
        soldOut++;
      } else if (row.failureCode === 'INSUFFICIENT_POINTS') {
        insufficient++;
      } else {
        other++;
      }
    }

    const succeededRedemptions = await currentClient(
      this.prisma,
    ).redemption.findMany({
      where: {
        flashSaleItemId: { in: itemIds },
        status: 'SUCCEEDED',
      },
      select: { id: true },
    });
    let afterTopUpCount = 0;
    let afterTopUpUsers = 0;
    if (succeededRedemptions.length > 0) {
      const keys = succeededRedemptions.map((r) => `flash-after-topup:${r.id}`);
      const where = {
        type: 'FLASH_AFTER_TOPUP' as const,
        dedupeKey: { in: keys },
      };
      afterTopUpCount = await currentClient(this.prisma).fraudLog.count({
        where,
      });
      // FraudLog is append-only (no resolved state): "open" = distinct users flagged.
      afterTopUpUsers = (
        await currentClient(this.prisma).fraudLog.findMany({
          where,
          select: { userId: true },
          distinct: ['userId'],
        })
      ).length;
    }
    const rate =
      succeededCount > 0
        ? Number((afterTopUpCount / succeededCount).toFixed(2))
        : 0;

    return {
      participants,
      failures: {
        SOLD_OUT: soldOut,
        INSUFFICIENT_POINTS: insufficient,
        OTHER: other,
      },
      afterTopUp: {
        count: afterTopUpCount,
        rate,
        flagged: afterTopUpUsers,
      },
    };
  }
}
