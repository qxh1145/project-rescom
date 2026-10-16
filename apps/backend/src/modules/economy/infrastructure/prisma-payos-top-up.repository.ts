import { Injectable } from '@nestjs/common';
import { Prisma, TopUpRequest, TopUpStatus } from '@prisma/client';
import { ProviderPaymentFacts } from '../application/ports/payment-provider.port';
import { PrismaService } from '../../../common/database/prisma.service';
import { runInTransaction } from '../../../common/database/prisma-unit-of-work';
import {
  AdminMismatchRow,
  AdminPayosListParams,
  AdminPayosRow,
  CreateProcessingResult,
  ListReconcileCandidatesParams,
  PayosTopUp,
  PayosTopUpRepositoryPort,
  TopUpAdminAlertEvent,
  TopUpAdminAuditEvent,
  TopUpRefundRow,
  TopUpRowForRefund,
  TopUpStatusEvent,
  UserTopUpRefundSummary,
} from '../application/ports/payos-top-up-repository.port';
import { TopUpRefundAlreadyRequestedException } from '../application/exceptions/economy.exceptions';

function maskLast4(accountNumber: string | null): string | null {
  if (!accountNumber) return null;
  return accountNumber.length >= 4 ? accountNumber.slice(-4) : accountNumber;
}

