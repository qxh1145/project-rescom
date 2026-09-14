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
} from '@rescom/schemas';
import { AuditLogService } from '../application/audit-log.service';
import { AuditLog } from '../domain/audit-log.entity';
import { SessionAuthGuard } from '../../auth/presentation/guards/session-auth.guard';
import { RolesGuard } from '../../auth/presentation/guards/roles.guard';
import { Roles } from '../../auth/presentation/decorators';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe';
import { ParseUUIDPipe } from '../../../common/http/parse-uuid.pipe';
import { createSuccessEnvelope } from '../../../common/http/response.envelope';

function toAuditLogResponse(log: AuditLog): AuditLogItem {
  return {
    id: log.id,
    action: log.action,
    userId: log.userId,
    targetUserId: log.targetUserId,
    outcome: log.outcome,
    errorCode: log.errorCode,
    metadata: log.metadata,
    createdAt: log.createdAt.toISOString(),
  };
}

@Controller('admin/audit-logs')
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

    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

    return createSuccessEnvelope({
      items: items.map(toAuditLogResponse),
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
    return createSuccessEnvelope({
      auditLog: toAuditLogResponse(log),
    });
  }
}
