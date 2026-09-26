import { Injectable } from '@nestjs/common';
import { Prisma, TopUpRequest as TopUpRequestRow } from '@prisma/client';
import { PrismaService } from '../../../common/database/prisma.service';
import { runInTransaction } from '../../../common/database/prisma-unit-of-work';
import { TopUpRequestEntity } from '../domain/top-up-request.entity';
import {
  CreatePendingTopUpResult,
  ListTopUpsForReviewParams,
  ListUserTopUpsParams,
  TopUpAdminAuditOutboxEvent,
  TopUpPage,
  TopUpRepositoryPort,
  TopUpReviewRecord,
} from '../application/ports/top-up-repository.port';
import { TopUpReferenceConflictException } from '../application/exceptions/economy.exceptions';

type TopUpRowWithEmail = TopUpRequestRow & {
  user?: { email: string } | null;
};

/**
 * PostgreSQL persistence for manual top-ups (Story 6.6). Every write joins the
 * caller's shared Unit of Work when one is open (AD-16), so a review decision,
 * its Ledger journal and its Outbox audit event commit or roll back together.
 */
@Injectable()
export class PrismaTopUpRepository implements TopUpRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async createPending(
    request: TopUpRequestEntity,
    maxPendingRequests: number,
  ): Promise<CreatePendingTopUpResult> {
    try {
      return await runInTransaction(this.prisma, async (tx) => {
        // Serialise creations per user so the pending limit cannot be raced.
        await tx.$queryRaw`
          SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${`top-up:${request.userId}`}))
        `;
        const pendingCount = await tx.topUpRequest.count({
          where: { userId: request.userId, status: 'PENDING' },
        });
        if (pendingCount >= maxPendingRequests) {
          return { outcome: 'LIMIT_REACHED' as const, pendingCount };
        }

        const created = await tx.topUpRequest.create({
          data: {
            id: request.id,
            userId: request.userId,
            amount: request.amount,
            amountVnd: request.amountVnd,
            transferReference: request.transferReference,
            status: 'PENDING',
            createdAt: request.createdAt,
          },
        });
        return { outcome: 'CREATED' as const, request: toEntity(created) };
      });
    } catch (error) {
      if (isTransferReferenceConflict(error)) {
        throw new TopUpReferenceConflictException();
      }
      throw error;
    }
  }

  async findById(id: string): Promise<TopUpRequestEntity | null> {
    const row = await this.prisma.topUpRequest.findUnique({ where: { id } });
    return row ? toEntity(row) : null;
  }

  async findByIdForUpdate(id: string): Promise<TopUpRequestEntity | null> {
    return runInTransaction(this.prisma, async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM top_up_requests WHERE id = ${id}::uuid FOR UPDATE
      `;
      const row = await tx.topUpRequest.findUnique({ where: { id } });
      return row ? toEntity(row) : null;
    });
  }

  async findReviewRecordById(id: string): Promise<TopUpReviewRecord | null> {
    const row = await this.prisma.topUpRequest.findUnique({
      where: { id },
      include: { user: { select: { email: true } } },
    });
    return row ? toReviewRecord(row) : null;
  }

  async listByUser(
    userId: string,
    params: ListUserTopUpsParams,
  ): Promise<TopUpPage<TopUpRequestEntity>> {
    const where: Prisma.TopUpRequestWhereInput = {
      userId,
      ...(params.status ? { status: params.status } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.topUpRequest.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: params.offset,
        take: params.limit,
      }),
      this.prisma.topUpRequest.count({ where }),
    ]);
    return { items: rows.map(toEntity), total };
  }

  async listForReview(
    params: ListTopUpsForReviewParams,
  ): Promise<TopUpPage<TopUpReviewRecord>> {
    const where: Prisma.TopUpRequestWhereInput = { status: params.status };
    const direction = params.status === 'PENDING' ? 'asc' : 'desc';
    const [rows, total] = await Promise.all([
      this.prisma.topUpRequest.findMany({
        where,
        include: { user: { select: { email: true } } },
        orderBy: [{ createdAt: direction }, { id: direction }],
        skip: params.offset,
        take: params.limit,
      }),
      this.prisma.topUpRequest.count({ where }),
    ]);
    return { items: rows.map(toReviewRecord), total };
  }

  async saveReviewDecision(
    decision: TopUpRequestEntity,
    auditEvent: TopUpAdminAuditOutboxEvent,
  ): Promise<TopUpRequestEntity | null> {
    return runInTransaction(this.prisma, async (tx) => {
      // Conditional transition: only a row that is still PENDING moves.
      const transitioned = await tx.topUpRequest.updateMany({
        where: { id: decision.id, status: 'PENDING' },
        data: {
          status: decision.status,
          adminId: decision.adminId,
          journalId: decision.journalId,
          rejectionReason: decision.rejectionReason,
          correlationId: decision.correlationId,
          reviewedAt: decision.reviewedAt,
        },
      });
      if (transitioned.count === 0) {
        return null;
      }

      // Replayable Moderation admin-audit event, same transaction (AD-16).
      await tx.outboxEvent.create({
        data: {
          id: auditEvent.id,
          idempotencyKey: auditEvent.idempotencyKey,
          eventType: auditEvent.eventType,
          schemaVersion: auditEvent.payload.schemaVersion,
          producer: auditEvent.producer,
          aggregateType: auditEvent.aggregateType,
          aggregateId: auditEvent.aggregateId,
          aggregateVersion: auditEvent.aggregateVersion,
          correlationId: auditEvent.correlationId,
          status: 'PENDING',
          payload: auditEvent.payload as unknown as Prisma.InputJsonValue,
        },
      });

      const updated = await tx.topUpRequest.findUniqueOrThrow({
        where: { id: decision.id },
      });
      return toEntity(updated);
    });
  }
}

function toEntity(row: TopUpRequestRow): TopUpRequestEntity {
  return new TopUpRequestEntity({
    id: row.id,
    userId: row.userId,
    amount: row.amount,
    amountVnd: row.amountVnd,
    transferReference: row.transferReference,
    status: row.status,
    adminId: row.adminId,
    journalId: row.journalId,
    rejectionReason: row.rejectionReason,
    correlationId: row.correlationId,
    reviewedAt: row.reviewedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function toReviewRecord(row: TopUpRowWithEmail): TopUpReviewRecord {
  return { request: toEntity(row), userEmail: row.user?.email ?? null };
}

/** P2002 on the transfer reference (Prisma reports columns or field names). */
function isTransferReferenceConflict(error: unknown): boolean {
  if (
    !error ||
    typeof error !== 'object' ||
    (error as { code?: unknown }).code !== 'P2002'
  ) {
    return false;
  }
  const target = (error as { meta?: { target?: unknown } }).meta?.target;
  const fields = Array.isArray(target) ? target.map(String) : [String(target)];
  return fields.some(
    (field) =>
      field.includes('transfer_reference') ||
      field.includes('transferReference'),
  );
}
