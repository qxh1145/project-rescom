import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import {
  ListMissingCodeReportsQuery,
  MissingCodeReportPage,
  listMissingCodeReportsQuerySchema,
} from '@rescom/schemas';
import { AdminMissingCodeReportsService } from '../application/admin-missing-code-reports.service';
import { SessionAuthGuard } from '../../auth/presentation/guards/session-auth.guard';
import { RolesGuard } from '../../auth/presentation/guards/roles.guard';
import { Roles } from '../../auth/presentation/decorators';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe';
import {
  ApiResponse,
  createSuccessEnvelope,
} from '../../../common/http/response.envelope';

/** Admin · open missing-code reports, read only. Contract: `missingCodeReportPageSchema`. */
@Controller(['admin/missing-code-reports', 'api/admin/missing-code-reports'])
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminMissingCodeReportsController {
  constructor(private readonly service: AdminMissingCodeReportsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async list(
    @Query(
      new ZodValidationPipe(
        listMissingCodeReportsQuerySchema,
        'VALIDATION_ERROR',
        'query',
      ),
    )
    query: ListMissingCodeReportsQuery,
  ): Promise<ApiResponse<MissingCodeReportPage>> {
    return createSuccessEnvelope(await this.service.list(query));
  }
}
