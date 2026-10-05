import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import {
  FraudLogPage,
  ListFraudLogQuery,
  listFraudLogQuerySchema,
} from '@rescom/schemas';
import { AdminFraudLogService } from '../application/admin-fraud-log.service';
import { SessionAuthGuard } from '../../auth/presentation/guards/session-auth.guard';
import { RolesGuard } from '../../auth/presentation/guards/roles.guard';
import { Roles } from '../../auth/presentation/decorators';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe';
import {
  ApiResponse,
  createSuccessEnvelope,
} from '../../../common/http/response.envelope';

/**
 * Admin · FraudLog (mock-off plan 4.2), read only. Contract:
 * `listFraudLogQuerySchema` → `fraudLogPageSchema`.
 */
@Controller(['admin/fraud-log', 'api/admin/fraud-log'])
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminFraudLogController {
  constructor(private readonly fraudLogService: AdminFraudLogService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async list(
    @Query(
      new ZodValidationPipe(
        listFraudLogQuerySchema,
        'VALIDATION_ERROR',
        'query',
      ),
    )
    query: ListFraudLogQuery,
  ): Promise<ApiResponse<FraudLogPage>> {
    return createSuccessEnvelope(await this.fraudLogService.list(query));
  }
}
