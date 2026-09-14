import { randomUUID } from 'crypto';
import {
  AuditLogRepositoryPort,
  CreateAuditLogData,
  ListAuditLogsParams,
  PaginatedAuditLogsResult,
} from '../application/ports/audit-log-repository.port';
import { AuditLog } from '../domain/audit-log.entity';

export class InMemoryAuditLogRepository implements AuditLogRepositoryPort {
  private logs: AuditLog[] = [];

  async append(data: CreateAuditLogData): Promise<AuditLog> {
    const log = new AuditLog({
      id: randomUUID(),
      action: data.action,
      userId: data.userId ?? null,
      targetUserId: data.targetUserId ?? null,
      outcome: data.outcome,
      errorCode: data.errorCode ?? null,
      metadata: data.metadata ?? null,
      createdAt: data.createdAt ?? new Date(),
    });

    this.logs.push(log);
    return log;
  }

  async findMany(
    params: ListAuditLogsParams,
  ): Promise<PaginatedAuditLogsResult> {
    let filtered = [...this.logs];

    if (params.action) {
      filtered = filtered.filter((log) => log.action === params.action!.trim());
    }

    if (params.userId) {
      filtered = filtered.filter((log) => log.userId === params.userId);
    }

    if (params.targetUserId) {
      filtered = filtered.filter(
        (log) => log.targetUserId === params.targetUserId,
      );
    }

    if (params.outcome) {
      filtered = filtered.filter((log) => log.outcome === params.outcome);
    }

    if (params.startDate) {
      const start = new Date(params.startDate).getTime();
      if (!isNaN(start)) {
        filtered = filtered.filter((log) => log.createdAt.getTime() >= start);
      }
    }

    if (params.endDate) {
      const end = new Date(params.endDate).getTime();
      if (!isNaN(end)) {
        filtered = filtered.filter((log) => log.createdAt.getTime() <= end);
      }
    }

    // Sort createdAt DESC
    filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const total = filtered.length;
    const page = Math.max(1, params.page);
    const limit = Math.max(1, params.limit);
    const skip = (page - 1) * limit;

    const items = filtered.slice(skip, skip + limit);

    return {
      items,
      total,
    };
  }

  async findById(id: string): Promise<AuditLog | null> {
    const found = this.logs.find((log) => log.id === id);
    return found ?? null;
  }
}
