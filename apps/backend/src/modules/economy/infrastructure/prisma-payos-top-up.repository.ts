import { Injectable } from '@nestjs/common';
import { Prisma, TopUpRequest, TopUpStatus } from '@prisma/client';
import { ProviderPaymentFacts } from '../application/ports/payment-provider.port';
import { PrismaService } from '../../../common/database/prisma.service';
import { runInTransaction } from '../../../common/database/prisma-unit-of-work';
import {
  AdminPayosListParams,
  AdminPayosRow,
  CreateProcessingResult,
  ListReconcileCandidatesParams,
  PayosTopUp,
  PayosTopUpRepositoryPort,
  TopUpAdminAlertEvent,
  TopUpAdminAuditEvent,
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
    journalId: row.journalId,
    pointsCredited: row.pointsCredited,
    amountPaidVnd: row.amountPaidVnd,
    providerReference: row.providerReference,
    counterAccountBankId: row.counterAccountBankId,
    counterAccountBankName: row.counterAccountBankName,
    counterAccountName: row.counterAccountName,
    counterAccountNumber: row.counterAccountNumber,
    createdAt: row.createdAt,
  };
}

@Injectable()
export class PrismaPayosTopUpRepository implements PayosTopUpRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  private readonly adminSelect = {
    id: true,
    userId: true,
    orderCode: true,
    amountVnd: true,
    amount: true,
    pointsCredited: true,
    amountPaidVnd: true,
    status: true,
    createdAt: true,
    paidAt: true,
    expiresAt: true,
    cancelledAt: true,
    user: { select: { email: true } },
  } as const;

  private adminRow(row: {
    id: string;
    userId: string;
    orderCode: number | null;
    amountVnd: number;
    amount: number;
    pointsCredited: number | null;
    amountPaidVnd: number | null;
    status: TopUpStatus;
    createdAt: Date;
    paidAt: Date | null;
    expiresAt: Date | null;
    cancelledAt: Date | null;
    user: { email: string };
  }): AdminPayosRow {
    if (row.orderCode === null || row.expiresAt === null)
      throw new Error('Expected payOS top-up');
    return {
      id: row.id,
      userId: row.userId,
      orderCode: row.orderCode,
      amountVnd: row.amountVnd,
      points: row.amount,
      pointsCredited: row.pointsCredited,
      amountPaidVnd: row.amountPaidVnd,
      status: row.status as AdminPayosRow['status'],
      createdAt: row.createdAt,
      paidAt: row.paidAt,
      expiresAt: row.expiresAt,
      cancelledAt: row.cancelledAt,
      userEmail: row.user?.email ?? null,
    };
  }

  async listForAdmin(
    params: AdminPayosListParams,
  ): Promise<{ items: AdminPayosRow[]; total: number }> {
    const where: Prisma.TopUpRequestWhereInput = {
      channel: 'PAYOS',
      status: params.status,
      orderCode: params.orderCode,
      createdAt: { gte: params.fromUtc, lt: params.toUtcExclusive },
      // ponytail: email contains scans users; add trigram index if admin search slows.
      ...(params.emailContains
        ? {
            user: {
              email: { contains: params.emailContains, mode: 'insensitive' },
            },
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.topUpRequest.findMany({
        where,
        select: this.adminSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: params.limit,
        skip: params.offset,
      }),
      this.prisma.topUpRequest.count({ where }),
    ]);
    return { items: rows.map((row) => this.adminRow(row)), total };
  }

  async listForExport(params: {
    fromUtc: Date;
    toUtcExclusive: Date;
    limit: number;
  }): Promise<AdminPayosRow[]> {
    const rows = await this.prisma.topUpRequest.findMany({
      where: {
        channel: 'PAYOS',
        createdAt: { gte: params.fromUtc, lt: params.toUtcExclusive },
      },
      select: this.adminSelect,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: params.limit,
    });
    return rows.map((row) => this.adminRow(row));
  }

  async countByChannel(): Promise<{ payos: number; manual: number }> {
    const groups = await this.prisma.topUpRequest.groupBy({
      by: ['channel'],
      _count: { _all: true },
    });
    return {
      payos: groups.find((row) => row.channel === 'PAYOS')?._count._all ?? 0,
      manual: groups.find((row) => row.channel === 'MANUAL')?._count._all ?? 0,
    };
  }

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

  async findByOrderCode(orderCode: number): Promise<PayosTopUp | null> {
    const row = await this.prisma.topUpRequest.findFirst({
      where: { orderCode, channel: 'PAYOS' },
    });
    return row ? toTopUp(row) : null;
  }

  async lockForUpdate(id: string): Promise<PayosTopUp | null> {
    return runInTransaction(this.prisma, async (tx) => {
      await tx.$queryRaw`SELECT id FROM top_up_requests WHERE id = ${id}::uuid AND channel = 'PAYOS' FOR UPDATE`;
      const row = await tx.topUpRequest.findFirst({
        where: { id, channel: 'PAYOS' },
      });
      return row ? toTopUp(row) : null;
    });
  }

  private async transition(
    id: string,
    statuses: TopUpStatus[],
    status: TopUpStatus,
    data: {
      facts: ProviderPaymentFacts;
      verifiedAt: Date;
      journalId?: string;
      pointsCredited?: number;
    },
    event: TopUpStatusEvent,
  ): Promise<{ changed: boolean }> {
    return runInTransaction(this.prisma, async (tx) => {
      const row = await tx.topUpRequest.findFirst({
        where: { id, channel: 'PAYOS', status: { in: statuses } },
      });
      if (!row) return { changed: false };
      const facts = data.facts;
      const changed =
        (
          await tx.topUpRequest.updateMany({
            where: { id, channel: 'PAYOS', status: { in: statuses } },
            data: {
              status,
              ...(data.journalId
                ? {
                    journalId: data.journalId,
                    pointsCredited: data.pointsCredited,
                  }
                : {}),
              amountPaidVnd: facts.amountPaidVnd,
              providerReference: facts.providerReference,
              paidAt: facts.paidAt ?? data.verifiedAt,
              counterAccountBankId:
                row.counterAccountBankId ?? facts.counterAccountBankId,
              counterAccountBankName:
                row.counterAccountBankName ?? facts.counterAccountBankName,
              counterAccountName:
                row.counterAccountName ?? facts.counterAccountName,
              counterAccountNumber:
                row.counterAccountNumber ?? facts.counterAccountNumber,
            },
          })
        ).count === 1;
      if (changed)
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
      return { changed };
    });
  }

  markSuccessful(
    id: string,
    data: {
      journalId: string;
      pointsCredited: number;
      facts: ProviderPaymentFacts;
      verifiedAt: Date;
    },
    event: TopUpStatusEvent,
  ): Promise<{ changed: boolean }> {
    return this.transition(
      id,
      ['PROCESSING', 'CANCELLED', 'EXPIRED', 'AMOUNT_MISMATCH'],
      'SUCCESSFUL',
      data,
      event,
    );
  }

  async markAmountMismatch(
    id: string,
    data: { facts: ProviderPaymentFacts; verifiedAt: Date },
    event: TopUpStatusEvent,
  ): Promise<{ changed: boolean }> {
    return runInTransaction(this.prisma, async (tx) => {
      // 1. Initial transition branch: from PROCESSING, CANCELLED, or EXPIRED
      const initialTransition = await this.transition(
        id,
        ['PROCESSING', 'CANCELLED', 'EXPIRED'],
        'AMOUNT_MISMATCH',
        data,
        event,
      );
      if (initialTransition.changed) {
        return { changed: true };
      }

      // 2. C3 refresh branch: already AMOUNT_MISMATCH, but amountPaidVnd changed
      const row = await tx.topUpRequest.findFirst({
        where: {
          id,
          channel: 'PAYOS',
          status: 'AMOUNT_MISMATCH',
          amountPaidVnd: { not: data.facts.amountPaidVnd },
        },
      });
      if (!row) {
        return { changed: false };
      }

      const facts = data.facts;
      const changed =
        (
          await tx.topUpRequest.updateMany({
            where: {
              id,
              channel: 'PAYOS',
              status: 'AMOUNT_MISMATCH',
              amountPaidVnd: { not: facts.amountPaidVnd },
            },
            data: {
              amountPaidVnd: facts.amountPaidVnd,
              providerReference: facts.providerReference,
              // Keep paidAt unchanged on refresh
              counterAccountBankId:
                row.counterAccountBankId ?? facts.counterAccountBankId,
              counterAccountBankName:
                row.counterAccountBankName ?? facts.counterAccountBankName,
              counterAccountName:
                row.counterAccountName ?? facts.counterAccountName,
              counterAccountNumber:
                row.counterAccountNumber ?? facts.counterAccountNumber,
            },
          })
        ).count === 1;

      if (changed) {
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
      }

      return { changed };
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

  async listReconcileCandidates(
    params: ListReconcileCandidatesParams,
  ): Promise<PayosTopUp[]> {
    const dayAgo = new Date(params.now.getTime() - 24 * 60 * 60 * 1000);
    const rows = await this.prisma.topUpRequest.findMany({
      where: {
        channel: 'PAYOS',
        ...(params.after ? { id: { gt: params.after } } : {}),
        OR: [
          { status: 'PROCESSING' },
          { status: 'AMOUNT_MISMATCH' },
          { status: 'CANCELLED', cancelledAt: { gte: dayAgo } },
          { status: 'EXPIRED', expiresAt: { gte: dayAgo } },
        ],
      },
      orderBy: { id: 'asc' },
      take: params.limit,
    });
    return rows.map(toTopUp);
  }

  async findPayosById(id: string): Promise<PayosTopUp | null> {
    const row = await this.prisma.topUpRequest.findFirst({
      where: { id, channel: 'PAYOS' },
    });
    return row ? toTopUp(row) : null;
  }

  async markExpired(
    id: string,
    now: Date,
    event: TopUpStatusEvent,
  ): Promise<{ changed: boolean }> {
    return runInTransaction(this.prisma, async (tx) => {
      const changed =
        (
          await tx.topUpRequest.updateMany({
            where: { id, channel: 'PAYOS', status: 'PROCESSING' },
            data: { status: 'EXPIRED' },
          })
        ).count === 1;

      if (changed) {
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
      }

      return { changed };
    });
  }

  async enqueueAdminAlert(
    event: TopUpAdminAlertEvent,
  ): Promise<{ created: boolean }> {
    return runInTransaction(this.prisma, async (tx) => {
      const result = await tx.outboxEvent.createMany({
        data: [
          {
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
        ],
        skipDuplicates: true,
      });
      return { created: result.count === 1 };
    });
  }

  async recordAdminAudit(event: TopUpAdminAuditEvent): Promise<void> {
    await runInTransaction(this.prisma, async (tx) => {
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
    });
  }
}