function toRefundRow(
  row: Prisma.TopUpRefundRequestGetPayload<object>,
): TopUpRefundRow {
  return {
    id: row.id,
    topUpId: row.topUpId,
    userId: row.userId,
    topUpJournalId: row.topUpJournalId,
    holdJournalId: row.holdJournalId,
    releaseJournalId: row.releaseJournalId,
    status: row.status as TopUpRefundRow['status'],
    eligibility: row.eligibility as TopUpRefundRow['eligibility'],
    ineligibleReason:
      row.ineligibleReason as TopUpRefundRow['ineligibleReason'],
    reason: row.reason as TopUpRefundRow['reason'],
    note: row.note,
    points: row.points,
    amountVnd: row.amountVnd,
    counterAccountBankId: row.counterAccountBankId,
    counterAccountBankName: row.counterAccountBankName,
    counterAccountName: row.counterAccountName,
    counterAccountNumber: row.counterAccountNumber,
    destinationVerified: row.destinationVerified,
    withdrawnAt: row.withdrawnAt,
    resolvedAt: row.resolvedAt,
    correlationId: row.correlationId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toUserRefundSummary(
  row: Prisma.TopUpRefundRequestGetPayload<object>,
): UserTopUpRefundSummary {
  return {
    id: row.id,
    status: row.status as UserTopUpRefundSummary['status'],
    eligibility: row.eligibility as UserTopUpRefundSummary['eligibility'],
    ineligibleReason:
      row.ineligibleReason as UserTopUpRefundSummary['ineligibleReason'],
    reason: row.reason as UserTopUpRefundSummary['reason'],
    points: row.points,
    amountVnd: row.amountVnd,
    destination: {
      bankId: row.counterAccountBankId,
      bankName: row.counterAccountBankName,
      holderName: row.counterAccountName,
      last4: maskLast4(row.counterAccountNumber),
      verified: row.destinationVerified,
    },
    submittedAt: row.createdAt,
    withdrawnAt: row.withdrawnAt,
  };
}

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
    channel: 'PAYOS',
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

  async listActionRequired({ limit }: { limit: number }): Promise<{
    mismatches: AdminMismatchRow[];
    uncredited: import('@rescom/schemas').AdminPayosUncredited[];
  }> {
    const rows = await this.prisma.topUpRequest.findMany({
      where: { channel: 'PAYOS', status: 'AMOUNT_MISMATCH' },
      select: {
        ...this.adminSelect,
        providerReference: true,
        counterAccountBankName: true,
        counterAccountNumber: true,
      },
      orderBy: [{ paidAt: 'asc' }, { id: 'asc' }],
      take: limit,
    });
    // Filter live status before LIMIT; historical closed alerts cannot hide newer open alerts.
    const alerts = await this.prisma.$queryRaw<
      Array<{
        aggregateId: string;
        payload: Prisma.JsonValue;
        createdAt: Date;
      }>
    >`
      SELECT a.aggregate_id AS "aggregateId", a.payload, a.created_at AS "createdAt"
      FROM outbox_events a
      JOIN top_up_requests t ON t.id::text = a.aggregate_id
      WHERE a.event_type = 'ECONOMY_TOPUP_ADMIN_ALERT'
        AND a.idempotency_key LIKE 'topup-alert:UNCREDITED_AFTER_PAYMENT:%'
        AND t.channel = 'PAYOS'
        AND t.status NOT IN ('SUCCESSFUL', 'MANUAL_REFUNDED', 'AMOUNT_MISMATCH')
      ORDER BY a.created_at ASC, a.id ASC
      LIMIT ${limit}
    `;
    // Outbox aggregate IDs come from alert writers; filter to UUIDs before querying uuid-typed IDs.
    const ids = alerts
      .map((alert) => alert.aggregateId)
      .filter((id) =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          id,
        ),
      );
    const active = await this.prisma.topUpRequest.findMany({
      where: {
        id: { in: ids },
        channel: 'PAYOS',
        status: { notIn: ['SUCCESSFUL', 'MANUAL_REFUNDED', 'AMOUNT_MISMATCH'] },
      },
      select: { ...this.adminSelect },
    });
    const byId = new Map(active.map((row) => [row.id, this.adminRow(row)]));
    return {
      mismatches: rows.map((row) => ({
        ...this.adminRow(row),
        providerReference: row.providerReference,
        counterAccountBankName: row.counterAccountBankName,
        counterAccountLast4: row.counterAccountNumber?.slice(-4) ?? null,
      })),
      uncredited: alerts
        .flatMap((alert) => {
          const row = byId.get(alert.aggregateId);
          if (!row) return [];
          const payload =
            alert.payload && typeof alert.payload === 'object'
              ? (alert.payload as Record<string, unknown>)
              : {};
          return [
            {
              topUpId: row.id,
              orderCode: row.orderCode,
              userId: row.userId,
              userEmail: row.userEmail,
              amountVnd: row.amountVnd,
              amountPaidVnd:
                typeof payload.amountPaidVnd === 'number'
                  ? payload.amountPaidVnd
                  : row.amountPaidVnd,
              status: row.status,
              paidAt:
                typeof payload.paidAt === 'string'
                  ? payload.paidAt
                  : (row.paidAt?.toISOString() ?? null),
              alertedAt: alert.createdAt.toISOString(),
            },
          ];
        })
        .slice(0, limit),
    };
  }

  async isMismatchJournal(journalId: string, key: string): Promise<boolean> {
    return !!(await this.prisma.ledgerJournal.findFirst({
      where: { id: journalId, idempotencyKey: key },
      select: { id: true },
    }));
  }

  async countActionRequired(): Promise<number> {
    const [mismatches, rows] = await Promise.all([
      this.prisma.topUpRequest.count({
        where: { channel: 'PAYOS', status: 'AMOUNT_MISMATCH' },
      }),
      this.prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count
        FROM outbox_events a
        JOIN top_up_requests t ON t.id::text = a.aggregate_id
        WHERE a.event_type = 'ECONOMY_TOPUP_ADMIN_ALERT'
          AND a.idempotency_key LIKE 'topup-alert:UNCREDITED_AFTER_PAYMENT:%'
          AND t.channel = 'PAYOS'
          AND t.status NOT IN ('SUCCESSFUL', 'MANUAL_REFUNDED', 'AMOUNT_MISMATCH')
      `,
    ]);
    const uncredited = Number(rows[0]?.count ?? 0);
    return mismatches + uncredited;
  }

  async resolveMismatch(
    id: string,
    data: {
      status: 'SUCCESSFUL' | 'MANUAL_REFUNDED';
      expectedAmountPaidVnd: number;
      journalId?: string;
      pointsCredited?: number;
      adminId: string;
      note: string | null;
      correlationId: string | null;
      resolvedAt: Date;
    },
    statusEvent: TopUpStatusEvent,
    auditEvent: TopUpAdminAuditEvent,
  ): Promise<{ changed: boolean }> {
    return runInTransaction(this.prisma, async (tx) => {
      const result = await tx.topUpRequest.updateMany({
        where: {
          id,
          channel: 'PAYOS',
          status: 'AMOUNT_MISMATCH',
          amountPaidVnd: data.expectedAmountPaidVnd,
        },
        data: {
          status: data.status,
          journalId: data.journalId,
          pointsCredited: data.pointsCredited,
          adminId: data.adminId,
          reviewedAt: data.resolvedAt,
          correlationId: data.correlationId,
          resolutionNote: data.note,
        },
      });
      if (!result.count) return { changed: false };
      await tx.outboxEvent.createMany({
        data: [statusEvent, auditEvent].map((event) => ({
          id: event.id,
          idempotencyKey: event.idempotencyKey,
          eventType: event.eventType,
          schemaVersion: 1,
          producer: event.producer,
          aggregateType: event.aggregateType,
          aggregateId: event.aggregateId,
          aggregateVersion: event.aggregateVersion,
          status: 'PENDING' as const,
          payload: event.payload as Prisma.InputJsonValue,
        })),
      });
      return { changed: true };
    });
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

  async lockTopUpForRefund(id: string): Promise<TopUpRowForRefund | null> {
    return runInTransaction(this.prisma, async (tx) => {
      await tx.$queryRaw`SELECT id FROM top_up_requests WHERE id = ${id}::uuid FOR UPDATE`;
      const row = await tx.topUpRequest.findUnique({
        where: { id },
      });
      if (!row) return null;
      return {
        id: row.id,
        userId: row.userId,
        channel: row.channel,
        orderCode: row.orderCode,
        amountVnd: row.amountVnd,
        points: row.amount,
        status: row.status as TopUpRowForRefund['status'],
        paidAt: row.paidAt,
        journalId: row.journalId,
        pointsCredited: row.pointsCredited,
        amountPaidVnd: row.amountPaidVnd,
        counterAccountBankId: row.counterAccountBankId,
        counterAccountBankName: row.counterAccountBankName,
        counterAccountName: row.counterAccountName,
        counterAccountNumber: row.counterAccountNumber,
        createdAt: row.createdAt,
      };
    });
  }

  async lockRefundRequestByTopUp(
    topUpId: string,
  ): Promise<TopUpRefundRow | null> {
    return runInTransaction(this.prisma, async (tx) => {
      await tx.$queryRaw`SELECT id FROM top_up_refund_requests WHERE top_up_id = ${topUpId}::uuid FOR UPDATE`;
      const row = await tx.topUpRefundRequest.findUnique({
        where: { topUpId },
      });
      return row ? toRefundRow(row) : null;
    });
  }

  async createRefundRequest(
    data: Parameters<PayosTopUpRepositoryPort['createRefundRequest']>[0],
    events: Parameters<PayosTopUpRepositoryPort['createRefundRequest']>[1],
  ): Promise<TopUpRefundRow> {
    return runInTransaction(this.prisma, async (tx) => {
      try {
        const row = await tx.topUpRefundRequest.create({
          data: {
            id: data.id,
            topUpId: data.topUpId,
            userId: data.userId,
            topUpJournalId: data.topUpJournalId,
            holdJournalId: data.holdJournalId,
            status: data.status,
            eligibility: data.eligibility,
            ineligibleReason: data.ineligibleReason,
            reason: data.reason,
            note: data.note,
            points: data.points,
            amountVnd: data.amountVnd,
            counterAccountBankId: data.counterAccountBankId,
            counterAccountBankName: data.counterAccountBankName,
            counterAccountName: data.counterAccountName,
            counterAccountNumber: data.counterAccountNumber,
            destinationVerified: data.destinationVerified,
            correlationId: data.correlationId,
            createdAt: data.createdAt,
          },
        });
        if (events.length > 0) {
          await tx.outboxEvent.createMany({
            data: events.map((event) => ({
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
            })),
          });
        }
        return toRefundRow(row);
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          throw new TopUpRefundAlreadyRequestedException();
        }
        throw error;
      }
    });
  }

  async withdrawRefundRequest(
    id: string,
    update: {
      releaseJournalId: string | null;
      withdrawnAt: Date;
    },
    events: Parameters<PayosTopUpRepositoryPort['withdrawRefundRequest']>[2],
  ): Promise<{ changed: boolean; request: TopUpRefundRow }> {
    return runInTransaction(this.prisma, async (tx) => {
      const result = await tx.topUpRefundRequest.updateMany({
        where: { id, status: 'REQUESTED' },
        data: {
          status: 'WITHDRAWN',
          withdrawnAt: update.withdrawnAt,
          releaseJournalId: update.releaseJournalId,
        },
      });
      const changed = result.count > 0;
      if (changed && events.length > 0) {
        await tx.outboxEvent.createMany({
          data: events.map((event) => ({
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
          })),
        });
      }
      const updated = await tx.topUpRefundRequest.findUniqueOrThrow({
        where: { id },
      });
      return { changed, request: toRefundRow(updated) };
    });
  }

  async findRefundRequestsByTopUpIds(
    topUpIds: string[],
  ): Promise<Map<string, UserTopUpRefundSummary>> {
    const map = new Map<string, UserTopUpRefundSummary>();
    if (topUpIds.length === 0) return map;
    const rows = await this.prisma.topUpRefundRequest.findMany({
      where: { topUpId: { in: topUpIds } },
    });
    for (const row of rows) {
      map.set(row.topUpId, toUserRefundSummary(row));
    }
    return map;
  }

  async findCreditJournal(
    journalId: string,
  ): Promise<{ id: string; idempotencyKey: string; createdAt: Date } | null> {
    return runInTransaction(this.prisma, async (tx) => {
      const journal = await tx.ledgerJournal.findUnique({
        where: { id: journalId },
        select: { id: true, idempotencyKey: true, createdAt: true },
      });
      return journal;
    });
  }

  async findCreditJournalKeysByIds(
    journalIds: string[],
  ): Promise<Map<string, string>> {
    if (journalIds.length === 0) return new Map();
    return runInTransaction(this.prisma, async (tx) => {
      const rows = await tx.ledgerJournal.findMany({
        where: { id: { in: journalIds } },
        select: { id: true, idempotencyKey: true },
      });
      return new Map(rows.map((r) => [r.id, r.idempotencyKey]));
    });
  }

  async getUserEmail(userId: string): Promise<string | null> {
    return runInTransaction(this.prisma, async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { email: true },
      });
      return user?.email ?? null;
    });
  }
}
