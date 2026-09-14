import {
  AuditLogRepositoryPort,
  ListAuditLogsParams,
  PaginatedAuditLogsResult,
} from './ports/audit-log-repository.port';
import { AuditLog } from '../domain/audit-log.entity';
import { AuditLogNotFoundException } from './exceptions/audit-log.exceptions';

export class AuditLogService {
  constructor(private readonly auditLogRepository: AuditLogRepositoryPort) {}

  async listAuditLogs(
    params: ListAuditLogsParams,
  ): Promise<PaginatedAuditLogsResult> {
    return await this.auditLogRepository.findMany(params);
  }

  async getAuditLogById(id: string): Promise<AuditLog> {
    const log = await this.auditLogRepository.findById(id);
    if (!log) {
      throw new AuditLogNotFoundException(id);
    }
    return log;
  }
}
