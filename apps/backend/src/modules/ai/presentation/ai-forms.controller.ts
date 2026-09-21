import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import {
  aiPromptSubmissionSchema,
  AiPromptSubmissionInput,
} from '@rescom/schemas';
import { AiPromptService } from '../application/ai-prompt.service';
import { SessionAuthGuard } from '../../auth/presentation/guards/session-auth.guard';
import { CsrfGuard } from '../../auth/presentation/guards/csrf.guard';
import { CurrentUser } from '../../auth/presentation/decorators';
import { AuthenticatedUser } from '../../auth/presentation/types/authenticated-request.type';
import { JsonOnlyGuard } from '../../../common/http/json-only.guard';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe';
import { createSuccessEnvelope } from '../../../common/http/response.envelope';

// NOTE — RBAC intentional design decision:
// Per Story 2.2 / architecture spec, every ACTIVE authenticated user has
// Publisher capability (a user can act as both Publisher and Respondent).
// The DB default role is RESPONDENT, so adding RolesGuard('PUBLISHER','ADMIN')
// here would silently block all RESPONDENT-role users from AI form generation.
// SessionAuthGuard (authentication + account-not-locked check) is the correct
// and sufficient gate for this endpoint.
@Controller('forms/ai')
@UseGuards(SessionAuthGuard)
export class AiFormsController {
  constructor(private readonly aiPromptService: AiPromptService) {}

  @Post('prepare-prompt')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard, JsonOnlyGuard)
  @UsePipes(new ZodValidationPipe(aiPromptSubmissionSchema))
  async preparePrompt(
    @CurrentUser() _user: AuthenticatedUser,
    @Body() dto: AiPromptSubmissionInput,
  ) {
    const payload = this.aiPromptService.buildPromptPayload(dto);
    return createSuccessEnvelope(payload, {
      message: 'AI prompt payload prepared successfully',
    });
  }
}
