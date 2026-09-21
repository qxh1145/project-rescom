import {
  Body,
  Controller,
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
} from '@rescom/schemas';
import { ParticipationService } from '../application/participation.service';
import { SessionAuthGuard } from '../../auth/presentation/guards/session-auth.guard';
import { CsrfGuard } from '../../auth/presentation/guards/csrf.guard';
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
  ) {
    const callerUserId = (req as any).user?.id ?? null;
    const result = await this.participationService.recordTelemetryEvents(
      formId,
      attemptId,
      callerUserId,
      body,
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
  ) {
    return this.ingestFormAttemptTelemetry(formId, attemptId, body, req);
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
  ) {
    const callerUserId = (req as any).user?.id ?? null;
    const result = await this.participationService.recordResponseTelemetryEvents(
      responseId,
      callerUserId,
      body,
    );
    return createSuccessEnvelope(result);
  }
}

