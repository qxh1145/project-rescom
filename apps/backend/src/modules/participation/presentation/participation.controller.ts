import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { Request } from 'express';
import {
  startSurveyAttemptInputSchema,
  StartSurveyAttemptInput,
  batchTelemetryEventsInputSchema,
  BatchTelemetryEventsInput,
  internalFormSubmissionInputSchema,
  InternalFormSubmissionInput,
  verifyExternalCompletionCodeInputSchema,
  VerifyExternalCompletionCodeInput,
  reportMissingCompletionCodeInputSchema,
  ReportMissingCompletionCodeInput,
} from '@rescom/schemas';
import { ParticipationService } from '../application/participation.service';
import { SessionAuthGuard } from '../../auth/presentation/guards/session-auth.guard';
import { CsrfGuard } from '../../auth/presentation/guards/csrf.guard';
import { OptionalSessionCsrfGuard } from '../../auth/presentation/guards/optional-session-csrf.guard';
import { CurrentUser } from '../../auth/presentation/decorators';
import { AuthenticatedUser } from '../../auth/presentation/types/authenticated-request.type';
import { JsonOnlyGuard } from '../../../common/http/json-only.guard';
import { ParseUUIDPipe } from '../../../common/http/parse-uuid.pipe';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe';
import { createSuccessEnvelope } from '../../../common/http/response.envelope';
import { Public } from '../../../common/security/public.decorator';

@Controller()
@UseGuards(SessionAuthGuard)
export class ParticipationController {
  constructor(private readonly participationService: ParticipationService) {}

  @Post('forms/:id/attempts')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(CsrfGuard, JsonOnlyGuard)
  @UsePipes(new ZodValidationPipe(startSurveyAttemptInputSchema))
  async startFormAttempt(
    @Param('id', ParseUUIDPipe) formId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: StartSurveyAttemptInput,
    @Req() req: Request,
  ) {
    const clientIp = req.ip || req.socket.remoteAddress || '127.0.0.1';
    const result = await this.participationService.startAttempt(
      formId,
      user.id,
      body ?? {},
      clientIp,
    );
    return createSuccessEnvelope(result);
  }

  @Post('surveys/:id/attempts')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(CsrfGuard, JsonOnlyGuard)
  @UsePipes(new ZodValidationPipe(startSurveyAttemptInputSchema))
  async startSurveyAttempt(
    @Param('id', ParseUUIDPipe) formId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: StartSurveyAttemptInput,
    @Req() req: Request,
  ) {
    return this.startFormAttempt(formId, user, body, req);
  }

  @Post('forms/:id/attempts/:attemptId/integrity-events')
  @HttpCode(HttpStatus.OK)
  @Public()
  @UseGuards(JsonOnlyGuard)
  @UsePipes(new ZodValidationPipe(batchTelemetryEventsInputSchema))
  async ingestFormAttemptTelemetry(
    @Param('id', ParseUUIDPipe) formId: string,
    @Param('attemptId', ParseUUIDPipe) attemptId: string,
    @Body() body: BatchTelemetryEventsInput,
    @Req() req: Request,
    @Headers('x-storage-capability') capability?: string,
  ) {
    // Epic 5 review P8: the owner's session, or a guest's attempt capability.
    const callerUserId = (req as any).user?.id ?? null;
    const result = await this.participationService.recordTelemetryEvents(
      formId,
      attemptId,
      callerUserId,
      body,
      capability ?? null,
    );
    return createSuccessEnvelope(result);
  }

  @Post('surveys/:id/attempts/:attemptId/integrity-events')
  @HttpCode(HttpStatus.OK)
  @Public()
  @UseGuards(JsonOnlyGuard)
  @UsePipes(new ZodValidationPipe(batchTelemetryEventsInputSchema))
  async ingestSurveyAttemptTelemetry(
    @Param('id', ParseUUIDPipe) formId: string,
    @Param('attemptId', ParseUUIDPipe) attemptId: string,
    @Body() body: BatchTelemetryEventsInput,
    @Req() req: Request,
    @Headers('x-storage-capability') capability?: string,
  ) {
    return this.ingestFormAttemptTelemetry(
      formId,
      attemptId,
      body,
      req,
      capability,
    );
  }

  @Post('responses/:responseId/integrity-events')
  @HttpCode(HttpStatus.OK)
  @Public()
  @UseGuards(JsonOnlyGuard)
  @UsePipes(new ZodValidationPipe(batchTelemetryEventsInputSchema))
  async ingestResponseTelemetry(
    @Param('responseId', ParseUUIDPipe) responseId: string,
    @Body() body: BatchTelemetryEventsInput,
    @Req() req: Request,
    @Headers('x-storage-capability') capability?: string,
  ) {
    const callerUserId = (req as any).user?.id ?? null;
    const result =
      await this.participationService.recordResponseTelemetryEvents(
        responseId,
        callerUserId,
        body,
        capability ?? null,
      );
    return createSuccessEnvelope(result);
  }

