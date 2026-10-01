import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  cancelAttemptRequestSchema,
  idempotencyKeySchema,
  type CancelAttemptRequest,
} from '@rescom/schemas';
import { SurveyRunnerReadService } from '../application/survey-runner-read.service';
import { SessionAuthGuard } from '../../auth/presentation/guards/session-auth.guard';
import { CsrfGuard } from '../../auth/presentation/guards/csrf.guard';
import { CurrentUser } from '../../auth/presentation/decorators';
import { AuthenticatedUser } from '../../auth/presentation/types/authenticated-request.type';
import { JsonOnlyGuard } from '../../../common/http/json-only.guard';
import { ParseUUIDPipe } from '../../../common/http/parse-uuid.pipe';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe';
import { createSuccessEnvelope } from '../../../common/http/response.envelope';
import { Public } from '../../../common/security/public.decorator';

/**
 * Story IR.2a: the Respondent reads of the survey runner (API-01..API-05)
 * and its cancel command (API-03). Kept apart from `ParticipationController`
 * (commands). The attempt routes are owner-only and per-user private
 * (`Cache-Control: no-store`); there is no Admin read path.
 */
@Controller(['', 'api'])
@UseGuards(SessionAuthGuard)
export class SurveyRunnerController {
  constructor(
    private readonly surveyRunnerReadService: SurveyRunnerReadService,
  ) {}

  /** API-01: public facts; a session is optional and never changes the body. */
  @Get('surveys/:id')
  @Public()
  async getSurveySummary(@Param('id', ParseUUIDPipe) surveyId: string) {
    const result =
      await this.surveyRunnerReadService.getSurveySummary(surveyId);
    return createSuccessEnvelope(result);
  }

  /** API-02 + API-05: the attempt with its pinned Form Definition. */
  @Get('attempts/:attemptId')
  @Header('Cache-Control', 'no-store')
  async getAttempt(
    @Param('attemptId', ParseUUIDPipe) attemptId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.surveyRunnerReadService.getAttemptDetails(
      attemptId,
      user.id,
    );
    return createSuccessEnvelope(result);
  }

  /** API-04: the reward outcome, read from posted Ledger journals only. */
  @Get('attempts/:attemptId/outcome')
  @Header('Cache-Control', 'no-store')
  async getAttemptOutcome(
    @Param('attemptId', ParseUUIDPipe) attemptId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.surveyRunnerReadService.getAttemptOutcome(
      attemptId,
      user.id,
    );
    return createSuccessEnvelope(result);
  }

  /**
   * API-03: 200 for a new cancel and for a replay (original `closedAt`). The
   * `Idempotency-Key` is required and validated; replay is state-based, so
   * the key is not stored (decision Q4).
   */
  @Post('attempts/:attemptId/cancel')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard, JsonOnlyGuard)
  async cancelAttempt(
    @Param('attemptId', ParseUUIDPipe) attemptId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(cancelAttemptRequestSchema))
    _body: CancelAttemptRequest,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const key = idempotencyKeySchema.safeParse(idempotencyKey ?? '');
    if (!key.success) {
      throw new BadRequestException({
        code: 'INVALID_IDEMPOTENCY_KEY',
        message: key.error.errors[0]?.message ?? 'Invalid Idempotency-Key',
      });
    }
    const result = await this.surveyRunnerReadService.cancelAttempt(
      attemptId,
      user.id,
    );
    return createSuccessEnvelope(result);
  }
}
