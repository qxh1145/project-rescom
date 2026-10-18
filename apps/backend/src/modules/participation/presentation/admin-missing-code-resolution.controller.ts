import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ResolveMissingCodeReportInput,
  resolveMissingCodeReportSchema,
} from '@rescom/schemas';
import { SessionAuthGuard } from '../../auth/presentation/guards/session-auth.guard';
import { RolesGuard } from '../../auth/presentation/guards/roles.guard';
import { CsrfGuard } from '../../auth/presentation/guards/csrf.guard';
import { CurrentUser, Roles } from '../../auth/presentation/decorators';
import { AuthenticatedUser } from '../../auth/presentation/types/authenticated-request.type';
import { JsonOnlyGuard } from '../../../common/http/json-only.guard';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe';
import { createSuccessEnvelope } from '../../../common/http/response.envelope';
import { ParticipationService } from '../application/participation.service';

/**
 * Story 14.1 (AC 1): Admin resolution of open missing-completion-code reports.
 * POST /admin/missing-code-reports/:attemptId/resolve
 */
@Controller([
  'admin/missing-code-reports',
  'api/admin/missing-code-reports',
])
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminMissingCodeResolutionController {
  constructor(private readonly participationService: ParticipationService) {}

  @Post(':attemptId/resolve')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard, JsonOnlyGuard)
  async resolve(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('attemptId', ParseUUIDPipe) attemptId: string,
    @Body(new ZodValidationPipe(resolveMissingCodeReportSchema))
    body: ResolveMissingCodeReportInput,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    const result = await this.participationService.resolveMissingCodeReport(
      admin.id,
      attemptId,
      body,
      { correlationId },
    );
    return createSuccessEnvelope(result, {
      message: result.replayed
        ? 'Missing code report was already resolved'
        : result.outcome === 'CREDIT_RESPONDENT'
          ? 'Respondent credited with pending reward'
          : 'Missing code report dismissed',
    });
  }
}
