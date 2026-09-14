import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/database/prisma.service';
import {
  AuditLogRepositoryPort,
  CreateAuditLogData,
  ListAuditLogsParams,
  PaginatedAuditLogsResult,
} from '../application/ports/audit-log-repository.port';
import { AuditLog } from '../domain/audit-log.entity';

@Injectable()
export class PrismaAuditLogRepository implements AuditLogRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async append(data: CreateAuditLogData): Promise<AuditLog> {
    const raw = await this.prisma.identityAuditLog.create({
      data: {
        action: data.action,
        userId: data.userId ?? null,
        targetUserId: data.targetUserId ?? null,
        outcome: data.outcome,
        errorCode: data.errorCode ?? null,
        metadata: data.metadata as Prisma.InputJsonValue,
      },
    });

    return new AuditLog({
      id: raw.id,
      action: raw.action,
      userId: raw.userId,
      targetUserId: raw.targetUserId,
      outcome: raw.outcome === 'FAILURE' ? 'FAILURE' : 'SUCCESS',
      errorCode: raw.errorCode,
      metadata: raw.metadata as Record<string, unknown> | null,
      createdAt: raw.createdAt,
    });
  }

  async findMany(
    params: ListAuditLogsParams,
  ): Promise<PaginatedAuditLogsResult> {
    const page = Math.max(1, params.page);
    const limit = Math.max(1, params.limit);
    const skip = (page - 1) * limit;

    const where: Prisma.IdentityAuditLogWhereInput = {};

    if (params.action) {
      where.action = params.action.trim();
    }

    if (params.userId) {
      where.userId = params.userId;
    }

    if (params.targetUserId) {
      where.targetUserId = params.targetUserId;
    }

    if (params.outcome) {
      where.outcome = params.outcome;
    }

    if (params.startDate || params.endDate) {
      where.createdAt = {};
      if (params.startDate) {
        const start = new Date(params.startDate);
        if (!isNaN(start.getTime())) {
          where.createdAt.gte = start;
        }
      }
      if (params.endDate) {
        const end = new Date(params.endDate);
        if (!isNaN(end.getTime())) {
          where.createdAt.lte = end;
        }
      }
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.identityAuditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.identityAuditLog.count({ where }),
    ]);

    return {
      items: items.map(
        (raw) =>
          new AuditLog({
            id: raw.id,
            action: raw.action,
            userId: raw.userId,
            targetUserId: raw.targetUserId,
            outcome: raw.outcome as 'SUCCESS' | 'FAILURE',
            errorCode: raw.errorCode,
            metadata: raw.metadata as Record<string, unknown> | null,
            createdAt: raw.createdAt,
          }),
      ),
      total,
    };
  }

  async findById(id: string): Promise<AuditLog | null> {
    const raw = await this.prisma.identityAuditLog.findUnique({
      where: { id },
    });

    if (!raw) {
      return null;
    }

    return new AuditLog({
      id: raw.id,
      action: raw.action,
      userId: raw.userId,
      targetUserId: raw.targetUserId,
      outcome: raw.outcome === 'FAILURE' ? 'FAILURE' : 'SUCCESS',
      errorCode: raw.errorCode,
      metadata: raw.metadata as Record<string, unknown> | null,
      createdAt: raw.createdAt,
    });
  }
}
