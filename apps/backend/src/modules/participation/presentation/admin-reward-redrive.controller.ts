import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { rewardRedriveRequestSchema } from '@rescom/schemas';
import { SessionAuthGuard } from '../../auth/presentation/guards/session-auth.guard';
import { RolesGuard } from '../../auth/presentation/guards/roles.guard';
import { CsrfGuard } from '../../auth/presentation/guards/csrf.guard';
import { Roles } from '../../auth/presentation/decorators';
import { JsonOnlyGuard } from '../../../common/http/json-only.guard';
import { ParseUUIDPipe } from '../../../common/http/parse-uuid.pipe';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe';
import { createSuccessEnvelope } from '../../../common/http/response.envelope';
import { ParticipationService } from '../application/participation.service';

/**
 * Admin re-drive of survey rewards (Story 6.4 AC7.1/7.2, Epic 6 review P1).
 *
 * The routes keep their Story 6.4 paths but are Admin-only and take an empty
 * body: the publisher, respondent, amount and policy mode are derived
 * server-side from the committed completion (the pinned Internal reward
 * request, the completed External attempt and its form), so nobody can move
 * a Publisher's Escrow with request parameters. Participation owns the
 * lookup, which is why the controller lives in this module (Economy cannot
 * import Participation without a cycle). Every call is idempotent.
 */
@Controller(['economy/rewards', 'api/economy/rewards'])
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminRewardRedriveController {
  constructor(private readonly participationService: ParticipationService) {}

  @Post('internal/:responseId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard, JsonOnlyGuard)
  async redriveInternalReward(
    @Param('responseId', ParseUUIDPipe) responseId: string,
    @Body(new ZodValidationPipe(rewardRedriveRequestSchema)) _body: unknown,
  ) {
    const result =
      await this.participationService.redriveInternalReward(responseId);
    return createSuccessEnvelope(result.reward);
  }

  @Post('external/:attemptId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard, JsonOnlyGuard)
  async redriveExternalReward(
    @Param('attemptId', ParseUUIDPipe) attemptId: string,
    @Body(new ZodValidationPipe(rewardRedriveRequestSchema)) _body: unknown,
  ) {
    const reward =
      await this.participationService.redriveExternalReward(attemptId);
    return createSuccessEnvelope(reward);
  }
}
