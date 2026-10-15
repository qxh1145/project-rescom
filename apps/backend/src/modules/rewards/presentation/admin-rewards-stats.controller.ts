import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import { rewardsStatsQuerySchema, RewardsStatsQueryDto } from '@rescom/schemas';
import { RewardsEnabledGuard } from './rewards-enabled.guard';
import { SessionAuthGuard } from '../../auth/presentation/guards/session-auth.guard';
import { RolesGuard } from '../../auth/presentation/guards/roles.guard';
import { Roles } from '../../auth/presentation/decorators';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe';
import { createSuccessEnvelope } from '../../../common/http/response.envelope';
import { RewardsAdminStatsService } from '../application/rewards-admin-stats.service';

@Controller(['admin/rewards', 'api/admin/rewards'])
@UseGuards(RewardsEnabledGuard, SessionAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminRewardsStatsController {
  constructor(private readonly statsService: RewardsAdminStatsService) {}

  @Get('stats')
  @Header('Cache-Control', 'no-store')
  async getStats(
    @Query(
      new ZodValidationPipe(
        rewardsStatsQuerySchema,
        'VALIDATION_ERROR',
        'query',
      ),
    )
    query: RewardsStatsQueryDto,
  ) {
    const stats = await this.statsService.getStats(query);
    return createSuccessEnvelope(stats);
  }
}
