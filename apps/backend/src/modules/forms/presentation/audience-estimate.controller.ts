import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Res,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  AudienceEstimateInput,
  audienceEstimateInputSchema,
} from '@rescom/schemas';
import {
  AudienceEstimateRateLimitedError,
  AudienceEstimateService,
} from '../application/audience-estimate.service';
import { SessionAuthGuard } from '../../auth/presentation/guards/session-auth.guard';
import { CsrfGuard } from '../../auth/presentation/guards/csrf.guard';
import { CurrentUser } from '../../auth/presentation/decorators';
import { AuthenticatedUser } from '../../auth/presentation/types/authenticated-request.type';
import { JsonOnlyGuard } from '../../../common/http/json-only.guard';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe';
import { createSuccessEnvelope } from '../../../common/http/response.envelope';

/**
 * Plan 5.5: Figma 9b "Người phù hợp ước tính". A read that carries a body,
 * so it is a POST with the same session + CSRF + JSON guards as every other
 * forms POST. Survey creation is not role-gated (`FormsController` has no
 * role check), so neither is this. Besides the global `default` throttler it
 * has its own per-user limit (30/hour, 429 `RATE_LIMIT_EXCEEDED` with
 * `Retry-After`). Exact small counts never leave the service.
 */
@Controller(['forms', 'api/forms'])
@UseGuards(SessionAuthGuard)
export class AudienceEstimateController {
  constructor(private readonly audienceEstimate: AudienceEstimateService) {}

  @Post('audience-estimate')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard, JsonOnlyGuard)
  @UsePipes(new ZodValidationPipe(audienceEstimateInputSchema))
  async estimate(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: AudienceEstimateInput,
    @Res({ passthrough: true }) response: Response,
  ) {
    try {
      return createSuccessEnvelope(
        await this.audienceEstimate.estimate(user.id, input.targeting),
      );
    } catch (error) {
      if (error instanceof AudienceEstimateRateLimitedError) {
        response.setHeader('Retry-After', String(error.retryAfterSeconds));
        throw new HttpException(
          {
            code: error.code,
            message: error.message,
            details: { retryAfterSeconds: error.retryAfterSeconds },
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      throw error;
    }
  }
}
