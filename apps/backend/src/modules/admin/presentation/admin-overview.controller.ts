import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import type { AdminOverview, AdminQueueCounts } from '@rescom/schemas';
import { AdminOverviewService } from '../application/admin-overview.service';
import { SessionAuthGuard } from '../../auth/presentation/guards/session-auth.guard';
import { RolesGuard } from '../../auth/presentation/guards/roles.guard';
import { Roles } from '../../auth/presentation/decorators';
import {
  ApiResponse,
  createSuccessEnvelope,
} from '../../../common/http/response.envelope';

/**
 * Story IR.4b part C (mock-off plan 4.1): the admin landing page and the
 * sidebar badges. Contracts: `adminOverviewSchema`, `adminQueueCountsSchema`.
 */
@Controller(['admin', 'api/admin'])
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminOverviewController {
  constructor(private readonly overviewService: AdminOverviewService) {}

  @Get('queue-counts')
  @Header('Cache-Control', 'no-store')
  async getQueueCounts(): Promise<ApiResponse<AdminQueueCounts>> {
    return createSuccessEnvelope(await this.overviewService.getQueueCounts());
  }

  @Get('overview')
  @Header('Cache-Control', 'no-store')
  async getOverview(): Promise<ApiResponse<AdminOverview>> {
    return createSuccessEnvelope(await this.overviewService.getOverview());
  }
}
