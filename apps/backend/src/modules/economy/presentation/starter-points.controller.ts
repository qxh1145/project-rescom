import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import {
  ExpireStarterPointsInput,
  expireStarterPointsSchema,
} from '@rescom/schemas';
import { SessionAuthGuard } from '../../auth/presentation/guards/session-auth.guard';
import { RolesGuard } from '../../auth/presentation/guards/roles.guard';
import { CsrfGuard } from '../../auth/presentation/guards/csrf.guard';
import { JsonOnlyGuard } from '../../../common/http/json-only.guard';
import { CurrentUser, Roles } from '../../auth/presentation/decorators';
import { AuthenticatedUser } from '../../auth/presentation/types/authenticated-request.type';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe';
import { createSuccessEnvelope } from '../../../common/http/response.envelope';
import { StarterPointsCoordinator } from '../application/starter-points.coordinator';

@Controller(['economy/starter-points', 'api/economy/starter-points'])
@UseGuards(SessionAuthGuard)
export class StarterPointsController {
  constructor(
    private readonly starterPointsCoordinator: StarterPointsCoordinator,
  ) {}

  /**
   * Retrieves the current user's starter points status and onboarding progress (FR-4, FR-5, FR-8).
   */
  @Get('status')
  async getStatus(@CurrentUser() user: AuthenticatedUser) {
    const status = await this.starterPointsCoordinator.getStatus(user.id);
    return createSuccessEnvelope(status);
  }

  /**
   * Evaluates onboarding progress and unlocks 100 starter points to Available if eligible (FR-8).
   */
  @Post('unlock')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  async unlock(@CurrentUser() user: AuthenticatedUser) {
    const result =
      await this.starterPointsCoordinator.checkAndUnlockStarterPoints(user.id);
    return createSuccessEnvelope(result);
  }

  /**
   * Admin batch endpoint to void unmatured frozen points past 30 days (FR-5).
   * Scans at most `limit` candidates per call; repeat with `after: nextCursor`
   * until `nextCursor` is null. Since Story IR.2b the `starter-expiry`
   * scheduler job runs the same sweep hourly; this stays the operator fallback.
   */
  @Post('expire')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard, CsrfGuard, JsonOnlyGuard)
  @Roles('ADMIN')
  @UsePipes(new ZodValidationPipe(expireStarterPointsSchema))
  async expire(@Body() body?: ExpireStarterPointsInput) {
    const cutoffDate = body?.cutoffDate ? new Date(body.cutoffDate) : undefined;
    const result =
      await this.starterPointsCoordinator.expireUnmaturedStarterPoints(
        cutoffDate,
        { limit: body?.limit, after: body?.after },
      );
    return createSuccessEnvelope(result);
  }
}
