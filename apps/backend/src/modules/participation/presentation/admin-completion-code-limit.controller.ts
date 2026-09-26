import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  CompletionCodeLimitResetRequest,
  completionCodeLimitResetRequestSchema,
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
 * Code-review decision E5-D1 (2026-09-26, option B): Admin recovery of the
 * account+FormVersion completion-code limit (`completion-code-policy-v1`:
 * 3 wrong codes lock an attempt, 6 per account and version refuse further
 * attempts; provisional pending PRD Open Question 14). There is no automatic
 * reset: after investigating (e.g. an FR-23 missing-code report or an honest
 * mistyper), an Admin forgives the counted wrong codes so the respondent can
 * start a new attempt. The reset is recorded (Admin, reason, count); the
 * locked attempts and their FraudLog evidence are never changed.
 */
@Controller([
  'admin/completion-code-limits',
  'api/admin/completion-code-limits',
])
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminCompletionCodeLimitController {
  constructor(private readonly participationService: ParticipationService) {}

  @Post('reset')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard, JsonOnlyGuard)
  async reset(
    @CurrentUser() admin: AuthenticatedUser,
    @Body(new ZodValidationPipe(completionCodeLimitResetRequestSchema))
    body: CompletionCodeLimitResetRequest,
  ) {
    const result = await this.participationService.resetCompletionCodeLimit(
      admin.id,
      body,
    );
    return createSuccessEnvelope(result, {
      message:
        result.failuresForgiven > 0
          ? 'Completion-code limit reset for this account and survey version.'
          : 'Nothing to reset: no wrong completion codes are counted for this account and survey version.',
    });
  }
}
