import {
  AuditLogRepositoryPort,
  ListAuditLogsParams,
  PaginatedAuditLogsResult,
} from './ports/audit-log-repository.port';
import { AuditLog } from '../domain/audit-log.entity';
import { AuditLogNotFoundException } from './exceptions/audit-log.exceptions';
import type { UserProfileRepositoryPort } from '../../users/application/ports/user-profile.repository.port';

export class AuditLogService {
  constructor(
    private readonly auditLogRepository: AuditLogRepositoryPort,
    private readonly profiles: Pick<
      UserProfileRepositoryPort,
      'findDisplayLabels'
    >,
  ) {}

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

  async displayLabels(logs: AuditLog[]): Promise<Map<string, string | null>> {
    const userIds = [
      ...new Set(
        logs
          .flatMap((log) => [log.userId, log.targetUserId])
          .filter(
            (id): id is string => typeof id === 'string' && id.length > 0,
          ),
      ),
    ];
    if (userIds.length === 0) {
      return new Map<string, string | null>();
    }
    return await this.profiles.findDisplayLabels(userIds);
  }
}
