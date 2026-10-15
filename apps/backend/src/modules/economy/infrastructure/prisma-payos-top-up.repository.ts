import { Injectable } from '@nestjs/common';
import { Prisma, TopUpRequest } from '@prisma/client';
import { PrismaService } from '../../../common/database/prisma.service';
import { runInTransaction } from '../../../common/database/prisma-unit-of-work';
import {
  CreateProcessingResult,
  PayosTopUp,
  PayosTopUpRepositoryPort,
  TopUpStatusEvent,
} from '../application/ports/payos-top-up-repository.port';

function toTopUp(row: TopUpRequest): PayosTopUp {
  if (
    row.channel !== 'PAYOS' ||
    row.orderCode === null ||
    row.expiresAt === null
  )
    throw new Error('Expected payOS top-up');
  return {
    id: row.id,
    userId: row.userId,
    orderCode: row.orderCode,
    amountVnd: row.amountVnd,
    points: row.amount,
    status: row.status as PayosTopUp['status'],
    checkoutUrl: row.checkoutUrl,
    paymentLinkId: row.paymentLinkId,
    expiresAt: row.expiresAt,
    cancelledAt: row.cancelledAt,
    paidAt: row.paidAt,
    createdAt: row.createdAt,
  };
}
@Injectable()
export class PrismaPayosTopUpRepository implements PayosTopUpRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}
  async createProcessing(
    input: Pick<
      PayosTopUp,
      'id' | 'userId' | 'amountVnd' | 'points' | 'expiresAt' | 'createdAt'
    >,
    options: { limit: number; windowMs: number; now: Date },
  ): Promise<CreateProcessingResult> {
    try {
      return await runInTransaction(this.prisma, async (tx) => {
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${`top-up:${input.userId}`}))`;
        const existing = await tx.topUpRequest.findFirst({
          where: {
            userId: input.userId,
            channel: 'PAYOS',
            status: 'PROCESSING',
          },
        });
        if (existing)
          return {
            outcome: 'ALREADY_PROCESSING' as const,
            topUp: toTopUp(existing),
          };
        const windowRows = await tx.topUpRequest.findMany({
          where: {
            userId: input.userId,
            channel: 'PAYOS',
            createdAt: {
              gt: new Date(options.now.getTime() - options.windowMs),
            },
          },
          orderBy: { createdAt: 'asc' },
          select: { createdAt: true },
        });
        if (windowRows.length >= options.limit)
          return {
            outcome: 'RATE_LIMITED' as const,
            retryAfterSeconds: Math.max(
              1,
              Math.ceil(
                (windowRows[0].createdAt.getTime() +
                  options.windowMs -
                  options.now.getTime()) /
                  1000,
              ),
            ),
          };
        const codes = await tx.$queryRaw<
          Array<{ code: number }>
        >`SELECT nextval('top_up_order_code_seq')::int AS code`;
        const row = await tx.topUpRequest.create({
          data: {
            id: input.id,
            userId: input.userId,
            amount: input.points,
            amountVnd: input.amountVnd,
            channel: 'PAYOS',
            status: 'PROCESSING',
            orderCode: codes[0].code,
            expiresAt: input.expiresAt,
            createdAt: input.createdAt,
          },
        });
        return { outcome: 'CREATED' as const, topUp: toTopUp(row) };
      });
    } catch (error) {
      const target = (error as { meta?: { target?: unknown } })?.meta?.target;
      if (
        (error as { code?: string })?.code === 'P2002' &&
        /user_id|userId|one_processing_per_user/.test(String(target))
      ) {
        const existing = await this.prisma.topUpRequest.findFirst({
          where: {
            userId: input.userId,
            channel: 'PAYOS',
            status: 'PROCESSING',
          },
        });
        if (existing)
          return { outcome: 'ALREADY_PROCESSING', topUp: toTopUp(existing) };
      }
      throw error;
    }
  }
  async attachPaymentLink(
    id: string,
    link: { paymentLinkId: string; checkoutUrl: string },
  ): Promise<PayosTopUp> {
    await this.prisma.topUpRequest.updateMany({
      where: { id, channel: 'PAYOS', paymentLinkId: null },
      data: link,
    });
    return toTopUp(
      await this.prisma.topUpRequest.findUniqueOrThrow({ where: { id } }),
    );
  }
  async markCancelled(
    id: string,
    cancelledAt: Date,
    event: TopUpStatusEvent | null,
  ): Promise<{ changed: boolean; topUp: PayosTopUp }> {
    return runInTransaction(this.prisma, async (tx) => {
      const changed =
        (
          await tx.topUpRequest.updateMany({
            where: { id, channel: 'PAYOS', status: 'PROCESSING' },
            data: { status: 'CANCELLED', cancelledAt },
          })
        ).count === 1;
      if (changed && event)
        await tx.outboxEvent.create({
          data: {
            id: event.id,
            idempotencyKey: event.idempotencyKey,
            eventType: event.eventType,
            schemaVersion: 1,
            producer: event.producer,
            aggregateType: event.aggregateType,
            aggregateId: event.aggregateId,
            aggregateVersion: event.aggregateVersion,
            status: 'PENDING',
            payload: event.payload as Prisma.InputJsonValue,
          },
        });
      return {
        changed,
        topUp: toTopUp(
          await tx.topUpRequest.findUniqueOrThrow({ where: { id } }),
        ),
      };
    });
  }
  async findOwned(id: string, userId: string): Promise<PayosTopUp | null> {
    const row = await this.prisma.topUpRequest.findFirst({
      where: { id, userId, channel: 'PAYOS' },
    });
    return row ? toTopUp(row) : null;
  }
  async listByUser(
    userId: string,
    options: { limit: number; offset: number },
  ): Promise<{ items: PayosTopUp[]; total: number }> {
    const where = {
      userId,
      channel: 'PAYOS' as const,
    };
    const [rows, total] = await Promise.all([
      this.prisma.topUpRequest.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: options.limit,
        skip: options.offset,
      }),
      this.prisma.topUpRequest.count({ where }),
    ]);
    return {
      items: rows.map(toTopUp),
      total,
    };
  }
  countManualPending(): Promise<number> {
    return this.prisma.topUpRequest.count({
      where: { channel: 'MANUAL', status: 'PENDING' },
    });
  }
}

