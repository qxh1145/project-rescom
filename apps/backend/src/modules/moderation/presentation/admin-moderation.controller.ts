import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApproveSurveyModerationInput,
  ListModerationQueueQuery,
  RejectSurveyModerationInput,
  approveSurveyModerationSchema,
  listModerationQueueQuerySchema,
  rejectSurveyModerationSchema,
} from '@rescom/schemas';
import { SessionAuthGuard } from '../../auth/presentation/guards/session-auth.guard';
import { RolesGuard } from '../../auth/presentation/guards/roles.guard';
import { CsrfGuard } from '../../auth/presentation/guards/csrf.guard';
import { CurrentUser, Roles } from '../../auth/presentation/decorators';
import { AuthenticatedUser } from '../../auth/presentation/types/authenticated-request.type';
import { JsonOnlyGuard } from '../../../common/http/json-only.guard';
import { ParseUUIDPipe } from '../../../common/http/parse-uuid.pipe';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe';
import { createSuccessEnvelope } from '../../../common/http/response.envelope';
import { SurveyModerationService } from '../application/survey-moderation.service';

/**
 * Admin Moderation Dashboard API (Story 8.1, FR-20/FR-53). `RolesGuard`
 * checks the session role; the service re-verifies the live Admin capability
 * inside the decision transaction (AD-16).
 */
@Controller(['admin/moderation/surveys', 'api/admin/moderation/surveys'])
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminModerationController {
  constructor(private readonly moderationService: SurveyModerationService) {}

  /** Surveys awaiting moderation, oldest submission first. */
  @Get()
  async listQueue(
    @Query(
      new ZodValidationPipe(
        listModerationQueueQuerySchema,
        'VALIDATION_ERROR',
        'query',
      ),
    )
    query: ListModerationQueueQuery,
  ) {
    const result = await this.moderationService.listQueue(query);
    return createSuccessEnvelope(result);
  }

  /** Preview: metadata, escrow, targeting, Form Definition and decision. */
  @Get(':formId')
  async getSurvey(@Param('formId', ParseUUIDPipe) formId: string) {
    const result = await this.moderationService.getSurvey(formId);
    return createSuccessEnvelope(result);
  }

  @Post(':formId/approve')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard, JsonOnlyGuard)
  async approve(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('formId', ParseUUIDPipe) formId: string,
    @Body(new ZodValidationPipe(approveSurveyModerationSchema))
    body: ApproveSurveyModerationInput,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    const result = await this.moderationService.approve({
      formId,
      adminId: admin.id,
      input: body,
      correlationId,
    });
    return createSuccessEnvelope(result, {
      message: result.replayed
        ? 'Survey was already approved'
        : 'Survey approved and published',
    });
  }

  @Post(':formId/reject')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard, JsonOnlyGuard)
  async reject(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('formId', ParseUUIDPipe) formId: string,
    @Body(new ZodValidationPipe(rejectSurveyModerationSchema))
    body: RejectSurveyModerationInput,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    const result = await this.moderationService.reject({
      formId,
      adminId: admin.id,
      input: body,
      correlationId,
    });
    return createSuccessEnvelope(result, {
      message: result.replayed
        ? 'Survey was already rejected'
        : 'Survey rejected and escrow refunded',
    });
  }
}
