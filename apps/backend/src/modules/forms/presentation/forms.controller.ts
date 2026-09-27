import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import {
  closeFormSchema,
  CloseFormInput,
  CreateExternalSurveyInput,
  createExternalSurveySchema,
  CreateFormDraftInput,
  createFormDraftSchema,
  formStatusTransitionSchema,
  FormStatusTransitionInput,
  idempotencyKeySchema,
  listFormsQuerySchema,
  ListFormsQuery,
  publishFormSchema,
  PublishFormInput,
  reopenSurveySchema,
  ReopenSurveyInput,
  RotateCompletionCodeInput,
  rotateCompletionCodeSchema,
} from '@rescom/schemas';
import { FormsService } from '../application/forms.service';
import { FormConflictException } from '../application/exceptions/form.exceptions';
import { SessionAuthGuard } from '../../auth/presentation/guards/session-auth.guard';
import { CsrfGuard } from '../../auth/presentation/guards/csrf.guard';
import { CurrentUser } from '../../auth/presentation/decorators';
import { AuthenticatedUser } from '../../auth/presentation/types/authenticated-request.type';
import { JsonOnlyGuard } from '../../../common/http/json-only.guard';
import { ParseUUIDPipe } from '../../../common/http/parse-uuid.pipe';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe';
import { createSuccessEnvelope } from '../../../common/http/response.envelope';

@Controller(['forms', 'api/forms'])
@UseGuards(SessionAuthGuard)
export class FormsController {
  constructor(private readonly formsService: FormsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(CsrfGuard, JsonOnlyGuard)
  @UsePipes(new ZodValidationPipe(createFormDraftSchema))
  async createDraft(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateFormDraftInput,
  ) {
    const created = await this.formsService.createDraft(user.id, dto);
    return createSuccessEnvelope(created, {
      message: 'Form draft created successfully',
    });
  }

  @Post('external')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(CsrfGuard, JsonOnlyGuard)
  @UsePipes(new ZodValidationPipe(createExternalSurveySchema))
  async createExternalSurvey(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateExternalSurveyInput,
    // Phase 5 C6: optional; a retry with the same key replays the survey.
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    let key: string | undefined;
    if (idempotencyKey !== undefined) {
      const parsed = idempotencyKeySchema.safeParse(idempotencyKey);
      if (!parsed.success) {
        throw new BadRequestException({
          code: 'INVALID_IDEMPOTENCY_KEY',
          message: parsed.error.errors[0]?.message ?? 'Invalid Idempotency-Key',
        });
      }
      key = parsed.data;
    }
    const created = await this.formsService.createExternalSurvey(
      user.id,
      dto,
      key,
    );
    return createSuccessEnvelope(created, {
      message: created.idempotentReplay
        ? 'External survey already created with this Idempotency-Key'
        : 'External survey created successfully',
    });
  }

  @Get()
  @UsePipes(
    new ZodValidationPipe(listFormsQuerySchema, 'VALIDATION_ERROR', 'query'),
  )
  async listForms(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListFormsQuery,
  ) {
    const result = await this.formsService.listForms(user.id, query);
    return createSuccessEnvelope(result);
  }

  @Get(':id')
  async getForm(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const form = await this.formsService.getFormById(id, {
      userId: user.id,
      role: user.role,
    });
    return createSuccessEnvelope(form);
  }

  @Patch(':id/draft')
  @UseGuards(CsrfGuard, JsonOnlyGuard)
  async updateDraft(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body()
    rawDto: unknown,
  ) {
    try {
      const updated = await this.formsService.updateDraft(
        id,
        {
          userId: user.id,
          role: user.role,
        },
        rawDto,
      );
      return createSuccessEnvelope(updated, {
        message: 'Form draft autosaved successfully',
      });
    } catch (err) {
      // Map domain-level optimistic lock conflict to HTTP 409 Conflict so the
      // frontend knows to reload and retry rather than silently losing data.
      if (err instanceof FormConflictException) {
        throw new ConflictException({
          code: err.code,
          message: err.message,
        });
      }
      throw err;
    }
  }

  @Delete(':id')
  @UseGuards(CsrfGuard)
  async deleteDraft(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.formsService.deleteDraft(id, {
      userId: user.id,
      role: user.role,
    });
    return createSuccessEnvelope(
      { id },
      { message: 'Form draft deleted successfully' },
    );
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard, JsonOnlyGuard)
  async publishForm(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(publishFormSchema))
    dto?: PublishFormInput,
  ) {
    const published = await this.formsService.publishForm(
      id,
      {
        userId: user.id,
        role: user.role,
      },
      dto,
    );
    return createSuccessEnvelope(published, {
      message: 'Form published successfully',
    });
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard, JsonOnlyGuard)
  async closeForm(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(closeFormSchema))
    dto?: CloseFormInput,
  ) {
    const closed = await this.formsService.closeForm(
      id,
      {
        userId: user.id,
        role: user.role,
      },
      dto,
    );
    return createSuccessEnvelope(closed, {
      message: 'Form closed successfully',
    });
  }

  @Post(':id/reopen')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard, JsonOnlyGuard)
  async reopenForm(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(reopenSurveySchema))
    dto: ReopenSurveyInput,
  ) {
    const reopened = await this.formsService.reopenForm(
      id,
      {
        userId: user.id,
        role: user.role,
      },
      dto,
    );
    return createSuccessEnvelope(reopened, {
      message: 'Form reopened successfully with additional quota',
    });
  }

  @Get(':id/pricing-quote')
  async getPricingQuote(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const quote = await this.formsService.getPricingQuote(id, {
      userId: user.id,
      role: user.role,
    });
    return createSuccessEnvelope(quote);
  }

  @Post(':id/status')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard, JsonOnlyGuard)
  async transitionStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(formStatusTransitionSchema))
    dto: FormStatusTransitionInput,
  ) {
    const updated = await this.formsService.transitionStatus(
      id,
      {
        userId: user.id,
        role: user.role,
      },
      dto,
    );
    return createSuccessEnvelope(updated, {
      message: 'Form status updated successfully',
    });
  }

  /**
   * Decision E5-D4: respondents currently taking the survey, whom "Create New
   * Version" would cut off (the builder warns before confirming).
   */
  @Get(':id/in-progress-attempts')
  async getInProgressAttempts(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const result = await this.formsService.getInProgressAttempts(id, {
      userId: user.id,
      role: user.role,
    });
    return createSuccessEnvelope(result);
  }

  @Post(':id/versions')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(CsrfGuard)
  async createNewVersion(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const result = await this.formsService.createNewVersion(id, {
      userId: user.id,
      role: user.role,
    });
    return createSuccessEnvelope(result, {
      message:
        result.interruptedAttempts > 0
          ? `New form version created successfully. The form is now in DRAFT status for editing; ${result.interruptedAttempts} in-progress attempt(s) on the previous version were cut off.`
          : 'New form version created successfully. The form is now in DRAFT status for editing.',
    });
  }

  @Get(':id/versions')
  async listVersions(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const versions = await this.formsService.listVersions(id, {
      userId: user.id,
      role: user.role,
    });
    return createSuccessEnvelope(versions);
  }

  @Post(':id/rotate-code')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard, JsonOnlyGuard)
  async rotateCompletionCode(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(rotateCompletionCodeSchema))
    dto?: RotateCompletionCodeInput,
  ) {
    const result = await this.formsService.rotateCompletionCode(
      id,
      {
        userId: user.id,
        role: user.role,
      },
      dto,
    );
    return createSuccessEnvelope(result, {
      message: 'Completion code rotated successfully',
    });
  }
}
