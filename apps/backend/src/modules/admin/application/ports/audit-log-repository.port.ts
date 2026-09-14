import { AuditLog } from '../../domain/audit-log.entity';

export interface ListAuditLogsParams {
  page: number;
  limit: number;
  action?: string;
  userId?: string;
  targetUserId?: string;
  outcome?: 'SUCCESS' | 'FAILURE';
  startDate?: string;
  endDate?: string;
}

export interface PaginatedAuditLogsResult {
  items: AuditLog[];
  total: number;
}

export interface CreateAuditLogData {
  action: string;
  userId?: string | null;
  targetUserId?: string | null;
  outcome: 'SUCCESS' | 'FAILURE';
  errorCode?: string | null;
  metadata?: Record<string, unknown> | unknown[] | null;
  createdAt?: Date;
}

export interface AuditLogRepositoryPort {
  append(data: CreateAuditLogData): Promise<AuditLog>;
  findMany(params: ListAuditLogsParams): Promise<PaginatedAuditLogsResult>;
  findById(id: string): Promise<AuditLog | null>;
}

export const AUDIT_LOG_REPOSITORY_PORT = Symbol('AuditLogRepositoryPort');
