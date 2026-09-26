import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  submitSurveyFeedbackInputSchema,
  type SubmitSurveyFeedbackCommand,
} from '@rescom/schemas';
import { SurveyFeedbackService } from '../application/survey-feedback.service';
import { SessionAuthGuard } from '../../auth/presentation/guards/session-auth.guard';
import { CsrfGuard } from '../../auth/presentation/guards/csrf.guard';
import { CurrentUser } from '../../auth/presentation/decorators';
import { AuthenticatedUser } from '../../auth/presentation/types/authenticated-request.type';
import { JsonOnlyGuard } from '../../../common/http/json-only.guard';
import { ParseUUIDPipe } from '../../../common/http/parse-uuid.pipe';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe';
import { createSuccessEnvelope } from '../../../common/http/response.envelope';

/**
 * Story 9.2 (FR-43): the Respondent's post-completion feedback on their own
 * completed attempt. There is deliberately no Publisher/Admin read endpoint in
 * Phase 1 (Publisher-visible feedback is Story 9.3).
 */
@Controller([
  'attempts/:attemptId/feedback',
  'api/attempts/:attemptId/feedback',
])
@UseGuards(SessionAuthGuard)
export class SurveyFeedbackController {
  constructor(private readonly surveyFeedbackService: SurveyFeedbackService) {}

  @Get()
  async getStatus(
    @Param('attemptId', ParseUUIDPipe) attemptId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.surveyFeedbackService.getFeedbackStatus(
      attemptId,
      user.id,
    );
    return createSuccessEnvelope(result);
  }

  /** 200 for both a new feedback and an identical replay (`replayed`). */
  @Post()
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard, JsonOnlyGuard)
  async submit(
    @Param('attemptId', ParseUUIDPipe) attemptId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(submitSurveyFeedbackInputSchema))
    body: SubmitSurveyFeedbackCommand,
  ) {
    const result = await this.surveyFeedbackService.submitFeedback(
      attemptId,
      user.id,
      body,
    );
    return createSuccessEnvelope(result);
  }
}
