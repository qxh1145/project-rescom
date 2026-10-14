import { Injectable } from '@nestjs/common';
import { Prisma, Voucher } from '@prisma/client';
import { PrismaService } from '../../../common/database/prisma.service';
import { currentClient } from '../../../common/database/prisma-unit-of-work';
import {
  RewardsAuditEvent,
  VoucherRecord,
  VoucherRedemptionRecord,
  VoucherRepositoryPort,
  VoucherPriceVersionRecord,
} from '../application/ports/voucher-repository.port';

const relations = {
  brand: true,
  _count: {
    select: {
      codes: { where: { redemptionId: null, issueReportId: null } },
    },
  },
} as const;
type VoucherRow = Voucher & {
  brand: { id: string; name: string };
  _count: { codes: number };
};
function toRecord(row: VoucherRow): VoucherRecord {
  return {
    id: row.id,
    title: row.title,
    brand: row.brand,
    category: row.category,
    valueVnd: row.valueVnd,
    basePoints: row.basePoints,
    promoPoints: row.promoPoints,
    priceVersion: row.priceVersion,
    stockTotal: row.stockTotal,
    stockRemaining: row.stockRemaining,
    codesAvailable: row.isSharedCode
      ? Number(!!row.sharedCode)
      : row._count.codes,
    state: row.state,
    isVisible: row.isVisible,
    isSharedCode: row.isSharedCode,
    sharedCode: row.sharedCode,
    redeemStartsAt: row.redeemStartsAt.toISOString(),
    redeemEndsAt: row.redeemEndsAt.toISOString(),
    codeExpiresAt: row.codeExpiresAt.toISOString(),
    description: row.description,
    whereToUse: row.whereToUse,
    terms: row.terms,
    howToUse: row.howToUse,
    imageUrl: row.imageUrl,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    createdById: row.createdById,
  };
}
function data(row: VoucherRecord) {
  return {
    title: row.title,
    brandId: row.brand.id,
    category: row.category,
    valueVnd: row.valueVnd,
    basePoints: row.basePoints,
    promoPoints: row.promoPoints,
    priceVersion: row.priceVersion,
    stockTotal: row.stockTotal,
    stockRemaining: row.stockRemaining,
    state: row.state,
    isVisible: row.isVisible,
    isSharedCode: row.isSharedCode,
    sharedCode: row.sharedCode,
    redeemStartsAt: new Date(row.redeemStartsAt),
    redeemEndsAt: new Date(row.redeemEndsAt),
    codeExpiresAt: new Date(row.codeExpiresAt),
    description: row.description,
    whereToUse: row.whereToUse,
    terms: row.terms,
    howToUse: row.howToUse,
    imageUrl: row.imageUrl,
    createdById: row.createdById,
  };
}
@Injectable()
export class PrismaVoucherRepository implements VoucherRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}
  async lock(id: string): Promise<void> {
    await currentClient(this.prisma)
      .$queryRaw`SELECT id FROM vouchers WHERE id = ${id}::uuid FOR UPDATE`;
  }
  async list(): Promise<VoucherRecord[]> {
    const rows = await currentClient(this.prisma).voucher.findMany({
      include: relations,
      orderBy: { id: 'asc' },
    });
    return rows.map(toRecord);
  }
  async findById(id: string): Promise<VoucherRecord | null> {
    const row = await currentClient(this.prisma).voucher.findUnique({
      where: { id },
      include: relations,
    });
    return row ? toRecord(row) : null;
  }
  async listBrands() {
    return currentClient(this.prisma).voucherBrand.findMany({
      orderBy: { id: 'asc' },
    });
  }
  async create(voucher: VoucherRecord): Promise<VoucherRecord> {
    const row = await currentClient(this.prisma).voucher.create({
      data: {
        id: voucher.id,
        ...data(voucher),
        createdAt: new Date(voucher.createdAt),
      },
      include: relations,
    });
    return toRecord(row);
  }
  async save(voucher: VoucherRecord): Promise<VoucherRecord> {
    const row = await currentClient(this.prisma).voucher.update({
      where: { id: voucher.id },
      data: data(voucher),
      include: relations,
    });
    return toRecord(row);
  }
  async adjustStock(
    id: string,
    total: number,
    expectedRemaining: number,
    updatedAt: string,
  ): Promise<VoucherRecord | null> {
    const updated = await currentClient(this.prisma).$queryRaw<
      { id: string }[]
    >`
      UPDATE vouchers SET stock_remaining = stock_remaining + (${total} - stock_total),
      stock_total = ${total}, updated_at = ${new Date(updatedAt)}
      WHERE id = ${id}::uuid AND stock_remaining = ${expectedRemaining}
      AND stock_remaining + (${total} - stock_total) >= 0 AND ${total} >= 0
      RETURNING id`;
    return updated.length ? this.findById(id) : null;
  }
  async appendPriceVersion(
    voucherId: string,
    version: number,
    basePoints: number,
    promoPoints: number | null,
    changedById: string,
    effectiveFrom: string,
  ): Promise<void> {
    await currentClient(this.prisma).voucherPriceVersion.create({
      data: {
        voucherId,
        version,
        basePoints,
        promoPoints,
        changedById,
        effectiveFrom: new Date(effectiveFrom),
      },
    });
  }
  async priceHistory(voucherId: string): Promise<VoucherPriceVersionRecord[]> {
    const rows = await currentClient(this.prisma).voucherPriceVersion.findMany({
      where: { voucherId },
      orderBy: { version: 'asc' },
    });
    return rows.map((row) => ({
      version: row.version,
      basePoints: row.basePoints,
      promoPoints: row.promoPoints,
      effectiveFrom: row.effectiveFrom.toISOString(),
      changedBy: { id: row.changedById, name: 'Admin' },
    }));
  }
  async redemptions(
    voucherId: string,
    limit: number,
  ): Promise<VoucherRedemptionRecord[]> {
    const rows = await currentClient(this.prisma).redemption.findMany({
      where: { voucherId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map((row) => ({
      reference: row.reference,
      userId: row.userId,
      points: row.pricePoints,
      kind: row.status,
      createdAt: row.createdAt.toISOString(),
    }));
  }
  async decrementRegularStock(
    id: string,
    _updatedAt?: string,
  ): Promise<boolean> {
    const count = await currentClient(this.prisma).$executeRaw`
      UPDATE "vouchers"
      SET "stock_remaining" = "stock_remaining" - 1,
          "updated_at" = CURRENT_TIMESTAMP
      WHERE "id" = ${id}::uuid
        AND "stock_remaining" > 0
    `;
    return count > 0;
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
}
