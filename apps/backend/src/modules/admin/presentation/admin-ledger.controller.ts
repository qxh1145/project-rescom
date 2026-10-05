import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import {
  AdminJournalList,
  AdminLedgerSummary,
  ListAdminJournalsQuery,
  listAdminJournalsQuerySchema,
} from '@rescom/schemas';
import { AdminLedgerService } from '../application/admin-ledger.service';
import { SessionAuthGuard } from '../../auth/presentation/guards/session-auth.guard';
import { RolesGuard } from '../../auth/presentation/guards/roles.guard';
import { Roles } from '../../auth/presentation/decorators';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe';
import {
  ApiResponse,
  createSuccessEnvelope,
} from '../../../common/http/response.envelope';

/**
 * Admin ledger view (mock-off plan 4.3). Contracts:
 * `listAdminJournalsQuerySchema` → `adminJournalListSchema`, and
 * `adminLedgerSummarySchema`.
 */
@Controller(['admin/ledger', 'api/admin/ledger'])
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminLedgerController {
  constructor(private readonly ledgerService: AdminLedgerService) {}

  @Get('journals')
  @Header('Cache-Control', 'no-store')
  async listJournals(
    @Query(
      new ZodValidationPipe(
        listAdminJournalsQuerySchema,
        'VALIDATION_ERROR',
        'query',
      ),
    )
    query: ListAdminJournalsQuery,
  ): Promise<ApiResponse<AdminJournalList>> {
    return createSuccessEnvelope(await this.ledgerService.listJournals(query));
  }

  @Get('summary')
  @Header('Cache-Control', 'no-store')
  async getSummary(): Promise<ApiResponse<AdminLedgerSummary>> {
    return createSuccessEnvelope(await this.ledgerService.getSummary());
  }
}
