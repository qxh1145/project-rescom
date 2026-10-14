import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/database/prisma.service';
import { currentClient } from '../../../common/database/prisma-unit-of-work';
import {
  RedemptionRepositoryPort,
  RedemptionQuoteRecord,
  RedemptionRecord,
  ClaimedVoucherCode,
} from '../application/ports/redemption-repository.port';

@Injectable()
export class PrismaRedemptionRepository implements RedemptionRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async insertQuote(
    quote: RedemptionQuoteRecord,
  ): Promise<RedemptionQuoteRecord> {
    const row = await currentClient(this.prisma).redemptionQuote.create({
      data: {
        id: quote.id,
        userId: quote.userId,
        voucherId: quote.voucherId,
        flashSaleItemId: quote.flashSaleItemId,
        priceVersion: quote.priceVersion,
        pricePoints: quote.pricePoints,
        priceSource: quote.priceSource,
        expiresAt: new Date(quote.expiresAt),
        createdAt: new Date(quote.createdAt),
      },
    });
    return {
      id: row.id,
      userId: row.userId,
      voucherId: row.voucherId,
      flashSaleItemId: row.flashSaleItemId,
      priceVersion: row.priceVersion,
      pricePoints: row.pricePoints,
      priceSource: row.priceSource,
      expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    };
  }

  async findQuoteById(id: string): Promise<RedemptionQuoteRecord | null> {
    const row = await currentClient(this.prisma).redemptionQuote.findUnique({
      where: { id },
    });
    if (!row) return null;
    return {
      id: row.id,
      userId: row.userId,
      voucherId: row.voucherId,
      flashSaleItemId: row.flashSaleItemId,
      priceVersion: row.priceVersion,
      pricePoints: row.pricePoints,
      priceSource: row.priceSource,
      expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    };
  }

  async findRedemptionByUserAndKey(
    userId: string,
    idempotencyKey: string,
  ): Promise<RedemptionRecord | null> {
    const row = await currentClient(this.prisma).redemption.findUnique({
      where: {
        userId_idempotencyKey: {
          userId,
          idempotencyKey,
        },
      },
    });
    if (!row) return null;
    return {
      id: row.id,
      userId: row.userId,
      voucherId: row.voucherId,
      voucherCodeId: row.voucherCodeId,
      flashSaleItemId: row.flashSaleItemId,
      quoteId: row.quoteId,
      idempotencyKey: row.idempotencyKey,
      status: row.status,
      pricePoints: row.pricePoints,
      priceSource: row.priceSource,
      priceVersion: row.priceVersion,
      journalId: row.journalId,
      balanceAfter: row.balanceAfter,
      failureCode: row.failureCode,
      failureDetails: row.failureDetails as Record<string, unknown> | null,
      reference: row.reference,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async findSucceededRedemptionByQuoteId(
    quoteId: string,
  ): Promise<RedemptionRecord | null> {
    const row = await currentClient(this.prisma).redemption.findFirst({
      where: {
        quoteId,
        status: 'SUCCEEDED',
      },
    });
    if (!row) return null;
    return {
      id: row.id,
      userId: row.userId,
      voucherId: row.voucherId,
      voucherCodeId: row.voucherCodeId,
      flashSaleItemId: row.flashSaleItemId,
      quoteId: row.quoteId,
      idempotencyKey: row.idempotencyKey,
      status: row.status,
      pricePoints: row.pricePoints,
      priceSource: row.priceSource,
      priceVersion: row.priceVersion,
      journalId: row.journalId,
      balanceAfter: row.balanceAfter,
      failureCode: row.failureCode,
      failureDetails: row.failureDetails as Record<string, unknown> | null,
      reference: row.reference,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async insertRedemption(
    redemption: RedemptionRecord,
  ): Promise<RedemptionRecord> {
    const row = await currentClient(this.prisma).redemption.create({
      data: {
        id: redemption.id,
        userId: redemption.userId,
        voucherId: redemption.voucherId,
        voucherCodeId: redemption.voucherCodeId,
        flashSaleItemId: redemption.flashSaleItemId,
        quoteId: redemption.quoteId,
        idempotencyKey: redemption.idempotencyKey,
        status: redemption.status,
        pricePoints: redemption.pricePoints,
        priceSource: redemption.priceSource,
        priceVersion: redemption.priceVersion,
        journalId: redemption.journalId,
        balanceAfter: redemption.balanceAfter,
        failureCode: redemption.failureCode,
        failureDetails:
          (redemption.failureDetails as Prisma.InputJsonValue) ??
          Prisma.JsonNull,
        reference: redemption.reference,
        createdAt: new Date(redemption.createdAt),
      },
    });

    return {
      id: row.id,
      userId: row.userId,
      voucherId: row.voucherId,
      voucherCodeId: row.voucherCodeId,
      flashSaleItemId: row.flashSaleItemId,
      quoteId: row.quoteId,
      idempotencyKey: row.idempotencyKey,
      status: row.status,
      pricePoints: row.pricePoints,
      priceSource: row.priceSource,
      priceVersion: row.priceVersion,
      journalId: row.journalId,
      balanceAfter: row.balanceAfter,
      failureCode: row.failureCode,
      failureDetails: row.failureDetails as Record<string, unknown> | null,
      reference: row.reference,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async claimCode(voucherId: string): Promise<ClaimedVoucherCode | null> {
    const selected = await currentClient(this.prisma).$queryRaw<
      Array<{ id: string; code: string }>
    >`
      SELECT "id", "code"
      FROM "voucher_codes"
      WHERE "voucher_id" = ${voucherId}::uuid
        AND "redemption_id" IS NULL
      ORDER BY "created_at" ASC, "id" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `;

    if (!selected.length) {
      return null;
    }

    const codeRow = selected[0];
    return {
      id: codeRow.id,
      code: codeRow.code,
    };
  }

  async linkCodeToRedemption(
    codeId: string,
    redemptionId: string,
  ): Promise<void> {
    await currentClient(this.prisma).$executeRaw`
      UPDATE "voucher_codes"
      SET "redemption_id" = ${redemptionId}::uuid
      WHERE "id" = ${codeId}::uuid
    `;
  }

  async countVoucherRedemptionsInWindow(
    userId: string,
    voucherId: string,
    since: Date,
  ): Promise<number> {
    return currentClient(this.prisma).redemption.count({
      where: {
        userId,
        voucherId,
        status: 'SUCCEEDED',
        createdAt: { gte: since },
      },
    });
  }

  async countTodayRedeemedPoints(
    userId: string,
    startOfDay: Date,
    endOfDay: Date,
  ): Promise<number> {
    const result = await currentClient(this.prisma).redemption.aggregate({
      where: {
        userId,
        status: 'SUCCEEDED',
        createdAt: {
          gte: startOfDay,
          lt: endOfDay,
        },
      },
      _sum: {
        pricePoints: true,
      },
    });
    return result._sum.pricePoints ?? 0;
  }

  async countFlashItemRedemptionsForUser(
    userId: string,
    flashSaleItemId: string,
  ): Promise<number> {
    return currentClient(this.prisma).redemption.count({
      where: {
        userId,
        flashSaleItemId,
        status: 'SUCCEEDED',
      },
    });
  }

  async claimFlashItem(
    itemId: string,
    userId: string,
    redemptionId: string,
  ): Promise<void> {
    await currentClient(this.prisma).flashItemClaim.create({
      data: {
        flashSaleItemId: itemId,
        userId,
        redemptionId,
      },
    });
  }

  async getDailyPointsLimit(): Promise<number> {
    const row = await currentClient(this.prisma).rewardsSettings.findUnique({
      where: { id: 1 },
    });
    return row?.dailyPointsLimit ?? 500;
  }

  async setDailyPointsLimit(
    limit: number,
    updatedById?: string,
  ): Promise<void> {
    await currentClient(this.prisma).rewardsSettings.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        dailyPointsLimit: limit,
        updatedById,
      },
      update: {
        dailyPointsLimit: limit,
        updatedById,
      },
    });
  }

  async findCodeById(id: string): Promise<ClaimedVoucherCode | null> {
    const row = await currentClient(this.prisma).voucherCode.findUnique({
      where: { id },
    });
    if (!row) return null;
    return {
      id: row.id,
      code: row.code,
    };
  }
}