  @Post('responses/:responseId/submit')
  @HttpCode(HttpStatus.OK)
  @Public()
  // Epic 5 review P12 (AD-20): the session's CSRF token, or an allowed
  // Origin for a guest.
  @UseGuards(OptionalSessionCsrfGuard, JsonOnlyGuard)
  @UsePipes(new ZodValidationPipe(internalFormSubmissionInputSchema))
  async submitResponse(
    @Param('responseId', ParseUUIDPipe) responseId: string,
    @Body() body: InternalFormSubmissionInput,
    @Req() req: Request,
  ) {
    const callerUserId = (req as any).user?.id ?? null;
    const result = await this.participationService.submitInternalResponse(
      responseId,
      callerUserId,
      body,
      true,
    );
    return createSuccessEnvelope(result);
  }

  @Post('forms/:id/submissions')
  @HttpCode(HttpStatus.OK)
  @Public()
  // Epic 5 review P12 (AD-20): the session's CSRF token, or an allowed
  // Origin for a guest.
  @UseGuards(OptionalSessionCsrfGuard, JsonOnlyGuard)
  @UsePipes(new ZodValidationPipe(internalFormSubmissionInputSchema))
  async submitForm(
    @Param('id', ParseUUIDPipe) formId: string,
    @Body() body: InternalFormSubmissionInput,
    @Req() req: Request,
  ) {
    const callerUserId = (req as any).user?.id ?? null;
    const result = await this.participationService.submitInternalResponse(
      formId,
      callerUserId,
      body,
      false,
    );
    return createSuccessEnvelope(result);
  }

  @Post('surveys/:id/submissions')
  @HttpCode(HttpStatus.OK)
  @Public()
  // Epic 5 review P12 (AD-20): the session's CSRF token, or an allowed
  // Origin for a guest.
  @UseGuards(OptionalSessionCsrfGuard, JsonOnlyGuard)
  @UsePipes(new ZodValidationPipe(internalFormSubmissionInputSchema))
  async submitSurvey(
    @Param('id', ParseUUIDPipe) formId: string,
    @Body() body: InternalFormSubmissionInput,
    @Req() req: Request,
  ) {
    return this.submitForm(formId, body, req);
  }

  @Post('forms/:id/attempts/:attemptId/verify-code')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard, JsonOnlyGuard)
  @UsePipes(new ZodValidationPipe(verifyExternalCompletionCodeInputSchema))
  async verifyFormAttemptCode(
    @Param('id', ParseUUIDPipe) formId: string,
    @Param('attemptId', ParseUUIDPipe) attemptId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: VerifyExternalCompletionCodeInput,
  ) {
    const result = await this.participationService.verifyExternalCompletionCode(
      formId,
      attemptId,
      user.id,
      body,
    );
    return createSuccessEnvelope(result);
  }

  @Post('surveys/:id/attempts/:attemptId/verify-code')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard, JsonOnlyGuard)
  @UsePipes(new ZodValidationPipe(verifyExternalCompletionCodeInputSchema))
  async verifySurveyAttemptCode(
    @Param('id', ParseUUIDPipe) formId: string,
    @Param('attemptId', ParseUUIDPipe) attemptId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: VerifyExternalCompletionCodeInput,
  ) {
    return this.verifyFormAttemptCode(formId, attemptId, user, body);
  }

  @Post('attempts/:attemptId/verify-code')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard, JsonOnlyGuard)
  @UsePipes(new ZodValidationPipe(verifyExternalCompletionCodeInputSchema))
  async verifyAttemptCode(
    @Param('attemptId', ParseUUIDPipe) attemptId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: VerifyExternalCompletionCodeInput,
  ) {
    const result = await this.participationService.verifyExternalCompletionCode(
      null,
      attemptId,
      user.id,
      body,
    );
    return createSuccessEnvelope(result);
  }

  @Post('forms/:id/attempts/:attemptId/report-missing-code')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard, JsonOnlyGuard)
  @UsePipes(new ZodValidationPipe(reportMissingCompletionCodeInputSchema))
  async reportFormAttemptMissingCode(
    @Param('id', ParseUUIDPipe) formId: string,
    @Param('attemptId', ParseUUIDPipe) attemptId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ReportMissingCompletionCodeInput,
  ) {
    const result = await this.participationService.reportMissingCompletionCode(
      formId,
      attemptId,
      user.id,
      body,
    );
    return createSuccessEnvelope(result);
  }

  @Post('surveys/:id/attempts/:attemptId/report-missing-code')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard, JsonOnlyGuard)
  @UsePipes(new ZodValidationPipe(reportMissingCompletionCodeInputSchema))
  async reportSurveyAttemptMissingCode(
    @Param('id', ParseUUIDPipe) formId: string,
    @Param('attemptId', ParseUUIDPipe) attemptId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ReportMissingCompletionCodeInput,
  ) {
    return this.reportFormAttemptMissingCode(formId, attemptId, user, body);
  }

  @Post('attempts/:attemptId/report-missing-code')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard, JsonOnlyGuard)
  @UsePipes(new ZodValidationPipe(reportMissingCompletionCodeInputSchema))
  async reportAttemptMissingCode(
    @Param('attemptId', ParseUUIDPipe) attemptId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ReportMissingCompletionCodeInput,
  ) {
    const result = await this.participationService.reportMissingCompletionCode(
      null,
      attemptId,
      user.id,
      body,
    );
    return createSuccessEnvelope(result);
  }
}
