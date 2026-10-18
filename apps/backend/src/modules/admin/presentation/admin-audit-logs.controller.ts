import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import {
  listAuditLogsQuerySchema,
  ListAuditLogsQuery,
  AuditLogItem,
  AuditLogUserRef,
} from '@rescom/schemas';
import { AuditLogService } from '../application/audit-log.service';
import { AuditLog } from '../domain/audit-log.entity';
import { maskAuditMetadata } from '../application/audit-metadata-mask';
import { SessionAuthGuard } from '../../auth/presentation/guards/session-auth.guard';
import { RolesGuard } from '../../auth/presentation/guards/roles.guard';
import { Roles } from '../../auth/presentation/decorators';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe';
import { ParseUUIDPipe } from '../../../common/http/parse-uuid.pipe';
import { createSuccessEnvelope } from '../../../common/http/response.envelope';

function toUserRef(
  id: string | null | undefined,
  labels: Map<string, string | null>,
): AuditLogUserRef | null {
  if (!id) {
    return null;
  }
  const raw = labels.get(id);
  return {
    id,
    displayName: raw?.trim() || null,
  };
}

function toAuditLogResponse(
  log: AuditLog,
  labels: Map<string, string | null>,
): AuditLogItem {
  return {
    id: log.id,
    action: log.action,
    userId: log.userId,
    targetUserId: log.targetUserId,
    actor: toUserRef(log.userId, labels),
    targetUser: toUserRef(log.targetUserId, labels),
    outcome: log.outcome,
    errorCode: log.errorCode,
    metadata: maskAuditMetadata(log.metadata),
    createdAt: log.createdAt.toISOString(),
  };
}

@Controller(['admin/audit-logs', 'api/admin/audit-logs'])
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminAuditLogsController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @Get()
  @UsePipes(
    new ZodValidationPipe(
      listAuditLogsQuerySchema,
      'VALIDATION_ERROR',
      'query',
    ),
  )
  async listAuditLogs(@Query() query: ListAuditLogsQuery) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const { items, total } = await this.auditLogService.listAuditLogs({
      page,
      limit,
      action: query.action,
      userId: query.userId,
      targetUserId: query.targetUserId,
      outcome: query.outcome,
      startDate: query.startDate,
      endDate: query.endDate,
    });

    const labels = await this.auditLogService.displayLabels(items);
    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

    return createSuccessEnvelope({
      items: items.map((item) => toAuditLogResponse(item, labels)),
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
    });
  }

  @Get(':id')
  async getAuditLogById(@Param('id', ParseUUIDPipe) id: string) {
    const log = await this.auditLogService.getAuditLogById(id);
    const labels = await this.auditLogService.displayLabels([log]);
    return createSuccessEnvelope({
      auditLog: toAuditLogResponse(log, labels),
    });
  }
}
